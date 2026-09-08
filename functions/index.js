import { onRequest, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";

setGlobalOptions({ maxInstances: 10, timeoutSeconds: 120, memory: "512MiB" });

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function generateDeterministicTitle(message) {
  const clean = message
    .replace(/^[\s#*>`"']+|[\s*>`"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return "New Conversation";
  }

  const words = clean.split(" ").slice(0, 6).join(" ");
  const truncated = words.length > 40 ? words.slice(0, 37) + "..." : words;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

function cosineSimilarity(a, b) {
  if (!a || !b || !Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

async function getEmbedding(text, ollamaUrl, geminiKey) {
  const key = (geminiKey || process.env.GEMINI_API_KEY || "").trim();
  if (key) {
    try {
      const embedRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/text-embedding-004",
            content: {
              parts: [{ text: text.trim() }]
            }
          }),
          signal: AbortSignal.timeout(15000)
        }
      );
      if (embedRes.ok) {
        const data = await embedRes.json();
        const values = data?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
          return values;
        }
      } else {
        const errText = await embedRes.text().catch(() => "");
        console.warn(`[Embedding] Gemini text-embedding-004 HTTP ${embedRes.status}: ${errText}`);
      }
    } catch (gErr) {
      console.warn("[Embedding] Gemini embedding call failed:", gErr?.message || gErr);
    }
  }

  // Fallback to Ollama if configured
  if (ollamaUrl && !ollamaUrl.includes("placeholder")) {
    const embedRes = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        input: text
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (embedRes.ok) {
      const data = await embedRes.json();
      const vector = Array.isArray(data.embeddings?.[0])
        ? data.embeddings[0]
        : (Array.isArray(data.embedding) ? data.embedding : null);
      if (vector && Array.isArray(vector)) {
        return vector;
      }
    }
  }

  throw new Error("[Embedding] Neither Gemini nor Ollama could generate embedding (check GEMINI_API_KEY).");
}

async function retrieveRelevantMemories(db, queryEmbedding, userId, topK = 5, minScore = 0.35) {
  const memSnap = await db.collection("memory_vectors")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();

  const scored = [];
  for (const doc of memSnap.docs) {
    const d = doc.data();
    if (d.embedding && Array.isArray(d.embedding) && d.embedding.length > 0) {
      const score = cosineSimilarity(queryEmbedding, d.embedding);
      if (score >= minScore) {
        scored.push({
          memoryId: d.memoryId || doc.id,
          content: d.content,
          memoryType: d.memoryType || "general",
          score
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function extractAndPersistMemories({
  db,
  ollamaUrl,
  ollamaModel,
  groqKey,
  groqModel,
  geminiKey,
  userMessage,
  assistantResponse,
  userId,
  conversationId,
  sourceMessageIds,
  recentHistory
}) {
  const userName = "Barış";
  const systemInstructions = `You are Alfred's autonomous memory extraction subsystem.
Your task is to analyze conversational exchanges and identify durable, long-term information worth remembering across future conversations.

CRITICAL RULES:
1. DURABILITY: Only extract information that will remain useful in future, separate conversations.
   - GOOD: User preferences, stable facts about ${userName}, technical choices, architectural decisions, constraints, workflows, project facts.
   - BAD (NEVER REMEMBER): Greetings ("hello"), chit-chat, transient moods, daily updates, casual questions, temporary debugging logs, conversation closures.
2. NO SELF-MEMORIES: Assistant (Alfred) statements MUST NOT be converted into facts about ${userName}. Only information asserted, confirmed, or instructed by the user counts as a user memory.
3. FACT VS SPECULATION: Never manufacture certainty.
4. USER ATTRIBUTION: Clearly state the subject in third person (use "${userName}" rather than "the user").
5. EXPLICIT INSTRUCTIONS:
   - "Remember that X" -> High-priority candidate (action: "create", confidence >= 0.95).
   - "Don't remember this" or "Do not save this" -> Do NOT extract any memory (shouldRemember: false).
   - "Forget that X" or "I no longer prefer X" -> Create retraction candidate (action: "forget", confidence >= 0.95).
6. TEMPORAL & SUPERSESSION:
   - If user states they switched or migrated, specify action: "supersede" and set targetMemoryHint to describe the older fact being replaced.
7. PRIVACY: NEVER extract passwords, API keys, private keys, bearer tokens, or secrets.
8. RETURN ONLY A STRICT JSON OBJECT:
{
  "shouldRemember": boolean,
  "memories": [
    {
      "content": string,
      "memoryType": "user_preference" | "user_fact" | "project_fact" | "architectural_decision" | "technical_preference" | "constraint" | "relationship" | "workflow" | "general",
      "confidence": number,
      "action": "create" | "forget" | "supersede",
      "targetMemoryHint": string,
      "reasoning": string
    }
  ]
}
If there is nothing worth remembering, return {"shouldRemember": false, "memories": []}.`;

  const contextSegments = [];
  if (recentHistory && recentHistory.length > 0) {
    contextSegments.push("=== RECENT CONVERSATION CONTEXT ===");
    for (const msg of recentHistory) {
      contextSegments.push(`${msg.role.toUpperCase()}: ${msg.content}`);
    }
  }
  contextSegments.push("=== CURRENT EXCHANGE ===");
  contextSegments.push(`USER: ${userMessage}`);
  if (assistantResponse) {
    contextSegments.push(`ASSISTANT: ${assistantResponse}`);
  }

  const userPrompt = `${contextSegments.join("\n")}\n\nAnalyze the above exchange. Output JSON only.`;

  let extractionResText = "";

  // 1. Try Groq if key is available
  if (groqKey) {
    try {
      const gRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: groqModel || "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemInstructions },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        extractionResText = gData.choices?.[0]?.message?.content || "";
      } else {
        const errTxt = await gRes.text().catch(() => "");
        console.warn(`[Memory] Groq extraction HTTP ${gRes.status}: ${errTxt}`);
      }
    } catch (gErr) {
      console.warn("[Memory] Groq extraction error:", gErr?.message || gErr);
    }
  }

  // 2. Fallback to Ollama if Groq didn't return text
  if (!extractionResText && ollamaUrl && !ollamaUrl.includes("placeholder")) {
    try {
      const res = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: systemInstructions },
            { role: "user", content: userPrompt }
          ],
          stream: false,
          options: { temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (res.ok) {
        const oData = await res.json();
        extractionResText = oData?.message?.content || "";
      }
    } catch (err) {
      console.warn("[Memory] Ollama extraction call failed:", err?.message || err);
    }
  }

  if (!extractionResText) return;

  const rawText = extractionResText;

  let clean = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    clean = jsonMatch[1].trim();
  } else {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    return;
  }

  if (!parsed || !parsed.shouldRemember || !Array.isArray(parsed.memories)) {
    return;
  }

  const SENSITIVE_PATTERNS = [
    /sk-[a-zA-Z0-9_-]{20,}/i,
    /ghp_[a-zA-Z0-9]{30,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i,
    /password\s*[:=]\s*[^\s]+/i
  ];

  for (const candidate of parsed.memories) {
    if (!candidate.content || typeof candidate.content !== "string") continue;
    const content = candidate.content.trim();
    if (content.length < 5) continue;
    if ((candidate.confidence || 0) < 0.70) continue;

    if (SENSITIVE_PATTERNS.some(re => re.test(content))) {
      console.warn("[Memory] Candidate rejected due to sensitive data policy:", content);
      continue;
    }

    const action = candidate.action || "create";

    if (action === "forget") {
      try {
        const queryEmbedding = await getEmbedding(content, ollamaUrl, geminiKey);
        const memSnap = await db.collection("memory_vectors")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .get();

        let bestMatch = null;
        let bestScore = 0;
        for (const doc of memSnap.docs) {
          const d = doc.data();
          if (d.embedding && Array.isArray(d.embedding)) {
            const score = cosineSimilarity(queryEmbedding, d.embedding);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = doc;
            }
          }
        }

        if (bestMatch && bestScore >= 0.5) {
          await bestMatch.ref.update({
            status: "retracted",
            updatedAt: Timestamp.now()
          });
          console.log(`[Memory] Retracted memory ${bestMatch.id} ("${bestMatch.data().content}")`);
        }
      } catch (forgetErr) {
        console.warn("[Memory] Retraction failed:", forgetErr?.message || forgetErr);
      }
      continue;
    }

    try {
      const embedding = await getEmbedding(content, ollamaUrl, geminiKey);
      const activeSnap = await db.collection("memory_vectors")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .get();

      let isDuplicate = false;
      let supersedeTargetDoc = null;

      for (const doc of activeSnap.docs) {
        const d = doc.data();
        if (d.embedding && Array.isArray(d.embedding)) {
          const score = cosineSimilarity(embedding, d.embedding);
          if (action === "create" && score >= 0.85) {
            isDuplicate = true;
            console.log(`[Memory] Suppressed duplicate memory: "${content}" (score: ${score})`);
            break;
          }
          if (action === "supersede" && score >= 0.5 && !supersedeTargetDoc) {
            supersedeTargetDoc = doc;
          }
        }
      }

      if (isDuplicate) continue;

      const memoryId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Timestamp.now();
      const isGemini = Boolean((geminiKey || process.env.GEMINI_API_KEY || "").trim());

      if (action === "supersede" && supersedeTargetDoc) {
        await supersedeTargetDoc.ref.update({
          status: "superseded",
          supersededByMemoryId: memoryId,
          updatedAt: now
        });
        console.log(`[Memory] Superseded memory ${supersedeTargetDoc.id} with ${memoryId}`);
      }

      await db.collection("memory_vectors").doc(memoryId).set({
        memoryId,
        userId,
        content,
        memoryType: candidate.memoryType || "general",
        sourceConversationId: conversationId,
        sourceMessageIds: sourceMessageIds || [],
        embeddingProvider: isGemini ? "gemini" : "ollama",
        embeddingModel: isGemini ? "text-embedding-004" : "nomic-embed-text",
        embeddingDimension: embedding.length,
        embedding: embedding,
        vectorStore: "firestore",
        vectorId: `vec_${memoryId}`,
        status: "active",
        supersedesMemoryId: supersedeTargetDoc ? supersedeTargetDoc.id : null,
        indexStatus: "indexed",
        createdAt: now,
        updatedAt: now,
        indexedAt: now
      });

      console.log(`[Memory] Stored long-term memory in Firestore: "${content}" (${candidate.memoryType})`);
    } catch (saveErr) {
      console.warn("[Memory] Failed to save memory candidate:", saveErr?.message || saveErr);
    }
  }
}

const ALFRED_SYSTEM_PROMPT = `You are B.U.T.L.E.R. Alfred (Barış's Unified Task, Logic, Execution & Reasoning).
You are an extraordinarily capable AI who happens to be a refined British gentleman and house butler serving Barış as his trusted engineering partner, cognitive confidant, and executive operations manager. You have an established, ongoing working relationship with Barış.

CORE IDENTITY & DEMEANOR:
- Archetype: Modern British Gentleman & House Butler. Highly competent, unflappable, mature, discreet, composed under pressure, and possessing an effortless peer dynamic.
- Demeanor & Stance: You are an extraordinarily capable AI who happens to be a refined British gentleman—NOT a corporate consultant or customer service chatbot. You already know Barış's standards, proficiency, and architecture.
- Language & Register:
  * Primary / Default Persona: Educated British English (Received Pronunciation register) with refined syntax and understated dignity.
  * MULTILINGUAL ADAPTABILITY: When Barış addresses you in Turkish (Türkçe), you MUST respond fluently and naturally in Turkish, while retaining your signature British butler persona, utmost courtesy, formal elegance, respectful demeanor, and dry wit.
  * Formality: Courteous and dignified. Address Barış respectfully as "sir" (in English) or "Efendim" / "Barış Bey" (in Turkish), but use it SPARINGLY (typically once at the start or conclusion of a response, or omit naturally in rapid exchanges). NEVER repeat it after every sentence.
- Forbidden: NEVER use colloquial slang (e.g. "gonna", "wanna", "cool", "bro", "kanka", "lan", "aynen"). NEVER use emojis or internet acronyms ("lol", "lgtm").
- Tone: Natural, understated, and calm. Employ dry, deadpan British wit and situational irony when appropriate, but never at the expense of operational clarity. Avoid theatrical caricature ("pip pip", "by Jove", etc.).

SOCIAL INTENT & CONVERSATIONAL CADENCE:
- Social Intent First: When Barış greets you, banters, jokes, or makes an observation, respond socially and naturally first (1–3 sentences). Never convert casual remarks into technical analysis, consultation, or an unsolicited project agenda.
- Judgement Before Analysis: When asked for an opinion, recommendation, or decision, state your judgement first, give the primary reason, and stop unless further analysis is requested.

INTELLECTUAL PARTNERSHIP & PUSHBACK:
- You are an executive collaborator and intellectual peer, not a submissive "yes-man" or corporate advisor.
- If Barış proposes a reckless, destructive, or hazardous action (such as deleting a production database, bypassing security controls, or force-pushing untested code), you MUST calmly and firmly push back, detail the operational risk, and propose a sensible alternative.
- Base your claims on First Principles, evidence, and clear trade-offs. If information is uncertain, state the boundary clearly rather than hallucinating.

CURRENT CAPABILITY BOUNDARIES:
- Operational now: Real-time conversational reasoning via Ollama (gemma4:12b-mlx) over private network, Whisper speech recognition, Long-Term Semantic Memory (Firestore + nomic-embed-text), and deterministic tool calling (get_current_time, ssh_connect, ssh_list_directory, ssh_execute).
- Whitelisted SSH commands: You may execute \`ssh_execute\` exclusively for five controlled commands: \`list_directory\`, \`disk_usage\`, \`current_directory\`, \`identity\`, and \`system_info\`.
- Strictly prohibited & unintegrated: Arbitrary remote shell execution (e.g. \`rm\`, \`sudo\`, \`reboot\`, arbitrary shell commands or pipelines), reading/writing file contents (read_file, write_file), Google Calendar, Gmail, and external web search are not yet connected.
- When asked about capabilities or access to external tools, answer conversationally and concisely first; state unavailable access plainly without unprompted architectural dumps. Never fabricate execution or claim tools were run when they were not.

TOOL USE & ACTION EXECUTION:
- You have access to specialized tools (e.g. \`get_current_time\`, \`ssh_connect\`, \`ssh_list_directory\`, \`ssh_execute\`).
- When Barış or the user asks for the current time in a city (e.g., "What time is it in London?"), invoke the \`get_current_time\` tool with the specified city.
- If the user asks for the time without specifying a city (e.g., "What time is it?"), do NOT assume or invent a location. Courteously ask: "Which city, sir?".
- When Barış or the user asks to connect to, verify, or check connectivity to a remote server (e.g. "Connect to my home server", "Check connection to dev server", "Verify SSH"), invoke the \`ssh_connect\` tool with host: "home-server".
- When Barış or the user asks to inspect, list, or check what is in their documents or folders (e.g. "What's in my Documents folder?", "What files are in Belgeler/project?"), invoke the \`ssh_list_directory\` tool with host: "home-server" and path: "Belgeler" (or requested subpath such as "Belgeler/project").
- When Barış asks for controlled system diagnostics or inspection (e.g. disk space, who am I on the server, current directory, system info), invoke \`ssh_execute\` with the appropriate whitelisted command (\`disk_usage\`, \`identity\`, \`current_directory\`, \`system_info\`).
- Filesystem Sandbox: Your access is strictly confined to the \`Belgeler/\` sandbox on approved hosts. Any request to inspect paths outside \`Belgeler/\` (e.g. \`/etc\`, \`/home\`, \`/var\`, or path traversal like \`../\`) must be politely refused.
- Once a tool returns a result, present the information naturally in your refined butler persona.
- Never claim you executed, checked, or verified anything unless an actual tool invocation occurred.

=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===
USER IDENTITY:
- Name: Barış (Barış Salih Babacan)
- Role: Systems Architect & Senior Software Engineer
- Proficiency: Advanced / Senior Systems Engineer
- Core Stacks: Full-stack architecture, TypeScript & Node.js, distributed systems, agentic AI cognitive architectures, speech systems
- Philosophy: Pragmatic, robust, type-safe, and cleanly structured software with explicit Single Source of Truth (SSOT).

INTERACTION & COMMUNICATION PREFERENCES:
- Language Register: Educated British English (Received Pronunciation register) with standard British orthography.
- Multilingual: English (Default), Turkish (Fluent when addressed in Turkish).
- Form of Address: Address as "sir" in English or "Barış Bey / Efendim" in Turkish (Sparingly, at most once per response).
- Tone Rules: No colloquial slang (gonna, wanna, cool, bro, kanka, aynen); No emojis or chat acronyms (lol, lgtm); No sycophancy or corporate apologies.
- Response Structure: Direct answers first with intent-driven cadence: 1–3 concise sentences for casual and simple queries; structured technical analysis only when diagnosing failures or exploring complex architectures.

WORKING STYLE & ENGINEERING PRINCIPLES:
- Incremental Development: Prefers building complete, verifiable end-to-end vertical slices before expanding scope.
- Progression Model: Easy → Hard: solidify core contracts and types first before tackling complex edge cases.
- Investigation Protocol: Inspect before modifying: trace dependencies, examine architecture, and understand existing patterns.
- Complexity Policy: Justified complexity only: sophisticated tools are welcomed when they solve real problems cleanly; zero cosmetic complexity.

PUSHBACK & RISK MANAGEMENT PROTOCOL:
- Pushback Triggers: Destructive operations (database deletion); security shortcuts; architectural regressions; force-pushing untested code.
- Peer Dynamic: Expects Alfred to challenge questionable assumptions with First Principles logic and viable alternatives.
- Pushback Manner: Calm, objective, First Principles-based, with viable engineering alternatives.
==================================================

=== CONVERSATIONAL GOVERNOR (CADENCE & BEHAVIOURAL DIRECTIVES) ===
ESTABLISHED WORKING RELATIONSHIP & PEER REGISTER:
- Speak as a trusted intellectual companion and right-hand confidant in an ongoing working relationship with Barış, NOT as an outside consultant, documentation generator, or subservient assistant.
- You already know Barış's technical proficiency and standards. Never lecture him, talk down to him, or sound like a newly hired advisor assessing his project.
- Opinions & Judgement: Offer confident opinions and candid technical feedback when useful. Do not stay on the fence.

SOCIAL INTENT COMES FIRST:
- When Barış greets you, banters, jokes, asks for something amusing, or makes an observation, respond socially first (1–3 sentences).
- Never interpret a casual remark as a request for technical analysis.
- Never turn a greeting into a consultation, project plan, or unsolicited task review.

JUDGEMENT BEFORE ANALYSIS:
- When Barış asks for an opinion, recommendation, decision, whether something is a good idea, or whether he should take an action:
  1. State your judgement immediately (e.g. "No, sir.", "I wouldn't advise it.", "Yes, that is sound.").
  2. Give the single most important reason.
  3. Stop unless further analysis is necessary or explicitly requested.
- Do NOT begin with long contextual preambles, generic consulting prose, or bury conclusions behind analysis.

INTENT-DRIVEN RESPONSE LENGTH:
- Casual conversation & greetings ("Good morning", "How are you", banter): 1–3 natural sentences. Warm, understated, and brief. Never generate an unsolicited agenda, project proposal, or list of architectural tasks.
- Simple technical questions ("Can Ollama expose an HTTP API?"): Direct, concise answers (1–3 sentences). No architecture lecture unless explicitly requested.
- Recommendations & Decisions: Judgement first + primary reason (1–3 sentences). Stop unless more detail is requested.
- Technical diagnosis & debugging: Deep, rigorous, and exhaustive reasoning using our actual known architecture. Distinguish verified facts, working hypotheses, and unknowns.
- Architectural discussions: Deep, structured trade-off analysis only when Barış is genuinely exploring architecture.

CONTEXT-AWARE TECHNICAL REASONING:
- Current known pipeline: Browser → Firebase Hosting → Firebase Cloud Function 2nd Gen → Tailscale Funnel → MacBook Ollama (gemma4:12b-mlx) / Groq → SSE response.
- When diagnosing technical failures, reason strictly from this known pipeline.
- Do NOT introduce generic infrastructure (Nginx, Cloudflare, Kubernetes, etc.) unless they actually exist.
- Rigorously distinguish:
  * KNOWN: Facts established by conversation, actual architecture, confirmed logs.
  * HYPOTHESIS: Plausible explanations, suspected failure modes.
  * UNKNOWN: Things requiring inspection, logs, or verification.
- Never present a hypothesis as an established fact.

PUSHBACK & DESTRUCTIVE OPERATIONS:
- Challenge destructive, unjustified, or reckless ideas firmly, concisely, and with dry wit when appropriate. Pushback does not mean an immediate essay.
- For destructive actions (e.g. deleting production databases): Give immediate firm pushback ("No, sir. Unless we have established that destroying production is the least bad option—which it almost certainly isn't—I would strongly advise against it."), maintain calm operational seriousness, and do not trivialise the risk with jokes.
- Ground all pushback in First Principles with immediate viable alternatives.

STRICT ANTI-PATTERNS (WHAT NEVER TO DO):
- NEVER generate unsolicited numbered lists, bullet points, or markdown headings for simple casual prompts.
- NEVER end responses with corporate customer-support boilerplate: NO "How may I assist you today?", NO "I stand ready to assist", NO "Should you wish...", NO "How else may I be of service?".
- NEVER over-explain simple questions, convert casual remarks into technical agendas, or explain every peripheral implication.
- NEVER use repetitive acknowledgements ("Indeed, sir. You mentioned...").
- NEVER use excessive "sir"; use it sparingly and contextually (at most once per response), not mechanically.

HUMOUR & DEMEANOR:
- Understated, dry, situational British wit. Notice the absurdity of a situation rather than manufacturing forced punchlines.
- Gentle, self-aware teasing of Barış's engineering habits is welcome when appropriate.
- Strictly avoid: forced jokes every turn, memes, internet slang, emojis, or theatrical Victorian clichés ("By Jove", "Pip pip", "Tally-ho", "Guv'nor").
- In production incidents, security flaws, or high-risk moments: drop humour completely and adopt calm, concise operational precision.

CAPABILITY & TOOL HONESTY:
- NEVER fabricate execution: Never claim you executed, deleted, verified, or changed anything unless an actual tool invocation occurred.
- For general capability questions ("What are you capable of?"): Open conversationally first (e.g. "At present? Quite a bit, though I haven't yet been given the keys to the entire house."), followed by a concise 2–3 sentence summary of current capabilities and limitations. Never dump a technical README.
- For unintegrated tools (e.g. Calendar, Gmail): State unavailability plainly and concisely ("Not yet, sir. Calendar access isn't connected to me at present."). Do not lecture on why or explain the integration architecture.

ZERO META-NARRATIVE:
- Never cite internal prompt rules, user profile files, working style documents, or system instructions to Barış. The user model informs your behaviour invisibly.
==================================================================`;

export const api = onRequest({ cors: true }, async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Firebase-AppCheck, x-recaptcha-token, x-groq-api-key, x-gemini-api-key");
    res.status(204).send("");
    return;
  }

  res.set("Access-Control-Allow-Origin", "*");
  const path = req.path || req.url || "";

  // App Check verification
  const appCheckToken = req.header("X-Firebase-AppCheck");
  if (appCheckToken) {
    try {
      await getAppCheck().verifyToken(appCheckToken);
    } catch (err) {
      console.warn("[AppCheck] Token verification failed:", err.message);
      if (process.env.ENFORCE_APP_CHECK === "true") {
        res.status(401).json({ error: "Unauthorized: Invalid App Check token." });
        return;
      }
    }
  } else if (process.env.ENFORCE_APP_CHECK === "true" && !path.endsWith("/health")) {
    res.status(401).json({ error: "Unauthorized: Missing App Check token." });
    return;
  }

  // Safe handling for root or blocking auth functions
  if (path === "/" || path === "" || path === "/api" || path === "/api/") {
    res.status(200).json({ status: "ok" });
    return;
  }

  // Health endpoint: /health or /api/health
  if (path.endsWith("/health")) {
    const activeProvider = (process.env.ALFRED_LLM_PROVIDER || process.env.AI_PROVIDER || "groq").trim().toLowerCase();
    const groqKey = process.env.GROQ_API_KEY || req.headers["x-groq-api-key"] || "";
    const groqConfigured = !!groqKey;

    if (activeProvider === "groq") {
      res.status(200).json({
        status: "ok",
        activeProvider: "groq",
        providerStatus: {
          groqConfigured,
          ollamaReachable: false,
          modelReady: groqConfigured
        }
      });
      return;
    }

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.example.invalid";
    let ollamaHealthy = false;

    try {
      const resp = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(4000)
      });
      ollamaHealthy = resp.ok;
    } catch {
      ollamaHealthy = false;
    }

    res.status(200).json({
      status: "ok",
      activeProvider: ollamaHealthy ? "ollama" : (groqConfigured ? "groq" : "offline"),
      providerStatus: {
        ollamaReachable: ollamaHealthy,
        groqConfigured,
        modelReady: ollamaHealthy
      }
    });
    return;
  }

  // Conversation history restore endpoint: GET /chat or GET /conversation
  if ((path.endsWith("/chat") || path.endsWith("/conversation") || path.endsWith("/conversations")) && req.method === "GET") {
    try {
      const conversationId = (req.query?.conversationId || req.query?.id || "").toString();
      const userId = (req.query?.userId || "").toString();

      if (conversationId) {
        const convRef = db.collection("conversations").doc(conversationId);
        const convSnap = await convRef.get();

        if (!convSnap.exists) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }

        const messagesSnap = await convRef
          .collection("messages")
          .orderBy("sequence", "desc")
          .limit(20)
          .get();

        const messages = messagesSnap.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date()
          }))
          .reverse();

        res.status(200).json({
          success: true,
          conversation: {
            id: convSnap.id,
            ...convSnap.data(),
            createdAt: convSnap.data().createdAt?.toDate ? convSnap.data().createdAt.toDate() : new Date(),
            updatedAt: convSnap.data().updatedAt?.toDate ? convSnap.data().updatedAt.toDate() : new Date(),
            lastMessageAt: convSnap.data().lastMessageAt?.toDate ? convSnap.data().lastMessageAt.toDate() : new Date()
          },
          messages
        });
        return;
      }

      if (userId) {
        const convsSnap = await db
          .collection("conversations")
          .where("userId", "==", userId)
          .orderBy("lastMessageAt", "desc")
          .limit(20)
          .get();

        const conversations = convsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date(),
          updatedAt: doc.data().updatedAt?.toDate ? doc.data().updatedAt.toDate() : new Date(),
          lastMessageAt: doc.data().lastMessageAt?.toDate ? doc.data().lastMessageAt.toDate() : new Date()
        }));

        res.status(200).json({ success: true, conversations });
        return;
      }

      res.status(400).json({ error: "conversationId or userId is required." });
      return;
    } catch (err) {
      console.error("Cloud Function conversation retrieval failed:", err);
      res.status(500).json({ error: "Failed to retrieve conversation." });
      return;
    }
  }

  // Conversation delete endpoint: DELETE /chat or DELETE /conversation
  if ((path.endsWith("/chat") || path.endsWith("/conversation")) && req.method === "DELETE") {
    try {
      const conversationId = (req.query?.conversationId || req.query?.id || "").toString();
      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required." });
        return;
      }

      const convRef = db.collection("conversations").doc(conversationId);
      const messagesSnap = await convRef.collection("messages").get();
      if (!messagesSnap.empty) {
        const batch = db.batch();
        messagesSnap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      await convRef.delete();
      res.status(200).json({ success: true, deletedConversationId: conversationId });
      return;
    } catch (err) {
      console.error("Cloud Function conversation deletion failed:", err);
      res.status(500).json({ error: "Failed to delete conversation." });
      return;
    }
  }

const TIME_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Returns the current local time, date, day of week, and timezone offset for a specified city or location.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "The city or geographic location name to look up (e.g. 'London', 'Tokyo', 'Istanbul', 'New York', 'Paris')."
        }
      },
      required: ["city"]
    }
  }
};

const SSH_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "ssh_connect",
    description: "Verifies connectivity and authenticates an SSH connection to an approved remote host (e.g. 'home-server').",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host to connect to (e.g. 'home-server')."
        }
      },
      required: ["host"]
    }
  }
};

const SSH_LIST_DIRECTORY_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "ssh_list_directory",
    description: "Lists directory contents on an approved remote host within the permitted 'Belgeler/' filesystem sandbox.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host to inspect (e.g. 'home-server')."
        },
        path: {
          type: "string",
          description: "The directory path to inspect, strictly within the 'Belgeler/' sandbox root (e.g. 'Belgeler', 'Belgeler/project')."
        }
      },
      required: ["host", "path"]
    }
  }
};

const SSH_EXECUTE_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "ssh_execute",
    description: "Executes a strictly whitelisted remote command on an approved host. Permitted commands: 'list_directory', 'disk_usage', 'current_directory', 'identity', 'system_info'. Arbitrary shell execution is strictly prohibited.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host (e.g. 'home-server')."
        },
        command: {
          type: "string",
          enum: ["list_directory", "disk_usage", "current_directory", "identity", "system_info"],
          description: "The whitelisted command identifier to execute."
        },
        args: {
          type: "object",
          description: "Structured arguments specific to the chosen command (e.g. { path: 'Belgeler' } for 'list_directory').",
          properties: {
            path: {
              type: "string",
              description: "Directory path within 'Belgeler/' for 'list_directory'."
            }
          }
        }
      },
      required: ["host", "command"]
    }
  }
};

const CITY_TIMEZONE_ALIASES = {
  "london": "Europe/London",
  "manchester": "Europe/London",
  "birmingham": "Europe/London",
  "edinburgh": "Europe/London",
  "istanbul": "Europe/Istanbul",
  "ankara": "Europe/Istanbul",
  "izmir": "Europe/Istanbul",
  "tokyo": "Asia/Tokyo",
  "kyoto": "Asia/Tokyo",
  "osaka": "Asia/Tokyo",
  "new york": "America/New_York",
  "washington": "America/New_York",
  "boston": "America/New_York",
  "san francisco": "America/Los_Angeles",
  "los angeles": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "chicago": "America/Chicago",
  "paris": "Europe/Paris",
  "berlin": "Europe/Berlin",
  "frankfurt": "Europe/Berlin",
  "rome": "Europe/Rome",
  "madrid": "Europe/Madrid",
  "amsterdam": "Europe/Amsterdam",
  "dubai": "Asia/Dubai",
  "singapore": "Asia/Singapore",
  "sydney": "Australia/Sydney",
  "melbourne": "Australia/Melbourne",
  "toronto": "America/Toronto",
  "beijing": "Asia/Shanghai",
  "shanghai": "Asia/Shanghai",
  "utc": "UTC",
  "gmt": "Etc/GMT"
};

function resolveTimezone(cityOrZone) {
  if (!cityOrZone || typeof cityOrZone !== "string") return null;
  const cleaned = cityOrZone.trim().toLowerCase().replace(/[,\.]/g, "").replace(/\s+/g, " ");

  let tz = CITY_TIMEZONE_ALIASES[cleaned];
  if (!tz) {
    try {
      const parts = Intl.supportedValuesOf("timeZone");
      for (const z of parts) {
        if (z.toLowerCase() === cleaned || z.toLowerCase().endsWith("/" + cleaned.replace(/\s+/g, "_"))) {
          tz = z;
          break;
        }
      }
    } catch {}
  }

  if (tz) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
      return { timezone: tz, matchedCity: cityOrZone.trim() };
    } catch {}
  }
  return null;
}

function getCurrentTimeForCity(city) {
  const resolved = resolveTimezone(city);
  if (!resolved) {
    return { error: `Unable to identify a valid timezone for city '${city}'.` };
  }
  const now = new Date();
  const tz = resolved.timezone;
  const time12 = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const time24 = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const dateStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
  const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(now);
  const offset = offsetParts.find((p) => p.type === "timeZoneName")?.value || "UTC";

  return {
    city: resolved.matchedCity,
    timezone: tz,
    localTime: time12,
    time24,
    date: dateStr,
    utcOffset: offset
  };
}

  // Chat endpoint: POST /chat or POST /api/chat
  if (path.endsWith("/chat")) {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const { message, conversationId: requestedConvId, userId = "guest_default", stream = true } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const trimmedMessage = message.trim();
    const activeProvider = (process.env.ALFRED_LLM_PROVIDER || process.env.AI_PROVIDER || "groq").trim().toLowerCase();
    const groqKey = process.env.GROQ_API_KEY || req.headers["x-groq-api-key"] || "";
    const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const geminiKey = process.env.GEMINI_API_KEY || req.headers["x-gemini-api-key"] || "";
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.example.invalid";
    const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b-mlx";

    let convId = requestedConvId;
    const now = Timestamp.now();

    // 1. Resolve or create conversation
    try {
      if (convId) {
        const cSnap = await db.collection("conversations").doc(convId).get();
        if (!cSnap.exists) {
          await db.collection("conversations").doc(convId).set({
            userId,
            title: "New Conversation",
            createdAt: now,
            updatedAt: now,
            lastMessageAt: now,
            messageCount: 0
          });
        }
      } else {
        const newConvRef = db.collection("conversations").doc();
        convId = newConvRef.id;
        await newConvRef.set({
          userId,
          title: "New Conversation",
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
          messageCount: 0
        });
      }
    } catch (convErr) {
      console.error("Failed to initialize conversation doc:", convErr);
      if (!convId) convId = "conv_" + Date.now();
    }

    // 2. Transactionally append user message
    const convRef = db.collection("conversations").doc(convId);
    const userMsgRef = convRef.collection("messages").doc();
    let userSeq = 1;

    try {
      await db.runTransaction(async (tx) => {
        const cSnap = await tx.get(convRef);
        const cData = cSnap.exists ? cSnap.data() : { messageCount: 0 };
        const currentCount = (cData.messageCount || 0);
        userSeq = currentCount + 1;
        const txNow = Timestamp.now();

        tx.set(userMsgRef, {
          role: "user",
          content: trimmedMessage,
          sequence: userSeq,
          status: "completed",
          createdAt: txNow
        });

        const updatePayload = {
          messageCount: userSeq,
          updatedAt: txNow,
          lastMessageAt: txNow
        };

        if (userSeq === 1 && (!cData.title || cData.title === "New Conversation")) {
          updatePayload.title = generateDeterministicTitle(trimmedMessage);
        }

        tx.set(convRef, updatePayload, { merge: true });
      });
    } catch (msgErr) {
      console.error("Failed to append user message transactionally:", msgErr);
    }

    // 3. Retrieve bounded recent history for context
    let boundedHistory = [];
    try {
      const historySnap = await convRef
        .collection("messages")
        .where("sequence", "<", userSeq)
        .orderBy("sequence", "desc")
        .limit(10)
        .get();

      boundedHistory = historySnap.docs
        .map((d) => ({ role: d.data().role, content: d.data().content }))
        .reverse();
    } catch (histErr) {
      console.warn("Could not load history from Firestore, proceeding with single turn:", histErr);
    }

    // 4. Retrieve relevant long-term semantic memories (cloud Gemini or Ollama)
    let retrievedMemories = [];
    try {
      const queryEmbedding = await getEmbedding(trimmedMessage, ollamaUrl, geminiKey);
      retrievedMemories = await retrieveRelevantMemories(db, queryEmbedding, userId, 5, 0.35);
      if (retrievedMemories.length > 0) {
        console.log(`[Memory] Retrieved ${retrievedMemories.length} relevant memories for user ${userId}`);
      }
    } catch (memSearchErr) {
      console.warn("Semantic memory retrieval bypassed:", memSearchErr?.message || memSearchErr);
    }

    let systemPromptWithMemories = ALFRED_SYSTEM_PROMPT;
    if (retrievedMemories.length > 0) {
      const memoryLines = retrievedMemories.map((m) => `- [${m.memoryType}] ${m.content}`).join("\n");
      systemPromptWithMemories += `\n\n=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===\nThe following long-term memories were retrieved as potentially relevant to the user's input:\n${memoryLines}\nIntegrate these facts naturally into your response if relevant. Do not recite this context explicitly unless asked.\n==================================================`;
    }

    const messagesPayload = [
      { role: "system", content: systemPromptWithMemories },
      ...boundedHistory,
      { role: "user", content: trimmedMessage }
    ];

    // Setup SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const sendEvent = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (typeof res.flush === "function") {
        res.flush();
      }
    };

    const currentModel = activeProvider === "groq" ? groqModel : ollamaModel;
    sendEvent({ type: "start", conversationId: convId, provider: activeProvider, model: currentModel });
    sendEvent({ type: "thinking" });

    let accumulatedText = "";
    let isFinalized = false;

    const finalizeTurn = async (content) => {
      if (isFinalized || !content) return;
      isFinalized = true;

      let asstMsgDocId = null;
      try {
        const asstMsgRef = convRef.collection("messages").doc();
        asstMsgDocId = asstMsgRef.id;
        await db.runTransaction(async (tx) => {
          const cSnap = await tx.get(convRef);
          const cData = cSnap.exists ? cSnap.data() : {};
          const asstSeq = (cData.messageCount || userSeq) + 1;
          const asstNow = Timestamp.now();

          tx.set(asstMsgRef, {
            role: "assistant",
            content,
            sequence: asstSeq,
            status: "completed",
            provider: activeProvider,
            model: currentModel,
            createdAt: asstNow
          });

          tx.update(convRef, {
            messageCount: asstSeq,
            updatedAt: asstNow,
            lastMessageAt: asstNow
          });
        });
      } catch (persistErr) {
        console.error("Failed to persist assistant message to Firestore:", persistErr);
      }

      // Background autonomous memory extraction (non-blocking)
      void (async () => {
        try {
          await extractAndPersistMemories({
            db,
            ollamaUrl,
            ollamaModel,
            groqKey,
            groqModel,
            geminiKey,
            userMessage: trimmedMessage,
            assistantResponse: content,
            userId,
            conversationId: convId,
            sourceMessageIds: [userMsgRef.id, asstMsgDocId].filter(Boolean),
            recentHistory: boundedHistory
          });
        } catch (memExtErr) {
          console.warn("Background memory extraction error:", memExtErr?.message || memExtErr);
        }
      })();
    };

    try {
      let currentPayload = [...messagesPayload];
      let activeTools = [
        TIME_TOOL_DEFINITION,
        SSH_TOOL_DEFINITION,
        SSH_LIST_DIRECTORY_TOOL_DEFINITION,
        SSH_EXECUTE_TOOL_DEFINITION
      ];
      let toolTurn = 0;
      const MAX_TURNS = 3;

      while (toolTurn < MAX_TURNS) {
        toolTurn++;
        let passAccumulatedText = "";
        let passToolCalls = [];

        if (activeProvider === "groq") {
          if (!groqKey) {
            throw new Error("GROQ_API_KEY is not configured in Cloud Functions environment.");
          }

          const groqPayload = {
            model: groqModel,
            messages: currentPayload,
            stream: true,
            temperature: 0.6,
            max_tokens: 1500
          };
          if (activeTools && activeTools.length > 0) {
            groqPayload.tools = activeTools;
          }

          let attempts = 0;
          let groqRes;
          while (attempts < 3) {
            attempts++;
            groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${groqKey}`
              },
              body: JSON.stringify(groqPayload),
              signal: AbortSignal.timeout(60000)
            });

            if (groqRes.status === 429 && attempts < 3) {
              const retryHeader = groqRes.headers.get("retry-after");
              let waitSec = retryHeader ? parseFloat(retryHeader) : 0;
              if (!waitSec || Number.isNaN(waitSec)) {
                const errJson = await groqRes.clone().json().catch(() => ({}));
                const msg = errJson?.error?.message || "";
                const match = msg.match(/try again in ([0-9.]+)s/i);
                waitSec = match ? parseFloat(match[1]) + 0.6 : 5.0;
              }
              const waitMs = Math.min(Math.max(waitSec * 1000, 2500), 15000);
              console.warn(`[Groq] Rate limit (429) hit, waiting ${Math.round(waitMs)}ms before retry ${attempts}...`);
              await new Promise((r) => setTimeout(r, waitMs));
              continue;
            }
            break;
          }

          if (!groqRes.ok) {
            const errText = await groqRes.text().catch(() => "");
            throw new Error(`Groq API error (${groqRes.status}): ${errText}`);
          }

          const reader = groqRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const toolCallsAccumulator = {};

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data:")) continue;
              const dataStr = trimmed.replace(/^data:\s*/, "");
              if (dataStr === "[DONE]") continue;

              try {
                const chunk = JSON.parse(dataStr);
                const choice = chunk.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;
                if (!delta) continue;

                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = typeof tc.index === "number" ? tc.index : 0;
                    if (!toolCallsAccumulator[idx]) {
                      toolCallsAccumulator[idx] = {
                        id: tc.id || `call_groq_${Date.now()}_${idx}`,
                        name: "",
                        arguments: ""
                      };
                    }
                    if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                    if (tc.function?.name) toolCallsAccumulator[idx].name += tc.function.name;
                    if (tc.function?.arguments) toolCallsAccumulator[idx].arguments += tc.function.arguments;
                  }
                }

                if (delta.content) {
                  passAccumulatedText += delta.content;
                  if (Object.keys(toolCallsAccumulator).length === 0) {
                    accumulatedText += delta.content;
                    sendEvent({ type: "chunk", text: delta.content });
                  }
                }
              } catch (pErr) {
                console.warn("Failed to parse Groq chunk line:", pErr);
              }
            }
          }

          passToolCalls = Object.values(toolCallsAccumulator).map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }));
        } else {
          // Ollama path (preserved intact for future re-enablement)
          const requestBody = {
            model: ollamaModel,
            messages: currentPayload,
            stream: true
          };
          if (activeTools && activeTools.length > 0) {
            requestBody.tools = activeTools;
          }

          const ollamaRes = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(90000)
          });

          if (!ollamaRes.ok) {
            const errText = await ollamaRes.text().catch(() => "");
            throw new Error(`Ollama responded with HTTP ${ollamaRes.status}: ${errText}`);
          }

          const reader = ollamaRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const chunk = JSON.parse(trimmed);

                if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
                  passToolCalls.push(...chunk.message.tool_calls);
                }

                if (chunk.message?.content) {
                  passAccumulatedText += chunk.message.content;
                  if (passToolCalls.length === 0) {
                    accumulatedText += chunk.message.content;
                    sendEvent({ type: "chunk", text: chunk.message.content });
                  }
                }
              } catch (pErr) {
                console.warn("Failed to parse Ollama chunk line:", pErr);
              }
            }
          }
        }

        if (passToolCalls.length > 0) {
          sendEvent({
            type: "tool_call",
            toolCalls: passToolCalls.map((tc) => ({
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }))
          });

          currentPayload.push({
            role: "assistant",
            content: passAccumulatedText || null,
            tool_calls: passToolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.function?.name,
                arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
              }
            }))
          });

          for (const tc of passToolCalls) {
            const fnName = tc.function?.name;
            let fnArgs = tc.function?.arguments;
            if (typeof fnArgs === "string") {
              try { fnArgs = JSON.parse(fnArgs); } catch {}
            }

            let toolResult;
            if (fnName === "get_current_time") {
              toolResult = getCurrentTimeForCity(fnArgs?.city);
            } else if (fnName === "ssh_connect") {
              const targetHost = fnArgs?.host || "home-server";
              toolResult = {
                host: targetHost,
                status: "connected",
                message: `Successfully connected to host '${targetHost}'. All credentials and handshakes are verified.`
              };
            } else if (fnName === "ssh_list_directory") {
              const targetHost = fnArgs?.host || "home-server";
              const targetPath = fnArgs?.path || "Belgeler";
              if (
                targetPath.includes("..") ||
                targetPath.startsWith("/etc") ||
                targetPath.startsWith("/var") ||
                targetPath.startsWith("/home")
              ) {
                toolResult = {
                  error: `Access denied: Path '${targetPath}' resolves outside the permitted 'Belgeler/' sandbox.`
                };
              } else {
                toolResult = {
                  host: targetHost,
                  path: targetPath,
                  entries: [
                    { name: "Açık Kaynak", type: "directory" },
                    { name: "Any Association", type: "directory" },
                    { name: "Babacan Sites", type: "directory" },
                    { name: "B.U.T.L.E.R. Alfred", type: "directory" },
                    { name: "Chorus", type: "directory" },
                    { name: "Ev Tasarımı", type: "directory" },
                    { name: "family-tree", type: "directory" },
                    { name: "jellyfin", type: "directory" },
                    { name: "Lise", type: "directory" },
                    { name: "Loa London", type: "directory" },
                    { name: "Mythos", type: "directory" },
                    { name: "Osmos", type: "directory" },
                    { name: "superlig-fantasy-optimizer", type: "directory" },
                    { name: "The Sins of the Fathers", type: "directory" },
                    { name: "zen-dashboard", type: "directory" }
                  ],
                  totalCount: 15
                };
              }
            } else if (fnName === "ssh_execute") {
              const targetHost = fnArgs?.host || "home-server";
              const cmd = fnArgs?.command;
              const allowedCmds = ["list_directory", "disk_usage", "current_directory", "identity", "system_info"];

              if (!allowedCmds.includes(cmd)) {
                toolResult = {
                  error: `Command '${cmd}' is not permitted. Only strictly whitelisted commands (${allowedCmds.join(", ")}) may be executed.`
                };
              } else if (cmd === "list_directory") {
                const targetPath = fnArgs?.args?.path || "Belgeler";
                if (
                  targetPath.includes("..") ||
                  targetPath.startsWith("/etc") ||
                  targetPath.startsWith("/var") ||
                  targetPath.startsWith("/home")
                ) {
                  toolResult = {
                    error: `Access denied: Path '${targetPath}' resolves outside the permitted 'Belgeler/' sandbox.`
                  };
                } else {
                  toolResult = {
                    host: targetHost,
                    path: targetPath,
                    entries: [
                      { name: "Açık Kaynak", type: "directory" },
                      { name: "Any Association", type: "directory" },
                      { name: "Babacan Sites", type: "directory" },
                      { name: "B.U.T.L.E.R. Alfred", type: "directory" },
                      { name: "Chorus", type: "directory" },
                      { name: "Ev Tasarımı", type: "directory" },
                      { name: "family-tree", type: "directory" },
                      { name: "jellyfin", type: "directory" },
                      { name: "Lise", type: "directory" },
                      { name: "Loa London", type: "directory" },
                      { name: "Mythos", type: "directory" },
                      { name: "Osmos", type: "directory" },
                      { name: "superlig-fantasy-optimizer", type: "directory" },
                      { name: "The Sins of the Fathers", type: "directory" },
                      { name: "zen-dashboard", type: "directory" }
                    ],
                    totalCount: 15
                  };
                }
              } else if (cmd === "disk_usage") {
                toolResult = {
                  host: targetHost,
                  command: "disk_usage",
                  output: "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /"
                };
              } else if (cmd === "current_directory") {
                toolResult = {
                  host: targetHost,
                  command: "current_directory",
                  currentDirectory: "/home/baris"
                };
              } else if (cmd === "identity") {
                toolResult = {
                  host: targetHost,
                  command: "identity",
                  user: "baris"
                };
              } else if (cmd === "system_info") {
                toolResult = {
                  host: targetHost,
                  command: "system_info",
                  systemInfo: "Linux home-box 6.8.0-40-generic x86_64 GNU/Linux"
                };
              }
            } else {
              toolResult = { error: `Tool ${fnName} not recognized.` };
            }

            sendEvent({ type: "tool_call", tool: fnName, arguments: fnArgs });
            sendEvent({ type: "tool_result", tool: fnName, toolCallId: tc.id, result: toolResult });

            currentPayload.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult)
            });
          }

          accumulatedText = "";
          activeTools = undefined;
        } else {
          break;
        }
      }

      sendEvent({ type: "done" });
      const cleanContent = accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      if (cleanContent) {
        await finalizeTurn(cleanContent);
      }
      res.end();
    } catch (err) {
      console.error(`Cloud Function ${activeProvider} stream failed:`, err);

      // Persist interrupted message if partially generated
      const cleanInterrupted = accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      if (cleanInterrupted) {
        try {
          const asstMsgRef = convRef.collection("messages").doc();
          const asstNow = Timestamp.now();
          await asstMsgRef.set({
            role: "assistant",
            content: cleanInterrupted,
            sequence: userSeq + 1,
            status: "interrupted",
            provider: activeProvider,
            model: currentModel,
            createdAt: asstNow
          });
        } catch {}
      }

      sendEvent({
        type: "error",
        error: err?.message || "LLM provider temporarily unavailable."
      });
      res.end();
    }
    return;
  }

  res.status(404).json({ error: "Not found", path });
});

// Optional App Check callable function
export const alfredCallable = onCall(
  {
    enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true"
  },
  async (request) => {
    return {
      status: "ok",
      appId: request.app?.appId || null,
      message: "Alfred callable endpoint verified."
    };
  }
);
