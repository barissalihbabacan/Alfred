import { IConversationRepository } from "./conversation-repository.interface.js";
import { FirestoreConversationRepository } from "./firestore-conversation-repository.js";
import { InMemoryConversationRepository } from "./in-memory-conversation-repository.js";

let cachedRepo: IConversationRepository | null = null;

/**
 * Determines whether real Firestore credentials or an emulator are available.
 */
export function hasFirestoreCredentials(): boolean {
  // If emulator host is present, Firestore is available locally
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return true;
  }

  // During Vitest unit test execution, default to InMemory repository
  // unless explicitly configured to use live Firestore
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    if (process.env.USE_LIVE_FIRESTORE_IN_TESTS !== "true") {
      return false;
    }
  }

  // Check for explicit service account credentials in environment
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const isRealEmail = clientEmail && !clientEmail.includes("your-service-account") && clientEmail.includes("@");
  const isRealKey = privateKey && privateKey.includes("-----BEGIN") && !privateKey.includes("...");

  if (isRealEmail && isRealKey) {
    return true;
  }

  // Cloud Functions or Google Cloud container environments have default credentials
  if (process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FIREBASE_CONFIG) {
    return true;
  }

  return false;
}

/**
 * Returns the active conversation repository singleton.
 * Uses FirestoreConversationRepository when credentials or emulator are configured.
 * Uses InMemoryConversationRepository during tests or when credentials are absent.
 */
export function getConversationRepository(): IConversationRepository {
  if (cachedRepo) {
    return cachedRepo;
  }

  if (process.env.USE_IN_MEMORY_CONVERSATION_REPO === "true" || !hasFirestoreCredentials()) {
    cachedRepo = new InMemoryConversationRepository();
    return cachedRepo;
  }

  try {
    cachedRepo = new FirestoreConversationRepository();
    return cachedRepo;
  } catch (err) {
    console.warn(
      "[ConversationRepository] Could not initialize Firestore, using InMemoryConversationRepository fallback:",
      err
    );
    cachedRepo = new InMemoryConversationRepository();
    return cachedRepo;
  }
}

/**
 * Overrides the active conversation repository (primarily for tests).
 */
export function setConversationRepository(repo: IConversationRepository | null): void {
  cachedRepo = repo;
}
