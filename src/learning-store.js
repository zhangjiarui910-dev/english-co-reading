import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir, readChunk } from "./store.js";

function vocabularyPath() { return path.join(dataDir(), "english_vocabulary.jsonl"); }
function practicePath() { return path.join(dataDir(), "english_practice.jsonl"); }
function profilePath() { return path.join(dataDir(), "english_profile.json"); }

let writeQueue = Promise.resolve();

function queuedWrite(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

async function ensureDataDir() {
  await mkdir(dataDir(), { recursive: true }); }
}

async function readJson(pathname, fallback) {
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonl(pathname) {
  try {
    const text = await readFile(pathname, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeTerm(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

export async function readStudyPassage({ bookId, chunkId, startWord = 0, maxWords = 300 }) {
  const chunk = await readChunk(bookId, chunkId);
  const words = chunk.text.trim().split(/\s+/).filter(Boolean);
  const start = clampInteger(startWord, 0, 0, words.length);
  const size = clampInteger(maxWords, 300, 80, 800);
  const end = Math.min(words.length, start + size);
  return {
    bookId,
    bookTitle: chunk.title,
    chunkId,
    chunkTitle: chunk.chunk.title,
    startWord: start,
    endWord: end,
    wordCount: end - start,
    totalWords: words.length,
    passage: words.slice(start, end).join(" "),
    hasMoreInChunk: end < words.length,
    nextStartWord: end < words.length ? end : null,
    nextChunkId: end < words.length ? chunkId : chunk.nextId,
    previousChunkId: chunk.prevId,
  };
}

export async function saveVocabulary(input = {}) {
  const term = normalizeTerm(input.term);
  if (!term) throw new Error("term is required");
  if (!input.bookId) throw new Error("bookId is required");

  const row = {
    id: crypto.randomUUID(),
    bookId: String(input.bookId),
    chunkId: input.chunkId ? String(input.chunkId) : null,
    term,
    context: String(input.context || "").trim() || null,
    learnerGuess: String(input.learnerGuess || "").trim() || null,
    meaning: String(input.meaning || "").trim() || null,
    pronunciation: String(input.pronunciation || "").trim() || null,
    note: String(input.note || "").trim() || null,
    status: ["new", "learning", "known"].includes(input.status) ? input.status : "new",
    nextReviewAt: input.nextReviewAt || null,
    createdAt: nowIso(),
  };
  await queuedWrite(async () => {
    await ensureDataDir();
    await appendFile(vocabularyPath(), `${JSON.stringify(row)}\n`, "utf8");
  });
  return row;
}

export async function listVocabulary({ bookId, status, query, limit = 100 } = {}) {
  const rows = await readJsonl(vocabularyPath());
  const needle = String(query || "").trim().toLowerCase();
  return rows
    .filter((row) => !bookId || row.bookId === bookId)
    .filter((row) => !status || row.status === status)
    .filter((row) => !needle || `${row.term} ${row.meaning || ""} ${row.context || ""}`.toLowerCase().includes(needle))
    .slice(-clampInteger(limit, 100, 1, 500))
    .reverse();
}

export async function logPractice(input = {}) {
  if (!input.bookId) throw new Error("bookId is required");
  if (!String(input.learnerText || "").trim()) throw new Error("learnerText is required");
  const row = {
    id: crypto.randomUUID(),
    bookId: String(input.bookId),
    chunkId: input.chunkId ? String(input.chunkId) : null,
    activity: ["retell", "answer", "translation", "sentence", "discussion"].includes(input.activity)
      ? input.activity
      : "retell",
    learnerText: String(input.learnerText).trim(),
    feedback: String(input.feedback || "").trim() || null,
    corrections: Array.isArray(input.corrections) ? input.corrections.map(String) : [],
    strengths: Array.isArray(input.strengths) ? input.strengths.map(String) : [],
    createdAt: nowIso(),
  };
  await queuedWrite(async () => {
    await ensureDataDir();
    await appendFile(practicePath(), `${JSON.stringify(row)}\n`, "utf8");
  });
  return row;
}

export async function setLearningProfile(input = {}) {
  const current = await readJson(profilePath(), {});
  const profile = {
    ...current,
    targetLevel: input.targetLevel || current.targetLevel || "B1-B2",
    explanationLanguage: input.explanationLanguage || current.explanationLanguage || "Chinese",
    sessionWords: clampInteger(input.sessionWords, current.sessionWords || 300, 80, 800),
    goals: Array.isArray(input.goals) ? input.goals.map(String) : current.goals || [],
    correctionStyle: input.correctionStyle || current.correctionStyle || "supportive-and-specific",
    updatedAt: nowIso(),
  };
  await queuedWrite(async () => {
    await ensureDataDir();
    await writeFile(profilePath(), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  });
  return profile;
}

export async function getLearningProfile() {
  return readJson(profilePath(), {
    targetLevel: "B1-B2",
    explanationLanguage: "Chinese",
    sessionWords: 300,
    goals: ["read original English books", "grow usable vocabulary", "discuss ideas in English"],
    correctionStyle: "supportive-and-specific",
  });
}

export async function learningDashboard({ bookId } = {}) {
  const vocabulary = await listVocabulary({ bookId, limit: 500 });
  const practice = (await readJsonl(practicePath())).filter((row) => !bookId || row.bookId === bookId);
  const counts = { new: 0, learning: 0, known: 0 };
  for (const item of vocabulary) counts[item.status] = (counts[item.status] || 0) + 1;
  const now = Date.now();
  return {
    bookId: bookId || null,
    vocabularyCount: vocabulary.length,
    vocabularyByStatus: counts,
    reviewDue: vocabulary.filter((item) => item.nextReviewAt && new Date(item.nextReviewAt).getTime() <= now).length,
    practiceCount: practice.length,
    recentPractice: practice.slice(-5).reverse(),
    profile: await getLearningProfile(),
  };
}
