import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  ITTSProvider,
  AudioData,
  SynthesizeOptions,
  TTSChunk,
  VoiceProfile
} from "./types.js";
import { ALFRED_DEFAULT_VOICE_PROFILE, getProfileVoiceForProvider } from "./profiles/alfred.js";
import { KokoroTTSProvider } from "./providers/kokoro/index.js";

const execAsync = promisify(exec);

export interface TTSServiceOptions {
  provider?: ITTSProvider;
  profile?: VoiceProfile;
}

/**
 * High-level Text-to-Speech facade for B.U.T.L.E.R. Alfred.
 * Orchestrates voice profiles, TTS provider dispatch, and audio playback.
 */
export class TTSService {
  private provider: ITTSProvider;
  private profile: VoiceProfile;

  constructor(options?: TTSServiceOptions) {
    this.provider = options?.provider || new KokoroTTSProvider();
    this.profile = options?.profile || ALFRED_DEFAULT_VOICE_PROFILE;
  }

  public getProvider(): ITTSProvider {
    return this.provider;
  }

  public getProfile(): VoiceProfile {
    return this.profile;
  }

  public setProvider(provider: ITTSProvider): void {
    this.provider = provider;
  }

  public setProfile(profile: VoiceProfile): void {
    this.profile = profile;
  }

  /**
   * Synthesizes text using Alfred's current voice profile and provider.
   */
  public async speak(text: string, options?: SynthesizeOptions): Promise<AudioData> {
    const voice = options?.voice || getProfileVoiceForProvider(this.profile, this.provider.id);
    const speed = options?.speed ?? this.profile.speed;

    return this.provider.synthesize(text, {
      ...options,
      voice,
      speed,
      language: options?.language || this.profile.language
    });
  }

  /**
   * Streams audio chunks as text chunks arrive.
   */
  public async *speakStream(
    textStream: AsyncIterable<string>,
    options?: SynthesizeOptions
  ): AsyncIterable<TTSChunk> {
    if (!this.provider.synthesizeStream) {
      throw new Error(`Provider '${this.provider.name}' does not support streaming synthesis.`);
    }

    const voice = options?.voice || getProfileVoiceForProvider(this.profile, this.provider.id);
    const speed = options?.speed ?? this.profile.speed;

    yield* this.provider.synthesizeStream(textStream, {
      ...options,
      voice,
      speed,
      language: options?.language || this.profile.language
    });
  }

  /**
   * Attempts to play audio locally using the available system player (paplay, aplay, etc.).
   */
  public async playAudio(audioOrPath: AudioData | string): Promise<boolean> {
    let filePath: string;
    let tempFileCreated = false;

    if (typeof audioOrPath === "string") {
      filePath = audioOrPath;
    } else {
      filePath = path.join(os.tmpdir(), `alfred_speech_${Date.now()}.wav`);
      await audioOrPath.save(filePath);
      tempFileCreated = true;
    }

    try {
      const player = await this.detectAudioPlayer();
      if (!player) {
        return false;
      }

      await execAsync(`${player} "${filePath}"`);
      return true;
    } catch {
      return false;
    } finally {
      if (tempFileCreated) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  /**
   * Detects available system command-line audio player.
   */
  private async detectAudioPlayer(): Promise<string | null> {
    const candidates = process.platform === "darwin"
      ? ["afplay"]
      : ["paplay", "aplay", "ffplay -nodisp -autoexit", "mpv --no-video"];

    for (const cmd of candidates) {
      const bin = cmd.split(" ")[0];
      try {
        await execAsync(`which ${bin}`);
        return cmd;
      } catch {
        // Continue searching
      }
    }

    return null;
  }
}
