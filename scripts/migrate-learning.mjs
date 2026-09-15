#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const learning = await import("../src/learning-system.js");
const store = await import("../src/store.js");
const migration = await learning.migrateLearningData({ dryRun: process.argv.includes("--dry-run") });
const bookId = option("--book");
const chunkId = option("--chunk");
const quote = option("--quote");
let cursor = null;

if (bookId || chunkId || quote) {
  if (!bookId || !chunkId || !quote) throw new Error("--book, --chunk, and --quote must be provided together");
  const chunk = await store.readChunk(bookId, chunkId);
  const charStart = chunk.text.toLowerCase().indexOf(quote.toLowerCase());
  if (charStart < 0) throw new Error(`Quote not found in ${bookId}/${chunkId}`);
  const before = chunk.text.slice(0, charStart).trim();
  const startWord = before ? before.split(/\s+/).length : 0;
  cursor = await store.saveReadingCursor({ bookId, chunkId, startWord, endWord: startWord, recentText: chunk.text.slice(charStart, charStart + 500), completedChunk: false });
}

process.stdout.write(`${JSON.stringify({ migration, cursor }, null, 2)}\n`);
