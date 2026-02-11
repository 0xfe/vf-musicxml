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
- [x] API spec and option defaults documented.
- [x] Compatibility behavior test-backed.

## Track M10B: Pagination Engine
- Implement system breaking across measures and parts/staves.
- Compute per-system widths and vertical flow across pages.
- Emit multiple SVG pages with deterministic page numbering.

Exit checklist:
- [x] Multi-page rendering works on representative real-world fixtures.
- [x] Continuous mode still supported and tested.
- [x] System/page break behavior deterministic under fixed options.

## Track M10C: Publishing Elements
- Render page-level title/movement metadata.
- Render part/staff labels at system start (full name first system, optional abbreviation on following systems).
- Render page numbers/header/footer text hooks.

Exit checklist:
- [x] Title + movement title + page number support landed.
- [x] Part labels and abbreviation repeat policy landed.
- [ ] Overflow/collision checks include header/label zones.

## Track M10D: Quality + Golden Integration
- Extend `npm run test:golden` proof-points for paginated comparisons.
- Promote `realworld-music21-bach-bwv1-6-8bars` from advisory to blocking once pagination + labels are implemented.
- Add per-system excerpt comparison helpers for page-oriented references.

Exit checklist:
- [ ] Bach proof-point mismatch reduced to agreed threshold.
- [ ] At least one additional paginated real-world proof-point added and passing.

## Implementation status snapshot (2026-02-11)
- Landed:
  - `layout` render options and compatibility mapping from legacy `paginate`.
  - Paginated default rendering with explicit page/system planning and multi-page output.
  - Continuous mode (`horizontal-continuous`) preserved.
  - Parser/renderer now honor MusicXML `<print new-system/new-page>` directives for forced system/page starts.
  - Part labels rendered on system starts (name on first system, abbreviation on later systems).
  - Header/footer/title/page-number hooks are implemented.
  - Metadata title fallback from centered `<credit><credit-words>` is implemented for files without explicit `<work-title>`.
  - Explicit SVG page background rect (`mx-page-background`) is injected to stabilize headless/browser screenshots.
  - Paginated spanner pass now skips off-window anchors, removing false `SPANNER_ANCHOR_NOT_RENDERED` diagnostics.
- Remaining:
  - Tune default header/footer/page-number behavior against real-world fixtures and references.
  - Calibrate system-width/measure-width planning against source print geometry to improve proof-point parity.
  - Continue reducing proof-point metric noise by combining deterministic system-window auto-crop with stronger alignment/region comparison (current auto-crop baseline: `mismatchRatio=0.214865`, `ssim=0.189070`, advisory fail).
  - Add deterministic header/label collision zones to geometry/style checks.
  - Reduce `realworld-music21-bach-bwv1-6-8bars` mismatch (currently advisory fail) to blocking-grade threshold.

## Latest M10D note (2026-02-11, later run)
- Added parser/model capture of MusicXML `measure@width` (`sourceWidthTenths`) and renderer column-width weighting from those hints (median across parts per column).
- Result: first-page/system spacing is modestly closer to source geometry (`inspect:score` spacing ratio improved from `1.173` to `1.1411`), but Bach proof-point remains advisory fail (`mismatchRatio=0.214798`, `ssim=0.192180`).
- Added parser support for MusicXML defaults `system-layout/system-margins` and applied those margins in paginated content-width planning (avoids over-shrinking systems when label columns are enabled and source system margins are present).
- Result after system-margin alignment + header-including auto-crop tuning: Bach proof-point improved to `mismatchRatio=0.203193` (still advisory fail; `ssim=0.151874`).
- Golden runner now reports both raw and structural mismatch metrics; current structural mismatch for Bach is high (`0.688990`) and will be used as diagnostic evidence, not blocking criteria, until alignment/scoring calibration is completed.
- Added parser/model support for note-level `default-x` + explicit stem direction capture from MusicXML so source engraving hints are available for future spacing/stem parity tuning.
- Added renderer stem-direction mapping (`<stem>up/down` -> VexFlow `stem_direction`) and switched beam generation to preserve authored stem directions during automatic beam grouping.
- Added parser/model support for authored beam tokens and renderer preference for source beam grouping (currently level-1 begin/continue/end), with deterministic regression tests to avoid beam-shape drift regressions.
- Fixed a beaming regression where flagged glyphs remained visible on beamed notes by preparing beam objects before voice draw (VexFlow flag suppression timing); added deterministic conformance gating for expected-pass flag/beam overlaps.
- Added optional centroid-based comparison alignment in headless visual tooling and golden proof-point pipeline:
  - `normalization.alignByInkCentroid`
  - `normalization.maxAlignmentShift`
  - `normalization.alignmentAxis` (`x`, `y`, `both`)
- Bach proof-point now records alignment telemetry (`alignmentShiftX`, `alignmentShiftY`) and currently runs with horizontal-only alignment (`alignmentAxis: "x"`).

## Latest M10D note (2026-02-11, current run)
- Added adaptive inter-part spacing in renderer layout planning:
  - part-level complexity scoring from dense rhythms/chords/beam/slur activity.
  - inter-part gap now expands for dense adjacent parts (`resolveInterPartGap`), reducing note/curve overlap pressure between stacked parts.
- Hardened label rendering under source system margins:
  - label wrapping width is constrained to the actual left-of-notation lane.
  - truncation/wrapping now avoids left-edge clipping without shrinking notation content width.
- Improved slur curve routing for mixed-stem and cross-voice scenarios:
  - slur side now prefers explicit placement, otherwise chooses the side with lower endpoint skew.
  - anchor-delta diagnostics now use side-aware endpoint anchors aligned with VexFlow curve positioning.
  - prior guards for extreme/mixed-stem deltas remain in place.
- Expanded deterministic curve-anomaly detection in geometry tooling:
  - supports both absolute (`C`) and relative (`c`) cubic path parsing.
  - broadens coverage for diagonal cut-through slur regressions in headless quality tests.
- Added/updated deterministic regression coverage:
  - `tests/integration/public-api.test.ts` now checks adaptive inter-part gap expansion.
  - `tests/integration/render-quality-regressions.test.ts` now asserts stable first-measure spacing on `realworld-music21-bach-bwv1-6`.
  - `tests/unit/notation-geometry.test.ts` now validates relative cubic path detection.
- Current proof-point snapshot:
  - `realworld-music21-bach-bwv1-6`: spacing ratio `1.0395`, no beam/flag regressions.
  - `realworld-music21-beethoven-op133-longform` page 1: `extremeCurveCount=0`.
  - `realworld-music21-beethoven-op18no1-m1` page 1: `extremeCurveCount=0` (large cut-through slur resolved), but spacing compression remains (`first/median ratio=0.6459`).

## Completion criteria
- [ ] Default rendering is paginated and documented.
- [ ] Horizontal continuous mode remains available and tested.
- [ ] Core publishing metadata (title/labels/page numbers) is available in public options.
- [ ] M10 doc renamed to `milestone-10.completed.md` with all references updated.
