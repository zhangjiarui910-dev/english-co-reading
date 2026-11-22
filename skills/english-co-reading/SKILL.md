---
name: english-co-reading
description: Read English books collaboratively for language learning, with short source passages, idea-first discussion, selective vocabulary support, learner retelling, and saved progress. Use when the user wants to start or continue an English book to improve English; do not use for ordinary research reading without a language-learning goal.
---

# English Co-Reading

Use the bundled `english_co_reading` MCP as a persistent reading room. Keep the book's ideas, voice, and emotional or intellectual interest central; language practice should deepen the reading rather than replace it.

## Start or resume

1. Read `english_get_profile` and `english_learning_dashboard`.
2. Use `reading_list_books`. If there is no book, help the user import an EPUB, text-based PDF, TXT, or Markdown file with the reading import tools. Scanned PDFs require OCR before import.
3. Resume with `english_read_passage({ bookId })` so the stable sentence anchor is resolved. Do not guess a chunk beginning from `lastChunkId`.
4. If the tool reports a relocation or nearest-position warning after a re-import, tell the user and show the recovered sentence for confirmation. Never silently jump to a different passage.
5. Default to about 300 words. After the learner actually finishes each small passage, call `english_save_reading_position` with the returned `startWord` and `endWord`. Merely displaying a passage saves its start, not its end.

## Guide the reading

- Present the original passage cleanly. Let the learner read or react before translating or explaining everything.
- Ask one natural comprehension or interpretation question at a time. Match the user's energy; discussion may be literary, philosophical, historical, or personal.
- Explain difficult sentences in three explicitly labelled layers:
  - `Literal meaning`: lexical meaning, reference, and syntactic structure.
  - `Natural Chinese`: a context-appropriate Chinese rendering.
  - `Context / literary inference`: tone, characterization, subtext, or other interpretation. Present this as an inference, not as the only fixed grammar meaning.
- For example, explain `if I feel so` literally as “if I have/continue to have that feeling,” then give the natural Chinese in its sentence, and only then explain why the context may suggest “if I let the feeling develop.”
- Distinguish a genuine misunderstanding from an English-expression problem. Correct the latter without treating the learner's idea as wrong.
- Prefer a few reusable words, collocations, phrasal verbs, or sentence patterns over exhaustive vocabulary lists. Save items with `english_save_vocabulary` when the learner chooses them or they are clearly worth retaining.
- Invite a short English retelling, answer, translation, sentence, or discussion response when it fits. Give specific feedback while preserving the learner's voice.
- Typed learner output may be recorded with `english_log_practice`. If the input came from speech recognition, never save the transcript directly as a learner error. First call `english_create_practice_draft`, keep the raw transcript, and ask for confirmation when recognition is uncertain.
- Use `english_update_practice_draft` for corrections, then `english_confirm_practice_draft` only after the learner confirms the text. Use `english_discard_practice_draft` for unusable recognition. Classify the result as `speech_to_text_error`, `learner_language_error`, `uncertain`, or `confirmed_correct`.

## Preserve continuity

- Use `reading_annotate_passage` for ideas tied to a quotation and the English vocabulary tools for language items; do not mix them indiscriminately.
- Browser `Send to Codex` submissions are durable local inbox items, not unsolicited push messages into a chat. When the user says they sent a note, asks whether it arrived, or asks to check co-reading messages, call `reading_list_submissions`, read the newest relevant batch with `reading_read_submission`, answer the question, and save the answer under the original annotation with `reading_reply_to_annotation`. Tell the user clearly if the current task has not loaded these tools yet and a new Codex task is required.
- Mark a chunk read only after the learner has actually finished it.
- At the end of a session, briefly recap the idea discussed, useful language retained, and the exact next reading position. Do not manufacture progress or save every incidental correction.

## Review notebook

- Use `english_review_notebook` for confirmed vocabulary and practice. Filter by book, chapter, learning status, or search text.
- Use `english_start_review` for a review session. `english_update_review_item` can edit, soft-delete, restore, mark `known`, or keep an item `learning` with a new review date. Source JSONL stays intact.
- The human-readable web entry is `/` on the local server and opens the compact review notebook first. The optional original-text reader is `/reader.html`; it uses a calm two-column layout whose narrow navigation panel switches between the book shelf and chapter list, while keeping anchored margin notes and Codex submission controls. The notebook includes a dedicated vocabulary-and-phrases shelf, visible confirmation after `known` / `learning` updates, pending speech confirmation, editing, filters, review mode, privacy-safe Markdown/HTML export, a 9:16 PNG share-card preview, and an interactive five-beat recording mode.
- Use `english_export_review` for shareable Markdown or HTML. Exports must exclude usernames, absolute paths, internal IDs, and private notes by default.

If the user wants research-oriented reading of humanities or social-science material without English practice, leave this workflow and use their separate general co-reading system.
