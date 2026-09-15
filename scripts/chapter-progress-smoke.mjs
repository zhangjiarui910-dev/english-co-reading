import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const store = await import("../src/store.js");

const books = await store.listBooks({ includePrivate: true });
const secondSelf = books.find((book) => book.bookId === "the-second-self");
const yellowWallpaper = books.find((book) => book.bookId === "the-yellow-wallpaper");

assert(secondSelf, "The Second Self is missing");
assert.equal(secondSelf.totalChunkCount, 91);
assert.equal(secondSelf.chunkCount, 76);
assert(secondSelf.chunksRead <= secondSelf.chunkCount);

assert(yellowWallpaper, "The Yellow Wallpaper is missing");
assert.equal(yellowWallpaper.totalChunkCount, 10);
assert.equal(yellowWallpaper.chunkCount, 8);
assert.equal(yellowWallpaper.chunksRead, 8);
assert(yellowWallpaper.chunksRead <= yellowWallpaper.chunkCount);

const chunks = await store.listChunks(secondSelf.bookId, { includePrivate: true });
const chapterIds = [...new Set(chunks.map((chunk) => chunk.chapterId))];
const appendixChunks = chunks.filter((chunk) => chunk.isAppendix);
const appendixChapterIds = [...new Set(appendixChunks.map((chunk) => chunk.chapterId))];
assert.equal(chapterIds.length, 17);
assert.equal(appendixChunks.length, 15);
assert.deepEqual(appendixChapterIds, ["ch00", "ch77", "ch88"]);
assert(chunks.filter((chunk) => ["ch71", "ch72", "ch73", "ch74", "ch75", "ch76"].includes(chunk.id)).every((chunk) => !chunk.isAppendix));

const annotationCount = chunks.reduce((sum, chunk) => sum + chunk.annotationCount, 0);
assert.equal(annotationCount, secondSelf.annotationCount);

await store.setChapterAppendixOverride(secondSelf.bookId, "ch71", true);
let changedBook = (await store.listBooks({ includePrivate: true })).find((book) => book.bookId === secondSelf.bookId);
assert.equal(changedBook.chunkCount, 73);
assert((await store.listChunks(secondSelf.bookId, { includePrivate: true })).filter((chunk) => ["ch71", "ch72", "ch73"].includes(chunk.id)).every((chunk) => chunk.isAppendix));

await store.setChapterAppendixOverride(secondSelf.bookId, "ch71", false);
changedBook = (await store.listBooks({ includePrivate: true })).find((book) => book.bookId === secondSelf.bookId);
assert.equal(changedBook.chunkCount, 76);

const manifest = JSON.parse(await readFile(path.join(process.env.READING_MCP_DATA_DIR, "books", secondSelf.bookId, "manifest.json"), "utf8"));
assert.equal(manifest.chapterAppendixOverrides.ch71, false);

console.log("chapter progress smoke passed: 17 chapters, 15 appendix chunks, 76 content chunks, Yellow Wallpaper 8/8");
