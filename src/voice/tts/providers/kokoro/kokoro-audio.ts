import fs from "node:fs/promises";
import path from "node:path";
import { AudioData } from "../../types.js";
import { TTSOutputError } from "../../../../core/errors/index.js";

/**
 * Encodes raw Float32Array PCM samples into a standard 16-bit integer RIFF/WAV buffer.
 */
export function encodeWav16Bit(
  samples: Float32Array,
  sampleRate = 24000,
  numChannels = 1
): Buffer {
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF identifier
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // audio format (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write samples with clipping and 16-bit int scaling
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.round(val), offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Constructs an AudioData implementation from raw PCM samples.
 */
export function createAudioData(
  samples: Float32Array,
  sampleRate = 24000,
  channels = 1
): AudioData {
  const duration = samples.length / sampleRate;

  return {
    samples,
    sampleRate,
    channels,
    duration,
    toWav(): Buffer {
      return encodeWav16Bit(samples, sampleRate, channels);
    },
    async save(filePath: string): Promise<void> {
      try {
        const resolved = path.resolve(filePath);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        const wavBuffer = encodeWav16Bit(samples, sampleRate, channels);
        await fs.writeFile(resolved, wavBuffer);
      } catch (error) {
        throw new TTSOutputError(
          "kokoro",
          filePath,
          (error as Error).message,
          error
        );
      }
    }
  };
}
