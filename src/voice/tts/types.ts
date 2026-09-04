/**
 * Normalized audio representation for synthesized speech.
 */
export interface AudioData {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly channels: number;
  readonly duration: number; // in seconds
  toWav(): Buffer;
  save(filePath: string): Promise<void>;
}

/**
 * Options passed to the TTS synthesis engine.
 */
export interface SynthesizeOptions {
  voice?: string;
  speed?: number;
  language?: string;
  splitPattern?: RegExp | string;
}

/**
 * Chunks yielded during streaming synthesis.
 */
export interface TTSChunk {
  text: string;
  phonemes?: string;
  audio: AudioData;
  index: number;
  isFinal: boolean;
}

/**
 * High-level persona voice profile decoupled from underlying TTS engine identifiers.
 */
export interface VoiceProfile {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly accent: string;
  readonly gender: "male" | "female" | "neutral";
  readonly character: string;
  readonly style: string;
  readonly energy: string;
  readonly speed?: number;
  /**
   * Mapping from provider ID (e.g. 'kokoro', 'elevenlabs') to provider-specific voice ID
   */
  readonly providerVoiceMap: Record<string, string>;
}

/**
 * Contract for all TTS engine providers.
 */
export interface ITTSProvider {
  readonly id: string;
  readonly name: string;

  /**
   * Returns true if the provider is initialized and ready for synthesis.
   */
  isConfigured(): boolean;

  /**
   * Synthesizes full text input into an AudioData object.
   */
  synthesize(text: string, options?: SynthesizeOptions): Promise<AudioData>;

  /**
   * Streams synthesized audio chunks from an incoming text stream (for real-time LLM piping).
   */
  synthesizeStream?(
    textStream: AsyncIterable<string>,
    options?: SynthesizeOptions
  ): AsyncIterable<TTSChunk>;

  /**
   * Returns metadata for all supported voices in this provider.
   */
  getSupportedVoices(): Array<{
    id: string;
    name: string;
    language: string;
    gender: string;
  }>;
}
