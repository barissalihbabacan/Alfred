"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

export type AssistantState =
  | "Idle"
  | "Listening"
  | "Transcribing"
  | "Thinking"
  | "Streaming"
  | "Speaking"
  | "Error";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
  duration?: number;
  timestamp: string;
  isThinking?: boolean;
}

const TEST_PROMPTS = [
  "Good morning, Alfred.",
  "What are you capable of?",
  "Can you access my calendar?",
  "Tell me something mildly amusing.",
  "Should I delete the production database?"
];

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  let html = escapeHtml(text);

  // Multi-line code blocks: ```lang ... ```
  const codeBlocks: string[] = [];
  html = html.replace(/```(?:([a-zA-Z0-9_-]+)\n)?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    const cleanCode = code.replace(/^\n+|\n+$/g, "");
    codeBlocks.push(`<pre class="code-block"><code>${cleanCode}</code></pre>`);
    return `§§CODEBLOCK${idx}§§`;
  });

  // Inline code: `code`
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, c) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="inline-code">${c}</code>`);
    return `§§INLINECODE${idx}§§`;
  });

  // Bold + Italic: ***text***
  html = html.replace(/\*\*\*([^\*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  html = html.replace(/\*\*([^\*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  html = html.replace(/\*([^\*]+?)\*/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+?)~~/g, "<del>$1</del>");

  // Restore protected code blocks & inline codes
  html = html.replace(/§§INLINECODE(\d+)§§/g, (_m, idx) => inlineCodes[Number(idx)]);
  html = html.replace(/§§CODEBLOCK(\d+)§§/g, (_m, idx) => codeBlocks[Number(idx)]);

  return html;
}

export default function VoiceChatPlayground() {
  const [state, setState] = useState<AssistantState>("Idle");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init-0",
      role: "assistant",
      text: "Good day, sir. B.U.T.L.E.R. Alfred at your service. How may I assist you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);
  const [inputText, setInputText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, state, scrollToBottom]);

  // Clean up audio playback on unmount
  useEffect(() => {
    return () => {
      if (currentAudioElementRef.current) {
        currentAudioElementRef.current.pause();
        currentAudioElementRef.current = null;
      }
    };
  }, []);

  // Play audio helper with error handling
  const playAudio = useCallback((audioUrl: string, messageId: string) => {
    try {
      if (currentAudioElementRef.current) {
        currentAudioElementRef.current.pause();
        currentAudioElementRef.current = null;
      }

      const audio = new Audio(audioUrl);
      currentAudioElementRef.current = audio;
      setCurrentlyPlayingId(messageId);
      setState("Speaking");

      audio.onended = () => {
        setCurrentlyPlayingId(null);
        setState("Idle");
      };

      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        setCurrentlyPlayingId(null);
        setState("Idle");
        setErrorMessage("Unable to play audio response in browser.");
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("Autoplay was prevented or audio failed:", err);
          setCurrentlyPlayingId(null);
          setState("Idle");
          setErrorMessage("Browser audio autoplay was restricted. Please click 'Play Voice' to listen.");
        });
      }
    } catch (err: any) {
      console.error("Audio instantiation failed:", err);
      setErrorMessage("Audio playback failure.");
      setState("Idle");
    }
  }, []);

  // Send text message to /api/chat with streaming SSE
  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend ?? inputText).trim();
    if (!messageText || state === "Thinking" || state === "Streaming" || state === "Transcribing") return;

    setErrorMessage(null);
    setInputText("");

    const userMessage: Message = {
      id: "user-" + Date.now(),
      role: "user",
      text: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    const assistantId = "asst-" + Date.now();
    const placeholderAssistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      text: "",
      isThinking: true,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    // Filter out previous unfinished/placeholder messages
    const historySource = messages.filter((m) => !m.isThinking && m.text.trim().length > 0);
    const newMessages = [...historySource, userMessage, placeholderAssistantMessage];
    setMessages(newMessages);
    setState("Thinking");

    let accumulatedText = "";

    try {
      const history = historySource.slice(-10).map((m) => ({
        role: m.role,
        content: m.text
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify({ message: messageText, history, stream: true })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${res.status}`);
      }

      if (!res.body) {
        throw new Error("No response body received from server.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const trimmed = block.trim();
          if (!trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.replace(/^data:\s*/, "");
          try {
            const event = JSON.parse(dataStr);
            if (event.type === "thinking") {
              setState("Thinking");
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, isThinking: true } : m))
              );
            } else if (event.type === "chunk") {
              setState("Streaming");
              accumulatedText += (event.text || "");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, text: accumulatedText, isThinking: false }
                    : m
                )
              );
            } else if (event.type === "done") {
              setState("Idle");
            } else if (event.type === "error") {
              throw new Error(event.error || "Streaming error occurred.");
            }
          } catch (parseErr: any) {
            if (parseErr.message && parseErr.message !== "Unexpected end of JSON input") {
              throw parseErr;
            }
          }
        }
      }

      setState("Idle");
    } catch (error: any) {
      console.error("Chat error:", error);
      setState("Error");
      setErrorMessage(error?.message || "Failed to communicate with Alfred server.");

      if (accumulatedText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: accumulatedText + " [Response interrupted]", isThinking: false }
              : m
          )
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    }
  };

  // Start microphone recording
  const startRecording = async () => {
    setErrorMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setState("Error");
      setErrorMessage("Microphone access is not supported by your browser environment.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size === 0) {
          setState("Idle");
          return;
        }

        await processAudioTranscription(audioBlob);
      };

      recorder.start(250);
      setIsRecording(true);
      setState("Listening");
    } catch (err: any) {
      console.error("Microphone permission or access error:", err);
      setState("Error");
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMessage("Microphone permission was denied. Please allow microphone access in your browser settings.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setErrorMessage("No microphone audio input device was found.");
      } else {
        setErrorMessage("Microphone access failed: " + (err.message || "Unknown error"));
      }
    }
  };

  // Stop microphone recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setState("Transcribing");
    }
  };

  // Process audio chunk via /api/stt
  const processAudioTranscription = async (blob: Blob) => {
    setState("Transcribing");
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      const res = await fetch("/api/stt", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `STT failed with status ${res.status}`);
      }

      const data = await res.json();
      const transcribedText = data.text?.trim();

      if (!transcribedText) {
        setState("Idle");
        setErrorMessage("No clear speech was recognized. Please speak clearly into the microphone.");
        return;
      }

      await handleSendMessage(transcribedText);
    } catch (err: any) {
      console.error("STT error:", err);
      setState("Error");
      setErrorMessage(err?.message || "Speech-to-text service failure.");
    }
  };

  const isBusy = state === "Thinking" || state === "Streaming" || state === "Listening" || state === "Transcribing";

  return (
    <div style={{
      maxWidth: "960px",
      margin: "0 auto",
      padding: "24px 16px",
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh"
    }}>
      <style>{`
        @keyframes dotBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.35; }
          40% { transform: scale(1.1); opacity: 1; }
        }
        .dot-bounce {
          animation: dotBounce 1.4s infinite ease-in-out both;
        }
        .markdown-content strong {
          font-weight: 600;
          color: #f8fafc;
        }
        .markdown-content em {
          font-style: italic;
          color: #e2e8f0;
        }
        .markdown-content code.inline-code {
          background: rgba(255, 255, 255, 0.08);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
          color: #c5a059;
        }
        .markdown-content pre.code-block {
          background: #0d121d;
          border: 1px solid #27354f;
          padding: 12px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 8px 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.88em;
          color: #f0f4fc;
        }
      `}</style>

      {/* Header */}
      <header style={{
        borderBottom: "1px solid var(--border-subtle)",
        paddingBottom: "16px",
        marginBottom: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div>
          <h1 style={{
            fontSize: "20px",
            fontWeight: 600,
            letterSpacing: "0.05em",
            color: "var(--text-primary)",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <span style={{ color: "var(--accent-gold)" }}>B.U.T.L.E.R.</span> ALFRED
          </h1>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
            Barış&apos;s Unified Task, Logic, Execution &amp; Reasoning — Real-Time Streaming Playground
          </p>
        </div>

        {/* Status Indicator */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          padding: "6px 14px",
          borderRadius: "9999px",
          fontSize: "13px",
          fontWeight: 500
        }}>
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor:
              state === "Listening" ? "var(--status-listening)" :
              state === "Transcribing" ? "var(--status-transcribing)" :
              state === "Thinking" ? "var(--status-thinking)" :
              state === "Streaming" ? "var(--accent-gold)" :
              state === "Speaking" ? "var(--status-speaking)" :
              state === "Error" ? "var(--danger)" : "var(--text-muted)",
            boxShadow:
              state !== "Idle" && state !== "Error" ? "0 0 8px currentColor" : "none",
            animation: state !== "Idle" && state !== "Error" ? "pulse 1.5s infinite" : "none"
          }} />
          <span style={{ color: "var(--text-secondary)" }}>
            {state === "Idle" && "Ready"}
            {state === "Listening" && "Listening..."}
            {state === "Transcribing" && "Transcribing audio..."}
            {state === "Thinking" && "Thinking..."}
            {state === "Streaming" && "Alfred is responding..."}
            {state === "Speaking" && "Speaking..."}
            {state === "Error" && "Error"}
          </span>
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div style={{
          backgroundColor: "rgba(239, 68, 68, 0.15)",
          border: "1px solid var(--danger)",
          color: "#fca5a5",
          padding: "10px 16px",
          borderRadius: "8px",
          marginBottom: "16px",
          fontSize: "13px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <span>⚠️ {errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fca5a5",
              cursor: "pointer",
              fontSize: "16px",
              marginLeft: "12px"
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Conversation Thread */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        paddingRight: "6px",
        marginBottom: "16px"
      }}>
        {messages.map((msg) => {
          const isAssistant = msg.role === "assistant";
          const isPlayingThis = currentlyPlayingId === msg.id;

          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isAssistant ? "flex-start" : "flex-end"
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "4px",
                fontSize: "11px",
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
                textTransform: "uppercase"
              }}>
                {isAssistant ? (
                  <span style={{ color: "var(--accent-gold)", fontWeight: 600 }}>ALFRED</span>
                ) : (
                  <span style={{ fontWeight: 600 }}>BARIŞ</span>
                )}
                <span>•</span>
                <span>{msg.timestamp}</span>
              </div>

              <div style={{
                maxWidth: "80%",
                padding: "14px 18px",
                borderRadius: "12px",
                backgroundColor: isAssistant ? "var(--bg-card)" : "var(--bg-secondary)",
                border: isAssistant ? "1px solid var(--border-subtle)" : "1px solid #2e3c54",
                color: "var(--text-primary)",
                lineHeight: "1.55",
                fontSize: "14px",
                whiteSpace: "pre-wrap"
              }}>
                {msg.isThinking ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                    fontSize: "13px"
                  }}>
                    <span style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                      <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--accent-gold)" }} />
                      <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--accent-gold)", animationDelay: "0.2s" }} />
                      <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--accent-gold)", animationDelay: "0.4s" }} />
                    </span>
                    <span>Thinking...</span>
                  </div>
                ) : isAssistant ? (
                  <div
                    className="markdown-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                  />
                ) : (
                  msg.text
                )}

                {/* Voice Playback Button for Alfred's responses (if audio exists) */}
                {isAssistant && msg.audioUrl && (
                  <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px solid #232d3f" }}>
                    <button
                      onClick={() => playAudio(msg.audioUrl!, msg.id)}
                      disabled={isBusy}
                      style={{
                        background: isPlayingThis ? "var(--accent-gold)" : "transparent",
                        color: isPlayingThis ? "#0a0d14" : "var(--accent-gold)",
                        border: "1px solid var(--accent-gold)",
                        borderRadius: "6px",
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 500,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.15s ease"
                      }}
                    >
                      {isPlayingThis ? "🔊 Speaking..." : "▶ Play Voice"}
                      {msg.duration && !isPlayingThis && (
                        <span style={{ opacity: 0.8, fontSize: "11px" }}>({msg.duration.toFixed(1)}s)</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Test Prompt Chips */}
      <div style={{
        marginBottom: "12px",
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        alignItems: "center"
      }}>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", marginRight: "4px" }}>Test queries:</span>
        {TEST_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(prompt)}
            disabled={isBusy}
            style={{
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "12px",
              transition: "border-color 0.15s",
              opacity: isBusy ? 0.5 : 1,
              cursor: isBusy ? "not-allowed" : "pointer"
            }}
            onMouseOver={(e) => {
              if (!isBusy) e.currentTarget.style.borderColor = "var(--accent-gold)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Bar: Text Box + Mic Button + Send Button */}
      <div style={{
        display: "flex",
        gap: "10px",
        backgroundColor: "var(--bg-secondary)",
        padding: "10px",
        borderRadius: "12px",
        border: "1px solid var(--border-subtle)",
        alignItems: "center"
      }}>
        {/* Microphone Button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={state === "Thinking" || state === "Streaming" || state === "Transcribing"}
          title={isRecording ? "Click to stop recording" : "Click to speak with Alfred"}
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "50%",
            backgroundColor: isRecording ? "var(--danger)" : "var(--bg-card)",
            color: isRecording ? "#ffffff" : "var(--accent-gold)",
            border: isRecording ? "2px solid #ffffff" : "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            transition: "all 0.2s ease",
            flexShrink: 0,
            cursor: isBusy ? "not-allowed" : "pointer"
          }}
        >
          {isRecording ? "⏹" : "🎤"}
        </button>

        {/* Text Input */}
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          disabled={isBusy || isRecording}
          placeholder={isRecording ? "Listening... Speak now, then click Stop." : "Address Alfred via text..."}
          style={{
            flex: 1,
            backgroundColor: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: "14px",
            padding: "8px 4px"
          }}
        />

        {/* Send Button */}
        <button
          onClick={() => handleSendMessage()}
          disabled={!inputText.trim() || isBusy || isRecording}
          style={{
            backgroundColor: inputText.trim() && !isBusy ? "var(--accent-gold)" : "var(--bg-card)",
            color: inputText.trim() && !isBusy ? "#0a0d14" : "var(--text-muted)",
            border: "none",
            padding: "8px 16px",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "13px",
            transition: "background-color 0.15s ease",
            cursor: inputText.trim() && !isBusy ? "pointer" : "not-allowed"
          }}
        >
          Send
        </button>
      </div>

      {/* Footer Info */}
      <footer style={{
        marginTop: "16px",
        display: "flex",
        justifyContent: "space-between",
        fontSize: "11px",
        color: "var(--text-muted)"
      }}>
        <span>Engine: Ollama (gemma4:12b-mlx) [Default] / Groq Cloud LPU</span>
        <span>Target: Local / Tailscale Network</span>
      </footer>
    </div>
  );
}
