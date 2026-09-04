/**
 * Canonical User Profile & Context Types — B.U.T.L.E.R. Alfred
 *
 * Defines structured representations for Alfred's canonical user profile layer,
 * loaded from version-controlled Git files under `users/`.
 *
 * Designed to cleanly coexist with future FirestoreMemoryProvider and
 * VectorSearchProvider without creating competing sources of truth.
 */

export interface CanonicalUserProfile {
  name: string;
  fullName: string;
  role: string;
  technicalProficiency: string;
  coreCompetencies: string[];
  primaryLanguages: string[];
  broadPhilosophy: string;
  expectationsFromAlfred: string[];
}

export interface CanonicalUserPreferences {
  defaultLanguageRegister: string;
  multilingualSupport: string[];
  formsOfAddress: {
    english: string;
    turkish: string;
    frequency: string;
  };
  forbiddenMannerisms: string[];
  responseStructure: string;
  pushbackTriggers: string[];
  concisenessGuidelines: {
    operational: string;
    architectural: string;
  };
}

export interface CanonicalWorkingStyle {
  incrementalDevelopment: string;
  progressionModel: string;
  investigationProtocol: string;
  complexityPolicy: string;
  collaborationContract: string;
}

export interface CanonicalUserContext {
  profile: CanonicalUserProfile;
  preferences: CanonicalUserPreferences;
  workingStyle: CanonicalWorkingStyle;
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
