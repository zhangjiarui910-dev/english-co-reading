import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDataDir = await mkdtemp(path.join(os.tmpdir(), "english-learning-system-"));
process.env.READING_MCP_DATA_DIR = tempDataDir;
const bookId = "the-yellow-wallpaper";
const chunkId = "ch02";
const target = "I don't like our room a bit.";
const chunkText = `# Chapter Two\n\nBut John says if I feel so, I shall neglect proper self-control; so I take pains to control myself.\n\n${target} I wanted one downstairs that opened on the piazza and had roses all over the window.\n\nHe is very careful and loving.`.replace(/\n/g, "\r\n");
const bookDir = path.join(tempDataDir, "books", bookId);
await mkdir(path.join(bookDir, "chunks"), { recursive: true });
await writeFile(path.join(bookDir, "chunks", `${chunkId}.txt`), chunkText, "utf8");
await writeFile(path.join(bookDir, "manifest.json"), `${JSON.stringify({ bookId, title: "The Yellow Wallpaper", author: "Charlotte Perkins Gilman", chunks: [{ id: chunkId, title: "Chapter Two", order: 0, path: `chunks/${chunkId}.txt`, prevId: null, nextId: null }] }, null, 2)}\n`, "utf8");

const vocabulary = Array.from({ length: 11 }, (_, index) => ({ id: `v${index}`, bookId, chunkId, term: index === 0 ? "if I feel so" : `term-${index}`, context: index === 0 ? "But John says if I feel so" : target, meaning: `释义 ${index}`, note: "语境提示", status: "new", nextReviewAt: null, createdAt: `2026-08-2${index % 7}T00:00:00.000Z` }));
const practice = Array.from({ length: 25 }, (_, index) => ({ id: `p${index}`, bookId, chunkId, activity: "translation", learnerText: `学习者表达 ${index}`, feedback: `推荐表达 ${index}`, corrections: index ? [] : ["需要区分字面与推断"], strengths: ["理解主旨"], createdAt: `2026-08-2${index % 7}T01:00:00.000Z` }));
await writeFile(path.join(tempDataDir, "english_vocabulary.jsonl"), `${vocabulary.map(JSON.stringify).join("\n")}\n`, "utf8");
await writeFile(path.join(tempDataDir, "english_practice.jsonl"), `${practice.map(JSON.stringify).join("\n")}\n`, "utf8");

const learning = await import("../src/learning-system.js");
const store = await import("../src/store.js");
const server = await import("../src/server.js");

const firstMigration = await learning.migrateLearningData();
const secondMigration = await learning.migrateLearningData();
if (firstMigration.vocabularyCount !== 11 || firstMigration.practiceCount !== 25 || !secondMigration.alreadyCurrent) throw new Error("idempotent legacy migration failed");
if ((await readFile(path.join(tempDataDir, "english_vocabulary.jsonl"), "utf8")).split(/\n/).filter(Boolean).length !== 11) throw new Error("legacy vocabulary changed");
if ((await readFile(path.join(tempDataDir, "english_practice.jsonl"), "utf8")).split(/\n/).filter(Boolean).length !== 25) throw new Error("legacy practice changed");

const charStart = chunkText.indexOf(target);
const startWord = chunkText.slice(0, charStart).trim().split(/\s+/).length;
await store.saveReadingCursor({ bookId, chunkId, startWord, endWord: startWord, recentText: chunkText.slice(charStart), completedChunk: false });
const resolved = await store.resolveReadingCursor({ bookId });
if (resolved.chunkId !== chunkId || !resolved.anchorText.startsWith(target)) throw new Error("exact sentence cursor failed");
const passage = await learning.readStudyPassage({ bookId, maxWords: 80 });
if (!passage.passage.startsWith(target) || passage.displayedCursor.completedChunk) throw new Error("exact resume passage failed");
const progress = await store.getProgress(bookId);
if (progress.readChunkIds.length !== 0 || progress.cursor.completedChunk) throw new Error("displaying a passage prematurely completed the chunk");

const pending = await learning.createPracticeDraft({ bookId, chunkId, activity: "sentence", sourceText: target, rawTranscript: "John only believes in sings he can see", errorClassification: "uncertain" });
if ((await learning.listReviewItems()).length !== 36) throw new Error("pending speech draft entered review");
const confirmed = await learning.confirmPracticeDraft({ draftId: pending.id, confirmedText: "John only believes in things he can see.", errorClassification: "speech_to_text_error", recommendedText: "John only believes in things he can see.", strengths: ["句子本身正确"], corrections: [], explanation: { literalMeaning: "only believes in things", naturalChinese: "John 只相信他能看见的事物。", contextInference: "这突出了他对可观察证据的偏好。" } });
if (confirmed.rawTranscript === confirmed.confirmedText || confirmed.practice.errorClassification !== "speech_to_text_error") throw new Error("speech audit/confirmation failed");
const pendingTwo = await learning.createPracticeDraft({ bookId, chunkId, rawTranscript: "bad transcript" });
await learning.discardPracticeDraft({ draftId: pendingTwo.id, reason: "recognition unusable" });
const review = await learning.listReviewItems({ bookId, chunkId });
if (review.length !== 37 || review.some((item) => item.learnerText === "bad transcript")) throw new Error("confirmed-only review failed");
const speechItem = review.find((item) => item.sourceId === confirmed.practice.id);
if (!speechItem?.fromSpeech || speechItem.rawTranscript !== pending.rawTranscript) throw new Error("speech provenance missing");

const layered = await learning.saveVocabulary({ bookId, chunkId, term: "if I feel so", context: "But John says if I feel so, I shall neglect proper self-control", meaning: "如果我有这种感觉", explanation: { literalMeaning: "字面指如果我有这种感觉 / 如果我这样感受。", naturalChinese: "John 说，如果我总这样想，就会疏于自我克制。", contextInference: "结合上下文，可理解为如果她任由这种情绪发展；这是语境推断，不是固定语法义。" } });
const layeredItem = (await learning.listReviewItems({ query: "任由这种情绪" })).find((item) => item.sourceId === layered.id);
if (!layeredItem?.explanation.literalMeaning || !layeredItem?.explanation.naturalChinese || !layeredItem?.explanation.contextInference) throw new Error("three-layer explanation failed");
await learning.updateReviewItem({ reviewId: speechItem.reviewId, status: "known" });
if (!(await learning.listReviewItems({ status: "known" })).some((item) => item.reviewId === speechItem.reviewId)) throw new Error("persistent review state failed");
const ratedItem = review.find((item) => item.sourceType === "vocabulary");
await learning.updateReviewItem({ reviewId: ratedItem.reviewId, status: "learning", nextReviewAt: new Date(Date.now() + 86400000).toISOString(), reviewRating: "forgot" });
const ratedOnce = (await learning.listReviewItems()).find((item) => item.reviewId === ratedItem.reviewId);
if (ratedOnce.reviewCount !== 1 || ratedOnce.lastReviewRating !== "forgot" || ratedOnce.status !== "learning") throw new Error("four-level review rating was not persisted");
await learning.updateReviewItem({ reviewId: ratedItem.reviewId, status: "known", nextReviewAt: null, reviewRating: "mastered" });
const masteredItem = (await learning.listReviewItems()).find((item) => item.reviewId === ratedItem.reviewId);
if (masteredItem.reviewCount !== 2 || masteredItem.lastReviewRating !== "mastered" || masteredItem.nextReviewAt !== null) throw new Error("mastered review state did not clear the schedule");

await learning.logPractice({ bookId, chunkId, learnerText: "Privacy check", sourceText: `${os.homedir()}\\private.epub`, feedback: `Do not expose ${path.basename(os.homedir())}`, inputMode: "typed" });
const markdown = await learning.exportReviewNotebook({ format: "markdown" });
const html = await learning.exportReviewNotebook({ format: "html" });
if (markdown.content.includes(os.homedir()) || markdown.content.includes(path.basename(os.homedir())) || /vocabulary:v\d/.test(markdown.content)) throw new Error("privacy-safe export failed");
if (!html.content.includes("Literal meaning") || !html.content.includes("Natural Chinese") || !html.content.includes("Context / literary inference")) throw new Error("human-readable layered HTML failed");
const names = new Set(server.tools.map((tool) => tool.name));
for (const name of ["english_review_notebook", "english_create_practice_draft", "english_confirm_practice_draft", "english_save_reading_position"]) if (!names.has(name)) throw new Error(`missing MCP tool ${name}`);

await rm(tempDataDir, { recursive: true, force: true });
console.log("learning system smoke passed: migration, exact cursor, speech confirmation, review, layers, privacy");
