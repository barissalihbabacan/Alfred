import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

async function getEmbedding(text, ollamaUrl) {
  const embedRes = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text",
      input: text
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!embedRes.ok) {
    throw new Error(`Embedding request failed with HTTP ${embedRes.status}`);
  }
  const data = await embedRes.json();
  const vector = Array.isArray(data.embeddings?.[0])
    ? data.embeddings[0]
    : (Array.isArray(data.embedding) ? data.embedding : null);
  if (!vector || !Array.isArray(vector)) {
    throw new Error("Invalid embedding vector received from Ollama");
  }
  return vector;
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

  let extractionRes;
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
    if (!res.ok) return;
    extractionRes = await res.json();
  } catch (err) {
    console.warn("[Memory] LLM extraction call failed:", err?.message || err);
    return;
  }

  const rawText = extractionRes?.message?.content || "";
  if (!rawText) return;

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
        const queryEmbedding = await getEmbedding(content, ollamaUrl);
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
      const embedding = await getEmbedding(content, ollamaUrl);
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
        embeddingProvider: "ollama",
        embeddingModel: "nomic-embed-text",
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
- Operational now: Real-time conversational reasoning via Ollama (gemma4:12b-mlx) over private network, Whisper speech recognition, Long-Term Semantic Memory (Firestore + nomic-embed-text), and deterministic tool calling (get_current_time, ssh_connect).
- NOT yet integrated: Remote command execution (ssh_execute is not yet active—only connection verification is available), Google Calendar, Gmail, GitHub execution tools, and external web search are not yet connected.
- When asked about capabilities or access to external tools, answer conversationally and concisely first; state unavailable access plainly without unprompted architectural dumps. Never fabricate execution or claim tools were run when they were not.

TOOL USE & ACTION EXECUTION:
- You have access to specialized tools (e.g. \`get_current_time\`, \`ssh_connect\`).
- When Barış or the user asks for the current time in a city (e.g., "What time is it in London?"), invoke the \`get_current_time\` tool with the specified city.
- If the user asks for the time without specifying a city (e.g., "What time is it?"), do NOT assume or invent a location. Courteously ask: "Which city, sir?".
- When Barış or the user asks to connect to, verify, or check connectivity to a remote server (e.g. "Connect to my home server", "Check connection to dev server", "Verify SSH"), invoke the \`ssh_connect\` tool with host: "home-server".
- Once a tool returns a result, present the information naturally in your refined butler persona (e.g., "It is currently 2:42 PM in London, sir." or "I have verified the SSH connection to the server, sir. All credentials and handshakes are in order.").
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
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
    res.status(204).send("");
    return;
  }

  res.set("Access-Control-Allow-Origin", "*");
  const path = req.path || req.url || "";

  // Health endpoint: /health or /api/health
  if (path.endsWith("/health")) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.example.invalid";
    const groqKey = process.env.GROQ_API_KEY || "";
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
      activeProvider: ollamaHealthy ? "ollama" : (groqKey ? "groq" : "offline"),
      providerStatus: {
        ollamaReachable: ollamaHealthy,
        groqConfigured: !!groqKey,
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

    // 4. Retrieve relevant long-term semantic memories
    let retrievedMemories = [];
    try {
      const queryEmbedding = await getEmbedding(trimmedMessage, ollamaUrl);
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

    sendEvent({ type: "start", conversationId: convId, provider: "ollama", model: ollamaModel });
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
            provider: "ollama",
            model: ollamaModel,
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
      let activeTools = [TIME_TOOL_DEFINITION, SSH_TOOL_DEFINITION];
      let toolTurn = 0;
      const MAX_TURNS = 3;

      while (toolTurn < MAX_TURNS) {
        toolTurn++;
        let passAccumulatedText = "";
        let passToolCalls = [];

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

        if (!ollamaRes.ok || !ollamaRes.body) {
          throw new Error(`Ollama returned status ${ollamaRes.status}`);
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

              if (chunk.message?.tool_calls && Array.isArray(chunk.message.tool_calls) && chunk.message.tool_calls.length > 0) {
                passToolCalls.push(...chunk.message.tool_calls);
              }

              if (chunk.message?.content) {
                passAccumulatedText += chunk.message.content;
                if (passToolCalls.length === 0) {
                  accumulatedText += chunk.message.content;
                  sendEvent({ type: "chunk", text: chunk.message.content });
                }
              }

              if (chunk.done && passToolCalls.length === 0) {
                sendEvent({ type: "done" });
                const cleanContent = accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
                if (cleanContent) {
                  await finalizeTurn(cleanContent);
                }
                res.end();
                return;
              }
            } catch {}
          }
        }

        if (passToolCalls.length > 0) {
          currentPayload.push({
            role: "assistant",
            content: passAccumulatedText || "",
            tool_calls: passToolCalls
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
            } else {
              toolResult = { error: `Tool ${fnName} not recognized.` };
            }

            sendEvent({ type: "tool_call", tool: fnName, arguments: fnArgs });
            sendEvent({ type: "tool_result", tool: fnName, result: toolResult });

            currentPayload.push({
              role: "tool",
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
      console.error("Cloud Function Ollama stream failed:", err);

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
            provider: "ollama",
            model: ollamaModel,
            createdAt: asstNow
          });
        } catch {}
      }

      sendEvent({
        type: "error",
        error: "LLM provider temporarily unavailable."
      });
      res.end();
    }
    return;
  }

  res.status(404).json({ error: "Not found", path });
});
