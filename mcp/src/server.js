#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotatePassage,
  collectCard,
  continueReading,
  dataDir,
  deleteBook,
  dismissCard,
  getProgress,
  listCardInbox,
  listCardCollection,
  listCards,
  listAnnotations,
  listBooks,
  listChunks,
  listSubmissions,
  markRead,
  readCard,
  readChunk,
  readSubmission,
  replyToAnnotation,
  resolveReadingCursor,
  saveReadingCursor,
  searchChunks,
  submitUserNotes,
} from "./store.js";
import {
  appendImportPart,
  beginImport,
  cancelImport,
  finishImport,
  importBook,
} from "./importer.js";
import { renderCardImageContent, saveCardImage } from "./card-renderer.js";
import {
  confirmPracticeDraft,
  createPracticeDraft,
  discardPracticeDraft,
  exportReviewNotebook,
  getLearningProfile,
  learningDashboard,
  listPracticeDrafts,
  listReviewItems,
  listVocabulary,
  logPractice,
  migrateLearningData,
  readStudyPassage,
  saveVocabulary,
  setLearningProfile,
  startReview,
  updatePracticeDraft,
  updateReviewItem,
} from "./learning-system.js";

const protocolVersion = "2024-11-05";

export const tools = [
  {
    name: "english_read_passage",
    description: "Open or resume a study-sized passage of 80-800 words. If chunkId/startWord are omitted, recover the exact saved sentence. The displayed start is saved automatically without marking the chunk complete.",
    inputSchema: {
      type: "object",
      required: ["bookId"],
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        startWord: { type: "number" },
        maxWords: { type: "number" },
        autoSave: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Read English Study Passage", readOnlyHint: true },
  },
  {
    name: "english_save_vocabulary",
    description: "Save one word, phrase, or expression from the current passage to the learner's vocabulary notebook.",
    inputSchema: {
      type: "object",
      required: ["bookId", "term"],
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        term: { type: "string" },
        context: { type: "string" },
        learnerGuess: { type: "string" },
        meaning: { type: "string" },
        pronunciation: { type: "string" },
        note: { type: "string" },
        status: { type: "string", enum: ["new", "learning", "known"] },
        nextReviewAt: { type: "string" },
        inputMode: { type: "string", enum: ["typed", "speech"] },
        explanation: {
          type: "object",
          properties: {
            literalMeaning: { type: "string" },
            naturalChinese: { type: "string" },
            contextInference: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Save Vocabulary" },
  },
  {
    name: "english_list_vocabulary",
    description: "List or search saved vocabulary, optionally filtered by book and learning status.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        status: { type: "string", enum: ["new", "learning", "known"] },
        query: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "List Vocabulary", readOnlyHint: true },
  },
  {
    name: "english_log_practice",
    description: "Save a learner retelling, answer, translation, sentence, or discussion response together with feedback.",
    inputSchema: {
      type: "object",
      required: ["bookId", "learnerText"],
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        activity: { type: "string", enum: ["retell", "answer", "translation", "sentence", "discussion"] },
        sourceText: { type: "string" },
        learnerText: { type: "string" },
        recommendedText: { type: "string" },
        feedback: { type: "string" },
        corrections: { type: "array", items: { type: "string" } },
        strengths: { type: "array", items: { type: "string" } },
        inputMode: { type: "string", enum: ["typed", "speech"] },
        confirmationStatus: { type: "string", enum: ["confirmed"] },
        rawTranscript: { type: "string" },
        errorClassification: { type: "string", enum: ["speech_to_text_error", "learner_language_error", "uncertain", "confirmed_correct"] },
        explanation: {
          type: "object",
          properties: {
            literalMeaning: { type: "string" },
            naturalChinese: { type: "string" },
            contextInference: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Log English Practice" },
  },
  {
    name: "english_save_reading_position",
    description: "Save the exact sentence/word cursor after a small passage is actually completed. This does not mark a whole chunk read unless completedChunk is explicitly true.",
    inputSchema: {
      type: "object",
      required: ["bookId", "chunkId", "startWord", "endWord"],
      properties: {
        bookId: { type: "string" }, chunkId: { type: "string" }, startWord: { type: "number" }, endWord: { type: "number" },
        recentText: { type: "string" }, completedChunk: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Save Exact Reading Position" },
  },
  {
    name: "english_get_reading_position",
    description: "Resolve the exact saved reading sentence, recovering it after re-import or chunk-layout changes when possible.",
    inputSchema: { type: "object", required: ["bookId"], properties: { bookId: { type: "string" } }, additionalProperties: false },
    annotations: { title: "Get Exact Reading Position", readOnlyHint: true },
  },
  {
    name: "english_create_practice_draft",
    description: "Save speech-to-text output as a pending draft. It is excluded from the review notebook until explicitly confirmed.",
    inputSchema: {
      type: "object", required: ["bookId", "rawTranscript"],
      properties: {
        bookId: { type: "string" }, chunkId: { type: "string" }, activity: { type: "string", enum: ["retell", "answer", "translation", "sentence", "discussion"] },
        sourceText: { type: "string" }, rawTranscript: { type: "string" }, editedText: { type: "string" }, feedback: { type: "string" }, recommendedText: { type: "string" },
        corrections: { type: "array", items: { type: "string" } }, strengths: { type: "array", items: { type: "string" } },
        errorClassification: { type: "string", enum: ["speech_to_text_error", "learner_language_error", "uncertain", "confirmed_correct"] },
        explanation: { type: "object", properties: { literalMeaning: { type: "string" }, naturalChinese: { type: "string" }, contextInference: { type: "string" } }, additionalProperties: false },
      }, additionalProperties: false,
    }, annotations: { title: "Create Speech Practice Draft" },
  },
  {
    name: "english_list_practice_drafts",
    description: "List speech-input drafts by pending, confirmed, or discarded status.",
    inputSchema: { type: "object", properties: { bookId: { type: "string" }, chunkId: { type: "string" }, status: { type: "string", enum: ["pending", "confirmed", "discarded"] } }, additionalProperties: false },
    annotations: { title: "List Practice Drafts", readOnlyHint: true },
  },
  {
    name: "english_update_practice_draft",
    description: "Correct the recognized text or classification of a pending speech draft before confirmation.",
    inputSchema: { type: "object", required: ["draftId"], properties: { draftId: { type: "string" }, editedText: { type: "string" }, sourceText: { type: "string" }, feedback: { type: "string" }, recommendedText: { type: "string" }, corrections: { type: "array", items: { type: "string" } }, strengths: { type: "array", items: { type: "string" } }, errorClassification: { type: "string", enum: ["speech_to_text_error", "learner_language_error", "uncertain", "confirmed_correct"] }, explanation: { type: "object", properties: { literalMeaning: { type: "string" }, naturalChinese: { type: "string" }, contextInference: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
    annotations: { title: "Update Practice Draft" },
  },
  {
    name: "english_confirm_practice_draft",
    description: "Confirm a corrected speech draft. Only the confirmed version enters formal practice and review; the raw transcript remains for traceability.",
    inputSchema: { type: "object", required: ["draftId"], properties: { draftId: { type: "string" }, confirmedText: { type: "string" }, errorClassification: { type: "string", enum: ["speech_to_text_error", "learner_language_error", "uncertain", "confirmed_correct"] }, feedback: { type: "string" }, recommendedText: { type: "string" }, corrections: { type: "array", items: { type: "string" } }, strengths: { type: "array", items: { type: "string" } }, explanation: { type: "object", properties: { literalMeaning: { type: "string" }, naturalChinese: { type: "string" }, contextInference: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
    annotations: { title: "Confirm Practice Draft" },
  },
  {
    name: "english_discard_practice_draft",
    description: "Discard an incorrect speech draft without deleting its audit trail or adding it to review.",
    inputSchema: { type: "object", required: ["draftId"], properties: { draftId: { type: "string" }, reason: { type: "string" } }, additionalProperties: false },
    annotations: { title: "Discard Practice Draft" },
  },
  {
    name: "english_review_notebook",
    description: "Open the human-readable cumulative review notebook data, filtered by book, chapter, status, or search text. Only confirmed practice is included.",
    inputSchema: { type: "object", properties: { bookId: { type: "string" }, chunkId: { type: "string" }, status: { type: "string", enum: ["new", "learning", "known"] }, query: { type: "string" }, includeDeleted: { type: "boolean" }, limit: { type: "number" } }, additionalProperties: false },
    annotations: { title: "My Review Notebook", readOnlyHint: true },
  },
  {
    name: "english_update_review_item",
    description: "Edit, soft-delete, restore, or change the review status and next review time without rewriting the immutable source JSONL.",
    inputSchema: { type: "object", required: ["reviewId"], properties: { reviewId: { type: "string" }, term: { type: "string" }, pronunciation: { type: "string" }, meaning: { type: "string" }, context: { type: "string" }, learnerText: { type: "string" }, recommendedText: { type: "string" }, feedback: { type: "string" }, strengths: { type: "array", items: { type: "string" } }, corrections: { type: "array", items: { type: "string" } }, status: { type: "string", enum: ["new", "learning", "known"] }, nextReviewAt: { type: "string" }, reviewRating: { type: "string", enum: ["forgot", "fuzzy", "remembered", "mastered"] }, deleted: { type: "boolean" }, restore: { type: "boolean" }, privateNote: { type: "string" }, explanation: { type: "object", properties: { literalMeaning: { type: "string" }, naturalChinese: { type: "string" }, contextInference: { type: "string" } }, additionalProperties: false } }, additionalProperties: false },
    annotations: { title: "Update Review Item" },
  },
  {
    name: "english_start_review",
    description: "Start a review session with due/new/learning confirmed items.",
    inputSchema: { type: "object", properties: { bookId: { type: "string" }, chunkId: { type: "string" }, status: { type: "string", enum: ["new", "learning", "known"] }, query: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
    annotations: { title: "Start Review", readOnlyHint: true },
  },
  {
    name: "english_export_review",
    description: "Export a clean Markdown or HTML review notebook. Public exports remove local usernames, absolute paths, internal IDs, and private notes.",
    inputSchema: { type: "object", properties: { format: { type: "string", enum: ["markdown", "html"] }, title: { type: "string" }, bookId: { type: "string" }, chunkId: { type: "string" }, status: { type: "string", enum: ["new", "learning", "known"] }, query: { type: "string" } }, additionalProperties: false },
    annotations: { title: "Export Review Notebook" },
  },
  {
    name: "english_migrate_learning_data",
    description: "Run the idempotent v2 compatibility migration. Original vocabulary and practice JSONL files are preserved unchanged.",
    inputSchema: { type: "object", properties: { dryRun: { type: "boolean" } }, additionalProperties: false },
    annotations: { title: "Migrate Learning Data" },
  },
  {
    name: "english_set_profile",
    description: "Set the learner's English level, session length, goals, explanation language, and correction style.",
    inputSchema: {
      type: "object",
      properties: {
        targetLevel: { type: "string" },
        explanationLanguage: { type: "string" },
        sessionWords: { type: "number" },
        goals: { type: "array", items: { type: "string" } },
        correctionStyle: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Set English Learning Profile" },
  },
  {
    name: "english_get_profile",
    description: "Get the current English learning profile.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Get English Learning Profile", readOnlyHint: true },
  },
  {
    name: "english_learning_dashboard",
    description: "Summarize vocabulary status, due reviews, recent practice, and the learning profile.",
    inputSchema: {
      type: "object",
      properties: { bookId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "English Learning Dashboard", readOnlyHint: true },
  },
  {
    name: "reading_list_books",
    description: "List imported books with progress and annotation counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { title: "List Books", readOnlyHint: true },
  },
  {
    name: "reading_list_chunks",
    description: "List chunks for a book in reading order.",
    inputSchema: {
      type: "object",
      required: ["bookId"],
      properties: { bookId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "List Chunks", readOnlyHint: true },
  },
  {
    name: "reading_read_chunk",
    description: "Read one book chunk and return prevId/nextId.",
    inputSchema: {
      type: "object",
      required: ["bookId", "chunkId"],
      properties: { bookId: { type: "string" }, chunkId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Read Chunk", readOnlyHint: true },
  },
  {
    name: "reading_continue",
    description:
      "Continue reading from the next unread chunk. If bookId is omitted, use the most recently read book.",
    inputSchema: {
      type: "object",
      properties: { bookId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Continue Reading", readOnlyHint: true },
  },
  {
    name: "reading_search_chunks",
    description: "Search book chunks by keyword.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        bookId: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Search Chunks", readOnlyHint: true },
  },
  {
    name: "reading_import_book",
    description:
      "Import one EPUB, text-based PDF, TXT, or Markdown file from base64 content into the reading library. Scanned PDFs require OCR first.",
    inputSchema: {
      type: "object",
      required: ["filename", "dataBase64"],
      properties: {
        filename: { type: "string" },
        dataBase64: { type: "string" },
        format: { type: "string", enum: ["epub", "pdf", "txt", "text", "md", "markdown"] },
        bookId: { type: "string" },
        title: { type: "string" },
        author: { type: "string" },
        maxChars: { type: "number" },
        headingRegex: { type: "string" },
        minSectionChars: { type: "number" },
        overwrite: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Import Book" },
  },
  {
    name: "reading_import_begin",
    description:
      "Start a chunked EPUB/PDF/TXT/Markdown import. Use this when the file is too large for one reading_import_book request.",
    inputSchema: {
      type: "object",
      required: ["filename"],
      properties: {
        filename: { type: "string" },
        format: { type: "string", enum: ["epub", "pdf", "txt", "text", "md", "markdown"] },
        expectedBytes: { type: "number" },
        bookId: { type: "string" },
        title: { type: "string" },
        author: { type: "string" },
        maxChars: { type: "number" },
        headingRegex: { type: "string" },
        minSectionChars: { type: "number" },
        overwrite: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Begin Import" },
  },
  {
    name: "reading_import_part",
    description: "Append one base64 file part to an active chunked import.",
    inputSchema: {
      type: "object",
      required: ["uploadId", "dataBase64"],
      properties: {
        uploadId: { type: "string" },
        dataBase64: { type: "string" },
        index: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Import Part" },
  },
  {
    name: "reading_import_finish",
    description: "Finish a chunked import and add the uploaded EPUB/PDF/TXT/Markdown file to the reading library.",
    inputSchema: {
      type: "object",
      required: ["uploadId"],
      properties: { uploadId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Finish Import" },
  },
  {
    name: "reading_import_cancel",
    description: "Cancel a chunked import and delete its temporary upload file.",
    inputSchema: {
      type: "object",
      required: ["uploadId"],
      properties: { uploadId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Cancel Import" },
  },
  {
    name: "reading_delete_book",
    description:
      "Delete a book from the active library and archive its book folder plus related progress, annotations, submissions, and cards under data/trash. Requires confirm: true.",
    inputSchema: {
      type: "object",
      required: ["bookId", "confirm"],
      properties: {
        bookId: { type: "string" },
        confirm: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Delete Book", destructiveHint: true },
  },
  {
    name: "reading_annotate_passage",
    description: "Write a Codex margin annotation anchored to a quote in a chunk. Human private notes should be created through the HTTP reader API, not this MCP tool.",
    inputSchema: {
      type: "object",
      required: ["bookId", "chunkId", "quote", "note"],
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        quote: { type: "string" },
        quoteOffset: { type: "number" },
        note: { type: "string" },
        kind: { type: "string" },
        mood: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        parentId: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Annotate Passage" },
  },
  {
    name: "reading_list_annotations",
    description: "List annotations, optionally filtered by book, chunk, kind, or author.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        kind: { type: "string" },
        author: { type: "string" },
        status: { type: "string" },
        parentId: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { title: "List Annotations", readOnlyHint: true },
  },
  {
    name: "reading_submit_user_notes",
    description:
      "Submit open user notes for Codex review. By default, include each chunk's full text once per session and mark notes submitted so they are not sent again.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        sessionId: { type: "string" },
        contextMode: {
          type: "string",
          enum: ["chunk-once-per-session", "chunk-always", "notes-only"],
        },
        includeContext: { type: "boolean" },
        forceChunkContext: { type: "boolean" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Submit User Notes" },
  },
  {
    name: "reading_list_submissions",
    description: "List human note submission batches that have been shared with Codex.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        sessionId: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "List Submissions", readOnlyHint: true },
  },
  {
    name: "reading_read_submission",
    description: "Read one human note submission batch including notes and context.",
    inputSchema: {
      type: "object",
      required: ["submissionId"],
      properties: { submissionId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Read Submission", readOnlyHint: true },
  },
  {
    name: "reading_reply_to_annotation",
    description: "Attach a Codex reply under an existing user or assistant annotation.",
    inputSchema: {
      type: "object",
      required: ["parentId", "note"],
      properties: {
        parentId: { type: "string" },
        note: { type: "string" },
        kind: { type: "string" },
        mood: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        bookId: { type: "string" },
        chunkId: { type: "string" },
        quote: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Reply To Annotation" },
  },
  {
    name: "reading_mark_read",
    description: "Mark a chunk as read and update last-read progress.",
    inputSchema: {
      type: "object",
      required: ["bookId", "chunkId"],
      properties: { bookId: { type: "string" }, chunkId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Mark Read" },
  },
  {
    name: "reading_card_inbox",
    description: "Show unread collected reading-card prompts, like a small bookmark inbox.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Reading Card Inbox", readOnlyHint: true },
  },
  {
    name: "reading_card_collection",
    description: "Browse collected reading cards as a paginated collection without opening every image.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Reading Card Collection", readOnlyHint: true },
  },
  {
    name: "reading_open_card",
    description: "Open one collected reading card and return it as an image for Codex to view.",
    inputSchema: {
      type: "object",
      required: ["cardId"],
      properties: { cardId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Open Reading Card", readOnlyHint: true },
  },
  {
    name: "reading_save_card",
    description: "Render one collected reading card to a local image file and return its absolute path.",
    inputSchema: {
      type: "object",
      required: ["cardId"],
      properties: { cardId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Save Reading Card" },
  },
  {
    name: "reading_dismiss_card",
    description: "Dismiss one collected reading card from the card inbox without deleting it.",
    inputSchema: {
      type: "object",
      required: ["cardId"],
      properties: { cardId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Dismiss Reading Card" },
  },
  {
    name: "reading_list_cards",
    description: "List collected ritual reading cards/bookmarks for completed sections or shared margin moments.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        source: { type: "string" },
        scope: { type: "string", enum: ["section", "book"] },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { title: "List Reading Cards", readOnlyHint: true },
  },
  {
    name: "reading_collect_card",
    description: "Collect a small ritual reading card/bookmark so it can be revisited later.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        chunkId: { type: "string" },
        bookTitle: { type: "string" },
        chunkTitle: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string" },
        kicker: { type: "string" },
        quote: { type: "string" },
        note: { type: "string" },
        footer: { type: "string" },
        art: { type: "string", enum: ["fold", "ripple", "stardust", "lastfold"] },
        variant: { type: "string" },
        scope: { type: "string", enum: ["section", "book"] },
        source: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { title: "Collect Reading Card" },
  },
  {
    name: "reading_get_progress",
    description: "Get reading progress for one book or all books.",
    inputSchema: {
      type: "object",
      properties: { bookId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { title: "Get Progress", readOnlyHint: true },
  },
];

function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textContent(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function imageContent({ text, image }) {
  return {
    content: [
      { type: "text", text },
      image,
    ],
  };
}

export async function callTool(name, args = {}) {
  switch (name) {
    case "english_read_passage":
      return textContent(await readStudyPassage(args));
    case "english_save_vocabulary":
      return textContent(await saveVocabulary(args));
    case "english_list_vocabulary":
      return textContent(await listVocabulary(args));
    case "english_log_practice":
      return textContent(await logPractice(args));
    case "english_save_reading_position":
      return textContent(await saveReadingCursor(args));
    case "english_get_reading_position":
      return textContent(await resolveReadingCursor(args));
    case "english_create_practice_draft":
      return textContent(await createPracticeDraft(args));
    case "english_list_practice_drafts":
      return textContent(await listPracticeDrafts(args));
    case "english_update_practice_draft":
      return textContent(await updatePracticeDraft(args));
    case "english_confirm_practice_draft":
      return textContent(await confirmPracticeDraft(args));
    case "english_discard_practice_draft":
      return textContent(await discardPracticeDraft(args));
    case "english_review_notebook":
      return textContent(await listReviewItems(args));
    case "english_update_review_item":
      return textContent(await updateReviewItem(args));
    case "english_start_review":
      return textContent(await startReview(args));
    case "english_export_review":
      return textContent(await exportReviewNotebook(args));
    case "english_migrate_learning_data":
      return textContent(await migrateLearningData(args));
    case "english_set_profile":
      return textContent(await setLearningProfile(args));
    case "english_get_profile":
      return textContent(await getLearningProfile());
    case "english_learning_dashboard":
      return textContent(await learningDashboard(args));
    case "reading_list_books":
      return textContent(await listBooks());
    case "reading_list_chunks":
      return textContent(await listChunks(args.bookId));
    case "reading_read_chunk":
      return textContent(await readChunk(args.bookId, args.chunkId));
    case "reading_continue":
      return textContent(await continueReading(args));
    case "reading_search_chunks":
      return textContent(await searchChunks(args));
    case "reading_import_book":
      return textContent(await importBook(args));
    case "reading_import_begin":
      return textContent(await beginImport(args));
    case "reading_import_part":
      return textContent(await appendImportPart(args));
    case "reading_import_finish":
      return textContent(await finishImport(args));
    case "reading_import_cancel":
      return textContent(await cancelImport(args));
    case "reading_delete_book":
      if (args.confirm !== true) throw new Error("reading_delete_book requires confirm: true");
      return textContent(await deleteBook(args.bookId));
    case "reading_annotate_passage":
      return textContent(await annotatePassage({ ...args, author: "claude", status: "published" }));
    case "reading_list_annotations":
      return textContent(await listAnnotations(args));
    case "reading_submit_user_notes":
      return textContent(await submitUserNotes(args));
    case "reading_list_submissions":
      return textContent(await listSubmissions(args));
    case "reading_read_submission":
      return textContent(await readSubmission(args.submissionId));
    case "reading_reply_to_annotation":
      return textContent(await replyToAnnotation({ ...args, author: "claude", status: "published" }));
    case "reading_mark_read":
      return textContent(await markRead(args.bookId, args.chunkId));
    case "reading_card_inbox":
      return textContent(await listCardInbox(args));
    case "reading_card_collection":
      return textContent(await listCardCollection(args));
    case "reading_open_card": {
      const card = await readCard(args.cardId);
      return imageContent({
        text: `${card.kicker || "收获了一枚回声书签"}\n${card.title || card.bookTitle || "Reading card"}`,
        image: renderCardImageContent(card),
      });
    }
    case "reading_save_card": {
      const card = await readCard(args.cardId);
      const saved = saveCardImage(card, path.join(dataDir, "card-exports"));
      return textContent({
        cardId: card.id,
        ...saved,
        hint: "Attach or send this local file path from the host environment when your client supports file sending.",
      });
    }
    case "reading_dismiss_card":
      return textContent(await dismissCard(args.cardId));
    case "reading_list_cards":
      return textContent(await listCards(args));
    case "reading_collect_card":
      return textContent(await collectCard({ ...args, createdBy: "claude" }));
    case "reading_get_progress":
      return textContent(await getProgress(args.bookId));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return null;

  if (message.method === "initialize") {
    return result(message.id, {
      protocolVersion,
      serverInfo: { name: "english-co-reading", version: "0.1.0" },
      capabilities: { tools: {} },
      instructions:
        `Use this server as a shared English-learning reading room and long-term review system. Read study-sized passages with english_read_passage, let the learner attempt comprehension before explaining, and preserve the book's ideas and tone instead of reducing reading to vocabulary drills. Save exact progress with english_save_reading_position only after each small passage is actually completed. ` +
        `For every explanation, clearly separate Literal meaning, Natural Chinese, and Context / literary inference; never present a literary inference as the only fixed grammar meaning. Save only learner-selected or clearly useful expressions with english_save_vocabulary. ` +
        `Typed practice can use english_log_practice. Speech-to-text must first use english_create_practice_draft; only english_confirm_practice_draft may add the confirmed version to formal practice. Classify issues as speech_to_text_error, learner_language_error, uncertain, or confirmed_correct. ` +
        `Use english_review_notebook and english_start_review for confirmed study records, and english_export_review for privacy-safe Markdown/HTML. Use english_learning_dashboard to resume. ` +
        `The general reading_* tools remain available for books, progress, search, annotations, notes, and imports. ` +
        `Codex can import EPUB, text-based PDF, TXT, and Markdown uploads, continue reading, read chunked books, search passages, track progress, leave margin annotations, ` +
        `reply under user notes, and call reading_submit_user_notes when the human sends staged notes. ` +
        `Reading actions may return cardNotification when a bookmark card is waiting; open it with reading_open_card, save it to a local file with reading_save_card, or clear it with reading_dismiss_card. Use reading_card_collection to browse cards by pages without loading every image. ` +
        `Use reading_import_book for small uploads, or reading_import_begin/part/finish for large files. ` +
        `If this server is running through src/server-sse.js, the same process can also serve the human reader at /, REST API at /api/*, SSE MCP at /sse, and JSON-RPC POST at /mcp. ` +
        `Data dir: ${dataDir}`,
    });
  }

  if (message.method === "notifications/initialized") {
    return null;
  }

  if (message.method === "tools/list") {
    return result(message.id, { tools });
  }

  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params || {};
    return result(message.id, await callTool(name, args || {}));
  }

  return error(message.id, -32601, `Method not found: ${message.method}`);
}

export function startStdioServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const response = await handle(JSON.parse(line));
      if (response) output.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      let id = null;
      try {
        id = JSON.parse(line).id ?? null;
      } catch {
        // Keep id null for parse errors.
      }
      output.write(`${JSON.stringify(error(id, -32000, err.message || String(err)))}\n`);
    }
  });

  return rl;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startStdioServer();
}
