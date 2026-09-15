import { userHeaders, getAnonymousUserId, parseAnonymousUserId, restoreAnonymousUserId } from "./anonymous-user.js";

const state = { books: [], chunks: [], items: [], drafts: [], shareItem: null, storyScene: 0, reviewMode: false, reviewItems: [], reviewIndex: 0, reviewRevealed: false, reviewPendingRating: null, reviewTotal: 0, reviewStats: { forgot: 0, fuzzy: 0, remembered: 0, mastered: 0 }, foyerBookId: null, foyerChunkId: null, foyerWhere: "" };
const $ = (id) => document.getElementById(id);
const authTokenKey = "co-reading-auth-token";
const currentBookKey = "co-reading-current-book-id";

async function api(path, options = {}, { retries = 0 } = {}) {
  const token = localStorage.getItem(authTokenKey);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...userHeaders(), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
      const raw = await response.text();
      let data = {};
      if (raw) {
        try { data = JSON.parse(raw); }
        catch { throw new Error(response.ok ? "服务器返回了无法解析的内容" : (raw.slice(0, 180) || response.statusText)); }
      }
      if (!response.ok) throw new Error(data.error || response.statusText || `HTTP ${response.status}`);
      return data;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const transient = /EPERM|EACCES|EBUSY|EAGAIN|not permitted|Failed to fetch|NetworkError|Load failed/i.test(message);
      if (!transient || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw lastError;
}
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function lines(values) { return (values || []).length ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "<p>未记录</p>"; }
function dateLabel(value) { if (!value) return "未安排"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "medium" }); }
function toast(message) { $("toast").textContent = message; $("toast").hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $("toast").hidden = true; }, 2600); }
function filterParams() { const params = new URLSearchParams(); if ($("book-filter").value) params.set("bookId", $("book-filter").value); if ($("chunk-filter").value) params.set("chunkId", $("chunk-filter").value); if ($("status-filter").value) params.set("status", $("status-filter").value); if ($("query").value.trim()) params.set("q", $("query").value.trim()); return params; }

function renderBooks() {
  applyFoyerWallpaper();
  $("book-filter").innerHTML = `<option value="">全部书籍</option>${state.books.map((book) => `<option value="${escapeHtml(book.bookId)}">${escapeHtml(tidyDisplayTitle(book.title, book.author) || book.bookId)}</option>`).join("")}`;
  renderHomeBooks();
  renderFoyer().catch(() => renderFoyerEmpty());
}

const SOLAR_TERMS = [
  [1, 5, "小寒"], [1, 20, "大寒"], [2, 4, "立春"], [2, 19, "雨水"],
  [3, 5, "惊蛰"], [3, 20, "春分"], [4, 4, "清明"], [4, 20, "谷雨"],
  [5, 5, "立夏"], [5, 21, "小满"], [6, 6, "芒种"], [6, 21, "夏至"],
  [7, 7, "小暑"], [7, 23, "大暑"], [8, 7, "立秋"], [8, 23, "处暑"],
  [9, 7, "白露"], [9, 23, "秋分"], [10, 8, "寒露"], [10, 23, "霜降"],
  [11, 7, "立冬"], [11, 22, "小雪"], [12, 7, "大雪"], [12, 21, "冬至"],
];

function solarTerm(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  let current = SOLAR_TERMS[SOLAR_TERMS.length - 1][2];
  for (const [m, d, name] of SOLAR_TERMS) {
    if (month > m || (month === m && day >= d)) current = name;
  }
  return current;
}

function chineseNumeral(n) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n <= 10) return n === 10 ? "十" : digits[n];
  if (n < 20) return `十${digits[n % 10]}`;
  if (n % 10 === 0) return `${digits[Math.floor(n / 10)]}十`;
  return `${digits[Math.floor(n / 10)]}十${digits[n % 10]}`;
}

function chineseDateLabel(date = new Date()) {
  const months = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  return `${months[date.getMonth()]}月${chineseNumeral(date.getDate())}日 · ${solarTerm(date)}`;
}

function dayOfYear(date = new Date()) {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((today - start) / 86400000);
}

function bookInitial(title) {
  const cleaned = String(title || "").replace(/^\s*(the|an|a)\s+/i, "").trim();
  const first = [...cleaned][0] ?? "";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

function tidyDisplayTitle(title, author = "") {
  let text = String(title || "").replace(/\u00a0/g, " ");
  const junk = /(?:z-?library|1lib|z-?lib(?:rary)?|zlib|libgen|annas?-?archive)(?:\.[a-z]{2,})?/i;
  const junkAt = text.search(junk);
  if (junkAt >= 0) text = text.slice(0, junkAt);
  text = text.replace(/[_ ]+[a-z0-9.-]+\.(?:sk|com|org|net|io|to)\b/gi, " ");
  text = text.replace(/_([^_]+)_/g, " $1 ");
  const authorText = String(author || "").trim();
  if (authorText) {
    const pieces = [authorText, ...authorText.split(/[（()]/).map((part) => part.replace(/[）)]/g, "").trim())]
      .filter((part) => part.length >= 2);
    for (const piece of pieces) {
      const escaped = piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`[\\s_\\-–—:：]*${escaped}\\s*$`, "i"), "");
      text = text.replace(new RegExp(`\\s+${escaped}(?=\\s|$)`, "i"), " ");
    }
  }
  return text.replace(/[_/|]+/g, " ").replace(/\s{2,}/g, " ").replace(/[-–—:：\s]+$/g, "").trim();
}

function splitBookTitle(title, author = "") {
  const raw = tidyDisplayTitle(title, author);
  const match = raw.match(/^(.+?)\s*[:：]\s*(.+)$/);
  if (match) return { main: match[1].trim(), subtitle: match[2].trim() };
  return { main: raw, subtitle: "" };
}

function leadVerbForBook(book) {
  const total = Math.max(0, Number(book?.chunkCount) || 0);
  const read = Math.max(0, Number(book?.chunksRead) || 0);
  if (!total || read <= 0) return "开始读";
  if (read >= total) return "重读";
  return "接着读";
}

function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}

function pickRandom(list, lastValue) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const pool = lastValue == null ? list : list.filter((item) => item !== lastValue);
  const use = pool.length ? pool : list;
  return use[Math.floor(Math.random() * use.length)];
}

function pickFoyerBook() {
  const requestedBookId = new URLSearchParams(location.search).get("book");
  const requestedBook = state.books.find((book) => book.bookId === requestedBookId);
  if (requestedBook) return requestedBook;
  const pickedId = pickRandom(state.books.map((book) => book.bookId), sessionGet("foyer-last-book"));
  if (pickedId) sessionSet("foyer-last-book", pickedId);
  return state.books.find((book) => book.bookId === pickedId) || null;
}

function currentFoyerBook() {
  if (state.foyerBookId) {
    const found = state.books.find((book) => book.bookId === state.foyerBookId);
    if (found) return found;
  }
  return pickFoyerBook();
}

function foyerEnterUrl(book) {
  if (!book?.bookId) return "/reader.html";
  const params = new URLSearchParams({ book: book.bookId });
  if (state.foyerChunkId) params.set("chunk", state.foyerChunkId);
  return `/reader.html?${params}`;
}

function enterFoyerBook() {
  const book = currentFoyerBook();
  if (book?.bookId) localStorage.setItem(currentBookKey, book.bookId);
  location.href = foyerEnterUrl(book);
}


const FOYER_PATTERNS = [
  "/botanical-moss.webp",
  "/botanical-cream.webp",
  "/assets/patterns/pattern-roses.jpg",
  "/assets/patterns/pattern-birds-green.jpg",
  "/assets/patterns/pattern-burgundy.jpg",
  "/assets/patterns/pattern-navy-line.png",
  "/assets/patterns/pattern-indigo.png",
];
function pickFoyerPattern() {
  const last = sessionGet("foyer-last-pattern");
  const lastIndex = FOYER_PATTERNS.indexOf(last);
  const pattern = FOYER_PATTERNS[lastIndex >= 0 ? (lastIndex + 1) % FOYER_PATTERNS.length : 0];
  if (pattern) sessionSet("foyer-last-pattern", pattern);
  return pattern;
}

function applyFoyerWallpaper() {
  const foyer = document.querySelector(".review-page .foyer");
  if (!foyer) return;
  const pattern = pickFoyerPattern();
  const cssUrl = `url("${pattern}")`;
  foyer.style.setProperty("--foyer-pattern", cssUrl);
  foyer.dataset.pattern = pattern;
  if (!foyer.dataset.awayBound && "IntersectionObserver" in window) {
    foyer.dataset.awayBound = "1";
    const observer = new IntersectionObserver((entries) => {
      foyer.classList.toggle("is-away", !(entries[0]?.isIntersecting));
    }, { threshold: 0.08 });
    observer.observe(foyer);
  }
}

function renderFoyerEmpty() {
  $("foyer-passage").innerHTML = `<p class="foyer-empty">这本书还没划过句子，进去读一段吧。</p>`;
}

function isOwnHighlight(item) {
  const ownAuthors = ["user", "human", "koshi", "you"];
  const highlightKinds = ["highlight", "highlight_note", "note"];
  return !item?.parentId
    && ownAuthors.includes(String(item?.author || "").toLowerCase())
    && highlightKinds.includes(String(item?.kind || "").toLowerCase());
}

function highlightTime(item) {
  return String(item?.updatedAt || item?.savedAt || item?.createdAt || "");
}

function endsAsSentence(value) {
  return /[.!?。！？]["'”’]?\s*$/.test(value);
}

function pickPassage(candidates) {
  if (!candidates.length) return null;
  return pickRandom(candidates);
}

function extractFoyerSentence(text) {
  const cleaned = String(text || "").replace(/^\s*#{1,6}\s+[^\n]+\n+/gm, "").replace(/\r/g, "");
  const paragraphs = cleaned.split(/\n\s*\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const body = paragraphs.filter((part) => {
    if (part.length < 40) return false;
    if (/^#{1,6}\s/.test(part)) return false;
    if (part.length <= 80 && !/[.!?。！？]/.test(part)) return false;
    return true;
  });
  const sentences = [];
  for (const paragraph of body) {
    const parts = paragraph.match(/[^.!?。！？]+[.!?。！？]["'”’]?/g) || [];
    for (const part of parts) {
      const sentence = part.trim();
      const length = [...sentence].length;
      if (length >= 28 && length <= 180 && /[A-Za-z\u4e00-\u9fff]/.test(sentence)) sentences.push(sentence);
    }
  }
  if (sentences.length) return pickRandom(sentences.slice(0, 8));
  return body.find((part) => {
    const length = [...part].length;
    return length >= 28 && length <= 180;
  }) || null;
}

async function pickBodyPassage(book, chunks) {
  const pool = (chunks || []).filter((chunk) => !chunk.isAppendix && !chunk.isFrontMatter);
  if (!pool.length || !book?.bookId) return null;
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 4);
  for (const chunk of shuffled) {
    try {
      const data = await api(`/api/books/${encodeURIComponent(book.bookId)}/chunks/${encodeURIComponent(chunk.id)}`);
      const quoteText = extractFoyerSentence(data?.text || "");
      if (quoteText) return { quoteText, chunkId: chunk.id, fromHighlight: false };
    } catch (_) { /* try another chunk */ }
  }
  return null;
}

function setText(id, value, { hidden = false } = {}) {
  const node = $(id);
  if (!node) return;
  node.textContent = value || "";
  if ("hidden" in node) node.hidden = hidden || !value;
}

async function resolveContinueContext() {
  const book = pickFoyerBook();
  state.foyerBookId = book?.bookId || null;
  state.foyerChunkId = null;
  state.foyerWhere = "";
  if (!book?.bookId) return null;
  try {
    const position = await api(`/api/reading-position?bookId=${encodeURIComponent(book.bookId)}`);
    if (position?.chunkId) state.foyerChunkId = position.chunkId;
    return position;
  } catch (_) { /* optional */ }
  return null;
}

function isChineseQuote(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk >= 4 && cjk >= Math.ceil([...value].length * 0.2);
}

function chineseChapterLabel(name) {
  const text = String(name || "").replace(/\s+Part\s+\d+\s*\/\s*\d+\s*$/i, "").trim();
  if (!text) return "";
  const english = text.match(/^(chapter|part|book)\s+(\d+|[ivxlcdm]+)\b/iu);
  if (english) {
    const kind = { chapter: "章", part: "部", book: "卷" }[english[1].toLowerCase()] || "章";
    const num = Number(english[2]);
    return Number.isFinite(num) ? `第${num}${kind}` : `第${String(english[2]).toUpperCase()}${kind}`;
  }
  const chinese = text.match(/^(第\s*[0-9一二三四五六七八九十百千]+\s*[章节部篇])/u);
  if (chinese) return chinese[1].replace(/\s+/g, "");
  return /[\u4e00-\u9fff]/.test(text) ? text : "";
}

function formatWhere(chunk, book, position) {
  if (state.foyerWhere) return state.foyerWhere;
  const chapterName = chineseChapterLabel(
    position?.sectionTitle
    || position?.chapterTitle
    || chunk?.sectionTitle
    || chunk?.chapterTitle
    || chunk?.title
    || "",
  );
  const partFromTitle = String(chunk?.title || "").match(/\bPart\s+(\d+)\s*\/\s*\d+\s*$/i)?.[1];
  const part = Number(position?.sectionPart)
    || Number(chunk?.sectionPart)
    || Number(partFromTitle)
    || (position?.chunkIndex != null ? Number(position.chunkIndex) + 1 : 0)
    || 0;
  const total = Math.max(0, Number(book?.chunkCount) || 0);
  const partLabel = part ? `第 ${part} 段` : "";
  const totalLabel = total ? `全书 ${total} 段` : "";
  if (chapterName && partLabel && totalLabel) return `${chapterName} · ${partLabel} / ${totalLabel}`;
  if (chapterName && partLabel) return `${chapterName} · ${partLabel}`;
  if (chapterName && totalLabel) return `${chapterName} · ${totalLabel}`;
  if (partLabel && totalLabel) return `${partLabel} / ${totalLabel}`;
  return totalLabel || partLabel || "";
}

async function renderFoyerMeta() {
  const now = new Date();
  setText("foyer-date", chineseDateLabel(now));
  const shelfLabel = $("foyer-shelf-label");
  if (shelfLabel) shelfLabel.textContent = `书架 · ${state.books.length} 本`;

  let dueCount = null;
  try {
    const due = await api("/api/review?limit=500");
    const list = Array.isArray(due) ? due : (due?.items || []);
    const today = Date.now();
    dueCount = list.filter((item) => {
      if (item.deleted || item.status === "known") return false;
      if (!item.nextReviewAt) return item.status === "learning" || item.status === "new";
      const t = new Date(item.nextReviewAt).getTime();
      return Number.isFinite(t) && t <= today;
    }).length;
  } catch (_) {
    dueCount = null;
  }
  const reviewBtn = $("foyer-review");
  if (reviewBtn) {
    reviewBtn.textContent = dueCount == null ? "复习本" : `复习本 · 今天 ${dueCount} 个`;
  }

  try {
    const progress = await api("/api/progress");
    const streak = Number(progress?.streak ?? progress?.currentStreak ?? progress?.days ?? 0);
    if (streak > 0) {
      setText("foyer-streak", `已经连续 ${streak} 天`, { hidden: false });
      $("foyer-streak").hidden = false;
    } else {
      setText("foyer-streak", "", { hidden: true });
      $("foyer-streak").hidden = true;
    }
  } catch (_) {
    setText("foyer-streak", "", { hidden: true });
    if ($("foyer-streak")) $("foyer-streak").hidden = true;
  }
}

async function renderFoyer() {
  await resolveContinueContext();
  const book = currentFoyerBook();
  const letter = bookInitial(tidyDisplayTitle(book?.title, book?.author) || book?.title) || "E";
  setText("foyer-letter", letter);
  const door = $("foyer-door");
  if (door) door.setAttribute("aria-label", book?.title ? `进入 ${tidyDisplayTitle(book.title, book.author) || book.title}` : "进入");

  if (!book) {
    setText("foyer-lead", "开始读");
    setText("foyer-title", "还没有书");
    setText("foyer-sub", "先去书架导入第一本");
    setText("foyer-where", "");
    renderFoyerEmpty();
    await renderFoyerMeta();
    return;
  }

  const { main, subtitle } = splitBookTitle(book.title || book.bookId, book.author);
  setText("foyer-lead", leadVerbForBook(book));
  setText("foyer-title", main || book.bookId);
  const subParts = [subtitle, book.author].filter(Boolean);
  setText("foyer-sub", subParts.join(" · "));

  let position = null;
  try {
    position = await api(`/api/reading-position?bookId=${encodeURIComponent(book.bookId)}`);
    if (position?.chunkId) state.foyerChunkId = position.chunkId;
  } catch (_) { /* optional */ }

  const [annotationsRaw, chunks] = await Promise.all([
    api(`/api/annotations?bookId=${encodeURIComponent(book.bookId)}`),
    api(`/api/books/${encodeURIComponent(book.bookId)}/chunks`).catch(() => []),
  ]);
  const annotations = Array.isArray(annotationsRaw) ? annotationsRaw : (annotationsRaw?.items || annotationsRaw?.annotations || []);

  const lengthOk = annotations
    .filter(isOwnHighlight)
    .map((item) => ({ ...item, quoteText: String(item.quote || "").replace(/\s+/g, " ").trim() }))
    .filter((item) => {
      const length = [...item.quoteText].length;
      return length >= 20 && length <= 180;
    })
    .sort((a, b) => highlightTime(b).localeCompare(highlightTime(a)));

  const complete = lengthOk.filter((item) => endsAsSentence(item.quoteText));
  const pool = complete.length ? complete : lengthOk;
  let selected = pickPassage(pool);
  if (selected) selected = { ...selected, fromHighlight: true };
  if (!selected) selected = await pickBodyPassage(book, chunks);

  if (!selected) {
    renderFoyerEmpty();
  } else {
    const chinese = isChineseQuote(selected.quoteText);
    const shown = chinese ? selected.quoteText : `“${selected.quoteText}”`;
    $("foyer-passage").innerHTML = `<blockquote class="foyer-quote"><p class="${chinese ? "is-zh" : ""}">${escapeHtml(shown)}</p></blockquote>`;
  }

  const whereChunk = chunks.find((item) => item.id === (state.foyerChunkId || selected?.chunkId)) || null;
  setText("foyer-where", formatWhere(whereChunk, book, position));
  await renderFoyerMeta();
}

function renderHomeBooks() {
  const query = $("home-book-search").value.trim().toLocaleLowerCase();
  const sorted = [...state.books]
    .sort((a, b) => String(b.lastReadAt || "").localeCompare(String(a.lastReadAt || "")))
  const matching = query
    ? sorted.filter((book) => `${book.title || ""} ${book.author || ""}`.toLocaleLowerCase().includes(query))
    : sorted.slice(0, 8);
  $("library-count").textContent = query
    ? `找到 ${matching.length} 本`
    : `显示 ${Math.min(8, state.books.length)} 本，共 ${state.books.length} 本`;
  $("home-books").innerHTML = matching.length
    ? matching.map((book, index) => {
        const total = Math.max(0, Number(book.chunkCount) || 0);
        const read = Math.min(total, Math.max(0, Number(book.chunksRead) || 0));
        const progress = total ? Math.round((read / total) * 100) : 0;
        return `<a class="home-book tone-${(index % 6) + 1}" href="/reader.html?book=${encodeURIComponent(book.bookId)}">
          <span class="home-book-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="home-book-title">${escapeHtml(tidyDisplayTitle(book.title, book.author) || book.bookId)}</span>
          <span class="home-book-author">${escapeHtml(book.author || "作者未注明")}</span>
          <span class="home-book-progress"><i style="width:${progress}%"></i></span>
          <span class="home-book-meta">${read}/${total} · ${book.annotationCount || 0} 条笔记</span>
        </a>`;
      }).join("")
    : state.books.length && query
      ? `<div class="home-book home-book-empty"><span class="home-book-title">没有找到这本书</span><span class="home-book-author">换一个书名或作者试试</span></div>`
      : `<a class="home-book home-book-empty" href="/reader.html"><span class="home-book-title">书架还是空的</span><span class="home-book-author">进入书架导入第一本书</span></a>`;
}
async function loadChunks() {
  const bookId = $("book-filter").value;
  state.chunks = bookId ? await api(`/api/books/${encodeURIComponent(bookId)}/chunks`) : [];
  $("chunk-filter").innerHTML = `<option value="">全部章节</option>${state.chunks.map((chunk) => `<option value="${escapeHtml(chunk.id)}">${escapeHtml(chunk.title)}</option>`).join("")}`;
}

function actionButtons(item, { compact = false } = {}) {
  const known = item.status === "known";
  const learning = item.status === "learning";
  return `<div class="card-actions" aria-label="学习状态操作">
    <button data-action="known" class="${known ? "is-active" : ""}" aria-pressed="${known}">${known ? "✓ 已认识" : "认识了"}</button>
    <button data-action="learning" class="${learning ? "is-active" : ""}" aria-pressed="${learning}">${learning ? "✓ 还要复习" : "还要复习"}</button>
    <button data-action="edit">编辑</button>
    ${compact ? "" : '<button data-action="share">分享卡片</button><button data-action="delete">删除</button>'}
  </div>`;
}

function cardHtml(item) {
  const exp = item.explanation || {};
  return `<article class="review-card" data-review-id="${escapeHtml(item.reviewId)}">
    <div class="card-head"><div><span class="pill">${escapeHtml(item.sourceType)} · ${escapeHtml(item.status)}</span><h3>${escapeHtml(item.term || "学习记录")}</h3><p class="meta">${escapeHtml(item.bookTitle)} · ${escapeHtml(item.chunkTitle)} · ${escapeHtml(dateLabel(item.createdAt))}</p></div>${item.pronunciation ? `<span>${escapeHtml(item.pronunciation)}</span>` : ""}</div>
    <blockquote class="context">${escapeHtml(item.context || "历史记录未保存原句。")}</blockquote>
    <div class="pair"><section><h4>当时的理解 / 表达</h4><p>${escapeHtml(item.learnerText || "未记录")}</p></section><section><h4>推荐修正版</h4><p>${escapeHtml(item.recommendedText || "未记录")}</p></section></div>
    <div class="lists"><section><h4>理解正确的地方</h4>${lines(item.strengths)}</section><section><h4>需要修正的地方</h4>${lines(item.corrections)}</section></div>
    <div class="layers"><section><h4>Literal meaning</h4><p>${escapeHtml(exp.literalMeaning || "未记录")}</p></section><section><h4>Natural Chinese</h4><p>${escapeHtml(exp.naturalChinese || "未记录")}</p></section><section><h4>Context / literary inference</h4><p>${escapeHtml(exp.contextInference || "未记录")}</p></section></div>
    ${item.fromSpeech ? `<p class="speech-note">语音识别 · 已确认 · ${escapeHtml(item.errorClassification || "uncertain")}</p>` : `<p class="speech-note">${escapeHtml(item.confirmationStatus || "confirmed")} · 非待确认草稿</p>`}
    ${actionButtons(item)}
  </article>`;
}

function reviewAnswerHtml(item) {
  const exp = item.explanation || {};
  return `<div class="review-answer">
    ${item.pronunciation ? `<p class="review-pronunciation">${escapeHtml(item.pronunciation)}</p>` : ""}
    <div class="pair"><section><h4>当时的理解 / 表达</h4><p>${escapeHtml(item.learnerText || "未记录")}</p></section><section><h4>推荐答案 / 修正版</h4><p>${escapeHtml(item.recommendedText || item.meaning || "未记录")}</p></section></div>
    <div class="lists"><section><h4>已经理解正确</h4>${lines(item.strengths)}</section><section><h4>还要注意</h4>${lines(item.corrections)}</section></div>
    <div class="layers"><section><h4>Literal meaning</h4><p>${escapeHtml(exp.literalMeaning || "未记录")}</p></section><section><h4>Natural Chinese</h4><p>${escapeHtml(exp.naturalChinese || "未记录")}</p></section><section><h4>Context / literary inference</h4><p>${escapeHtml(exp.contextInference || "未记录")}</p></section></div>
  </div>`;
}

function reviewSessionHtml(item) {
  const number = state.reviewIndex + 1;
  const lastCard = number === state.reviewItems.length;
  const selected = state.reviewPendingRating;
  const prompt = item.sourceType === "vocabulary" ? "先在心里回忆它的意思和常见用法。" : "先回忆你会怎样理解或表达，再查看答案。";
  return `<article class="active-recall-card" data-review-id="${escapeHtml(item.reviewId)}">
    <header class="recall-head"><div><span class="pill">${escapeHtml(item.sourceType === "vocabulary" ? "生词 / 词组" : "表达练习")}</span><p>${number} / ${state.reviewItems.length}</p></div><button data-review-action="exit">退出复习</button></header>
    <div class="recall-prompt"><p class="eyebrow">先回忆，不急着看答案</p><h3>${escapeHtml(item.term || "这条学习记录")}</h3><blockquote class="context">${escapeHtml(item.context || "历史记录未保存原句。")}</blockquote><p class="recall-hint">${prompt}</p></div>
    ${state.reviewRevealed ? reviewAnswerHtml(item) : `<button class="reveal-answer primary" data-review-action="reveal">查看答案</button>`}
    ${state.reviewRevealed ? `<div class="rating-panel"><p>先选择回忆结果，再进入下一题</p><div class="rating-actions"><button data-review-action="rate" data-rating="forgot" class="${selected === "forgot" ? "selected" : ""}" aria-pressed="${selected === "forgot"}"><strong>忘了</strong><span>明天再见</span></button><button data-review-action="rate" data-rating="fuzzy" class="${selected === "fuzzy" ? "selected" : ""}" aria-pressed="${selected === "fuzzy"}"><strong>有点模糊</strong><span>3 天后</span></button><button data-review-action="rate" data-rating="remembered" class="${selected === "remembered" ? "selected" : ""}" aria-pressed="${selected === "remembered"}"><strong>想起来了</strong><span>7 天后</span></button><button data-review-action="rate" data-rating="mastered" class="mastered ${selected === "mastered" ? "selected" : ""}" aria-pressed="${selected === "mastered"}"><strong>已经掌握</strong><span>退出近期复习</span></button></div><button class="review-next primary" data-review-action="next" ${selected ? "" : "disabled"}>${lastCard ? "完成复习" : "下一题 →"}</button></div>` : ""}
  </article>`;
}

function reviewFinishedHtml() {
  const stats = state.reviewStats;
  return `<article class="review-finished"><p class="eyebrow">Review complete</p><h3>今天的复习完成啦</h3><p>一共复习 ${state.reviewItems.length} 条。</p><div class="review-stats"><span>忘了 <strong>${stats.forgot}</strong></span><span>模糊 <strong>${stats.fuzzy}</strong></span><span>想起来 <strong>${stats.remembered}</strong></span><span>掌握 <strong>${stats.mastered}</strong></span></div><button class="primary" data-review-action="exit">回到复习本</button></article>`;
}

function renderReviewSession() {
  document.body.classList.add("review-session-active");
  const item = state.reviewItems[state.reviewIndex];
  $("items").innerHTML = item ? reviewSessionHtml(item) : reviewFinishedHtml();
  $("list-title").textContent = item ? "主动回忆" : "本次复习完成";
  $("review-progress").textContent = item ? `本次 ${state.reviewIndex + 1} / ${state.reviewItems.length} · 待复习共 ${state.reviewTotal}` : "已保存本次复习结果";
  renderVocabulary();
  renderDrafts();
}
function vocabularyHtml(item) {
  const exp = item.explanation || {};
  const kind = String(item.term || "").trim().includes(" ") ? "词组" : "生词";
  const meaning = item.meaning || item.recommendedText || exp.literalMeaning || "尚未填写释义";
  return `<article class="vocabulary-card" data-review-id="${escapeHtml(item.reviewId)}">
    <div class="vocabulary-head"><div><span class="pill">${kind} · ${escapeHtml(item.status)}</span><h3>${escapeHtml(item.term || "未命名词汇")}</h3></div>${item.pronunciation ? `<span class="pronunciation">${escapeHtml(item.pronunciation)}</span>` : ""}</div>
    <p class="vocabulary-meaning">${escapeHtml(meaning)}</p>
    <blockquote class="vocabulary-context">${escapeHtml(item.context || "历史记录未保存原句。")}</blockquote>
    <p class="meta">${escapeHtml(item.bookTitle)} · ${escapeHtml(item.chunkTitle)}</p>
    <p class="review-date">${item.status === "known" ? "已掌握，暂不安排复习" : `下次复习：${escapeHtml(dateLabel(item.nextReviewAt))}`}</p>
    ${actionButtons(item, { compact: true })}
  </article>`;
}
function renderVocabulary() {
  const section = $("vocabulary-section");
  section.hidden = state.reviewMode;
  if (state.reviewMode) return;
  const vocabulary = state.items.filter((item) => item.sourceType === "vocabulary");
  const phrases = vocabulary.filter((item) => /\s/.test(String(item.term || "").trim()));
  const words = vocabulary.filter((item) => !/\s/.test(String(item.term || "").trim()));
  const emptyShelf = (label) => `<article class="vocabulary-empty"><h3>当前没有符合条件的${label}</h3><p class="meta">调整筛选条件，或在共读时保存值得复习的表达。</p></article>`;
  $("vocabulary-summary").textContent = `${words.length} 个生词 · ${phrases.length} 个词组或搭配 · 当前筛选条件同步生效`;
  $("word-count").textContent = `${words.length} 条`;
  $("phrase-count").textContent = `${phrases.length} 条`;
  $("word-items").innerHTML = words.length ? words.map(vocabularyHtml).join("") : emptyShelf("生词");
  $("phrase-items").innerHTML = phrases.length ? phrases.map(vocabularyHtml).join("") : emptyShelf("词组或搭配");
}
function renderItems() {
  if (state.reviewMode) { renderReviewSession(); return; }
  const visibleItems = state.reviewMode ? state.items : state.items.filter((item) => item.sourceType !== "vocabulary");
  $("items").innerHTML = visibleItems.length ? visibleItems.map(cardHtml).join("") : `<article class="review-card"><h3>没有符合条件的练习或讲解</h3><p class="meta">调整筛选条件，或继续共读并保存值得复习的内容。</p></article>`;
  $("list-title").textContent = state.reviewMode ? "本次复习" : "练习与讲解";
  renderVocabulary();
}
function draftHtml(draft) {
  return `<article class="draft" data-draft-id="${escapeHtml(draft.id)}"><div><p class="meta">原始识别文本（保留追溯）</p><blockquote class="context">${escapeHtml(draft.rawTranscript)}</blockquote><label>确认前文本<textarea rows="3" data-field="editedText">${escapeHtml(draft.editedText)}</textarea></label></div><div class="draft-actions"><label>问题分类<select data-field="classification">${["uncertain","speech_to_text_error","learner_language_error","confirmed_correct"].map((value) => `<option ${draft.errorClassification === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><button class="primary" data-draft="confirm">修正并确认</button><button data-draft="discard">废弃这条</button></div></article>`;
}
function renderDrafts() { $("draft-section").hidden = state.reviewMode || state.drafts.length === 0; $("drafts").innerHTML = state.drafts.map(draftHtml).join(""); }

async function loadData() {
  const params = filterParams();
  [state.items, state.drafts] = await Promise.all([api(`/api/review?${params}`), api(`/api/practice-drafts?status=pending${$("book-filter").value ? `&bookId=${encodeURIComponent($("book-filter").value)}` : ""}`)]);
  state.reviewMode = false; document.body.classList.remove("review-session-active"); renderItems(); renderDrafts();
}
async function patchItem(reviewId, body, successMessage) { await api(`/api/review/${encodeURIComponent(reviewId)}`, { method: "PATCH", body }, { retries: 4 }); await loadData(); if (successMessage) toast(successMessage); }

function openEdit(item) {
  $("edit-id").value = item.reviewId; $("edit-term").value = item.term || ""; $("edit-context").value = item.context || ""; $("edit-learner").value = item.learnerText || ""; $("edit-recommended").value = item.recommendedText || ""; $("edit-strengths").value = (item.strengths || []).join("\n"); $("edit-corrections").value = (item.corrections || []).join("\n"); $("edit-literal").value = item.explanation?.literalMeaning || ""; $("edit-natural").value = item.explanation?.naturalChinese || ""; $("edit-context-inference").value = item.explanation?.contextInference || ""; $("edit-dialog").showModal();
}

async function handleItemAction(event) {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const reviewId = button.closest("[data-review-id]")?.getAttribute("data-review-id"); const item = state.items.find((row) => row.reviewId === reviewId); if (!item) return;
  if (button.dataset.action === "edit") return openEdit(item);
  if (button.dataset.action === "share") return openShare(item);
  if (button.dataset.action === "delete") { if (confirm("从复习本隐藏这条记录？原始 JSONL 不会被删除。")) await patchItem(reviewId, { deleted: true }, "已从复习本隐藏；原始学习记录仍然保留。"); return; }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "保存中…";
  toast("正在保存学习状态…");
  try {
    if (button.dataset.action === "known") await patchItem(reviewId, { status: "known", nextReviewAt: null }, "✓ 已标记为“认识了”，不会进入近期复习。");
    if (button.dataset.action === "learning") { const next = new Date(Date.now() + 3 * 86400000).toISOString(); await patchItem(reviewId, { status: "learning", nextReviewAt: next }, `✓ 已标记为“还要复习”，下次复习：${dateLabel(next)}。`); }
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    toast(`保存失败：${error.message}`);
  }
}
function reviewSchedule(rating) {
  if (rating === "mastered") return { status: "known", nextReviewAt: null };
  const days = rating === "forgot" ? 1 : rating === "fuzzy" ? 3 : 7;
  return { status: "learning", nextReviewAt: new Date(Date.now() + days * 86400000).toISOString() };
}

async function handleReviewAction(event) {
  const button = event.target.closest("[data-review-action]");
  if (!button) return false;
  const action = button.dataset.reviewAction;
  if (action === "reveal") { state.reviewRevealed = true; state.reviewPendingRating = null; renderReviewSession(); return true; }
  if (action === "exit") { await loadData(); $("review-progress").textContent = ""; return true; }
  if (action === "rate") { state.reviewPendingRating = button.dataset.rating || null; renderReviewSession(); return true; }
  if (action !== "next" || !state.reviewPendingRating) return false;
  const item = state.reviewItems[state.reviewIndex];
  const rating = state.reviewPendingRating;
  if (!item || !rating) return true;
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    await api(`/api/review/${encodeURIComponent(item.reviewId)}`, { method: "PATCH", body: { ...reviewSchedule(rating), reviewRating: rating } }, { retries: 4 });
  } catch (error) {
    button.disabled = false;
    button.textContent = state.reviewIndex + 1 === state.reviewItems.length ? "重试完成复习" : "重试下一题 →";
    toast(`保存失败：${error.message}`);
    return true;
  }
  state.reviewStats[rating] += 1;
  state.reviewIndex += 1;
  state.reviewRevealed = false;
  state.reviewPendingRating = null;
  renderReviewSession();
  return true;
}

$("items").addEventListener("click", async (event) => { if (state.reviewMode && await handleReviewAction(event)) return; await handleItemAction(event); });
$("word-items").addEventListener("click", handleItemAction);
$("phrase-items").addEventListener("click", handleItemAction);

$("save-edit").addEventListener("click", async (event) => {
  event.preventDefault(); const split = (id) => $(id).value.split(/\n+/).map((value) => value.trim()).filter(Boolean);
  await patchItem($("edit-id").value, { term: $("edit-term").value, context: $("edit-context").value, learnerText: $("edit-learner").value, recommendedText: $("edit-recommended").value, strengths: split("edit-strengths"), corrections: split("edit-corrections"), explanation: { literalMeaning: $("edit-literal").value, naturalChinese: $("edit-natural").value, contextInference: $("edit-context-inference").value } });
  $("edit-dialog").close(); toast("复习记录已更新，原始 JSONL 保持不变。");
});

$("drafts").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-draft]"); if (!button) return;
  const card = button.closest("[data-draft-id]"); const draftId = card.dataset.draftId; const confirmedText = card.querySelector('[data-field="editedText"]').value.trim(); const errorClassification = card.querySelector('[data-field="classification"]').value;
  if (button.dataset.draft === "confirm") await api(`/api/practice-drafts/${encodeURIComponent(draftId)}/confirm`, { method: "POST", body: { confirmedText, errorClassification } });
  if (button.dataset.draft === "discard" && confirm("废弃这条识别草稿？它不会进入复习。")) await api(`/api/practice-drafts/${encodeURIComponent(draftId)}/discard`, { method: "POST", body: { reason: "discarded in review notebook" } });
  await loadData();
});

$("start-review").addEventListener("click", async () => { const body = Object.fromEntries(filterParams()); const result = await api("/api/review/start", { method: "POST", body: { ...body, limit: 10 } }); state.reviewItems = result.items; state.reviewIndex = 0; state.reviewRevealed = false; state.reviewPendingRating = null; state.reviewTotal = result.total; state.reviewStats = { forgot: 0, fuzzy: 0, remembered: 0, mastered: 0 }; state.reviewMode = true; renderItems(); document.querySelector(".notebook").scrollIntoView({ behavior: "smooth" }); });
document.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", async () => { const result = await api("/api/review/export", { method: "POST", body: { ...Object.fromEntries(filterParams()), format: button.dataset.export } }); const blob = new Blob([result.content], { type: result.format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `我的英语复习本.${result.format === "html" ? "html" : "md"}`; link.click(); URL.revokeObjectURL(link.href); toast(`已导出 ${result.count} 条，隐私字段已隐藏。`); }));

function shareMarkup(item) {
  const showLearner = $("share-learner").checked; const showFeeling = $("share-feeling").checked; const keyPoint = item.explanation?.literalMeaning || item.corrections?.[0] || "今天读懂了一处细微表达"; const feeling = item.explanation?.contextInference || item.strengths?.[0] || "慢一点，读进句子里。";
  return `<p class="share-source">今日共读 · ${escapeHtml(item.bookTitle)} · ${escapeHtml(item.chunkTitle)}</p><section data-scene="0"><blockquote>${escapeHtml(item.context || item.term)}</blockquote></section>${showLearner ? `<section class="share-block" data-scene="1"><h4>我的最初理解</h4><p>${escapeHtml(item.learnerText || "未记录")}</p></section>` : ""}<section class="share-block" data-scene="2"><h4>老师提示</h4><p>${escapeHtml(keyPoint)}</p></section><section class="share-block" data-scene="3"><h4>更自然的表达</h4><p>${escapeHtml(item.recommendedText || item.meaning || "未记录")}</p></section>${showFeeling ? `<section class="share-block" data-scene="4"><h4>今日收获</h4><p>${escapeHtml(feeling)}</p></section>` : ""}<p class="small">English Co‑Reading · 已隐藏本地与身份信息</p>`;
}
function openShare(item) { state.shareItem = item; state.storyScene = 0; $("share-card").classList.remove("story"); $("next-story").hidden = true; $("share-card").innerHTML = shareMarkup(item); $("share-dialog").showModal(); }
function rerenderShare() { if (state.shareItem) $("share-card").innerHTML = shareMarkup(state.shareItem); }
$("share-learner").addEventListener("change", rerenderShare); $("share-feeling").addEventListener("change", rerenderShare); $("close-share").addEventListener("click", () => $("share-dialog").close());
$("story-mode").addEventListener("click", () => { state.storyScene = 0; $("share-card").classList.add("story"); $("next-story").hidden = false; document.querySelectorAll("#share-card [data-scene]").forEach((node) => node.classList.toggle("active", Number(node.dataset.scene) === 0)); });
$("next-story").addEventListener("click", () => { const scenes = [...document.querySelectorAll("#share-card [data-scene]")]; state.storyScene = (state.storyScene + 1) % scenes.length; scenes.forEach((node, index) => node.classList.toggle("active", index === state.storyScene)); });

function wrapCanvas(ctx, value, x, y, width, lineHeight, maxLines = 6) { const words = [...String(value || "")]; let line = ""; let row = 0; for (const char of words) { const test = line + char; if (ctx.measureText(test).width > width && line) { ctx.fillText(line, x, y + row * lineHeight); line = char; row += 1; if (row >= maxLines) return y + row * lineHeight; } else line = test; } if (line && row < maxLines) { ctx.fillText(line, x, y + row * lineHeight); row += 1; } return y + row * lineHeight; }
$("download-png").addEventListener("click", () => {
  const item = state.shareItem; if (!item) return; const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1920; const ctx = canvas.getContext("2d"); const gradient = ctx.createLinearGradient(0,0,1080,1920); gradient.addColorStop(0,"#fff8ee"); gradient.addColorStop(1,"#e7d9ca"); ctx.fillStyle = gradient; ctx.fillRect(0,0,1080,1920); ctx.fillStyle="#8b7568"; ctx.font="700 28px system-ui"; ctx.fillText("TODAY'S CO-READING",90,120); ctx.fillStyle="#2e2924"; ctx.font="700 58px Georgia, serif"; let y = wrapCanvas(ctx,item.context || item.term,90,260,900,78,7) + 80; const block = (label,value) => { ctx.fillStyle="#8b6d5b"; ctx.font="700 25px system-ui"; ctx.fillText(label,90,y); y += 48; ctx.fillStyle="#3f3832"; ctx.font="34px system-ui"; y = wrapCanvas(ctx,value || "未记录",90,y,900,50,5) + 58; }; if ($("share-learner").checked) block("我的最初理解",item.learnerText); block("更自然的表达",item.recommendedText || item.meaning); block("一个关键点",item.explanation?.literalMeaning || item.corrections?.[0]); if ($("share-feeling").checked) block("今日收获",item.explanation?.contextInference || item.strengths?.[0]); ctx.fillStyle="#8b7568"; ctx.font="26px system-ui"; ctx.fillText("English Co‑Reading · privacy-safe export",90,1820); const link = document.createElement("a"); link.download="english-co-reading-share.png"; link.href=canvas.toDataURL("image/png"); link.click();
});

let debounce;
$("query").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => loadData().catch((error) => toast(error.message)), 220); });
$("home-book-search").addEventListener("input", renderHomeBooks);
$("book-filter").addEventListener("change", async () => { await loadChunks(); await loadData(); }); $("chunk-filter").addEventListener("change", () => loadData()); $("status-filter").addEventListener("change", () => loadData());

$("foyer-enter").addEventListener("click", enterFoyerBook);
$("foyer-door").addEventListener("click", enterFoyerBook);
$("foyer-down").addEventListener("click", () => {
  $("shelf")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("foyer-review").addEventListener("click", () => {
  ($("review-notebook") || document.querySelector("main"))?.scrollIntoView({ behavior: "smooth", block: "start" });
});

function fillRecoveryCode() {
  $("recovery-current").value = getAnonymousUserId();
  $("recovery-input").value = "";
}

$("recovery-open").addEventListener("click", () => {
  fillRecoveryCode();
  $("recovery-dialog").showModal();
  $("recovery-current").focus();
  $("recovery-current").select();
});

$("recovery-copy").addEventListener("click", async () => {
  const code = $("recovery-current").value;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    $("recovery-current").select();
    document.execCommand("copy");
  }
  toast("迁移码已复制，请另外保存一份");
});

$("recovery-restore").addEventListener("click", () => {
  try {
    const next = parseAnonymousUserId($("recovery-input").value);
    const current = $("recovery-current").value;
    if (next === current) {
      toast("已经是这份数据");
      $("recovery-dialog").close();
      return;
    }
    if (!confirm("换到这个迁移码会打开另一份书架。当前这份还在，以后贴回原来的码就能找回。继续？")) return;
    restoreAnonymousUserId(next);
    toast("正在恢复原来的书架…");
    location.reload();
  } catch (error) {
    toast(error.message || "无法恢复");
  }
});

async function init() { state.books = await api("/api/books"); renderBooks(); await loadData(); }
init().catch((error) => toast(error.message));
