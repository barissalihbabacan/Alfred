/**
 * Firestore -> JSON for the weekly backup (scripts/backup-firestore.ts).
 *
 * Pure apart from the Firestore handles it is given, so it can be tested with
 * plain objects. Values JSON cannot hold are tagged so a restore can rebuild
 * them exactly: {"__type": "timestamp" | "geopoint" | "reference" | "bytes", …}.
 */

export const BACKUP_FORMAT = "alfred-firestore-backup/1";

export interface BackupDocument {
  id: string;
  data: Record<string, unknown>;
  /** Subcollections by name (e.g. conversations/{id}/messages); omitted when none. */
  collections?: Record<string, BackupDocument[]>;
}

export interface FirestoreBackup {
  format: typeof BACKUP_FORMAT;
  projectId: string;
  createdAt: string;
  collections: Record<string, BackupDocument[]>;
}

/** The parts of the Admin SDK the dump uses (a CollectionReference / DocumentSnapshot subset). */
export interface CollectionLike {
  id: string;
  get(): Promise<{ docs: DocumentSnapshotLike[] }>;
}
export interface DocumentSnapshotLike {
  id: string;
  data(): Record<string, unknown> | undefined;
  ref: { listCollections(): Promise<CollectionLike[]> };
}

function isTimestamp(v: object): v is { seconds: number; nanoseconds: number; toDate: () => Date } {
  const t = v as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  return typeof t.seconds === "number" && typeof t.nanoseconds === "number" && typeof t.toDate === "function";
}

function isGeoPoint(v: object): v is { latitude: number; longitude: number } {
  const g = v as { latitude?: unknown; longitude?: unknown; constructor?: { name?: string } };
  return typeof g.latitude === "number" && typeof g.longitude === "number" && g.constructor?.name === "GeoPoint";
}

function isReference(v: object): v is { path: string; firestore: unknown } {
  const r = v as { path?: unknown; firestore?: unknown; constructor?: { name?: string } };
  return typeof r.path === "string" && r.constructor?.name === "DocumentReference";
}

/** One Firestore field value as JSON, tagging the types JSON has no form for. */
export function serializeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value instanceof Uint8Array) return { __type: "bytes", base64: Buffer.from(value).toString("base64") };
  if (isTimestamp(value)) {
    return { __type: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds, iso: value.toDate().toISOString() };
  }
  if (isGeoPoint(value)) return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  if (isReference(value)) return { __type: "reference", path: value.path };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v);
  return out;
}

/** Every document of a collection, with its subcollections, recursively. */
export async function dumpCollection(collection: CollectionLike): Promise<BackupDocument[]> {
  const snap = await collection.get();
  const docs: BackupDocument[] = [];
  for (const doc of snap.docs) {
    const entry: BackupDocument = { id: doc.id, data: serializeValue(doc.data() ?? {}) as Record<string, unknown> };
    const subcollections = await doc.ref.listCollections();
    if (subcollections.length > 0) {
      entry.collections = {};
      for (const sub of subcollections) entry.collections[sub.id] = await dumpCollection(sub);
    }
    docs.push(entry);
  }
  return docs;
}

/** Document counts per collection path, for the log (never the content). */
export function countDocuments(collections: Record<string, BackupDocument[]>, prefix = ""): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, docs] of Object.entries(collections)) {
    const path = prefix ? `${prefix}/*/${name}` : name;
    counts[path] = (counts[path] ?? 0) + docs.length;
    for (const doc of docs) {
      if (!doc.collections) continue;
      for (const [sub, n] of Object.entries(countDocuments(doc.collections, path))) counts[sub] = (counts[sub] ?? 0) + n;
    }
  }
  return counts;
}
