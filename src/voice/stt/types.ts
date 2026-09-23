import {
  AudioTranscriptionOptions,
  AudioTranscriptionResponse
} from "../../ai/providers/types.js";

export interface STTTranscriptionOptions extends AudioTranscriptionOptions {}
export interface STTTranscriptionResult extends AudioTranscriptionResponse {}

/**
 * Interface representing the Speech-to-Text service boundary for Alfred's voice layer.
 */
export interface SpeechToTextService {
  transcribe(options: STTTranscriptionOptions): Promise<STTTranscriptionResult>;
}
