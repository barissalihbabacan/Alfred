import { AlfredError } from "./base.js";

export class TTSError extends AlfredError {
  public override readonly code: string = "TTS_ERROR";

  constructor(
    public readonly provider: string,
    message: string,
    cause?: unknown
  ) {
    super(`[TTS:${provider}] ${message}`, cause);
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      provider: this.provider
    };
  }
}

export class TTSModelError extends TTSError {
  public override readonly code: string = "TTS_MODEL_ERROR";

  constructor(provider: string, model: string, message: string, cause?: unknown) {
    super(provider, `Model '${model}' error: ${message}`, cause);
  }
}

export class TTSVoiceNotFoundError extends TTSError {
  public override readonly code: string = "TTS_VOICE_NOT_FOUND";

  constructor(provider: string, voice: string, availableVoices?: string[]) {
    const list = availableVoices && availableVoices.length > 0 ? ` Available voices: ${availableVoices.join(", ")}` : "";
    super(provider, `Voice '${voice}' is not recognized or supported by provider '${provider}'.${list}`);
  }
}

export class TTSInferenceError extends TTSError {
  public override readonly code: string = "TTS_INFERENCE_ERROR";

  constructor(provider: string, message: string, cause?: unknown) {
    super(provider, `Inference failed: ${message}`, cause);
  }
}

export class TTSUnsupportedRuntimeError extends TTSError {
  public override readonly code: string = "TTS_UNSUPPORTED_RUNTIME";

  constructor(provider: string, runtime: string, reason: string) {
    super(provider, `Runtime '${runtime}' is unsupported or unavailable: ${reason}`);
  }
}

export class TTSOutputError extends TTSError {
  public override readonly code: string = "TTS_OUTPUT_ERROR";

  constructor(provider: string, path: string, message: string, cause?: unknown) {
    super(provider, `Failed writing audio output to '${path}': ${message}`, cause);
  }
}
