import { IMemoryRepository } from "./memory-repository.interface.js";
import { FirestoreMemoryRepository } from "./firestore-memory-repository.js";
import { InMemoryMemoryRepository } from "./in-memory-memory-repository.js";
import { hasFirestoreCredentials } from "./factory.js";

let cachedMemoryRepo: IMemoryRepository | null = null;

/**
 * Returns the active memory repository singleton.
 * Uses FirestoreMemoryRepository when live credentials or emulator are configured.
 * Uses InMemoryMemoryRepository during tests or when credentials are absent.
 */
export function getMemoryRepository(): IMemoryRepository {
  if (cachedMemoryRepo) {
    return cachedMemoryRepo;
  }

  if (process.env.USE_IN_MEMORY_MEMORY_REPO === "true" || !hasFirestoreCredentials()) {
    cachedMemoryRepo = new InMemoryMemoryRepository();
    return cachedMemoryRepo;
  }

  try {
    cachedMemoryRepo = new FirestoreMemoryRepository();
    return cachedMemoryRepo;
  } catch (err) {
    console.warn(
      "[MemoryRepository] Could not initialize Firestore memory repo, falling back to InMemoryMemoryRepository:",
      err
    );
    cachedMemoryRepo = new InMemoryMemoryRepository();
    return cachedMemoryRepo;
  }
}

/**
 * Overrides the active memory repository (primarily for unit tests).
 */
export function setMemoryRepository(repo: IMemoryRepository | null): void {
  cachedMemoryRepo = repo;
}
