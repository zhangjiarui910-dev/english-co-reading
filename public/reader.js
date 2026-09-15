import { buildCardCandidates, pickCard, sharedNoteIdSet } from "./card-logic.js";
import { userHeaders } from "./anonymous-user.js";

const state = {
  books: [],
  chunks: [],
  annotations: [],
  bookId: null,
  chunkId: null,
  chunk: null,
  quote: "",
  quoteOffset: null,
  selectedQuote: "",
  selectedQuoteOffset: null,
  activeAnnotationId: null,
  dismissedAnnotationIds: new Set(),
  cardCandidates: [],
  cardIndex: 0,
  lastFinish: null,
  toastTimer: null,
  refreshInFlight: false,
  composing: false,
  replyDrafts: {},
  resumeCursor: null,
  readingNote: null,
  readingNoteDirty: false,
  noteMode: "codex",
  contextSelection: null,
  displayTextStart: 0,
  expandedChapterIds: new Set(),
  frontMatterExpanded: false,
  appendixExpanded: false,
};

const $ = (id) => document.getElementById(id);
const authTokenKey = "co-reading-auth-token";
const currentBookKey = "co-reading-current-book-id";
const initialParams = new URLSearchParams(location.search);
const urlToken = initialParams.get("token");
const initialBookId = initialParams.get("book");
if (urlToken) {
  localStorage.setItem(authTokenKey, urlToken);
    initialParams.delete("token");
    history.replaceState(null, "", `${location.pathname}${initialParams.size ? `?${initialParams}` : ""}`);
}

async function api(path, options = {}) {
  const token = localStorage.getItem(authTokenKey);
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...userHeaders(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      let binary = "";
      const size = 0x8000;
      for (let index = 0; index < bytes.length; index += size) {
        binary += String.fromCharCode(...bytes.subarray(index, index + size));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function scrollToPanel(selector) {
  if (!isMobileLayout()) return;
  requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  state.toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 2400);
}

function formatIdentity(author) {
  const value = String(author || "unknown").toLowerCase();
  if (value === "user" || value === "koshi") return "you";
  if (value === "claude" || value === "assistant") return "Codex";
  return value;
}

function replyClass(reply, root) {
  const sameAuthor = String(reply.author || "").toLowerCase() === String(root.author || "").toLowerCase();
  return sameAuthor ? "reply root-author" : "reply other-author";
}

function repliesFor(parentId, notes) {
  return notes.filter((item) => item.parentId === parentId);
}

function replyCount(parentId, notes, seen = new Set()) {
  if (seen.has(parentId)) return 0;
  seen.add(parentId);
  return repliesFor(parentId, notes).reduce((count, reply) => count + 1 + replyCount(reply.id, notes, seen), 0);
}

function renderReply(reply, root, notes, depth = 1, seen = new Set()) {
  if (!reply.id || seen.has(reply.id)) return "";
  const nextSeen = new Set(seen);
  nextSeen.add(reply.id);
  const children = repliesFor(reply.id, notes);
  const visibleDepth = Math.min(depth, 4);
  return `<div class="${replyClass(reply, root)}" style="--reply-depth: ${visibleDepth}">
    <p class="reply-body">${escapeHtml(reply.note)}</p>
    <div class="note-meta">${escapeHtml(formatIdentity(reply.author))} · ${escapeHtml(reply.kind || "reply")}</div>
    ${
      children.length
        ? `<div class="reply-children">${children
            .map((child) => renderReply(child, root, notes, depth + 1, nextSeen))
            .join("")}</div>`
        : ""
    }
  </div>`;
}

function renderThread(note, notes) {
  const replies = repliesFor(note.id, notes);
  const draft = state.replyDrafts[note.id] || "";
  return `<div class="thread">
    ${replies.map((reply) => renderReply(reply, note, notes, 1, new Set([note.id]))).join("")}
    <form class="reply-form" data-parent-id="${escapeHtml(note.id)}">
      <textarea rows="2" placeholder="Reply in this margin...">${escapeHtml(draft)}</textarea>
      <button type="submit" class="primary-button">Reply</button>
    </form>
  </div>`;
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

function renderBooks() {
  $("books").innerHTML = state.books
    .map((book, index) => {
      const total = book.chunkCount || 0;
      const read = book.chunksRead || 0;
      const pct = total ? Math.round((read / total) * 100) : 0;
      const title = tidyDisplayTitle(book.title, book.author) || book.bookId;
      const author = book.author || "Unknown author";
      const coverTone = (index % 6) + 1;
      return `<div class="book-row cover-tone-${coverTone} ${book.bookId === state.bookId ? "active" : ""}">
        <button class="book" data-book="${escapeHtml(book.bookId)}" aria-label="打开 ${escapeHtml(title)}，进度 ${read}/${total}，${book.annotationCount || 0} 条笔记">
          <span class="book-cover" aria-hidden="true">
            <span class="book-cover-kicker">ENGLISH READING</span>
            <span class="book-title">${escapeHtml(title)}</span>
            <span class="book-cover-author">${escapeHtml(author)}</span>
          </span>
          <span class="book-meta">${read}/${total} · ${book.annotationCount || 0} notes</span>
          <span class="progress"><span style="width: ${pct}%"></span></span>
        </button>
        <button class="book-delete" data-delete-book="${escapeHtml(book.bookId)}" title="Delete ${escapeHtml(title)}" aria-label="Delete ${escapeHtml(title)}">Delete</button>
      </div>`;
    })
    .join("");
}

function fallbackChapterDetails(chunk) {
  const fullTitle = String(chunk.title || "").trim();
  const match = fullTitle.match(/\s+Part\s+(\d+)\s*\/\s*(\d+)\s*$/iu);
  return {
    id: chunk.chapterId || chunk.id,
    title: chunk.chapterTitle || chunk.sectionTitle || (match ? fullTitle.slice(0, match.index).trim() : fullTitle),
    hasParts: Boolean(match) || Number(chunk.chapterPartCount || chunk.sectionPartCount || 1) > 1,
  };
}

function groupedChapters() {
  const groups = [];
  for (const chunk of state.chunks) {
    const details = fallbackChapterDetails(chunk);
    const previous = groups.at(-1);
    if (details.hasParts && previous?.id === details.id) {
      previous.chunks.push(chunk);
      continue;
    }
    groups.push({
      id: details.id,
      title: details.title || chunk.id,
      hasParts: details.hasParts,
      isAppendix: Boolean(chunk.isAppendix),
      isFrontMatter: Boolean(chunk.isFrontMatter),
      appendixOverride: chunk.appendixOverride ?? null,
      chunks: [chunk],
    });
  }
  return groups;
}

function chapterForChunk(chunkId) {
  return groupedChapters().find((chapter) => chapter.chunks.some((chunk) => chunk.id === chunkId)) || null;
}

function chapterSummary(chapter) {
  const read = chapter.chunks.filter((chunk) => chunk.read).length;
  const notes = chapter.chunks.reduce((sum, chunk) => sum + (chunk.annotationCount || 0), 0);
  return `共 ${chapter.chunks.length} 段 · 已读 ${read} 段 · 笔记 ${notes} 条`;
}

function parseChapterHeading(title) {
  const text = String(title || "").trim();
  const english = text.match(/^(chapter|part|book)\s+(\d+|[ivxlcdm]+)\b(?:[:.\s—–-]+(.*))?$/iu);
  if (english) {
    const word = english[1].toLowerCase();
    const label = `${word.charAt(0).toUpperCase()}${word.slice(1)} ${english[2]}`;
    return { kind: "chapter", label, name: (english[3] || "").trim(), full: text };
  }
  const chinese = text.match(/^(第\s*[0-9一二三四五六七八九十百千]+\s*[章节部篇])\s*[:：.\s—–-]*(.*)$/u);
  if (chinese) {
    return { kind: "chapter", label: chinese[1].replace(/\s+/g, ""), name: (chinese[2] || "").trim(), full: text };
  }
  return { kind: "section", label: "", name: text, full: text };
}

function renderChapterTitle(title) {
  const heading = parseChapterHeading(title);
  if (heading.kind === "chapter" && heading.name) {
    return `<span class="chapter-title"><span class="chapter-num">${escapeHtml(heading.label)}</span><span class="chapter-name">${escapeHtml(heading.name)}</span></span>`;
  }
  return `<span class="chapter-title"><span class="chapter-name">${escapeHtml(heading.name || heading.label || heading.full)}</span></span>`;
}

function renderChunkButton(chunk) {
  return `<button class="chunk ${chunk.id === state.chunkId ? "active" : ""}" data-chunk="${escapeHtml(chunk.id)}">
    <span class="chunk-title">${escapeHtml(chunk.title)}</span>
    <span class="chunk-meta">${escapeHtml(chunk.id)} · ${chunk.read ? "read" : "unread"} · ${chunk.annotationCount || 0} notes</span>
  </button>`;
}

function renderAppendixControl(chapter) {
  const nextAppendix = !chapter.isAppendix;
  const label = chapter.isAppendix ? "移出附录" : "归入附录";
  const shortLabel = chapter.isAppendix ? "移出" : "附录";
  const automaticLabel = chapter.appendixOverride === null ? "自动判断" : "手动设置";
  return `<button class="chapter-appendix-button" type="button" data-appendix-toggle="${escapeHtml(chapter.id)}" data-next-appendix="${nextAppendix}" title="${automaticLabel}：${label}" aria-label="${label}：${escapeHtml(chapter.title)}">${shortLabel}</button>`;
}

function renderChapter(chapter) {
  const single = chapter.chunks.length === 1;
  const expanded = !single && state.expandedChapterIds.has(chapter.id);
  const heading = parseChapterHeading(chapter.title);
  const titleHtml = renderChapterTitle(chapter.title);
  const copy = `<span class="chapter-copy">${titleHtml}<span class="chapter-meta">${chapterSummary(chapter)}</span></span>`;
  const mainButton = single
    ? `<button class="chapter-button chapter-single ${chapter.chunks[0].id === state.chunkId ? "active" : ""}" data-chunk="${escapeHtml(chapter.chunks[0].id)}">
        ${copy}
      </button>`
    : `<button class="chapter-button ${expanded ? "expanded" : ""}" data-chapter-toggle="${escapeHtml(chapter.id)}" aria-expanded="${expanded}">
        ${copy}
        <span class="chapter-chevron" aria-hidden="true">${expanded ? "−" : "+"}</span>
      </button>`;
  const parts = expanded ? `<div class="chapter-parts">${chapter.chunks.map(renderChunkButton).join("")}</div>` : "";
  return `<section class="chapter-entry ${chapter.isAppendix ? "is-appendix" : ""} is-${heading.kind}" data-chapter-id="${escapeHtml(chapter.id)}">
    <div class="chapter-row">${mainButton}${renderAppendixControl(chapter)}</div>
    ${parts}
  </section>`;
}

function renderChunks() {
  const chapters = groupedChapters();
  const readingChapters = chapters.filter((chapter) => !chapter.isAppendix);
  const frontMatterChapters = chapters.filter((chapter) => chapter.isFrontMatter);
  const appendixChapters = chapters.filter((chapter) => chapter.isAppendix && !chapter.isFrontMatter);
  const frontMatterChunks = frontMatterChapters.flatMap((chapter) => chapter.chunks);
  const frontMatterNotes = frontMatterChunks.reduce((sum, chunk) => sum + (chunk.annotationCount || 0), 0);
  const frontMatter = frontMatterChapters.length
    ? `<section class="appendix-section frontmatter-section">
        <button class="appendix-heading" type="button" data-frontmatter-section-toggle aria-expanded="${state.frontMatterExpanded}">
          <span><span class="chapter-title">书前页</span><span class="chapter-meta">${frontMatterChapters.length} 组 · ${frontMatterChunks.length} 段 · 笔记 ${frontMatterNotes} 条</span></span>
          <span class="chapter-chevron" aria-hidden="true">${state.frontMatterExpanded ? "−" : "+"}</span>
        </button>
        ${state.frontMatterExpanded ? `<div class="appendix-chapters">${frontMatterChapters.map(renderChapter).join("")}</div>` : ""}
      </section>`
    : "";
  const appendixChunks = appendixChapters.flatMap((chapter) => chapter.chunks);
  const appendixRead = appendixChunks.filter((chunk) => chunk.read).length;
  const appendixNotes = appendixChunks.reduce((sum, chunk) => sum + (chunk.annotationCount || 0), 0);
  const appendix = appendixChapters.length
    ? `<section class="appendix-section">
        <button class="appendix-heading" type="button" data-appendix-section-toggle aria-expanded="${state.appendixExpanded}">
          <span><span class="chapter-title">附录</span><span class="chapter-meta">${appendixChapters.length} 章 · ${appendixChunks.length} 段 · 已读 ${appendixRead} 段 · 笔记 ${appendixNotes} 条</span></span>
          <span class="chapter-chevron" aria-hidden="true">${state.appendixExpanded ? "−" : "+"}</span>
        </button>
        ${state.appendixExpanded ? `<div class="appendix-chapters">${appendixChapters.map(renderChapter).join("")}</div>` : ""}
      </section>`
    : "";
  $("chunks").innerHTML = `${frontMatter}${readingChapters.map(renderChapter).join("")}${appendix}`;
}

function isMostlyChinese(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  if (compact.length < 12) return false;
  const sample = compact.slice(0, 500);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return cjk >= 12 && cjk > latin;
}

function splitVisibleParagraphs(source) {
  if (/\r?\n\s*\r?\n/.test(source)) {
    const parts = [];
    let start = 0;
    for (const match of source.matchAll(/\r?\n\s*\r?\n/g)) {
      parts.push({ raw: source.slice(start, match.index), start });
      start = match.index + match[0].length;
    }
    parts.push({ raw: source.slice(start), start });
    return parts.filter((part) => part.raw.length);
  }
  const lines = [];
  let start = 0;
  for (const match of source.matchAll(/\r?\n/g)) {
    lines.push({ raw: source.slice(start, match.index), start });
    start = match.index + match[0].length;
  }
  lines.push({ raw: source.slice(start), start });
  const nonempty = lines.filter((part) => part.raw.trim());
  const longish = nonempty.filter((part) => part.raw.replace(/[　\s]/g, "").length >= 12).length;
  if (nonempty.length >= 2 && longish >= nonempty.length * 0.45) return nonempty;
  return source ? [{ raw: source, start: 0 }] : [];
}

function isChineseOpeningTitle(value) {
  const text = String(value || "").replace(/^[　\s#]+/, "").trim();
  if (!text) return true;
  if (/^第[0-9一二三四五六七八九十百千两零〇]+\s*[章节部篇回]/u.test(text)) return true;
  if (/^【[^】]{1,16}】/.test(text) && !/[。！？]/.test(text)) return true;
  return [...text].length <= 18 && !/[。！？；]/.test(text);
}

function tidyParagraphPart(part) {
  const lead = part.raw.match(/^[\r\n]+/)?.[0].length || 0;
  const trail = part.raw.match(/[\r\n]+$/)?.[0].length || 0;
  return {
    raw: part.raw.slice(lead, Math.max(lead, part.raw.length - trail)),
    start: part.start + lead,
  };
}

function peelChineseHeading(part) {
  const match = part.raw.match(/^([^\r\n]+)(\r?\n)([\s\S]+)$/);
  if (!match) return [part];
  const first = match[1].replace(/^[　\s#]+/, "").trim();
  const rest = match[3].replace(/^[　\s]+/, "").trim();
  if (rest.length < 20 || !isChineseOpeningTitle(first)) return [part];
  return [
    { raw: match[1], start: part.start },
    { raw: match[3], start: part.start + match[1].length + match[2].length },
  ];
}

function highlightMarkup(text, highlight) {
  const quote = escapeHtml(text.slice(highlight.start, highlight.end));
  const bookmark = highlight.shared ? `<span class="shared-bookmark" title="这里有两个人的折痕。">此处有回声</span>` : "";
  const pureHighlight = highlight.note.kind === "highlight";
  const personal = highlight.note.kind === "highlight_note" || pureHighlight || highlight.note.status === "saved";
  const hasPersonalNote = !pureHighlight && personal;
  const personalToggle = hasPersonalNote
    ? `<button class="personal-note-toggle" type="button" data-open-personal-note="${escapeHtml(highlight.note.id)}" aria-label="查看这条划线笔记">笔记</button>`
    : "";
  const markTitle = pureHighlight ? "我的划线" : highlight.note.note;
  return `<mark class="${highlight.note.id === state.activeAnnotationId ? "active" : ""} ${highlight.shared ? "shared" : ""} ${personal ? "personal-highlight" : ""} ${pureHighlight ? "plain-highlight" : ""}" data-note-id="${escapeHtml(highlight.note.id)}" title="${escapeHtml(markTitle)}">${quote}</mark>${personalToggle}${bookmark}`;
}

function renderHighlightedSlice(text, start, end, highlights) {
  let html = "";
  let cursor = start;
  for (const highlight of highlights) {
    if (highlight.end <= start || highlight.start >= end) continue;
    const from = Math.max(highlight.start, start);
    const to = Math.min(highlight.end, end);
    if (from > cursor) html += escapeHtml(text.slice(cursor, from));
    html += highlightMarkup(text, { ...highlight, start: from, end: to });
    cursor = to;
  }
  if (cursor < end) html += escapeHtml(text.slice(cursor, end));
  return html;
}

function renderText() {
  if (!state.chunk) return;
  const text = state.chunk.text || "";
  const headingMatch = text.match(/^\s*#{1,6}\s+([^\r\n]+)\r?\n+/);
  const displayedHeading = headingMatch?.[1]?.trim().replace(/\s+/g, " ").toLowerCase();
  const chunkHeading = String(state.chunk.chunk?.title || "").trim().replace(/\s+/g, " ").toLowerCase();
  state.displayTextStart = headingMatch && displayedHeading === chunkHeading ? headingMatch[0].length : 0;
  if (state.displayTextStart) {
    const sectionHeadingMatch = text.slice(state.displayTextStart).match(/^\s*#{1,6}\s+([^\r\n]+)\r?\n+/);
    const displayedSectionHeading = sectionHeadingMatch?.[1]?.trim().replace(/\s+/g, " ").toLowerCase();
    const sectionTitle = String(state.chunk.chunk?.sectionTitle || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (sectionHeadingMatch && displayedSectionHeading === sectionTitle) {
      state.displayTextStart += sectionHeadingMatch[0].length;
    }
    const bylineMatch = text.slice(state.displayTextStart).match(/^\s*([^\r\n]+)\r?\n\s*\r?\n/);
    const displayedByline = bylineMatch?.[1]?.trim().replace(/\s+/g, " ").toLowerCase();
    if (bylineMatch && displayedByline === sectionTitle) {
      state.displayTextStart += bylineMatch[0].length;
    }
  }
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const sharedIds = sharedNoteIdSet(notes);
  const highlights = [];
  const occupied = [];
  const rootNotes = notes
    .filter((item) => !item.parentId && item.quote)
    .sort((a, b) => {
      const left = Number.isInteger(a.quoteOffset) ? a.quoteOffset : text.indexOf(a.quote);
      const right = Number.isInteger(b.quoteOffset) ? b.quoteOffset : text.indexOf(b.quote);
      return left - right;
    });
  for (const note of rootNotes) {
    const quote = String(note.quote || "");
    const requestedOffset = Number(note.quoteOffset);
    const start =
      Number.isInteger(requestedOffset) && requestedOffset >= 0 && text.slice(requestedOffset, requestedOffset + quote.length) === quote
        ? requestedOffset
        : text.indexOf(quote);
    if (!quote || start < state.displayTextStart) continue;
    const end = start + quote.length;
    if (occupied.some((range) => start < range.end && end > range.start)) continue;
    occupied.push({ start, end });
    highlights.push({ start, end, note, shared: sharedIds.has(note.id) });
  }

  const visible = text.slice(state.displayTextStart);
  const chinese = isMostlyChinese(visible);
  $("text").classList.toggle("text-zh", chinese);
  if (chinese) {
    const paragraphs = splitVisibleParagraphs(visible)
      .map(tidyParagraphPart)
      .filter((part) => part.raw.trim())
      .flatMap(peelChineseHeading)
      .map(tidyParagraphPart)
      .filter((part) => part.raw.trim());
    $("text").innerHTML = paragraphs.map((part) => {
      const absStart = state.displayTextStart + part.start;
      const leading = part.raw.match(/^[　 \t]+/)?.[0].length || 0;
      const contentStart = absStart + leading;
      const absEnd = absStart + part.raw.length;
      const title = isChineseOpeningTitle(part.raw);
      const body = renderHighlightedSlice(text, contentStart, absEnd, highlights);
      return `<p class="${title ? "zh-title" : "zh-p"}">${body || "&nbsp;"}</p>`;
    }).join("");
    bindPersonalNoteToggles();
    return;
  }

  $("text").innerHTML = renderHighlightedSlice(text, state.displayTextStart, text.length, highlights);
  applyDropCap();
  bindPersonalNoteToggles();
}

function applyDropCap() {
  const source = String(state.chunk?.text || "").slice(state.displayTextStart || 0);
  const blocks = [];
  let blockStart = 0;
  for (const separator of source.matchAll(/\r?\n\s*\r?\n/g)) {
    blocks.push({ raw: source.slice(blockStart, separator.index), start: blockStart });
    blockStart = separator.index + separator[0].length;
  }
  blocks.push({ raw: source.slice(blockStart), start: blockStart });

  const normalizeTitle = (value) => String(value || "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\s+Part\s+\d+\s*\/\s*\d+\s*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
  const bookTitle = normalizeTitle(currentBook()?.title || state.chunk?.title);
  const sectionTitle = normalizeTitle(state.chunk?.chunk?.sectionTitle || state.chunk?.chunk?.chapterTitle);
  const chunkTitle = normalizeTitle(state.chunk?.chunk?.title);
  const isOpeningTitle = (value) => {
    const normalized = normalizeTitle(value);
    if (!normalized) return true;
    if (normalized === sectionTitle || normalized === chunkTitle) return true;
    if (bookTitle && (bookTitle === normalized || bookTitle.startsWith(`${normalized} `))) return true;
    return value.length <= 80 && !/[.!?。！？][\"'”’]?\s*$/.test(value);
  };
  const paragraph = blocks.find((block) => {
    const value = block.raw.trim();
    return value && !isOpeningTitle(value);
  });
  if (!paragraph) return;

  const leadingSpace = paragraph.raw.search(/\S/);
  const sourceStart = paragraph.start + leadingSpace;
  const firstParagraph = paragraph.raw.trim();
  if (firstParagraph.length < 40 || !/[A-Z]/.test(source[sourceStart])) return;
  const firstWord = source.slice(sourceStart).match(/^[A-Za-z]+(?:[’'][A-Za-z]+)*/)?.[0] || "";
  if (!firstWord || /^[A-Z]+(?:[’'][A-Z]+)*$/.test(firstWord)) return;

  const root = $("text");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest(".inline-note, .shared-bookmark, button")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) textNodes.push(current);
  const renderedText = textNodes.map((current) => current.nodeValue || "").join("");
  const renderedParagraph = firstParagraph.replace(/\r\n/g, "\n");
  const renderedStart = renderedText.indexOf(renderedParagraph);
  if (renderedStart < 0) return;

  let node = null;
  let index = -1;
  let consumed = 0;
  for (const current of textNodes) {
    const length = current.nodeValue?.length || 0;
    if (renderedStart < consumed + length) {
      node = current;
      index = renderedStart - consumed;
      break;
    }
    consumed += length;
  }
  if (!node || index < 0) return;
  const letter = node.nodeValue[index];
  if (letter !== source[sourceStart] || !/[A-Z]/.test(letter)) return;
  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + 1);
  const span = document.createElement("span");
  span.className = "dropcap letter-mask";
  range.surroundContents(span);
}

function renderRunningHead() {
  const book = currentBook();
  const chunkTitle = String(state.chunk?.chunk?.title || "");
  const bookTitle = tidyDisplayTitle(book?.title || state.chunk?.title, book?.author);
  const year = (chunkTitle.match(/\b(?:18|19|20)\d{2}\b/) || bookTitle.match(/\b(?:18|19|20)\d{2}\b/))?.[0] || "";
  $("running-chunk").textContent = state.chunkId ? `(${state.chunkId})` : "";
  $("running-book").textContent = bookTitle;
  $("running-year").textContent = year ? `(${year})` : "";
  $("running-head").hidden = !state.chunkId;
}

function isOwnAnnotation(annotation) {
  return ["user", "human", "koshi", "you"].includes(String(annotation?.author || "").toLowerCase());
}

function bindPersonalNoteToggles() {
  document.querySelectorAll("[data-open-personal-note]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      activateAnnotation(button.dataset.openPersonalNote, { scroll: true });
    });
  });
}

function renderAnnotations() {
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const roots = notes.filter((item) => !item.parentId);
  const openCount = state.annotations.filter((item) => item.author === "user" && (item.status || "open") === "open")
    .length;

  $("margins").innerHTML = roots
    .filter((note) => {
      const isPureHighlight = note.kind === "highlight";
      const isPersonal = note.kind === "highlight_note" || note.status === "saved";
      if (isPureHighlight || state.dismissedAnnotationIds.has(note.id)) return false;
      return !isPersonal || note.id === state.activeAnnotationId;
    })
    .map((note) => {
      const replies = replyCount(note.id, notes);
      const expanded = note.id === state.activeAnnotationId;
      const isShared = sharedNoteIdSet(notes).has(note.id);
      const isPersonal = note.kind === "highlight_note" || note.status === "saved";
      const canDelete = isOwnAnnotation(note);
      const kindLabel = isPersonal ? "我的划线笔记" : note.kind || "note";
      return `<article class="note-card ${(note.status || "") === "open" ? "open" : ""} ${isPersonal ? "personal-note" : ""} ${expanded ? "active" : ""}" data-note-id="${escapeHtml(note.id)}" tabindex="0">
        <button class="note-card-close" type="button" data-close-note-card aria-label="关闭这条批注">×</button>
        ${canDelete ? `<button class="note-card-delete" type="button" data-delete-annotation aria-label="删除这条划线或笔记">删除</button>` : ""}
        ${isShared ? `<p class="shared-line">这里有两个人的折痕。</p>` : ""}
        <p class="note-quote">${escapeHtml(note.quote)}</p>
        <p class="note-body">${escapeHtml(note.note)}</p>
        <div class="note-meta">${escapeHtml(formatIdentity(note.author))} · ${escapeHtml(kindLabel)}${isPersonal ? " · 仅自己可见" : ` · ${escapeHtml(note.status || "published")}`}${replies ? ` · ${replies} replies` : ""}</div>
        ${
          expanded && !isPersonal
            ? renderThread(note, notes)
            : ""
        }
      </article>`;
    })
    .join("");

  $("retry-notes").hidden = openCount === 0;
  $("retry-notes").textContent = openCount ? `重新发送留言 · ${openCount}` : "发送未送达留言";
}

function currentBook() {
  return state.books.find((item) => item.bookId === state.bookId) || {};
}

function currentChunkMeta() {
  return state.chunks.find((item) => item.id === state.chunkId) || state.chunk?.chunk || {};
}

async function loadReadingNote() {
  if (!state.bookId || !state.chunkId) return;
  const notes = await api(
    `/api/reading-notes?bookId=${encodeURIComponent(state.bookId)}&chunkId=${encodeURIComponent(state.chunkId)}`,
  );
  state.readingNote = notes[0] || null;
  state.readingNoteDirty = false;
  $("reading-note-text").value = state.readingNote?.note || "";
  $("reading-note-scope").textContent = `${currentBook().title || state.bookId} · ${currentChunkMeta().title || state.chunkId}`;
  $("reading-note-status").textContent = state.readingNote?.savedAt
    ? `上次保存：${new Date(state.readingNote.savedAt).toLocaleString()}`
    : "只保存在你的 English Co-Reading 数据目录中，不会发送给 Codex。";
}

async function openReadingNote() {
  if (!state.bookId || !state.chunkId) return;
  if (!state.readingNoteDirty) await loadReadingNote();
  $("reading-note-panel").hidden = false;
  $("reading-note-text").focus();
}

async function saveReadingNote() {
  if (!state.bookId || !state.chunkId) return;
  const button = $("save-reading-note");
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    state.readingNote = await api("/api/reading-notes", {
      method: "PUT",
      body: { bookId: state.bookId, chunkId: state.chunkId, note: $("reading-note-text").value },
    });
    state.readingNoteDirty = false;
    $("reading-note-status").textContent = `已保存：${new Date(state.readingNote.savedAt).toLocaleString()}`;
    showToast("本段笔记已保存");
  } finally {
    button.disabled = false;
    button.textContent = "保存笔记";
  }
}

function refreshCards({ finish = null, show = false } = {}) {
  const chunkAnnotations = state.annotations.filter(
    (item) => item.chunkId === state.chunkId && item.kind !== "highlight_note" && item.status !== "saved",
  );
  state.cardCandidates = buildCardCandidates({
    book: currentBook(),
    chunk: { ...currentChunkMeta(), text: state.chunk?.text || "" },
    annotations: chunkAnnotations,
    finish,
  });
  if (state.cardIndex >= state.cardCandidates.length) state.cardIndex = 0;
  $("show-card").disabled = state.cardCandidates.length === 0;
  $("show-card").textContent = state.cardCandidates.length ? `生成分享卡 ${state.cardCandidates.length}` : "生成分享卡";
  if (show && state.cardCandidates.length) {
    openCardPanel();
  } else {
    renderCardPanel();
  }
}

function renderCardPanel() {
  const card = pickCard(state.cardCandidates, state.cardIndex);
  $("card-panel").hidden = !card || $("card-panel").hidden;
  if (!card) {
    $("card-preview").innerHTML = "";
    return;
  }
  $("card-preview").innerHTML = renderReadingCard(card);
}

function seededRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function readingCardArt(card) {
  const random = seededRandom(card.artSeed || 1);
  if (card.art === "ripple") {
    const centers = [
      [25 + random() * 18, 20 + random() * 18],
      [58 + random() * 18, 48 + random() * 18],
      [22 + random() * 14, 72 + random() * 12],
    ];
    const circles = centers
      .flatMap(([cx, cy], groupIndex) =>
        Array.from({ length: groupIndex === 1 ? 4 : 3 }, (_, index) => {
          const radius = 8 + index * (6 + random() * 3) + random() * 2;
          const opacity = 0.035 + random() * 0.06;
          return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
        }),
      )
      .join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.36">${circles}</g></svg>`;
  }
  if (card.art === "stardust") {
    const dots = Array.from({ length: 64 }, () => {
      const cx = 7 + random() * 86;
      const cy = 8 + random() * 80;
      const radius = 0.08 + random() * 0.24;
      const opacity = 0.18 + random() * 0.42;
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
    }).join("");
    const bright = Array.from({ length: 7 }, () => {
      const cx = 12 + random() * 76;
      const cy = 12 + random() * 72;
      const opacity = 0.22 + random() * 0.26;
      return `<path d="M ${(cx - 0.9).toFixed(2)} ${cy.toFixed(2)} L ${(cx + 0.9).toFixed(2)} ${cy.toFixed(2)} M ${cx.toFixed(2)} ${(cy - 0.9).toFixed(2)} L ${cx.toFixed(2)} ${(cy + 0.9).toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
    }).join("");
    const lines = Array.from({ length: 5 }, () => {
      const x1 = 8 + random() * 84;
      const y1 = 10 + random() * 76;
      const x2 = x1 + (random() - 0.5) * 12;
      const y2 = y1 + (random() - 0.5) * 12;
      return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}" opacity="0.07" />`;
    }).join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="currentColor">${dots}</g><g fill="none" stroke="currentColor" stroke-width="0.14">${lines}${bright}</g></svg>`;
  }
  const lines = Array.from({ length: 14 }, () => {
    const x = 8 + random() * 84;
    const drift = (random() - 0.5) * 10;
    const opacity = 0.06 + random() * 0.14;
    return `<path d="M ${x.toFixed(2)} 3 C ${(x + drift).toFixed(2)} 30 ${(x - drift).toFixed(2)} 62 ${x.toFixed(2)} 97" opacity="${opacity.toFixed(3)}" />`;
  }).join("");
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.32">${lines}</g></svg>`;
}

function renderReadingCard(card) {
  return `<article class="ritual-card ${escapeHtml(card.variant)} art-${escapeHtml(card.art || "fold")} ${escapeHtml(cardSizeClass(card))}">
    <div class="card-art">${readingCardArt(card)}</div>
    <div class="card-content">
      <p class="card-kicker">${escapeHtml(card.kicker)}</p>
      <h3>${escapeHtml(card.title)}</h3>
      <p class="card-subtitle">${escapeHtml(card.subtitle)}</p>
      <blockquote>${escapeHtml(card.quote)}</blockquote>
      <div class="card-voices ${card.rightText ? "" : "single"}">
        <section>
          <span>${escapeHtml(card.leftLabel)}</span>
          <p>${escapeHtml(card.leftText)}</p>
        </section>
        ${
          card.rightText
            ? `<section>
                <span>${escapeHtml(card.rightLabel)}</span>
                <p>${escapeHtml(card.rightText)}</p>
              </section>`
            : ""
        }
      </div>
      <footer>${escapeHtml(card.footer)}</footer>
    </div>
  </article>`;
}

function cardSizeClass(card) {
  const totalLength = [card.quote, card.leftText, card.rightText, card.note]
    .filter(Boolean)
    .join("")
    .length;
  if (totalLength < 120) return "card-compact";
  if (totalLength > 360) return "card-tall";
  return "card-standard";
}

function openCardPanel() {
  if (!state.cardCandidates.length) return;
  $("card-panel").hidden = false;
  renderCardPanel();
}

function placeSelectionTools() {
  const tools = $("selection-tools");
  if (!tools || tools.hidden) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const width = tools.offsetWidth || 168;
  const height = tools.offsetHeight || 76;
  let left = rect.left + (rect.width / 2) - (width / 2);
  let top = rect.bottom + 10;
  if (top + height > window.innerHeight - 12) top = rect.top - height - 10;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  top = Math.max(8, top);
  tools.style.left = `${Math.round(left)}px`;
  tools.style.top = `${Math.round(top)}px`;
  tools.style.right = "auto";
  tools.style.bottom = "auto";
}

function updateSelectionAction({ preserve = false } = {}) {
  const selection = window.getSelection();
  const details = selectionDetails(selection);
  if (!details && preserve && state.selectedQuote) return;
  state.selectedQuote = details?.quote || "";
  state.selectedQuoteOffset = details?.quoteOffset ?? null;
  $("selection-tools").hidden = Boolean(state.contextSelection) || !state.selectedQuote || !state.bookId || !state.chunkId;
  if (!$("selection-tools").hidden) requestAnimationFrame(placeSelectionTools);
}

function quoteForNote() {
  return state.contextSelection?.quote || state.selectedQuote || window.getSelection()?.toString() || "";
}

function clearSelectionAction() {
  state.selectedQuote = "";
  state.selectedQuoteOffset = null;
  $("selection-tools").hidden = true;
}

function elementForNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(needle.length, 1);
  }
  return count;
}

function findOccurrence(haystack, needle, occurrence) {
  let index = -1;
  let from = 0;
  for (let current = 0; current <= occurrence; current += 1) {
    index = haystack.indexOf(needle, from);
    if (index === -1) return -1;
    from = index + Math.max(needle.length, 1);
  }
  return index;
}

function nextTextNodeAfter(element) {
  const root = $("text");
  if (!root || !element) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = null;
  let seen = false;
  while ((node = walker.nextNode())) {
    if (seen && node.nodeValue) return node;
    if (element.contains(node)) seen = true;
  }
  return null;
}

function dropcapLetter() {
  return $("text")?.querySelector(".dropcap")?.textContent || "";
}

function rangeStartsAfterDropcap(range) {
  const drop = $("text")?.querySelector(".dropcap");
  if (!drop || drop.contains(range.startContainer)) return false;
  const after = nextTextNodeAfter(drop);
  if (range.startContainer === after && range.startOffset === 0) return true;
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const child = range.startContainer.childNodes[range.startOffset];
    return Boolean(child && (child === after || after?.parentElement === child || child.contains?.(after)));
  }
  return false;
}

function rangePlainText(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(".inline-note, .shared-bookmark, button").forEach((node) => node.remove());
  const text = fragment.textContent || "";
  const letter = dropcapLetter();
  if (letter && !text.startsWith(letter) && rangeStartsAfterDropcap(range)) return `${letter}${text}`;
  return text;
}

function selectionDetails(selection) {
  if (!selection || selection.rangeCount === 0 || !state.chunk?.text) return null;
  const range = selection.getRangeAt(0);
  const rawQuote = rangePlainText(range);
  const quote = rawQuote.trim();
  if (!quote) return null;
  const textEl = $("text");
  const startEl = elementForNode(range.startContainer);
  const endEl = elementForNode(range.endContainer);
  if (!startEl || !endEl) return null;
  if (!textEl.contains(range.commonAncestorContainer) || !textEl.contains(startEl) || !textEl.contains(endEl)) return null;
  if (startEl.closest(".inline-note, .shared-bookmark") || endEl.closest(".inline-note, .shared-bookmark")) return null;

  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(textEl);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const occurrence = countOccurrences(prefixRange.toString(), quote);
  const visibleText = state.chunk.text.slice(state.displayTextStart || 0);
  const visibleOffset = findOccurrence(visibleText, quote, occurrence);
  const quoteOffset = visibleOffset < 0 ? -1 : visibleOffset + (state.displayTextStart || 0);
  return {
    quote,
    quoteOffset: quoteOffset >= 0 ? quoteOffset : null,
  };
}

function pointInsideRange(range, x, y) {
  return Array.from(range.getClientRects()).some((rect) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  );
}

function selectWordAtPoint(x, y) {
  let range = document.caretRangeFromPoint?.(x, y) || null;
  if (!range && document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  }
  const node = range?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE || !$("text").contains(node)) return null;
  if (node.parentElement?.closest(".inline-note, .shared-bookmark")) return null;
  const text = node.nodeValue || "";
  const offset = range.startOffset;
  const word = Array.from(text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g))
    .find((match) => offset >= match.index && offset <= match.index + match[0].length);
  if (!word) return null;
  range.setStart(node, word.index);
  range.setEnd(node, word.index + word[0].length);
  const drop = $("text")?.querySelector(".dropcap");
  const dropText = drop?.firstChild;
  const afterDrop = drop ? nextTextNodeAfter(drop) : null;
  if (dropText && afterDrop) {
    if (drop.contains(node)) {
      const rest = afterDrop.nodeValue?.match(/^[a-z]+(?:['’\-][A-Za-z]+)*/);
      if (rest) range.setEnd(afterDrop, rest[0].length);
    } else if (node === afterDrop && word.index === 0 && /^[a-z]/.test(word[0])) {
      range.setStart(dropText, 0);
    }
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selectionDetails(selection);
}

function contextForSelection({ quote, quoteOffset }) {
  const text = String(state.chunk?.text || "");
  const offset = Number.isInteger(quoteOffset) ? quoteOffset : text.indexOf(quote);
  if (offset < 0) return quote;
  const before = text.slice(0, offset);
  const starts = [before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "), before.lastIndexOf("\n\n")];
  const startBoundary = Math.max(...starts);
  const start = startBoundary < 0 ? Math.max(0, offset - 240) : startBoundary + 2;
  const afterStart = offset + quote.length;
  const after = text.slice(afterStart);
  const endings = [after.indexOf(". "), after.indexOf("? "), after.indexOf("! "), after.indexOf("\n\n")].filter((value) => value >= 0);
  const end = endings.length ? afterStart + Math.min(...endings) + 1 : Math.min(text.length, afterStart + 240);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function closeTextContextMenu({ clearSelection = false } = {}) {
  state.contextSelection = null;
  $("text-context-menu").hidden = true;
  if (clearSelection) {
    window.getSelection()?.removeAllRanges();
    clearSelectionAction();
  } else {
    updateSelectionAction({ preserve: true });
  }
}

function openTextContextMenu(details, x, y) {
  state.contextSelection = details;
  const phrase = /\s/.test(details.quote.trim());
  $("context-menu-term").textContent = details.quote;
  $("save-vocabulary").textContent = phrase ? "加入词组本" : "加入生词本";
  const menu = $("text-context-menu");
  menu.hidden = false;
  const width = menu.offsetWidth || 196;
  const height = menu.offsetHeight || 220;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  $("selection-tools").hidden = true;
}

async function copyOriginalText() {
  const value = state.contextSelection?.quote;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("浏览器没有允许复制");
  }
  closeTextContextMenu({ clearSelection: true });
  showToast("已复制原文");
}

async function saveContextVocabulary() {
  const details = state.contextSelection;
  if (!details || !state.bookId || !state.chunkId) return;
  const phrase = /\s/.test(details.quote.trim());
  const saved = await api("/api/vocabulary", {
    method: "POST",
    body: {
      bookId: state.bookId,
      chunkId: state.chunkId,
      term: details.quote.trim(),
      context: contextForSelection(details),
      status: "new",
      inputMode: "typed",
    },
  });
  closeTextContextMenu({ clearSelection: true });
  showToast(saved.alreadyExists ? "这条已经在复习本里了" : phrase ? "已加入词组本" : "已加入生词本");
}

async function loadBooks() {
  state.books = await api("/api/books");
  renderBooks();
}

async function selectBook(bookId) {
  state.bookId = bookId;
  localStorage.setItem(currentBookKey, bookId);
  state.chunkId = null;
  state.chunk = null;
  state.activeAnnotationId = null;
  state.replyDrafts = {};
  state.resumeCursor = null;
  clearSelectionAction();
  state.readingNote = null;
  state.readingNoteDirty = false;
  state.expandedChapterIds = new Set();
  state.frontMatterExpanded = false;
  state.appendixExpanded = false;
  $("reading-note-panel").hidden = true;
  state.chunks = await api(`/api/books/${encodeURIComponent(bookId)}/chunks`);
  state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(bookId)}`);
  const book = state.books.find((item) => item.bookId === bookId);
  const currentChapter = chapterForChunk(book?.lastChunkId);
  if (currentChapter?.chunks.length > 1) state.expandedChapterIds.add(currentChapter.id);
  if (currentChapter?.isFrontMatter) state.frontMatterExpanded = true;
  else if (currentChapter?.isAppendix) state.appendixExpanded = true;
  $("book-meta").textContent = book?.author || "Unknown author";
  $("book-title").textContent = tidyDisplayTitle(book?.title, book?.author) || bookId;
  $("chunk-file").textContent = "No chapter selected";
  $("chunk-title").textContent = "Open a chapter to start reading";
  $("running-head").hidden = true;
  $("text").innerHTML = `<p class="empty">Choose a chapter. Highlight text to leave a note for Codex.</p>`;
  $("mark-read").disabled = true;
  $("open-reading-note").disabled = true;
  $("continue-reading").disabled = false;
  document.body.classList.add("has-book");
  document.body.classList.remove("has-chunk");
  renderBooks();
  renderChunks();
  renderAnnotations();
  scrollToPanel(".chapters");
}

function clearBookSelection() {
  state.bookId = null;
  state.chunkId = null;
  state.chunk = null;
  state.annotations = [];
  state.chunks = [];
  state.activeAnnotationId = null;
  state.cardCandidates = [];
  state.replyDrafts = {};
  state.resumeCursor = null;
  clearSelectionAction();
  state.readingNote = null;
  state.readingNoteDirty = false;
  state.expandedChapterIds = new Set();
  state.frontMatterExpanded = false;
  state.appendixExpanded = false;
  $("reading-note-panel").hidden = true;
  $("book-meta").textContent = "Choose a book";
  $("book-title").textContent = "Reading shelf";
  $("chunk-file").textContent = "No chapter selected";
  $("chunk-title").textContent = "Open a chapter to start reading";
  $("running-head").hidden = true;
  $("text").innerHTML = `<p class="empty">Select a book and chapter. Highlight text to leave a note for Codex.</p>`;
  $("mark-read").disabled = true;
  $("open-reading-note").disabled = true;
  $("continue-reading").disabled = true;
  $("show-card").disabled = true;
  document.body.classList.remove("has-book", "has-chunk");
  renderBooks();
  renderChunks();
  renderAnnotations();
}

async function deleteBookFromShelf(bookId) {
  const book = state.books.find((item) => item.bookId === bookId);
  const label = book?.title || bookId;
  if (!confirm(`Delete "${label}" from this library?\n\nThe files and related notes will be archived under data/trash.`)) return;

  const result = await api(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  $("status").textContent = result.message || `Deleted ${label}.`;
  await loadBooks();
  if (state.bookId === bookId) clearBookSelection();
  renderBooks();
}

function highlightResumeAnchor(anchorText) {
  const needle = String(anchorText || "").trim();
  if (!needle) return false;
  const walker = document.createTreeWalker($("text"), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(".inline-note")) continue;
    const index = node.nodeValue.indexOf(needle);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + needle.length);
    const span = document.createElement("span");
    span.className = "resume-anchor";
    span.title = "上次读到这里";
    range.surroundContents(span);
    requestAnimationFrame(() => span.scrollIntoView({ block: "center", behavior: "smooth" }));
    return true;
  }
  return false;
}

function applyResumeCursor(cursor = state.resumeCursor) {
  if (!cursor?.anchorText) return;
  const matched = highlightResumeAnchor(cursor.anchorText);
  $("status").textContent = cursor.warning || (matched ? "已回到上次读到的句子。" : "已回到记录的最近位置，请核对原文。 ");
}

async function selectChunk(chunkId, cursor = null) {
  state.chunkId = chunkId;
  const selectedChapter = chapterForChunk(chunkId);
  if (selectedChapter?.chunks.length > 1) state.expandedChapterIds.add(selectedChapter.id);
  if (selectedChapter?.isFrontMatter) state.frontMatterExpanded = true;
  else if (selectedChapter?.isAppendix) state.appendixExpanded = true;
  clearSelectionAction();
  state.activeAnnotationId = null;
  state.chunk = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks/${encodeURIComponent(chunkId)}`);
  state.lastFinish = null;
  state.resumeCursor = cursor;
  $("chunk-file").textContent = state.chunk.chunk.id;
  $("chunk-title").textContent = state.chunk.chunk.title;
  renderRunningHead();
  $("mark-read").disabled = false;
  $("open-reading-note").disabled = false;
  $("continue-reading").disabled = false;
  document.body.classList.add("has-chunk");
  renderChunks();
  renderText();
  renderAnnotations();
  await loadReadingNote();
  refreshCards();
  applyResumeCursor();
  scrollToPanel(".reader");
}

function openNoteForm(quote, { mode = "codex", quoteOffset = null } = {}) {
  state.quote = quote.trim();
  state.noteMode = mode;
  state.quoteOffset = quoteOffset ?? (state.selectedQuote === state.quote ? state.selectedQuoteOffset : state.contextSelection?.quoteOffset ?? null);
  if (!state.bookId || !state.chunkId || !state.quote) return;
  $("quote-preview").textContent = state.quote;
  $("note").value = "";
  const personal = mode === "personal";
  $("note-form-title").textContent = personal ? "添加划线笔记" : "给 Codex 留言";
  $("note").placeholder = personal ? "记下你的理解、联想或想保留的讲解……" : "Leave a note for Codex...";
  $("note-submit").textContent = personal ? "保存划线笔记" : "发送给 Codex";
  $("selection-tools").hidden = true;
  $("text-context-menu").hidden = true;
  $("note-form").hidden = false;
  $("note").focus();
}

function closeNoteForm() {
  $("note-form").hidden = true;
  window.getSelection()?.removeAllRanges();
  clearSelectionAction();
}

function activateAnnotation(noteId, { scroll = false } = {}) {
  state.dismissedAnnotationIds.delete(noteId);
  state.activeAnnotationId = state.activeAnnotationId === noteId ? null : noteId;
  renderText();
  renderAnnotations();
  if (scroll && state.activeAnnotationId) {
    document.querySelector(`.note-card[data-note-id="${CSS.escape(noteId)}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

function isEditingDraft() {
  const active = document.activeElement;
  return Boolean(
    state.composing ||
      state.selectedQuote ||
      !$("note-form").hidden ||
      active?.matches?.("textarea, input") ||
      active?.closest?.(".reply-form, .note-form, .reading-note-panel"),
  );
}

async function refreshCurrent({ force = false } = {}) {
  if (state.refreshInFlight) return;
  if (!force && isEditingDraft()) return;
  state.refreshInFlight = true;
  try {
    await loadBooks();
    if (state.bookId) {
      if (!state.books.some((book) => book.bookId === state.bookId)) {
        clearBookSelection();
        $("status").textContent = "This book was deleted from the active library.";
        return;
      }
      state.chunks = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks`);
      state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(state.bookId)}`);
      renderBooks();
      renderChunks();
      renderText();
      renderAnnotations();
      refreshCards();
      applyResumeCursor();
    }
  } finally {
    state.refreshInFlight = false;
  }
}

$("books").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-book]");
  if (deleteButton) {
    deleteBookFromShelf(deleteButton.dataset.deleteBook).catch(showError);
    return;
  }
  const button = event.target.closest("[data-book]");
  if (button) selectBook(button.dataset.book).catch(showError);
});

$("chunks").addEventListener("click", (event) => {
  const appendixControl = event.target.closest("[data-appendix-toggle]");
  if (appendixControl) {
    const chapterId = appendixControl.dataset.appendixToggle;
    const isAppendix = appendixControl.dataset.nextAppendix === "true";
    appendixControl.disabled = true;
    api(`/api/books/${encodeURIComponent(state.bookId)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: "PATCH",
      body: { isAppendix },
    })
      .then(async () => {
        state.chunks = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks`);
        const changedChapter = chapterForChunk(chapterId);
        if (isAppendix && changedChapter?.isFrontMatter) state.frontMatterExpanded = true;
        else if (isAppendix) state.appendixExpanded = true;
        await loadBooks();
        renderChunks();
        showToast(isAppendix ? "已归入附录，不再计入阅读进度" : "已移出附录，重新计入阅读进度");
      })
      .catch(showError)
      .finally(() => {
        appendixControl.disabled = false;
      });
    return;
  }

  const appendixHeading = event.target.closest("[data-appendix-section-toggle]");
  if (appendixHeading) {
    state.appendixExpanded = !state.appendixExpanded;
    renderChunks();
    return;
  }

  const frontMatterHeading = event.target.closest("[data-frontmatter-section-toggle]");
  if (frontMatterHeading) {
    state.frontMatterExpanded = !state.frontMatterExpanded;
    renderChunks();
    return;
  }

  const chapterButton = event.target.closest("[data-chapter-toggle]");
  if (chapterButton) {
    const chapterId = chapterButton.dataset.chapterToggle;
    if (state.expandedChapterIds.has(chapterId)) state.expandedChapterIds.delete(chapterId);
    else state.expandedChapterIds.add(chapterId);
    renderChunks();
    return;
  }

  const button = event.target.closest("[data-chunk]");
  if (button) selectChunk(button.dataset.chunk).catch(showError);
});

$("text").addEventListener("mouseup", () => {
  updateSelectionAction();
});

$("text").addEventListener("touchend", () => {
  setTimeout(updateSelectionAction, 80);
});

document.addEventListener("selectionchange", () => updateSelectionAction({ preserve: true }));

$("selection-tools").addEventListener("pointerdown", (event) => {
  event.preventDefault();
});

document.addEventListener(
  "pointerdown",
  (event) => {
    const mark = event.target.closest?.("#text mark[data-note-id]");
    if (!mark || event.button !== 0) return;
    event.stopPropagation();
    activateAnnotation(mark.dataset.noteId, { scroll: true });
  },
  true,
);

$("cancel-note").addEventListener("click", () => {
  closeNoteForm();
});

$("close-note").addEventListener("click", () => {
  closeNoteForm();
});

$("open-reading-note").addEventListener("click", () => openReadingNote().catch(showError));
$("close-reading-note").addEventListener("click", () => {
  $("reading-note-panel").hidden = true;
});
$("save-reading-note").addEventListener("click", () => saveReadingNote().catch(showError));
$("reading-note-text").addEventListener("input", () => {
  state.readingNoteDirty = true;
  $("reading-note-status").textContent = "有尚未保存的修改";
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeTextContextMenu();
  closeNoteForm();
  $("card-panel").hidden = true;
  $("reading-note-panel").hidden = true;
});

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = $("note").value.trim();
  if (!note) return;
  const button = $("note-submit");
  const originalLabel = button.textContent;
  const personal = state.noteMode === "personal";
  let annotationSaved = false;
  button.disabled = true;
  button.textContent = personal ? "保存中…" : "发送中…";
  try {
    await api("/api/annotations", {
      method: "POST",
      body: {
        bookId: state.bookId,
        chunkId: state.chunkId,
        quote: state.quote,
        quoteOffset: state.quoteOffset,
        note,
        kind: personal ? "highlight_note" : "note",
        status: personal ? "saved" : "open",
      },
    });
    annotationSaved = true;
    const submission = personal ? null : await submitOpenNotes();
    closeNoteForm();
    await refreshCurrent({ force: true });
    if (personal) {
      showToast("划线笔记已保存");
    } else {
      const message = submission?.submissionId
        ? `已发送 ${submission.count} 条留言到 Codex 共读收件箱。`
        : submission?.message || "留言已发送。";
      $("status").textContent = message;
      showToast(`${message} 在 Codex 对话中说“查看我的共读留言”即可回复。`);
    }
  } catch (error) {
    showError(error);
    if (annotationSaved && !personal) {
      await refreshCurrent({ force: true }).catch(() => {});
      showToast("小纸条已保存，但暂时没有送达；可点击顶部“重新发送留言”。");
    } else {
      showToast(`保存失败：${error.message || error}`);
    }
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

$("margins").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-annotation]");
  if (deleteButton) {
    const card = deleteButton.closest(".note-card[data-note-id]");
    if (card?.dataset.noteId) deleteAnnotationById(card.dataset.noteId).catch(showError);
    return;
  }
  const closeButton = event.target.closest("[data-close-note-card]");
  if (closeButton) {
    const card = closeButton.closest(".note-card[data-note-id]");
    if (card?.dataset.noteId) state.dismissedAnnotationIds.add(card.dataset.noteId);
    if (state.activeAnnotationId === card?.dataset.noteId) state.activeAnnotationId = null;
    renderText();
    renderAnnotations();
    return;
  }
  if (event.target.closest("textarea, button")) return;
  const card = event.target.closest(".note-card[data-note-id]");
  if (card) activateAnnotation(card.dataset.noteId);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".reply-form");
  if (!form) return;
  event.preventDefault();
  const textarea = form.querySelector("textarea");
  const note = textarea.value.trim();
  if (!note) return;
  await api("/api/replies", {
    method: "POST",
    body: {
      parentId: form.dataset.parentId,
      note,
      author: "user",
      kind: "reply",
    },
  });
  textarea.value = "";
  delete state.replyDrafts[form.dataset.parentId];
  await refreshCurrent({ force: true });
});

document.addEventListener("input", (event) => {
  const textarea = event.target.closest("textarea");
  const form = event.target.closest(".reply-form");
  if (!textarea || !form) return;
  state.replyDrafts[form.dataset.parentId] = textarea.value;
});

document.addEventListener("compositionstart", (event) => {
  if (!event.target.closest?.(".reply-form, .note-form, .reading-note-panel")) return;
  state.composing = true;
});

document.addEventListener("compositionend", (event) => {
  if (!event.target.closest?.(".reply-form, .note-form, .reading-note-panel")) return;
  state.composing = false;
});

async function submitOpenNotes() {
  return api("/api/submit-notes", {
    method: "POST",
    body: {
      bookId: state.bookId,
      sessionId: "reader",
      contextMode: "chunk-once-per-session",
    },
  });
}

$("retry-notes").addEventListener("click", async () => {
  const button = $("retry-notes");
  button.disabled = true;
  button.textContent = "发送中…";
  try {
    const result = await submitOpenNotes();
    await refreshCurrent({ force: true });
    const message = result.submissionId
      ? `已发送 ${result.count} 条留言到 Codex 共读收件箱。`
      : result.message || "没有待发送的留言。";
    $("status").textContent = message;
    showToast(`${message} 在 Codex 对话中说“查看我的共读留言”即可回复。`);
  } catch (error) {
    showError(error);
    renderAnnotations();
    showToast(`发送失败：${error.message || error}`);
  } finally {
    button.disabled = false;
  }
});

$("personal-note-selection").addEventListener("click", () => {
  openNoteForm(quoteForNote(), { mode: "personal" });
});

$("codex-note-selection").addEventListener("click", () => {
  openNoteForm(quoteForNote(), { mode: "codex" });
});

async function savePlainHighlight(quoteInput, quoteOffset = null) {
  const quote = String(quoteInput || "").trim();
  if (!quote || !state.bookId || !state.chunkId) return;
  const duplicate = state.annotations.some(
    (item) =>
      item.chunkId === state.chunkId &&
      item.kind === "highlight" &&
      item.quote === quote &&
      (item.quoteOffset ?? null) === (quoteOffset ?? null),
  );
  if (duplicate) {
    showToast("这句话已经划过线了");
    return;
  }
  await api("/api/annotations", {
    method: "POST",
    body: {
      bookId: state.bookId,
      chunkId: state.chunkId,
      quote,
      quoteOffset,
      note: "仅划线",
      kind: "highlight",
      status: "saved",
    },
  });
  window.getSelection()?.removeAllRanges();
  clearSelectionAction();
  await refreshCurrent({ force: true });
  showToast("已划线");
}

async function deleteAnnotationById(annotationId) {
  const annotation = state.annotations.find((item) => item.id === annotationId);
  if (!annotation || !isOwnAnnotation(annotation)) {
    showToast("只能删除自己的划线或笔记");
    return;
  }
  const label = annotation.kind === "highlight" ? "这条划线" : "这条划线笔记";
  if (!confirm(`删除${label}？\n\n原始记录会保留在本地审计数据中。`)) return;
  await api(`/api/annotations/${encodeURIComponent(annotationId)}`, {
    method: "DELETE",
    body: { reason: "deleted by user in reader" },
  });
  if (state.activeAnnotationId === annotationId) state.activeAnnotationId = null;
  await refreshCurrent({ force: true });
  showToast(`已删除${label}`);
}

$("text").addEventListener("contextmenu", (event) => {
  const mark = event.target.closest?.("mark[data-note-id]");
  if (mark) {
    const annotation = state.annotations.find((item) => item.id === mark.dataset.noteId);
    if (!isOwnAnnotation(annotation)) return;
    event.preventDefault();
    deleteAnnotationById(mark.dataset.noteId).catch(showError);
    return;
  }
  const selection = window.getSelection();
  const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const details = selectedRange && pointInsideRange(selectedRange, event.clientX, event.clientY)
    ? selectionDetails(selection)
    : selectWordAtPoint(event.clientX, event.clientY);
  if (!details?.quote) return;
  event.preventDefault();
  openTextContextMenu(details, event.clientX, event.clientY);
});

$("text").addEventListener("copy", (event) => {
  const details = selectionDetails(window.getSelection());
  if (!details?.quote || !event.clipboardData) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", details.quote);
});

$("save-vocabulary").addEventListener("click", () => saveContextVocabulary().catch(showError));

$("copy-original").addEventListener("click", () => copyOriginalText().catch(showError));

$("context-highlight").addEventListener("click", () => {
  const details = state.contextSelection;
  if (!details) return;
  closeTextContextMenu();
  savePlainHighlight(details.quote, details.quoteOffset).catch(showError);
});

document.addEventListener("pointerdown", (event) => {
  if ($("text-context-menu").hidden || event.target.closest("#text-context-menu")) return;
  closeTextContextMenu();
});

window.addEventListener("resize", () => closeTextContextMenu());
document.addEventListener("scroll", () => closeTextContextMenu(), true);

$("mark-read").addEventListener("click", async () => {
  const result = await api("/api/mark-read", {
    method: "POST",
    body: { bookId: state.bookId, chunkId: state.chunkId },
  });
  state.lastFinish = result.finish || null;
  await refreshCurrent({ force: true });
  refreshCards({ finish: state.lastFinish, show: Boolean(state.lastFinish) });
  if (!state.lastFinish && state.cardCandidates.some((card) => card.source === "shared")) {
    showToast("收获了一枚回声书签");
  }
});

$("continue-reading").addEventListener("click", async () => {
  if (!state.bookId) return;
  const next = await api(`/api/continue?bookId=${encodeURIComponent(state.bookId)}`);
  const chunkId = next?.chunk?.chunk?.id || next?.chunk?.chunkId || next?.chunk?.id;
  if (!chunkId) {
    $("status").textContent = next?.message || "Nothing left to continue.";
    return;
  }
  await selectChunk(chunkId, next.cursor || null);
});

$("back-to-library").addEventListener("click", clearBookSelection);

$("refresh").addEventListener("click", () => refreshCurrent({ force: true }).catch(showError));

$("show-card").addEventListener("click", openCardPanel);

$("card-close").addEventListener("click", () => {
  $("card-panel").hidden = true;
});

$("card-random").addEventListener("click", () => {
  if (!state.cardCandidates.length) return;
  state.cardIndex = (state.cardIndex + 1) % state.cardCandidates.length;
  renderCardPanel();
});

$("import-book").addEventListener("click", () => {
  $("import-file").click();
});

$("import-file").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  $("import-book").disabled = true;
  try {
    const imported = [];
    for (const file of files) {
      $("status").textContent = `Importing ${file.name}...`;
      const manifest = await api("/api/import", {
        method: "POST",
        body: {
          filename: file.name,
          dataBase64: await fileToBase64(file),
        },
      });
      imported.push(manifest);
    }
    $("status").textContent = files.length === 1 ? `Imported ${files[0].name}.` : `Imported ${files.length} books.`;
    await loadBooks();
    renderBooks();
    if (imported.length === 1 && imported[0]?.bookId) {
      await selectBook(imported[0].bookId);
    }
  } catch (error) {
    showError(error);
  } finally {
    $("import-book").disabled = false;
    event.target.value = "";
  }
});

function showError(error) {
  $("status").textContent = error.message || String(error);
}

loadBooks()
  .then(() => {
    if (initialBookId && state.books.some((book) => book.bookId === initialBookId)) return selectBook(initialBookId);
  })
  .catch(showError);
setInterval(() => {
  if (document.hidden) return;
  refreshCurrent().catch(showError);
}, 5000);
