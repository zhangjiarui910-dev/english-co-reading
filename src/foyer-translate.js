import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./store.js";

const caches = new Map();

function cachePath() {
  return path.join(dataDir(), "foyer_translations.json");
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function mostlyChinese(text) {
  const value = normalize(text);
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk >= 8 && !/[A-Za-z]{6,}/.test(value);
}

function usableTranslation(source, translation) {
  const value = normalize(translation);
  if (!value) return "";
  if (/MYMEMORY|INVALID SOURCE|QUERY LENGTH/i.test(value)) return "";
  if (value.toLowerCase() === source.toLowerCase()) return "";
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk >= 2 ? value : "";
}

async function loadCache() {
  const key = dataDir();
  if (caches.has(key)) return caches.get(key);
  let cache = {};
  try {
    cache = JSON.parse(await readFile(cachePath(), "utf8"));
    if (!cache || typeof cache !== "object") cache = {};
  } catch {
    cache = {};
  }
  caches.set(key, cache);
  return cache;
}

async function saveCache(cache) {
  const key = dataDir();
  caches.set(key, cache);
  await mkdir(dataDir(), { recursive: true });
  await writeFile(cachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  return response.json();
}

async function translateRemote(source) {
  const encoded = encodeURIComponent(source.slice(0, 500));
  try {
    const google = await fetchJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encoded}`);
    return usableTranslation(source, (google?.[0] || []).map((part) => part?.[0] || "").join(""));
  } catch (_) {
    return "";
  }
}

export async function translateFoyerSentence(text) {
  const source = normalize(text);
  if (!source) return "";
  if (mostlyChinese(source)) return source;
  const store = await loadCache();
  if (store[source]) return store[source];

  const translation = await translateRemote(source);
  if (!translation) return "";
  store[source] = translation;
  await saveCache(store).catch(() => {});
  return translation;
}
