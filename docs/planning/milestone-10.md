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
- Resolve active left-bar squeeze/overflow regressions on dense real-world fixtures via generalized spacing logic (no fixture-specific patches).
- Resolve dynamic-glyph lane collisions (`f/sf/...`) with deterministic overlap gates.

Exit checklist:
- [ ] Bach proof-point mismatch reduced to agreed threshold.
- [ ] At least one additional paginated real-world proof-point added and passing.
- [x] `realworld-music21-bach-bwv244-10` and `realworld-music21-mozart-k458-m1` pass left-bar compression/overflow gates.
- [ ] Dynamic-glyph lanes pass deterministic collision thresholds on style proof-points.

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

## Latest M10D note (2026-02-11, follow-up run)
- Fixed multi-staff clef-state drift that caused wrong-register rendering in real-world piano fixtures:
  - parser now merges partial clef updates by staff (instead of replacing full clef arrays),
  - clef parsing now falls back to source order (`1..N`) when multiple unnumbered clefs appear,
  - renderer clef resolution now avoids cross-staff fallback leakage and supports small mid-system clef-change glyphs.
- Revalidated proof-points after clef fixes:
  - `realworld-music21-schumann-clara-polonaise-op1n1` no longer exhibits the prior staff-clef swap behavior.
  - `realworld-music21-mozart-k545-exposition` no longer exhibits clef/register drift across systems.
- Text/readability hardening updates are now in place for M8/M9 overlap areas:
  - `lilypond-61b-multiplelyrics` uses overlap-aware lyric row packing and currently reports zero text overlaps in deterministic inspection.
  - `lilypond-71g-multiplechordnames` uses improved harmony stacking/spacing and currently reports zero text overlaps in deterministic inspection.
- Unsupported-duration fallback behavior for `lilypond-03a-rhythm-durations` now skips unsupported explicit note types with diagnostics (`UNSUPPORTED_DURATION_TYPE_SKIPPED`) rather than coercing quarter-note fallbacks.
- Demo-page overflow hardening:
  - demo HTML now enforces `overflow-x: hidden` at page and surface levels to prevent horizontal blank-scroll artifacts in browser demo review.

## Latest M10D note (2026-02-12)
- Demo viewport tuning for review ergonomics:
  - demo rendering scale set to `0.7`,
  - SVG trimming now anchors to notation geometry and includes only nearby text bounds (so large header/footer/page-number whitespace no longer dominates short fixtures).
- LilyPond category UX now surfaces both ID and title (`Category 31 - Dynamics and other single symbols`, etc.) on index/roadmap/demo pages.
- Expanded complex real-world coverage by importing and activating:
  - `realworld-music21-beethoven-op59no2-m1`
  - `realworld-music21-mozart-k458-m1`
  - `realworld-music21-bach-bwv244-10`

## Latest M10D note (2026-02-12, follow-up run)
- Category-31/32 readability hardening:
  - direction text rendering now uses overlap-aware row packing above the stave,
  - chord-shared articulation/ornament modifiers are deduplicated to prevent duplicate symbol stacking on chord noteheads,
  - note-specific technical text/fingering labels are compacted when multiple tokens share one anchor.
- Deterministic gate expansion:
  - added integration quality checks for `31a-Directions` and `32a-Notations` text-overlap budgets and unsupported-notation diagnostics.
- Current inspection deltas:
  - `31a-Directions` text overlaps reduced from `13` to `7`.
  - `32a-Notations` text overlaps reduced from `21` to `4`.
- Remaining explicit unsupported notation in category 32: `NON_ARPEGGIATE_UNSUPPORTED` (tracked as VexFlow gap `VF-GAP-002`).

## Latest M10D note (2026-02-12, current run)
- Closed the main left-bar squeeze regression path with a generalized layout fix (no fixture conditionals):
  - `expandColumnWidthsToFit(...)` now receives minimum-width constraints and preserves first-column floor protections during justify-path shrink.
  - first-column justification floor is bounded against even-split width so opening bars stay readable without starving later bars.
- Proof-point telemetry after the fix:
  - `realworld-music21-mozart-k458-m1`: `barlineIntrusions=0`, `compressed bands=0/8`, `min band ratio=0.9161`.
  - `realworld-music21-bach-bwv244-10`: `barlineIntrusions=0`, `compressed bands=0/8`, `min band ratio=1.0`.
  - `lilypond-03a-rhythm-durations`: still overflow-clean (`barlineIntrusions=0`, `compressed bands=0/2`).
- Remaining M10D blocker focus is now dynamic/text lane collisions (`B-012`) plus residual Schumann dense-band/tie spacing (`B-007`).

## Latest M10D note (2026-02-12, follow-up run)
- Added stronger generalized first-column density safeguards in `src/vexflow/render.ts`:
  - denser opening bars receive bounded extra width and higher readability floor without disabling authored width hints,
  - all adjustments remain proportional and fixture-agnostic.
- Added expanded grand-staff intra-gap pressure signals (cross-staff octave proximity + curved-relation emphasis) to reduce residual treble/bass crowding in dense piano systems.
- Added local dense-measure adaptive system splitting in pagination planning so dense windows can render with fewer measures per system instead of compressing first bars.
- Proof-point revalidation snapshot:
  - `realworld-music21-bach-bwv244-10`: `barlineIntrusions=0`, `compressed bands=0/4`, `min band ratio=1.0`.
  - `realworld-music21-mozart-k458-m1`: `barlineIntrusions=0`, `compressed bands=0/8`.
  - `lilypond-03a-rhythm-durations`: `barlineIntrusions=0`, `compressed bands=0/3`.
  - `lilypond-01a-pitches-pitches`: `barlineIntrusions=0`, no compressed bands.
  - `realworld-music21-schumann-clara-polonaise-op1n1`: still `compressed bands=1/4` (`min band ratio=0.695`), but visual page-level crowding reduced.
- Validation: `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run demos:build` all pass after these updates.
- Direction-lane correctness fix:
  - direction events without explicit staff targets now render once on the top staff for multi-staff parts (instead of duplicating on every staff),
  - this removes a generalized source of duplicated dynamics/text glyph collisions in piano/ensemble pages.
- Regression-gate hardening:
  - tightened page-1 spacing checks for `realworld-music21-mozart-k458-m1` and `realworld-music21-bach-bwv244-10` (zero compressed bands expected),
  - tightened category-31 direction overlap budgets (text and dynamics/text) to `<= 4`.

## Latest M10D note (2026-02-13)
- Density-aware spacing telemetry refinement:
  - extended spacing-band summaries with per-band note-count context and `firstToMedianOtherEstimatedWidthRatio`,
  - switched `inspect:score` compressed-band classification to use width-ratio (fallback to gap-ratio only when width-ratio is unavailable).
- Why: raw first-bar gap ratio alone over-reports compression in dense opening bars (many noteheads can produce smaller mean gaps without true width starvation).
- Deterministic coverage:
  - added unit regression in `tests/unit/notation-geometry.test.ts` proving that dense first measures can have low raw gap ratio (`0.5`) while width-ratio remains healthy (`1.25`).
  - updated integration proof-point spacing gates in `tests/integration/render-quality-regressions.test.ts` to use width-ratio classification (fallback to gap ratio).
- Proof-point snapshot after the telemetry update:
  - `realworld-music21-schumann-clara-polonaise-op1n1`: `compressed(<0.75 width-ratio)=0/4`, `minGapRatio=0.695`, `minWidthRatio=1.1583`.
  - `realworld-music21-bach-bwv244-10`: `compressed(<0.75 width-ratio)=0/4`.
  - `realworld-music21-mozart-k458-m1`: `compressed(<0.75 width-ratio)=0/8`.
- Validation: `npm run test:unit -- tests/unit/notation-geometry.test.ts`, `npm run test:integration`, `npm run lint`, `npm run typecheck`, and `npm run demos:build` all pass.

## Latest M10D note (2026-02-13, direction-lane follow-up)
- Continued `B-012` mitigation with generalized direction/dynamics lane tuning in `src/vexflow/render-notations-text.ts`:
  - increased row spacing for dense direction stacks,
  - adjusted above/below dynamics baseline shifts to reduce cross-lane collisions,
  - deduplicated direction words when they are dynamics-equivalent to parsed dynamics markers.
- Category-31 regression checks now pass with tighter observed metrics:
  - `text overlaps=0`
  - `dynamics-to-text overlaps=4` (within gate budget).
- Category-32 remains inside current text-overlap budget (`overlaps=4`).
- Validation: `npm run test:integration -- tests/integration/render-quality-regressions.test.ts`, `npm run test`, and `npm run demos:build` all pass.

## Latest M10D note (2026-02-13, harmony-label readability follow-up)
- Continued `B-012` mitigation with generalized harmony-label rendering updates in `src/vexflow/render-notations-text.ts`:
  - harmony row packing now uses style-accurate bold/italic width measurement (matching the actual drawn chord-symbol font),
  - harmony row spans now include explicit side padding to avoid near-touch overlap misses,
  - harmony row search budget was increased so dense chord systems can spill into extra rows instead of colliding.
- Added compact harmony-kind formatting for long MusicXML kind labels (for example `major-seventh -> maj7`, `minor -> m`, `dominant -> 7`) while preserving explicitly styled custom text where present.
- Follow-up system-gap tuning in `src/vexflow/render.ts` now separates lane-collision pressure (lyrics/harmony/direction words) from dynamics-only pressure so automatic inter-system expansion prioritizes actual collision drivers.
- Proof-point snapshot after this pass:
  - `71f-allchordtypes`: `text overlaps=0` (from `1`, historical baseline `10`),
  - `71g-multiplechordnames`: `text overlaps=0`,
  - `31d-directions-compounds`: remains bounded (`text overlaps=1`).
- Validation: `npm run lint`, `npm run typecheck`, `npm run test` (23 files / 140 tests), and `npm run demos:build` all pass.

## Latest M10D note (2026-02-13, spacing telemetry + vertical spread follow-up)
- Tuned inter-part spacing sensitivity for ledger-heavy writing in `src/vexflow/render.ts`:
  - `estimatePartVerticalSpread` now blends average spread, peak spread, and elevated-spread prevalence so sparse-but-extreme register passages are not diluted in long parts.
  - `resolveInterPartGap` now weights `verticalSpread` more strongly (`*42`) to reduce adjacent-system crowding on extreme pitch fixtures.
- Added deterministic integration coverage in `tests/integration/public-api.test.ts` that proves adjacent-part gap expansion for extreme-register passages.
- Refined spacing-band telemetry in `src/testkit/notation-geometry.ts`:
  - sparse first measures are no longer treated as compressed solely because they contain fewer noteheads than later measures.
  - note-count normalization for `firstToMedianOtherEstimatedWidthRatio` now applies only when the first measure is denser than the comparison baseline.
- Added unit coverage for sparse-opening classification in `tests/unit/notation-geometry.test.ts`.
- Post-fix headless check: `lilypond-01a-pitches-pitches` now reports `minWidthRatio=1` and `compressed(<0.75 width-ratio)=0/5` (previously false-positive `2/5`) with unchanged intrusion/collision cleanliness.
- Validation: `npm run test -- tests/unit/notation-geometry.test.ts`, `npm run test -- tests/integration/public-api.test.ts`, `npm run test -- tests/integration/render-quality-regressions.test.ts`, `npm run lint`, `npm run typecheck`, and `npm run demos:build` all pass.

## Latest M10D note (2026-02-12, text-lane routing hardening)
- Generalized text-lane routing was hardened in `src/vexflow/render-notations-text.ts` and `src/vexflow/render.ts`:
  - per-system lane state now persists across adjacent measures for directions, harmonies, and lyrics,
  - row packing now uses interval occupancy checks instead of right-edge-only checks (order-independent and safer for non-monotonic event ordering),
  - direction bottom-lane offset and lyric/harmony row spacing were increased to reduce inter-lane collisions in text-dense fixtures.
- Added deterministic integration guard for category-31d (`31d-directions-compounds`) with overlap budget `<= 4`.
- Headless inspection trend after this pass:
  - `31d-directions-compounds`: overlaps `8 -> 4`
  - `71f-allchordtypes`: overlaps `10 -> 5`
  - `31a-Directions`: remains `0`
  - `61b-multiplelyrics`: remains `0`

## Latest M10D note (2026-02-12, cross-system text-lane spacing follow-up)
- Added a generalized inter-system spacing safeguard in `src/vexflow/render.ts`:
  - when `layout.system.minSystemGap` is not explicitly pinned, system gap now auto-expands from score-level text pressure (`partLayout.textAnnotationPressure`) with bounded clamps,
  - this addresses cross-system collisions where lower text lanes in one system overlap upper text lanes in the next.
- Added deterministic regression guard for `71f-allchordtypes` in `tests/integration/render-quality-regressions.test.ts` (`text overlaps <= 3`).
- Headless inspection trend after this follow-up:
  - `71f-allchordtypes`: overlaps `5 -> 1`
  - `31d-directions-compounds`: overlaps `4 -> 1`
  - `31a-Directions`: overlaps `2`
  - `61b-multiplelyrics`: overlaps `0`
- Revalidated conformance report (`npm run test:conformance:report`): expected-pass quality summary remains stable with no critical collisions.

## Completion criteria
- [ ] Default rendering is paginated and documented.
- [ ] Horizontal continuous mode remains available and tested.
- [ ] Core publishing metadata (title/labels/page numbers) is available in public options.
- [ ] M10D blocker bugs (`B-003`, `B-007`, `B-011`, `B-012`) are closed or explicitly waived with rationale.
- [ ] M10 doc renamed to `milestone-10.completed.md` with all references updated.
