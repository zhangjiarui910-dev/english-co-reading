# English Co-Reading: Natural Editorial Redesign

## Design direction

The interface is read as a quiet literary workspace for language learners. Its visual references are vintage museum posters, herbarium sheets, faded ceramic tiles, archival paper, and restrained editorial typography.

- Design variance: 7
- Motion intensity: 3
- Visual density: 5
- Theme: light only
- Primary accent: muted brick red
- Supporting neutrals: paper, olive, faded tile blue
- Shape system: nearly square, 2px radius

## Functional improvements

- The original reader now uses a stable reading column with a dedicated marginalia rail on wide screens.
- The library and chapter list behave like a printed index rather than a stack of floating cards.
- The review notebook uses editorial rules, dividers, and whitespace to clarify hierarchy.
- Filters remain sticky but are presented as a compact catalogue strip.
- Existing IDs, routes, controls, data flow, and learning behavior are preserved.
- Responsive layouts collapse to one reading column with no horizontal overflow.
- Focus states and reduced-motion behavior are explicitly supported.

## Files

- `public/natural-editorial.css`: the new visual theme
- `public/reader.html`: loads the theme and declares the reader page scope
- `public/review.html`: loads the theme and declares the review page scope
- `public/review.js`: replaces ambiguous empty dashes with `未记录`

## Verification

- Browser-tested at 1280 x 720 and a narrow mobile breakpoint.
- No horizontal overflow was found.
- No browser console errors or warnings were found.
- JavaScript syntax checks passed.
- English-learning, learning-system, and card smoke tests passed.
- The legacy general smoke test still fails on an existing stale markup assertion. The same failure reproduces on the untouched installed version.
