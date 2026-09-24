/**
 * Canonical User Profile & Context Types — B.U.T.L.E.R. Alfred
 *
 * Alfred's canonical user profile is the human-authored Markdown under
 * `users/` (USER_PROFILE.md, PREFERENCES.md, WORKING_STYLE.md). It is kept as
 * the raw file contents. The system prompt carries a hand-written, reviewed
 * digest of exactly these files (./user-profile.digest.md, which records
 * their sha256; tests and the functions build fail once a file changes
 * without the digest being updated), so every edit to users/*.md still has
 * to reach the prompt before it can be deployed. Sources other than the
 * committed files are rendered verbatim by `renderUserProfileBlock()`.
 *
 * Designed to cleanly coexist with FirestoreMemoryProvider and
 * VectorSearchProvider without creating competing sources of truth.
 */

/** The raw contents of the three canonical profile files. */
export interface UserProfileSources {
  /** users/USER_PROFILE.md */
  userProfile: string;
  /** users/PREFERENCES.md */
  preferences: string;
  /** users/WORKING_STYLE.md */
  workingStyle: string;
}

export interface CanonicalUserContext {
  sources: UserProfileSources;
  /**
   * "git": every file was read from users/ on disk.
   * "fallback": users/ (or some file in it) was unreadable, so the missing
   * files came from the copy embedded at build time (user-profile.generated.ts).
   */
  source: "git" | "fallback";
  loadedAt: Date;
}

/**
 * Interface for Canonical Profile Providers.
 * Part of the planned tripartite context architecture:
 * - CanonicalProfileProvider (Git - Authoritative for baseline profile)
 * - MemoryProvider (Firestore - Authoritative for learned memories)
 * - SemanticRetrievalProvider (Vector DB - Non-authoritative search index)
 */
export interface ICanonicalProfileProvider {
  loadContext(): Promise<CanonicalUserContext>;
  loadContextSync(): CanonicalUserContext;
}
