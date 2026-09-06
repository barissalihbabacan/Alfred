#!/usr/bin/env tsx
import { getMemoryService } from "../src/alfred/cognitive/memory/index.js";

async function main() {
  console.log("=================================================");
  console.log(" B.U.T.L.E.R. Alfred — Long-Term Memory Re-Indexer");
  console.log("=================================================");
  console.log("Reading active canonical memories from Firestore...");

  // Parse optional --user flag
  const args = process.argv.slice(2);
  let userId: string | undefined;
  const userIdx = args.indexOf("--user");
  if (userIdx !== -1 && args[userIdx + 1]) {
    userId = args[userIdx + 1];
  }

  const memoryService = getMemoryService();
  const startTime = Date.now();

  try {
    const result = await memoryService.reindexAll(userId);
    const durationMs = Date.now() - startTime;

    console.log("-------------------------------------------------");
    console.log(`Total Active Records : ${result.total}`);
    console.log(`Successfully Indexed : ${result.succeeded}`);
    console.log(`Failed               : ${result.failed}`);
    console.log(`Duration             : ${durationMs}ms`);

    if (result.errors.length > 0) {
      console.error("\nErrors encountered during re-indexing:");
      for (const err of result.errors) {
        console.error(`- Memory [${err.memoryId}]: ${err.error}`);
      }
      process.exit(1);
    }

    console.log("\nRe-indexing completed successfully.");
    process.exit(0);
  } catch (err: any) {
    console.error("\nFatal error during re-indexing:", err?.message || err);
    process.exit(1);
  }
}

main();
