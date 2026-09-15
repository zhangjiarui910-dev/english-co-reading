import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tempDataDir = await mkdtemp(path.join(os.tmpdir(), "english-co-reading-"));
await cp(path.join(root, "data.example"), tempDataDir, { recursive: true });
process.env.READING_MCP_DATA_DIR = tempDataDir;

const manifest = {
  bookId: "english-demo",
  title: "English Demo",
  author: "Test Author",
  chunks: [{ id: "ch00", title: "Chapter One", order: 0, path: "chunks/ch00.txt", prevId: null, nextId: null }],
};
await mkdir(path.join(tempDataDir, "books", "english-demo", "chunks"), { recursive: true });
await writeFile(path.join(tempDataDir, "books", "english-demo", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  path.join(tempDataDir, "books", "english-demo", "chunks", "ch00.txt"),
  Array.from({ length: 420 }, (_, index) => `word${index + 1}`).join(" "),
);

const learning = await import("../src/learning-system.js");
const passage = await learning.readStudyPassage({ bookId: "english-demo", chunkId: "ch00", maxWords: 120 });
if (passage.wordCount !== 120 || passage.nextStartWord !== 120 || !passage.hasMoreInChunk) {
  throw new Error("study passage cursor failed");
}

await learning.saveVocabulary({
  bookId: "english-demo",
  chunkId: "ch00",
  term: "make sense of",
  context: "We make sense of a difficult passage.",
  meaning: "理解；弄懂",
});
const vocabulary = await learning.listVocabulary({ bookId: "english-demo" });
if (vocabulary.length !== 1 || vocabulary[0].term !== "make sense of") {
  throw new Error("vocabulary persistence failed");
}

await learning.logPractice({
  bookId: "english-demo",
  chunkId: "ch00",
  activity: "retell",
  learnerText: "The narrator tries to understand the event.",
  feedback: "Clear and accurate.",
  strengths: ["accurate main idea"],
});
await learning.setLearningProfile({ targetLevel: "B2", sessionWords: 240, goals: ["read essays"] });
const dashboard = await learning.learningDashboard({ bookId: "english-demo" });
if (dashboard.vocabularyCount !== 1 || dashboard.practiceCount !== 1 || dashboard.profile.sessionWords !== 240) {
  throw new Error("learning dashboard failed");
}

console.log("English learning smoke test passed");
