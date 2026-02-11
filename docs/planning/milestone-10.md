# Milestone 10: Pagination + Score Publishing Layout

This milestone introduces first-class page layout so rendered output can be compared credibly to published PDFs/images.

## Motivation
- Current renderer produces one long horizontal system by default, which blocks high-fidelity comparison against page-oriented references.
- Real-world proof-point `realworld-music21-bach-bwv1-6-8bars` shows this gap clearly: even with beaming and intrusion fixes, layout context (systems/pages/titles/part labels) differs substantially from reference engraving.

## External API references considered
- Verovio options expose explicit page/system controls and score metadata placement hooks (e.g. `pageWidth`, `pageHeight`, `adjustPageWidth`, `header`, `footer`, spacing knobs):  
  https://book.verovio.org/toolkit-reference/toolkit-options.html
- OpenSheetMusicDisplay exposes page format and score-info toggles (title/credits/part names/system labels) in render options:  
  https://opensheetmusicdisplay.github.io/classdoc/classes/OSMDOptions.html
- LilyPond engraving docs emphasize line/system breaking and spacing policy as core notation quality concerns:  
  https://lilypond.org/doc/v2.24/Documentation/notation/horizontal-spacing-overview

## Outcome
- Default render mode becomes paginated.
- Library still supports continuous horizontal rendering (`layout.mode = "horizontal-continuous"`).
- Score publishing elements (title, movement, part/staff labels, page numbers) are supported via explicit API.

## Proposed API direction

### Render option surface
- Add `layout` options to renderer API:
  - `mode`: `"paginated"` | `"horizontal-continuous"`
  - `page`: `{ width, height, margins }`
  - `system`: `{ targetMeasuresPerSystem?, minSystemGap?, justifyLastSystem? }`
  - `labels`: `{ showPartNames, showPartAbbreviations, repeatOnSystemBreak }`
  - `headerFooter`: `{ showTitle, showMovementTitle, showPageNumber, leftHeader?, rightHeader?, leftFooter?, rightFooter? }`

### Score metadata usage
- Reuse existing CSM metadata (`score.metadata.workTitle`, `movementTitle`) for page headers.
- Use `partList.name` / `abbreviation` for left-side system labels.

### Backward compatibility
- Keep top-level `paginate` temporarily as compatibility alias that maps into `layout.mode`.
- Preserve existing `renderToSVGPages` return shape.

## Track M10A: Page/Layout Model + API Spec
- Define renderer page/system model in code + docs.
- Add deterministic tests for option normalization/defaults.
- Document migration path from `paginate` boolean to `layout` object.

Exit checklist:
- [ ] API spec and option defaults documented.
- [ ] Compatibility behavior test-backed.

## Track M10B: Pagination Engine
- Implement system breaking across measures and parts/staves.
- Compute per-system widths and vertical flow across pages.
- Emit multiple SVG pages with deterministic page numbering.

Exit checklist:
- [ ] Multi-page rendering works on representative real-world fixtures.
- [ ] Continuous mode still supported and tested.
- [ ] System/page break behavior deterministic under fixed options.

## Track M10C: Publishing Elements
- Render page-level title/movement metadata.
- Render part/staff labels at system start (full name first system, optional abbreviation on following systems).
- Render page numbers/header/footer text hooks.

Exit checklist:
- [ ] Title + movement title + page number support landed.
- [ ] Part labels and abbreviation repeat policy landed.
- [ ] Overflow/collision checks include header/label zones.

## Track M10D: Quality + Golden Integration
- Extend `npm run test:golden` proof-points for paginated comparisons.
- Promote `realworld-music21-bach-bwv1-6-8bars` from advisory to blocking once pagination + labels are implemented.
- Add per-system excerpt comparison helpers for page-oriented references.

Exit checklist:
- [ ] Bach proof-point mismatch reduced to agreed threshold.
- [ ] At least one additional paginated real-world proof-point added and passing.

## Completion criteria
- [ ] Default rendering is paginated and documented.
- [ ] Horizontal continuous mode remains available and tested.
- [ ] Core publishing metadata (title/labels/page numbers) is available in public options.
- [ ] M10 doc renamed to `milestone-10.completed.md` with all references updated.
