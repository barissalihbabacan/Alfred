/**
 * Dumps every Firestore collection (with subcollections) to a JSON file.
 *
 *   npm run backup:firestore -- --out backup.json
 *
 * Credentials: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS,
 * set by google-github-actions/auth in .github/workflows/backup.yml). The
 * project id comes from the credentials, GCLOUD_PROJECT or .firebaserc.
 *
 * Prints document counts only, never document content: the workflow log of a
 * public repository is public. The workflow encrypts the file before storing it.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, writeFileSync } from "node:fs";
import { BACKUP_FORMAT, countDocuments, dumpCollection, type FirestoreBackup } from "./firestore-backup-format.js";

function projectIdFromFirebaserc(): string | undefined {
  try {
    const rc = JSON.parse(readFileSync(new URL("../.firebaserc", import.meta.url), "utf8")) as { projects?: { default?: string } };
    return rc.projects?.default;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : "firestore-backup.json";
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectIdFromFirebaserc();
  if (!projectId) throw new Error("No project id: set GCLOUD_PROJECT or .firebaserc projects.default.");

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const backup: FirestoreBackup = { format: BACKUP_FORMAT, projectId, createdAt: new Date().toISOString(), collections: {} };
  for (const collection of await db.listCollections()) {
    backup.collections[collection.id] = await dumpCollection(collection);
  }

  writeFileSync(out, JSON.stringify(backup));
  const counts = countDocuments(backup.collections);
  console.log(`Backed up project ${projectId} to ${out}:`);
  for (const [path, n] of Object.entries(counts)) console.log(`  ${path}: ${n} document(s)`);
  if (Object.keys(counts).length === 0) console.log("  (no collections)");
}

main().catch((err: unknown) => {
  console.error("Backup failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
