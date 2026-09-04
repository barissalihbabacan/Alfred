import dotenv from "dotenv";

dotenv.config();

export interface TTSConfig {
  provider: string;
  voice: string;
  language: string;
  model: string;
  dtype: "fp32" | "fp16" | "q8" | "q4";
  device: "cpu" | "wasm";
  speed: number;
  sampleRate: number;
}

export const DEFAULT_TTS_PROVIDER = "kokoro";
export const DEFAULT_TTS_VOICE = "bm_george";
export const DEFAULT_TTS_LANGUAGE = "en-GB";
export const DEFAULT_TTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_TTS_DTYPE = "q8";
export const DEFAULT_TTS_DEVICE = "cpu";
export const DEFAULT_TTS_SPEED = 0.95;
export const DEFAULT_TTS_SAMPLE_RATE = 24000;

/**
 * Returns centralized TTS configuration from environment variables.
 */
export function getTTSConfig(): TTSConfig {
  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase() || DEFAULT_TTS_PROVIDER;
  const voice = process.env.TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;
  const language = process.env.TTS_LANGUAGE?.trim() || DEFAULT_TTS_LANGUAGE;
  const model = process.env.TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;

  const rawDtype = (process.env.TTS_DTYPE?.trim().toLowerCase() || DEFAULT_TTS_DTYPE);
  const dtype = (["fp32", "fp16", "q8", "q4"].includes(rawDtype) ? rawDtype : DEFAULT_TTS_DTYPE) as TTSConfig["dtype"];

  const rawDevice = (process.env.TTS_DEVICE?.trim().toLowerCase() || DEFAULT_TTS_DEVICE);
  const device = (["cpu", "wasm"].includes(rawDevice) ? rawDevice : DEFAULT_TTS_DEVICE) as TTSConfig["device"];

  const rawSpeed = process.env.TTS_SPEED ? parseFloat(process.env.TTS_SPEED) : DEFAULT_TTS_SPEED;
  const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 && rawSpeed <= 3.0 ? rawSpeed : DEFAULT_TTS_SPEED;

  return {
    provider,
    voice,
    language,
    model,
    dtype,
    device,
    speed,
    sampleRate: DEFAULT_TTS_SAMPLE_RATE
  };
}
