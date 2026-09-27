import { describe, it, expect } from "vitest";
import { Firestore, GeoPoint, Timestamp } from "firebase-admin/firestore";
import {
  countDocuments,
  dumpCollection,
  serializeValue,
  type CollectionLike,
  type DocumentSnapshotLike
} from "../../scripts/firestore-backup-format.js";

// A Firestore handle that is never connected: only used to build a real DocumentReference.
const offlineDb = new Firestore({ projectId: "backup-test" });

function collection(id: string, docs: Array<{ id: string; data: Record<string, unknown>; subs?: CollectionLike[] }>): CollectionLike {
  return {
    id,
    get: async () => ({
      docs: docs.map((d): DocumentSnapshotLike => ({
        id: d.id,
        data: () => d.data,
        ref: { listCollections: async () => d.subs ?? [] }
      }))
    })
  };
}

describe("Firestore backup format (scripts/firestore-backup-format.ts)", () => {
  it("tags the Admin SDK types JSON cannot hold, using the real classes", () => {
    const ts = new Timestamp(1790419004, 123000000);
    expect(serializeValue(ts)).toEqual({ __type: "timestamp", seconds: 1790419004, nanoseconds: 123000000, iso: ts.toDate().toISOString() });
    expect(serializeValue(new GeoPoint(41.0082, 28.9784))).toEqual({ __type: "geopoint", latitude: 41.0082, longitude: 28.9784 });
    expect(serializeValue(offlineDb.doc("conversations/c1"))).toEqual({ __type: "reference", path: "conversations/c1" });
    expect(serializeValue(new Uint8Array([1, 2, 255]))).toEqual({ __type: "bytes", base64: "AQL/" });
  });

  it("keeps plain values, arrays (e.g. embeddings) and nested maps as they are", () => {
    const value = { content: "Barış", n: 3, ok: true, none: null, embedding: [0.1, -0.2], nested: { at: new Timestamp(1, 0), list: [{ x: 1 }] } };
    const out = serializeValue(value) as Record<string, unknown>;
    expect(out).toMatchObject({ content: "Barış", n: 3, ok: true, none: null, embedding: [0.1, -0.2], nested: { list: [{ x: 1 }] } });
    expect((out.nested as { at: { __type: string } }).at.__type).toBe("timestamp");
    // Round-trips through JSON.
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it("dumps subcollections (conversations/{id}/messages) and counts documents without their content", async () => {
    const messages = collection("messages", [
      { id: "m1", data: { role: "user", sequence: 1 } },
      { id: "m2", data: { role: "assistant", sequence: 2 } }
    ]);
    const conversations = collection("conversations", [
      { id: "c1", data: { title: "Test" }, subs: [messages] },
      { id: "c2", data: { title: "Boş" } }
    ]);
    const dumped = await dumpCollection(conversations);
    expect(dumped).toEqual([
      { id: "c1", data: { title: "Test" }, collections: { messages: [{ id: "m1", data: { role: "user", sequence: 1 } }, { id: "m2", data: { role: "assistant", sequence: 2 } }] } },
      { id: "c2", data: { title: "Boş" } }
    ]);
    const counts = countDocuments({ conversations: dumped, memory_vectors: [{ id: "v1", data: {} }] });
    expect(counts).toEqual({ conversations: 2, "conversations/*/messages": 2, memory_vectors: 1 });
    expect(JSON.stringify(counts)).not.toContain("Test");
  });
});
