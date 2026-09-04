import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import {
  ITTSProvider,
  AudioData,
  SynthesizeOptions,
  TTSChunk
} from "../../types.js";
import { getTTSConfig, TTSConfig } from "../../../../core/config/index.js";
import {
  TTSModelError,
  TTSVoiceNotFoundError,
  TTSInferenceError
} from "../../../../core/errors/index.js";
import { createAudioData } from "./kokoro-audio.js";

export interface KokoroProviderOptions {
  config?: Partial<TTSConfig>;
  ttsInstance?: any; // Useful for dependency injection / mocking in tests
}

/**
 * Local Text-to-Speech provider using Kokoro-82M ONNX runtime.
 * Performs fast, 100% offline neural voice synthesis.
 */
export class KokoroTTSProvider implements ITTSProvider {
  public readonly id = "kokoro" as const;
  public readonly name = "Kokoro-82M Local TTS";

  private config: TTSConfig;
  private ttsPromise: Promise<any> | null = null;
  private ttsInstance: any = null;

  constructor(options?: KokoroProviderOptions) {
    this.config = {
      ...getTTSConfig(),
      ...options?.config
    };

    if (options?.ttsInstance) {
      this.ttsInstance = options.ttsInstance;
      this.ttsPromise = Promise.resolve(options.ttsInstance);
    }
  }

  public isConfigured(): boolean {
    return true; // Local provider doesn't require API keys
  }

  /**
   * Lazily loads the Kokoro-82M model via ONNX.
   */
  private async getModel(): Promise<any> {
    if (this.ttsInstance) {
      return this.ttsInstance;
    }

    if (!this.ttsPromise) {
      this.ttsPromise = (async () => {
        try {
          const model = await KokoroTTS.from_pretrained(this.config.model, {
            dtype: this.config.dtype,
            device: this.config.device
          });
          this.ttsInstance = model;
          return model;
        } catch (error) {
          throw new TTSModelError(
            this.id,
            this.config.model,
            `Failed to load Kokoro ONNX model: ${(error as Error).message}`,
            error
          );
        }
      })();
    }

    return this.ttsPromise;
  }

  /**
   * Synthesizes text into AudioData.
   */
  public async synthesize(
    text: string,
    options?: SynthesizeOptions
  ): Promise<AudioData> {
    if (!text || text.trim().length === 0) {
      throw new TTSInferenceError(this.id, "Cannot synthesize empty text.");
    }

    const model = await this.getModel();
    const voice = options?.voice || this.config.voice;
    const speed = options?.speed ?? this.config.speed;

    // Validate voice
    const supported = this.getSupportedVoices().map((v) => v.id);
    if (!supported.includes(voice)) {
      throw new TTSVoiceNotFoundError(this.id, voice, supported);
    }

    try {
      const generated = await model.generate(text, {
        voice,
        speed
      });

      const rawSamples = generated.audio instanceof Float32Array
        ? generated.audio
        : new Float32Array(generated.audio);

      return createAudioData(rawSamples, generated.sampling_rate || 24000);
    } catch (error) {
      if (error instanceof TTSVoiceNotFoundError || error instanceof TTSModelError) {
        throw error;
      }
      throw new TTSInferenceError(
        this.id,
        `Synthesis failed for voice '${voice}': ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Streams synthesized audio chunks from an incoming text stream.
   */
  public async *synthesizeStream(
    textStream: AsyncIterable<string>,
    options?: SynthesizeOptions
  ): AsyncIterable<TTSChunk> {
    const model = await this.getModel();
    const voice = options?.voice || this.config.voice;
    const speed = options?.speed ?? this.config.speed;

    const splitter = new TextSplitterStream();
    const stream = model.stream(splitter, {
      voice,
      speed
    });

    // Feed the splitter in the background
    (async () => {
      try {
        for await (const token of textStream) {
          splitter.push(token);
        }
      } finally {
        splitter.close();
      }
    })();

    let index = 0;
    for await (const chunk of stream) {
      const samples = chunk.audio.audio instanceof Float32Array
        ? chunk.audio.audio
        : new Float32Array(chunk.audio.audio);

      const audio = createAudioData(samples, chunk.audio.sampling_rate || 24000);

      yield {
        text: chunk.text,
        phonemes: chunk.phonemes,
        audio,
        index: index++,
        isFinal: false
      };
    }
  }

  /**
   * Returns list of supported British and international voices.
   */
  public getSupportedVoices() {
    return [
      // British English Male (Butler candidates)
      { id: "bm_george", name: "George (British Male)", language: "en-GB", gender: "male" },
      { id: "bm_fable", name: "Fable (British Male)", language: "en-GB", gender: "male" },
      { id: "bm_lewis", name: "Lewis (British Male)", language: "en-GB", gender: "male" },
      { id: "bm_daniel", name: "Daniel (British Male)", language: "en-GB", gender: "male" },

      // British English Female
      { id: "bf_emma", name: "Emma (British Female)", language: "en-GB", gender: "female" },
      { id: "bf_isabella", name: "Isabella (British Female)", language: "en-GB", gender: "female" },
      { id: "bf_alice", name: "Alice (British Female)", language: "en-GB", gender: "female" },
      { id: "bf_lily", name: "Lily (British Female)", language: "en-GB", gender: "female" },

      // American English Male & Female
      { id: "af_heart", name: "Heart (American Female)", language: "en-US", gender: "female" },
      { id: "am_michael", name: "Michael (American Male)", language: "en-US", gender: "male" },
      { id: "am_adam", name: "Adam (American Male)", language: "en-US", gender: "male" }
    ];
  }
}
