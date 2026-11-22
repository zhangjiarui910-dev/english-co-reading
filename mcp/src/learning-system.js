import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { dataDir, readChunk, resolveReadingCursor, saveReadingCursor } from "./store.js";

const vocabularyPath = path.join(dataDir, "english_vocabulary.jsonl");
const practicePath = path.join(dataDir, "english_practice.jsonl");
const draftsPath = path.join(dataDir, "english_practice_drafts.jsonl");
const profilePath = path.join(dataDir, "english_profile.json");
const reviewStatePath = path.join(dataDir, "english_review_state.json");
const migrationPath = path.join(dataDir, "english_learning_migration.json");
const exportsDir = path.join(dataDir, "exports");
const learningStatuses = new Set(["new", "learning", "known"]);
const errorClassifications = new Set(["speech_to_text_error", "learner_language_error", "uncertain", "confirmed_correct"]);
const activities = new Set(["retell", "answer", "translation", "sentence", "discussion"]);
let writeQueue = Promise.resolve();

function queuedWrite(task) { const next = writeQueue.then(task, task); writeQueue = next.catch(() => {}); return next; }
async function ensureDataDir() { await mkdir(dataDir, { recursive: true }); }
async function readJson(pathname, fallback) { try { return JSON.parse(await readFile(pathname, "utf8")); } catch (error) { if (error?.code === "ENOENT") return fallback; throw error; } }
async function readJsonl(pathname) { try { return (await readFile(pathname, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch (error) { if (error?.code === "ENOENT") return []; throw error; } }
async function writeJson(pathname, value) { await mkdir(path.dirname(pathname), { recursive: true }); await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
async function writeJsonl(pathname, rows) { await mkdir(path.dirname(pathname), { recursive: true }); const body = rows.map((row) => JSON.stringify(row)).join("\n"); await writeFile(pathname, body ? `${body}\n` : "", "utf8"); }
function cleanText(value) { return String(value || "").trim() || null; }
function nowIso() { return new Date().toISOString(); }
function clampInteger(value, fallback, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback; }
function explanation(input = {}, fallback = {}) { const value = input && typeof input === "object" ? input : {}; return { literalMeaning: cleanText(value.literalMeaning ?? fallback.literalMeaning), naturalChinese: cleanText(value.naturalChinese ?? fallback.naturalChinese), contextInference: cleanText(value.contextInference ?? fallback.contextInference) }; }
function confirmedPractice(row) { return !["pending", "discarded", "superseded"].includes(row.confirmationStatus || "confirmed"); }

export async function readStudyPassage(input = {}) {
  if (!input.bookId) throw new Error("bookId is required");
  let chunkId = input.chunkId || null;
  let startWord = input.startWord;
  let resume = null;
  if (!chunkId || startWord === undefined || startWord === null) {
    resume = await resolveReadingCursor({ bookId: input.bookId });
    chunkId ||= resume.chunkId;
    if (startWord === undefined || startWord === null) startWord = resume.startWord;
  }
  const chunk = await readChunk(input.bookId, chunkId);
  const words = chunk.text.trim().split(/\s+/).filter(Boolean);
  const start = clampInteger(startWord, 0, 0, words.length);
  const size = clampInteger(input.maxWords, 300, 80, 800);
  const end = Math.min(words.length, start + size);
  const passage = words.slice(start, end).join(" ");
  const displayedCursor = input.autoSave === false ? null : await saveReadingCursor({ bookId: input.bookId, chunkId, startWord: start, endWord: start, recentText: passage, completedChunk: false });
  return {
    bookId: input.bookId, bookTitle: chunk.title, chunkId, chunkTitle: chunk.chunk.title,
    startWord: start, endWord: end, wordCount: end - start, totalWords: words.length, passage,
    hasMoreInChunk: end < words.length, nextStartWord: end < words.length ? end : null,
    nextChunkId: end < words.length ? chunkId : chunk.nextId, previousChunkId: chunk.prevId,
    resume: resume ? { matchStatus: resume.matchStatus, warning: resume.warning, anchorText: resume.anchorText } : null,
    displayedCursor,
    completionHint: "After the learner finishes this small passage, call english_save_reading_position with endWord. Do not mark the whole chunk read unless it is actually finished.",
  };
}

export async function saveVocabulary(input = {}) {
  const term = cleanText(input.term);
  if (!term) throw new Error("term is required");
  if (!input.bookId) throw new Error("bookId is required");
  const createdAt = nowIso();
  const row = {
    schemaVersion: 2, id: crypto.randomUUID(), bookId: String(input.bookId), chunkId: cleanText(input.chunkId), term,
    context: cleanText(input.context), learnerGuess: cleanText(input.learnerGuess), meaning: cleanText(input.meaning),
    pronunciation: cleanText(input.pronunciation), note: cleanText(input.note),
    explanation: explanation(input.explanation, { literalMeaning: input.meaning, naturalChinese: input.meaning, contextInference: input.note }),
    status: learningStatuses.has(input.status) ? input.status : "new", nextReviewAt: cleanText(input.nextReviewAt),
    inputMode: input.inputMode === "speech" ? "speech" : "typed", confirmationStatus: "confirmed", confirmedAt: createdAt, createdAt,
  };
  return queuedWrite(async () => {
    await ensureDataDir();
    const existing = (await readJsonl(vocabularyPath)).find((item) =>
      String(item.bookId) === row.bookId &&
      (cleanText(item.chunkId) || null) === row.chunkId &&
      String(item.term || "").trim().toLocaleLowerCase() === row.term.toLocaleLowerCase() &&
      (cleanText(item.context) || null) === row.context
    );
    if (existing) return { ...existing, alreadyExists: true };
    await appendFile(vocabularyPath, `${JSON.stringify(row)}\n`, "utf8");
    return row;
  });
}

export async function listVocabulary({ bookId, chunkId, status, query, limit = 100 } = {}) {
  const state = await readJson(reviewStatePath, { items: {} });
  const needle = String(query || "").trim().toLowerCase();
  return (await readJsonl(vocabularyPath))
    .map((row) => { const overlay = state.items?.[`vocabulary:${row.id}`] || {}; return { ...row, ...(overlay.edits || {}), status: overlay.status || row.status, nextReviewAt: overlay.nextReviewAt ?? row.nextReviewAt, deletedAt: overlay.deletedAt || null }; })
    .filter((row) => !row.deletedAt).filter((row) => !bookId || row.bookId === bookId).filter((row) => !chunkId || row.chunkId === chunkId)
    .filter((row) => !status || row.status === status)
    .filter((row) => !needle || `${row.term} ${row.meaning || ""} ${row.context || ""}`.toLowerCase().includes(needle))
    .slice(-clampInteger(limit, 100, 1, 500)).reverse();
}

export async function logPractice(input = {}) {
  if (!input.bookId) throw new Error("bookId is required");
  if (!cleanText(input.learnerText)) throw new Error("learnerText is required");
  if (input.inputMode === "speech" && input.confirmationStatus !== "confirmed") throw new Error("Speech input must be saved with english_create_practice_draft and confirmed before it becomes practice.");
  const createdAt = nowIso();
  const row = {
    schemaVersion: 2, id: crypto.randomUUID(), bookId: String(input.bookId), chunkId: cleanText(input.chunkId),
    activity: activities.has(input.activity) ? input.activity : "retell", sourceText: cleanText(input.sourceText || input.context),
    learnerText: cleanText(input.learnerText), recommendedText: cleanText(input.recommendedText), feedback: cleanText(input.feedback),
    corrections: Array.isArray(input.corrections) ? input.corrections.map(String) : [], strengths: Array.isArray(input.strengths) ? input.strengths.map(String) : [],
    explanation: explanation(input.explanation), inputMode: input.inputMode === "speech" ? "speech" : "typed",
    rawTranscript: cleanText(input.rawTranscript), errorClassification: errorClassifications.has(input.errorClassification) ? input.errorClassification : "uncertain",
    confirmationStatus: "confirmed", confirmedAt: cleanText(input.confirmedAt) || createdAt, draftId: cleanText(input.draftId), createdAt,
  };
  await queuedWrite(async () => { await ensureDataDir(); await appendFile(practicePath, `${JSON.stringify(row)}\n`, "utf8"); });
  return row;
}

export async function createPracticeDraft(input = {}) {
  if (!input.bookId) throw new Error("bookId is required");
  const rawTranscript = cleanText(input.rawTranscript || input.learnerText);
  if (!rawTranscript) throw new Error("rawTranscript is required");
  const row = {
    schemaVersion: 2, id: crypto.randomUUID(), bookId: String(input.bookId), chunkId: cleanText(input.chunkId),
    activity: activities.has(input.activity) ? input.activity : "retell", sourceText: cleanText(input.sourceText || input.context), rawTranscript,
    editedText: cleanText(input.editedText) || rawTranscript, feedback: cleanText(input.feedback), recommendedText: cleanText(input.recommendedText),
    corrections: Array.isArray(input.corrections) ? input.corrections.map(String) : [], strengths: Array.isArray(input.strengths) ? input.strengths.map(String) : [],
    explanation: explanation(input.explanation), inputMode: "speech",
    errorClassification: errorClassifications.has(input.errorClassification) ? input.errorClassification : "uncertain",
    confirmationStatus: "pending", createdAt: nowIso(), updatedAt: nowIso(),
  };
  await queuedWrite(async () => { await ensureDataDir(); await appendFile(draftsPath, `${JSON.stringify(row)}\n`, "utf8"); });
  return row;
}

export async function listPracticeDrafts({ bookId, chunkId, status = "pending" } = {}) {
  return (await readJsonl(draftsPath)).filter((row) => !bookId || row.bookId === bookId).filter((row) => !chunkId || row.chunkId === chunkId).filter((row) => !status || row.confirmationStatus === status).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function updatePracticeDraft(input = {}) {
  if (!input.draftId) throw new Error("draftId is required");
  return queuedWrite(async () => {
    const rows = await readJsonl(draftsPath); let updated = null;
    const next = rows.map((row) => {
      if (row.id !== input.draftId) return row;
      if (row.confirmationStatus !== "pending") throw new Error("Only pending drafts can be edited");
      updated = { ...row,
        editedText: cleanText(input.editedText) ?? row.editedText, sourceText: cleanText(input.sourceText) ?? row.sourceText,
        feedback: cleanText(input.feedback) ?? row.feedback, recommendedText: cleanText(input.recommendedText) ?? row.recommendedText,
        corrections: Array.isArray(input.corrections) ? input.corrections.map(String) : row.corrections,
        strengths: Array.isArray(input.strengths) ? input.strengths.map(String) : row.strengths,
        explanation: input.explanation ? explanation(input.explanation, row.explanation) : row.explanation,
        errorClassification: errorClassifications.has(input.errorClassification) ? input.errorClassification : row.errorClassification, updatedAt: nowIso() };
      return updated;
    });
    if (!updated) throw new Error(`Unknown draftId: ${input.draftId}`);
    await writeJsonl(draftsPath, next); return updated;
  });
}

export async function confirmPracticeDraft(input = {}) {
  const draft = await updatePracticeDraft({ ...input, editedText: input.confirmedText ?? input.editedText });
  const practice = await logPractice({ ...draft, learnerText: draft.editedText, inputMode: "speech", confirmationStatus: "confirmed", rawTranscript: draft.rawTranscript, draftId: draft.id, errorClassification: errorClassifications.has(input.errorClassification) ? input.errorClassification : draft.errorClassification });
  await queuedWrite(async () => {
    const rows = await readJsonl(draftsPath);
    await writeJsonl(draftsPath, rows.map((row) => row.id === draft.id ? { ...row, editedText: draft.editedText, errorClassification: practice.errorClassification, confirmationStatus: "confirmed", confirmedAt: practice.confirmedAt, confirmedPracticeId: practice.id, updatedAt: nowIso() } : row));
  });
  return { draftId: draft.id, rawTranscript: draft.rawTranscript, confirmedText: practice.learnerText, practice };
}

export async function discardPracticeDraft({ draftId, reason } = {}) {
  if (!draftId) throw new Error("draftId is required");
  return queuedWrite(async () => {
    const rows = await readJsonl(draftsPath); let discarded = null;
    const next = rows.map((row) => { if (row.id !== draftId) return row; discarded = { ...row, confirmationStatus: "discarded", discardedAt: nowIso(), discardReason: cleanText(reason), updatedAt: nowIso() }; return discarded; });
    if (!discarded) throw new Error(`Unknown draftId: ${draftId}`);
    await writeJsonl(draftsPath, next); return discarded;
  });
}

async function metadataFor(bookId, chunkId, cache) {
  const key = `${bookId}/${chunkId || ""}`; if (cache.has(key)) return cache.get(key);
  let value = { bookTitle: bookId, chunkTitle: chunkId || "未记录章节" };
  if (bookId && chunkId) { try { const chunk = await readChunk(bookId, chunkId); value = { bookTitle: chunk.title, chunkTitle: chunk.chunk.title }; } catch {} }
  cache.set(key, value); return value;
}
function applyReviewState(item, state) { const overlay = state.items?.[item.reviewId] || {}; return { ...item, ...(overlay.edits || {}), status: overlay.status || item.status, nextReviewAt: Object.hasOwn(overlay, "nextReviewAt") ? overlay.nextReviewAt : item.nextReviewAt, deletedAt: overlay.deletedAt || null, reviewCount: overlay.reviewCount || 0, lastReviewRating: overlay.lastReviewRating || null, lastReviewedAt: overlay.lastReviewedAt || null }; }

export async function listReviewItems({ bookId, chunkId, status, query, includeDeleted = false, limit = 500 } = {}) {
  const [vocabulary, practice, state] = await Promise.all([readJsonl(vocabularyPath), readJsonl(practicePath), readJson(reviewStatePath, { schemaVersion: 2, items: {} })]);
  const cache = new Map(); const items = [];
  for (const row of vocabulary) {
    items.push(applyReviewState({ reviewId: `vocabulary:${row.id}`, sourceType: "vocabulary", sourceId: row.id, bookId: row.bookId, chunkId: row.chunkId || null, ...(await metadataFor(row.bookId, row.chunkId, cache)), term: row.term, pronunciation: row.pronunciation || null, meaning: row.meaning || null, context: row.context || null, learnerText: row.learnerGuess || null, recommendedText: row.meaning || row.note || null, feedback: row.note || null, strengths: row.strengths || [], corrections: row.corrections || [], explanation: explanation(row.explanation, { literalMeaning: row.meaning, naturalChinese: row.meaning, contextInference: row.note }), status: learningStatuses.has(row.status) ? row.status : "new", nextReviewAt: row.nextReviewAt || null, inputMode: row.inputMode || "unknown", fromSpeech: row.inputMode === "speech", confirmationStatus: row.confirmationStatus || "confirmed", confirmed: true, createdAt: row.createdAt || null }, state));
  }
  for (const row of practice.filter(confirmedPractice)) {
    items.push(applyReviewState({ reviewId: `practice:${row.id}`, sourceType: "practice", sourceId: row.id, bookId: row.bookId, chunkId: row.chunkId || null, ...(await metadataFor(row.bookId, row.chunkId, cache)), term: row.activity || "practice", pronunciation: null, meaning: null, context: row.sourceText || row.context || null, learnerText: row.learnerText || null, recommendedText: row.recommendedText || row.feedback || null, feedback: row.feedback || null, strengths: row.strengths || [], corrections: row.corrections || [], explanation: explanation(row.explanation, { naturalChinese: row.feedback }), status: learningStatuses.has(row.status) ? row.status : "new", nextReviewAt: row.nextReviewAt || null, inputMode: row.inputMode || "unknown", fromSpeech: row.inputMode === "speech", rawTranscript: row.rawTranscript || null, errorClassification: row.errorClassification || "uncertain", confirmationStatus: row.confirmationStatus || "confirmed", confirmed: true, createdAt: row.createdAt || null }, state));
  }
  const needle = String(query || "").trim().toLowerCase();
  return items.filter((item) => includeDeleted || !item.deletedAt).filter((item) => !bookId || item.bookId === bookId).filter((item) => !chunkId || item.chunkId === chunkId).filter((item) => !status || item.status === status).filter((item) => !needle || [item.term, item.context, item.learnerText, item.recommendedText, item.feedback, ...(item.strengths || []), ...(item.corrections || []), item.explanation?.literalMeaning, item.explanation?.naturalChinese, item.explanation?.contextInference].filter(Boolean).join(" ").toLowerCase().includes(needle)).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, clampInteger(limit, 500, 1, 2000));
}

export async function updateReviewItem(input = {}) {
  if (!input.reviewId) throw new Error("reviewId is required");
  const allowed = ["term", "pronunciation", "meaning", "context", "learnerText", "recommendedText", "feedback", "strengths", "corrections", "explanation", "privateNote"];
  return queuedWrite(async () => {
    const state = await readJson(reviewStatePath, { schemaVersion: 2, items: {} }); state.items ||= {};
    const current = state.items[input.reviewId] || {}; const edits = { ...(current.edits || {}) };
    for (const key of allowed) if (Object.hasOwn(input, key)) edits[key] = input[key];
    const reviewRatings = new Set(["forgot", "fuzzy", "remembered", "mastered"]);
    const rated = reviewRatings.has(input.reviewRating);
    const next = { ...current, edits, status: learningStatuses.has(input.status) ? input.status : current.status, nextReviewAt: Object.hasOwn(input, "nextReviewAt") ? cleanText(input.nextReviewAt) : current.nextReviewAt, deletedAt: input.deleted === true ? nowIso() : input.restore === true ? null : current.deletedAt, reviewCount: rated ? (current.reviewCount || 0) + 1 : current.reviewCount || 0, lastReviewRating: rated ? input.reviewRating : current.lastReviewRating || null, lastReviewedAt: rated ? nowIso() : current.lastReviewedAt || null, updatedAt: nowIso() };
    state.items[input.reviewId] = next; state.schemaVersion = 2; state.updatedAt = nowIso(); await writeJson(reviewStatePath, state); return next;
  });
}

export async function startReview(input = {}) {
  const items = await listReviewItems({ ...input, limit: 2000 }); const now = Date.now();
  const due = items.filter((item) => item.status !== "known" && (!item.nextReviewAt || new Date(item.nextReviewAt).getTime() <= now));
  return { startedAt: nowIso(), total: due.length, items: due.slice(0, clampInteger(input.limit, 20, 1, 100)) };
}

function publicText(value) {
  const home = os.homedir(); const username = path.basename(home); const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(value || "").replaceAll(home, "[local path]").replace(new RegExp(`\\b${escaped}\\b`, "gi"), "[user]").replace(/[A-Za-z]:\\[^\s<>"']+/g, "[local path]").replace(/\/(?:Users|home)\/[^\s<>"']+/g, "[local path]");
}
function htmlEscape(value) { return publicText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function reviewMarkdown(items, title) { return `# ${publicText(title)}\n\n${items.map((item) => `## ${publicText(item.term || "学习记录")}\n\n- 书籍 / 章节：${publicText(item.bookTitle)} · ${publicText(item.chunkTitle)}\n- 状态：${item.status} · 下次复习：${item.nextReviewAt || "未安排"}\n- 保存时间：${item.createdAt || "未知"}\n- 输入：${item.fromSpeech ? "语音识别（已确认）" : "文字或历史记录"}\n\n**原文语境**  \n${publicText(item.context || "历史记录未保存原句。")}\n\n**当时的理解 / 表达**  \n${publicText(item.learnerText || "—")}\n\n**推荐修正版**  \n${publicText(item.recommendedText || "—")}\n\n**理解正确的地方**\n\n${(item.strengths || []).map((value) => `- ${publicText(value)}`).join("\n") || "- —"}\n\n**需要修正的地方**\n\n${(item.corrections || []).map((value) => `- ${publicText(value)}`).join("\n") || "- —"}\n\n### Literal meaning\n\n${publicText(item.explanation?.literalMeaning || "—")}\n\n### Natural Chinese\n\n${publicText(item.explanation?.naturalChinese || "—")}\n\n### Context / literary inference\n\n${publicText(item.explanation?.contextInference || "—")}`).join("\n\n---\n\n")}\n`; }
function reviewHtml(items, title) { const cards = items.map((item) => `<article><header><span>${htmlEscape(item.status)}</span><h2>${htmlEscape(item.term || "学习记录")}</h2><p>${htmlEscape(item.bookTitle)} · ${htmlEscape(item.chunkTitle)}</p></header><blockquote>${htmlEscape(item.context || "历史记录未保存原句。")}</blockquote><dl><dt>当时的理解 / 表达</dt><dd>${htmlEscape(item.learnerText || "—")}</dd><dt>推荐修正版</dt><dd>${htmlEscape(item.recommendedText || "—")}</dd><dt>理解正确的地方</dt><dd>${htmlEscape((item.strengths || []).join("；") || "—")}</dd><dt>需要修正的地方</dt><dd>${htmlEscape((item.corrections || []).join("；") || "—")}</dd></dl><section class="layers"><h3>Literal meaning</h3><p>${htmlEscape(item.explanation?.literalMeaning || "—")}</p><h3>Natural Chinese</h3><p>${htmlEscape(item.explanation?.naturalChinese || "—")}</p><h3>Context / literary inference</h3><p>${htmlEscape(item.explanation?.contextInference || "—")}</p></section><footer>${htmlEscape(item.createdAt || "")} · ${item.fromSpeech ? "语音识别，已确认" : "已确认"}</footer></article>`).join("\n"); return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${htmlEscape(title)}</title><style>body{margin:auto;max-width:860px;padding:48px 24px;background:#f6f1e8;color:#27231f;font:17px/1.7 system-ui,"PingFang SC",sans-serif}h1{font:700 48px/1.1 Georgia,serif}article{margin:28px 0;padding:30px;border:1px solid #ded5c7;border-radius:24px;background:#fffdf8;box-shadow:0 18px 50px #5c493014}header span{float:right;color:#a25d48}header p,footer{color:#81786d}blockquote{margin:24px 0;padding:18px 22px;border-left:4px solid #c9775b;background:#f8f1e8;font:20px/1.65 Georgia,serif}dt,h3{font-weight:750;color:#6f594b}dd{margin:0 0 18px}.layers{padding:18px;border-radius:18px;background:#f5f0e8}.layers h3{margin:12px 0 2px;font-size:14px;text-transform:uppercase;letter-spacing:.04em}footer{margin-top:22px;font-size:14px}</style><body><h1>${htmlEscape(title)}</h1>${cards}</body></html>`; }

export async function exportReviewNotebook({ format = "markdown", title = "我的英语复习本", ...filters } = {}) {
  const items = await listReviewItems({ ...filters, limit: 2000 }); const html = format === "html";
  const content = html ? reviewHtml(items, title) : reviewMarkdown(items, title); await mkdir(exportsDir, { recursive: true });
  const filePath = path.join(exportsDir, `english-review-${new Date().toISOString().slice(0, 10)}.${html ? "html" : "md"}`); await writeFile(filePath, content, "utf8");
  return { format: html ? "html" : "markdown", count: items.length, path: filePath, content, privacy: "Local usernames, absolute paths, internal IDs, and private notes are excluded." };
}

export async function migrateLearningData({ dryRun = false } = {}) {
  const [vocabulary, practice, drafts, current] = await Promise.all([readJsonl(vocabularyPath), readJsonl(practicePath), readJsonl(draftsPath), readJson(migrationPath, null)]);
  const signature = crypto.createHash("sha256").update(`${vocabulary.map((row) => row.id).join("|")}::${practice.map((row) => row.id).join("|")}`).digest("hex");
  const result = { schemaVersion: 2, strategy: "non-destructive-overlay", vocabularyCount: vocabulary.length, practiceCount: practice.length, draftCount: drafts.length, signature, sourceFilesPreserved: ["english_vocabulary.jsonl", "english_practice.jsonl"], alreadyCurrent: current?.schemaVersion === 2 && current?.signature === signature, migratedAt: current?.migratedAt || nowIso() };
  if (!dryRun && !result.alreadyCurrent) await queuedWrite(async () => { await writeJson(migrationPath, result); if (!(await readJson(reviewStatePath, null))) await writeJson(reviewStatePath, { schemaVersion: 2, items: {}, updatedAt: nowIso() }); });
  return result;
}

export async function setLearningProfile(input = {}) {
  const current = await readJson(profilePath, {}); const profile = { ...current, targetLevel: input.targetLevel || current.targetLevel || "B1-B2", explanationLanguage: input.explanationLanguage || current.explanationLanguage || "Chinese", sessionWords: clampInteger(input.sessionWords, current.sessionWords || 300, 80, 800), goals: Array.isArray(input.goals) ? input.goals.map(String) : current.goals || [], correctionStyle: input.correctionStyle || current.correctionStyle || "supportive-and-specific", updatedAt: nowIso() };
  await queuedWrite(async () => { await ensureDataDir(); await writeJson(profilePath, profile); }); return profile;
}
export async function getLearningProfile() { return readJson(profilePath, { targetLevel: "B1-B2", explanationLanguage: "Chinese", sessionWords: 300, goals: ["read original English books", "grow usable vocabulary", "discuss ideas in English"], correctionStyle: "supportive-and-specific" }); }
export async function learningDashboard({ bookId } = {}) {
  const vocabulary = await listVocabulary({ bookId, limit: 500 }); const practice = (await readJsonl(practicePath)).filter((row) => confirmedPractice(row) && (!bookId || row.bookId === bookId)); const pending = await listPracticeDrafts({ bookId, status: "pending" });
  const counts = { new: 0, learning: 0, known: 0 }; for (const item of vocabulary) counts[item.status] = (counts[item.status] || 0) + 1; const now = Date.now();
  return { bookId: bookId || null, vocabularyCount: vocabulary.length, vocabularyByStatus: counts, reviewDue: vocabulary.filter((item) => item.nextReviewAt && new Date(item.nextReviewAt).getTime() <= now).length, practiceCount: practice.length, pendingSpeechDrafts: pending.length, recentPractice: practice.slice(-5).reverse(), profile: await getLearningProfile() };
}
