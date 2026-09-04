import { VoiceProfile } from "../types.js";

/**
 * Canonical default voice profile for B.U.T.L.E.R. Alfred.
 *
 * Characteristics:
 * - Language: en-GB (British English)
 * - Accent: British RP (Received Pronunciation)
 * - Gender: Male
 * - Character: Formal British Butler
 * - Style: Calm, composed, respectful
 * - Energy: Restrained, low-moderate pace
 */
export const ALFRED_DEFAULT_VOICE_PROFILE: VoiceProfile = {
  id: "alfred-default",
  name: "Alfred Pennyworth (Canonical Butler)",
  language: "en-GB",
  accent: "British",
  gender: "male",
  character: "formal-butler",
  style: "calm",
  energy: "restrained",
  speed: 0.95,
  providerVoiceMap: {
    kokoro: "bm_george",
    elevenlabs: "charlie", // Placeholder for future cloud provider
    openai: "onyx",        // Placeholder for future cloud provider
    azure: "en-GB-RyanNeural" // Placeholder for future cloud provider
  }
};

/**
 * Returns the voice identifier mapped to the given provider.
 * Falls back to default if not explicitly mapped.
 */
export function getProfileVoiceForProvider(
  profile: VoiceProfile,
  providerId: string,
  fallback = "bm_george"
): string {
  return profile.providerVoiceMap[providerId.toLowerCase()] || fallback;
}
