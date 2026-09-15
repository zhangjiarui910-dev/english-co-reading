# English Co-Reading chapter update

## What changed

- `src/store.js`
  - Detects appendix chapters conservatively from their normalized chapter title.
  - Calculates progress from content chunks only.
  - Keeps all original read chunk IDs intact.
  - Adds per-book `chapterAppendixOverrides` metadata only after a manual correction.
- `src/http-routes.js`
  - Adds one local API route for saving a chapter's appendix override.
- `public/reader.js`
  - Groups consecutive `Part x/y` chunks into collapsible chapters.
  - Opens the current reading chapter by default.
  - Adds a collapsed appendix section and manual move controls.
- `public/natural-editorial.css`
  - Styles chapter rows, nested parts, the appendix section, and correction controls.

## Data safety

- No annotation, reading-note, submission, or progress file format was changed.
- The real data directory was backed up before code changes.
- Critical data file hashes matched the backup after deployment.

## Live verification

- The Second Self: 17 chapters total, 14 content chapters visible, 15 appendix chunks, progress 1/76, 20 active note/reply records.
- The current chapter opens by default.
- Notes and Index are inside the collapsed appendix section.
- Three Codex replies remain available under their original notes.
- The Yellow Wallpaper: 9/9, never above 100%.
- Manual move in/out was tested on a data copy and persisted in the book manifest.
