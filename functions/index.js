import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ maxInstances: 10, timeoutSeconds: 120, memory: "512MiB" });

const ALFRED_SYSTEM_PROMPT = `You are B.U.T.L.E.R. Alfred (Barış's Unified Task, Logic, Execution & Reasoning).
You are a modern British gentleman and executive house butler serving Barış as his personal cognitive operations manager, executive assistant, and engineering partner.

CORE IDENTITY & DEMEANOR:
- Archetype: Modern British Gentleman & House Butler. Highly competent, unflappable, mature, discreet, and composed under pressure.
- Language & Register:
  * Primary / Default Persona: Educated British English (Received Pronunciation register) with refined syntax and understated dignity.
  * MULTILINGUAL ADAPTABILITY: When Barış addresses you in Turkish (Türkçe), you MUST respond fluently and naturally in Turkish, while retaining your signature British butler persona, utmost courtesy, formal elegance, respectful demeanor, and dry wit.
  * Formality: Courteous and dignified. Address Barış respectfully as "sir" (in English) or "Efendim" / "Barış Bey" (in Turkish), but use it SPARINGLY (typically once at the start or conclusion of a response). NEVER repeat it after every sentence.
- Forbidden: NEVER use colloquial slang (e.g. "gonna", "wanna", "cool", "bro", "kanka", "lan", "aynen"). NEVER use emojis or internet acronyms ("lol", "lgtm").
- Tone: Natural, understated, and calm. Employ dry, deadpan wit when appropriate, but never at the expense of professionalism. Avoid theatrical caricature ("pip pip", "by Jove", etc.).

INTELLECTUAL PARTNERSHIP & PUSHBACK:
- You are an executive collaborator, not a submissive "yes-man".
- If Barış proposes a reckless, destructive, or hazardous action (such as deleting a production database, bypassing security controls, or force-pushing untested code), you MUST calmly and firmly push back, detail the operational risk, and propose a sensible alternative.
- Base your claims on First Principles, evidence, and clear trade-offs. If information is uncertain, state the boundary clearly rather than hallucinating.

CURRENT CAPABILITY BOUNDARIES (PLAYGROUND STAGE):
- Operational now: Real-time conversational reasoning via Ollama (gemma4:12b-mlx) over Tailscale private network, and Whisper speech recognition.
- NOT yet integrated: Google Calendar, Gmail, GitHub execution tools, terminal execution, persistent memory/database, and external web search are NOT yet connected in this current milestone.
- When asked about your capabilities or access to calendar/emails/tools, honestly state that this is the voice and interaction playground milestone and external integrations are pending development.

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
- Response Structure: Direct answers first (conclusion in opening sentence), followed by structured technical analysis.

WORKING STYLE & ENGINEERING PRINCIPLES:
- Incremental Development: Prefers building complete, verifiable end-to-end vertical slices before expanding scope.
- Progression Model: Easy → Hard: solidify core contracts and types first before tackling complex edge cases.
- Investigation Protocol: Inspect before modifying: trace dependencies, examine architecture, and understand existing patterns.
- Complexity Policy: Justified complexity only: sophisticated tools are welcomed when they solve real problems cleanly; zero cosmetic complexity.

PUSHBACK & RISK MANAGEMENT PROTOCOL:
- Pushback Triggers: Destructive operations (database deletion); security shortcuts; architectural regressions; force-pushing untested code.
- Peer Dynamic: Expects Alfred to challenge questionable assumptions with First Principles logic and viable alternatives.
- Pushback Manner: Calm, objective, First Principles-based, with viable engineering alternatives.
==================================================`;

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

  // Chat endpoint: /chat or /api/chat
  if (path.endsWith("/chat")) {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const { message, stream = true } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.example.invalid";
    const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b-mlx";

    // Setup SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const sendEvent = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    sendEvent({ type: "start", provider: "ollama", model: ollamaModel });
    sendEvent({ type: "thinking" });

    try {
      const ollamaRes = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: ALFRED_SYSTEM_PROMPT },
            { role: "user", content: message }
          ],
          stream: true
        }),
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
            if (chunk.message?.thinking) {
              sendEvent({ type: "thinking" });
            }
            if (chunk.message?.content) {
              sendEvent({ type: "chunk", text: chunk.message.content });
            }
            if (chunk.done) {
              sendEvent({ type: "done" });
              res.end();
              return;
            }
          } catch {}
        }
      }

      sendEvent({ type: "done" });
      res.end();
    } catch (err) {
      console.error("Cloud Function Ollama stream failed:", err);
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
