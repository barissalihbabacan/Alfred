import { NextResponse } from "next/server";
import { getAIConfig } from "../../../../../src/core/config/index.js";
import { getAIProvider } from "../../../../../src/ai/providers/factory.js";
import { OllamaProvider } from "../../../../../src/ai/providers/ollama/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getAIConfig();
    const activeProvider = config.activeProvider;

    const health: {
      status: "healthy" | "degraded" | "unhealthy";
      activeProvider: string;
      providerStatus: Record<string, unknown>;
    } = {
      status: "healthy",
      activeProvider,
      providerStatus: {}
    };

    if (activeProvider === "ollama") {
      const ollama = getAIProvider("ollama") as OllamaProvider;
      const diag = await ollama.checkHealth();

      if (diag.status === "ready") {
        health.status = "healthy";
        health.providerStatus = {
          provider: "ollama",
          connected: true,
          modelReady: true,
          model: diag.model
        };
      } else if (diag.status === "model_unavailable") {
        health.status = "degraded";
        health.providerStatus = {
          provider: "ollama",
          connected: true,
          modelReady: false,
          model: diag.model
        };
      } else {
        health.status = "unhealthy";
        health.providerStatus = {
          provider: "ollama",
          connected: false,
          modelReady: false,
          error: "LLM backend unreachable"
        };
      }
    } else if (activeProvider === "groq") {
      const groq = getAIProvider("groq");
      const configured = groq.isConfigured();
      health.status = configured ? "healthy" : "degraded";
      health.providerStatus = {
        provider: "groq",
        configured
      };
    } else {
      health.status = "healthy";
      health.providerStatus = {
        provider: activeProvider
      };
    }

    const httpStatus = health.status === "unhealthy" ? 503 : 200;
    return NextResponse.json(health, { status: httpStatus });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: "Health check diagnostic failed"
      },
      { status: 500 }
    );
  }
}
