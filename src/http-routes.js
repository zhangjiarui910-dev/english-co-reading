import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotatePassage,
  collectCard,
  continueReading,
  deleteAnnotation,
  deleteBook,
  dismissCard,
  getProgress,
  listCardInbox,
  listCardCollection,
  listCards,
  listAnnotations,
  listReadingNotes,
  listBooks,
  listChunks,
  markRead,
  readCard,
  readChunk,
  replyToAnnotation,
  resolveReadingCursor,
  saveReadingCursor,
  saveReadingNote,
  searchChunks,
  setChapterAppendixOverride,
  submitUserNotes,
} from "./store.js";
import { translateFoyerSentence } from "./foyer-translate.js";
import { importBook } from "./importer.js";
import { renderCardPng, renderCardSvg } from "./card-renderer.js";
import {
  confirmPracticeDraft,
  createPracticeDraft,
  discardPracticeDraft,
  exportReviewNotebook,
  listPracticeDrafts,
  listReviewItems,
  saveVocabulary,
  startReview,
  updatePracticeDraft,
  updateReviewItem,
} from "./learning-system.js";
import { isMultiuserEnabled, readUserIdFromRequest, runWithUser } from "./user-context.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(ROOT, "public");
const defaultMaxBodyBytes = Number(process.env.READING_HTTP_MAX_BODY_BYTES || process.env.READING_IMPORT_MAX_BYTES || 25_000_000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export async function readBody(req, { maxBytes = defaultMaxBodyBytes, allowEmpty = true } = {}) {
  const contentType = req.headers["content-type"] || "";
  if (contentType && !contentType.includes("application/json")) {
    const err = new Error("Content-Type must be application/json");
    err.statusCode = 415;
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  if (!chunks.length) {
    if (allowEmpty) return {};
    throw new Error("Missing JSON body");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function routeParts(url) {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

export async function handleApi(req, res, url, options = {}) {
  if (isMultiuserEnabled()) {
    const userId = readUserIdFromRequest(req);
    if (!userId) return sendError(res, 400, "Missing or invalid anonymous user id");
    return runWithUser(userId, () => handleApiRoutes(req, res, url, options));
  }
  return handleApiRoutes(req, res, url, options);
}

async function handleApiRoutes(req, res, url, options = {}) {
  const parts = routeParts(url);
  const maxBytes = options.maxBodyBytes || defaultMaxBodyBytes;

  if (req.method === "GET" && parts.length === 2 && parts[1] === "books") {
    return sendJson(res, 200, await listBooks({ includePrivate: true }));
  }

  if (req.method === "GET" && parts.length === 4 && parts[1] === "books" && parts[3] === "chunks") {
    return sendJson(res, 200, await listChunks(parts[2], { includePrivate: true }));
  }

  if (req.method === "PATCH" && parts.length === 5 && parts[1] === "books" && parts[3] === "chapters") {
    const body = await readBody(req, { maxBytes });
    return sendJson(res, 200, await setChapterAppendixOverride(parts[2], parts[4], body.isAppendix));
  }

  if (req.method === "DELETE" && parts.length === 3 && parts[1] === "books") {
    return sendJson(res, 200, await deleteBook(parts[2]));
  }

  if (req.method === "GET" && parts.length === 5 && parts[1] === "books" && parts[3] === "chunks") {
    return sendJson(res, 200, await readChunk(parts[2], parts[4]));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "continue") {
    return sendJson(res, 200, await continueReading({ bookId: url.searchParams.get("bookId") || undefined }));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "reading-position") {
    return sendJson(res, 200, await resolveReadingCursor({ bookId: url.searchParams.get("bookId") || undefined }));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "reading-position") {
    return sendJson(res, 200, await saveReadingCursor(await readBody(req, { maxBytes })));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "review") {
    return sendJson(res, 200, await listReviewItems({
      bookId: url.searchParams.get("bookId") || undefined,
      chunkId: url.searchParams.get("chunkId") || undefined,
      status: url.searchParams.get("status") || undefined,
      query: url.searchParams.get("q") || undefined,
      includeDeleted: url.searchParams.get("includeDeleted") === "true",
      limit: Number(url.searchParams.get("limit") || 500),
    }));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "vocabulary") {
    const item = await saveVocabulary(await readBody(req, { maxBytes }));
    return sendJson(res, item.alreadyExists ? 200 : 201, item);
  }

  if (req.method === "PATCH" && parts.length === 3 && parts[1] === "review") {
    return sendJson(res, 200, await updateReviewItem({ ...(await readBody(req, { maxBytes })), reviewId: parts[2] }));
  }

  if (req.method === "POST" && parts.length === 3 && parts[1] === "review" && parts[2] === "start") {
    return sendJson(res, 200, await startReview(await readBody(req, { maxBytes })));
  }

  if (req.method === "POST" && parts.length === 3 && parts[1] === "review" && parts[2] === "export") {
    return sendJson(res, 200, await exportReviewNotebook(await readBody(req, { maxBytes })));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "practice-drafts") {
    return sendJson(res, 200, await listPracticeDrafts({
      bookId: url.searchParams.get("bookId") || undefined,
      chunkId: url.searchParams.get("chunkId") || undefined,
      status: url.searchParams.get("status") || "pending",
    }));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "practice-drafts") {
    return sendJson(res, 201, await createPracticeDraft(await readBody(req, { maxBytes })));
  }

  if (req.method === "PATCH" && parts.length === 3 && parts[1] === "practice-drafts") {
    return sendJson(res, 200, await updatePracticeDraft({ ...(await readBody(req, { maxBytes })), draftId: parts[2] }));
  }

  if (req.method === "POST" && parts.length === 4 && parts[1] === "practice-drafts" && parts[3] === "confirm") {
    return sendJson(res, 200, await confirmPracticeDraft({ ...(await readBody(req, { maxBytes })), draftId: parts[2] }));
  }

  if (req.method === "POST" && parts.length === 4 && parts[1] === "practice-drafts" && parts[3] === "discard") {
    return sendJson(res, 200, await discardPracticeDraft({ ...(await readBody(req, { maxBytes })), draftId: parts[2] }));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "annotations") {
    return sendJson(
      res,
      200,
      await listAnnotations({
        bookId: url.searchParams.get("bookId") || undefined,
        chunkId: url.searchParams.get("chunkId") || undefined,
        kind: url.searchParams.get("kind") || undefined,
        author: url.searchParams.get("author") || undefined,
        status: url.searchParams.get("status") || undefined,
        parentId: url.searchParams.has("parentId") ? url.searchParams.get("parentId") : undefined,
        includePrivate: true,
      }),
    );
  }

  if (req.method === "DELETE" && parts.length === 3 && parts[1] === "annotations") {
    return sendJson(res, 200, await deleteAnnotation(parts[2], await readBody(req, { maxBytes, allowEmpty: true })));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "reading-notes") {
    return sendJson(
      res,
      200,
      await listReadingNotes({
        bookId: url.searchParams.get("bookId") || undefined,
        chunkId: url.searchParams.get("chunkId") || undefined,
      }),
    );
  }

  if (req.method === "PUT" && parts.length === 2 && parts[1] === "reading-notes") {
    return sendJson(res, 200, await saveReadingNote(await readBody(req, { maxBytes })));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "cards") {
    return sendJson(
      res,
      200,
      await listCards({
        bookId: url.searchParams.get("bookId") || undefined,
        chunkId: url.searchParams.get("chunkId") || undefined,
        source: url.searchParams.get("source") || undefined,
        limit: Number(url.searchParams.get("limit") || 20),
        offset: Number(url.searchParams.get("offset") || 0),
      }),
    );
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "card-collection") {
    return sendJson(
      res,
      200,
      await listCardCollection({
        bookId: url.searchParams.get("bookId") || undefined,
        limit: Number(url.searchParams.get("limit") || 12),
        offset: Number(url.searchParams.get("offset") || 0),
      }),
    );
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "card-inbox") {
    return sendJson(
      res,
      200,
      await listCardInbox({
        bookId: url.searchParams.get("bookId") || undefined,
        limit: Number(url.searchParams.get("limit") || 10),
      }),
    );
  }

  if (req.method === "GET" && parts.length === 4 && parts[1] === "cards" && parts[3] === "image.svg") {
    const card = await readCard(parts[2]);
    res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" });
    res.end(renderCardSvg(card));
    return;
  }

  if (req.method === "GET" && parts.length === 4 && parts[1] === "cards" && parts[3] === "image.png") {
    const card = await readCard(parts[2]);
    res.writeHead(200, { "content-type": "image/png" });
    res.end(renderCardPng(card));
    return;
  }

  if (req.method === "POST" && parts.length === 4 && parts[1] === "cards" && parts[3] === "dismiss") {
    return sendJson(res, 200, await dismissCard(parts[2]));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "cards") {
    const body = await readBody(req, { maxBytes });
    return sendJson(res, 201, await collectCard({ ...body, createdBy: body.createdBy || "human" }));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "annotations") {
    const body = await readBody(req, { maxBytes });
    return sendJson(
      res,
      201,
      await annotatePassage({
        ...body,
        author: body.author || "user",
        status: body.status || "open",
      }),
    );
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "replies") {
    const body = await readBody(req, { maxBytes });
    return sendJson(
      res,
      201,
      await replyToAnnotation({
        ...body,
        author: body.author || "user",
        kind: body.kind || "reply",
        status: body.status || "open",
      }),
    );
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "submit-notes") {
    return sendJson(res, 200, await submitUserNotes(await readBody(req, { maxBytes })));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "mark-read") {
    const body = await readBody(req, { maxBytes });
    return sendJson(res, 200, await markRead(body.bookId, body.chunkId));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "import") {
    return sendJson(res, 201, await importBook(await readBody(req, { maxBytes })));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "progress") {
    return sendJson(res, 200, await getProgress(url.searchParams.get("bookId") || undefined));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "translate") {
    const body = await readBody(req, { maxBytes });
    try {
      const translation = await translateFoyerSentence(body.text || body.quote || "");
      return sendJson(res, 200, { translation });
    } catch (_) {
      return sendJson(res, 200, { translation: "" });
    }
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "search") {
    return sendJson(
      res,
      200,
      await searchChunks({
        bookId: url.searchParams.get("bookId") || undefined,
        query: url.searchParams.get("q") || "",
        limit: Number(url.searchParams.get("limit") || 10),
      }),
    );
  }

  return sendError(res, 404, "Not found");
}

export async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "review.html" : url.pathname.slice(1);
  const resolved = path.resolve(publicDir, requested);
  const relative = path.relative(publicDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return sendError(res, 403, "Forbidden");
  }

  try {
    const body = await readFile(resolved);
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(resolved)] || "application/octet-stream",
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return sendError(res, 404, "Not found");
    throw error;
  }
}
