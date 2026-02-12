# Planning Status

This file is the current snapshot of planning state. Update this first as milestones progress.

## Status

- Last updated: 2026-02-12 (US, 11:40 EST)
- Planning location: all planning artifacts now live under `/Users/mo/git/musicxml/docs/planning/`.
- Current state: M0-M7 are completed. M8 is active (M8A done, M8B/M8C incremental slices landed). M9 is active for style-fidelity planning/execution in parallel with M8 remediation. M10 is active with M10A/M10B implementation in place and M10C/M10D quality hardening in progress; latest slices added richer category-31/32 notation mapping (articulations/ornaments/vibrato/strokes/technical tokens), workspace-portable gap-registry validation, denser horizontal planning for rhythm-heavy measures, stronger intra-staff spacing heuristics for grand-staff writing, smarter demo-page bounds trimming, and deterministic category-31/32 text-overlap gates with reduced overlap pressure (`31a: 13 -> 7`, `32a: 21 -> 4`). Demo scale is now `0.7` for generated demo pages. M11 planning is opened for auto-format/layout optimization follow-on work.
- Review integration: Feedback items `F-001` through `F-024` are accepted and incorporated across the planning docs.

### Next step when execution continues:
  1. Continue M8B: extend geometry rule packs beyond current spacing/intrusion tooling (presence + justification + text clearances).
  2. Continue M8C: calibrate golden excerpt alignment and thresholds, then expand coverage from proof-points to broader fixture waves.
  3. Execute M9A/M9B: land style rule catalog and wire style diagnostics into deterministic quality gates.
  4. Continue M10C/M10D: improve page-level fidelity (system width calibration + print-geometry alignment), reduce Bach proof-point mismatch, and promote proof-point policy from advisory toward blocking.
  5. Continue Schumann/Beethoven residual vertical-collision tuning (tie/slur + cross-staff spacing) and promote deterministic staff-gap gates.
  6. Resolve B-003 spacing calibration for `realworld-music21-beethoven-op18no1-m1` and promote the resulting rule into M8/M9 spacing gates.
  7. Close remaining category-32 `NON_ARPEGGIATE_UNSUPPORTED` gap with a generalized rendering strategy (or explicit VexFlow patch) and wire it into upstream gap tracking.
  8. Keep M11 in planning-only state until M8/M9/M10 current slices are closed, then begin M11A telemetry/objective work.

## Milestone progress:

| Milestone | Name | Status | Notes |
|---|---|---|---|
| M0 | Repo Foundation + Core Test Harness | Completed | All scoped deliverables and validation checks passed. |
| M1 | Parser Core + Canonical Score Model | Completed | Baseline partwise parser + ADR + diagnostics/docs/test gates landed. |
| M2 | Basic Rendering Adapter | Completed | Single-part/staff render path, API wiring, SVG + visual smoke coverage, rendering doc landed. |
| M3 | Rhythm, Timewise Conversion, Collision Audits | Completed | Timewise normalization + `.mxl` decode + timing hardening + collision helper + conformance metadata/report wiring + visual sentinel snapshots completed. |
| M4 | Notations and Directions | Completed | Ties/slurs/articulations/dynamics/tempo/wedges baseline with parser-model-render coverage, tests, and docs landed. |
| M5 | Multi-Part Layout, Text, and Modularization Decision | Completed | Multi-part/staff layout + connector semantics + lyric/harmony baseline + modularization decision delivered with test/docs gates. |
| M6 | Advanced Notation Coverage | Completed | Grace/cue/ornament/tuplet/repeat+ending baseline with deterministic tests, conformance fixture promotion, and fallback policy docs landed. |
| M7 | Full Conformance + Quality Program (Umbrella) | Completed | All M7 tracks (`M7A`-`M7D`) are complete with executable gates, reports, and lifecycle tooling. |
| M7A | Corpus Comprehensiveness | Completed | Canonical collated corpus manifest + full LilyPond conformance import (156 active fixtures), expanded real-world onboarding (8 fixtures including lead-sheet/orchestral + long-form chamber coverage), explicit `23c` malformed-source waiver policy, and executable M7A threshold gates are in place. |
| M7B | Quality Rubric + Deterministic Quality Gates | Completed | Deterministic quality scoring (`Q1..Q7`) integrated into conformance reports with executable gates (weighted mean, catastrophic-readability, critical-collision). |
| M7C | Layered Evaluation Framework | Completed | Layered evaluator (`eval:run`) landed with dataset splits, deterministic split gates, perceptual metrics hooks, model-audit prompt/schema versioning, and triage artifacts. |
| M7D | VexFlow Gap Upstreaming + Release Hardening | Completed | VexFlow gap registry + validation tooling, upstream brief generation, sync log, and release-hardening checklist are in place and test-backed. |
| M8 | Golden-Driven Visual Quality Program | In Progress | M8A LilyPond golden mapping baseline landed (156 fixtures; v2.24 primary + explicit v2.25 fallback tags). M8B first slice landed: first-measure spacing normalization for `01a` plus deterministic spacing-ratio tooling. |
| M9 | Engraving Style Fidelity Program | In Progress | New style-focused milestone created with source-linked rulebook, proof-point fixtures, deterministic style-gate plan, and wave-based burndown checklist. |
| M10 | Pagination + Publishing Layout | In Progress | M10A/M10B baseline landed (paginated default, continuous mode fallback, system/page planning, multi-page SVG output). M10C/M10D quality/fidelity hardening remains active. |
| M11 | Auto-Formatting + Layout Optimization | Planned | Planning doc created; implementation deferred until current M8/M9/M10 active slices are closed. |



### Completed in this phase

  - Reviewed VexFlow build/test model and integration constraints.
  - Reviewed official MusicXML references (spec/tutorials/examples/XSD links).
  - Reviewed LilyPond collated MusicXML regression corpus and test-suite resources.
  - Revised architecture/API/testing milestones based on review feedback.
  - Completed M0 with project/test/CI/conformance harness scaffold and passing checks.
  - Completed M1 parser baseline (`saxes` AST + AST-to-CSM transform + strict/lenient diagnostics and tests).
  - Completed M2 rendering baseline (single-part mapper, renderer APIs, headless SVG tests, Playwright visual smoke harness, rendering pipeline docs).
  - Expanded M3 `.mxl` edge-case coverage (missing rootfile target, malformed `container.xml`, unsupported compression, truncated archive).
  - Added conformance collision-audit metadata schema/loader support and headless report function (`runConformanceCollisionAudit`).
  - Added first conformance execution workflow test that runs active fixtures through parse/render and collision-audit gates.
  - Added staged conformance fixtures for `timewise` and `rhythm` categories and wired execution report artifacts (`json` + `markdown`).
  - Added active expected-fail conformance fixtures and updated report/execution semantics to validate expected vs observed outcomes.
  - Added conformance report diagnostic histograms (parse/render code counts + severity counts) for triage acceleration.
  - Added conformance report category rollups (pass/fail and diagnostic counts by fixture category).
  - Added Playwright visual sentinel tests for active pass fixtures in `smoke`, `timewise`, and `rhythm` categories.
  - Added fixture-level `parse_mode` support for strict/lenient conformance execution and notation strict-vs-lenient expected behavior fixtures.
  - Added visual snapshot baselines for smoke + conformance sentinel suites via `test:visual:update`.
  - Added agent acceleration docs (`ai-state.md` + dependency tips under `docs/`).
  - Completed M4 parser/model support for direction dynamics/wedges, note slurs, and cross-event spanner linking (`tie`/`slur`/`wedge`) with strict-mode diagnostics.
  - Completed M4 renderer support for articulation mapping, direction text placement, and tie/slur/wedge spanner drawing with graceful degradation diagnostics.
  - Added notation baseline conformance fixture (`notation-m4-baseline`) and expanded integration/unit/svg/conformance/visual tests to cover M4 behavior.
  - Added notation support matrix documentation and refreshed parser/render/diagnostic docs for the M4 baseline.
  - Started M5 renderer layout baseline: multi-part stacking, multi-staff routing (`staves`), and stave connector rendering (`singleLeft`, `brace`, score-level `bracket`).
  - Added M5 layout conformance fixture (`layout-m5-multipart-baseline`) and promoted it into conformance execution and visual sentinel browser snapshots.
  - Added M5 staff-routing tests across unit/integration/svg layers while preserving deterministic headless gates.
  - Completed M5 lyric/harmony baseline parsing and rendering (`<harmony>`, `<lyric>`) with deterministic headless text placement and diagnostics.
  - Added part-group parsing (`part-group` start/stop + symbol mapping) and wired connector rendering from parsed group metadata.
  - Added text-focused conformance fixture (`text-m5-lyrics-harmony-baseline`) with collision-audit selector on `text` and visual sentinel snapshot coverage.
  - Added M5 docs gates: layout heuristics and modularization decision notes.
  - Completed M6 parser/model support for grace notes (`<grace>`), cue notes (`<cue>`), ornaments (`<notations><ornaments>`), tuplet endpoints/ratios (`<tuplet>` + `<time-modification>`), and repeat/ending barline metadata.
  - Completed M6 renderer support for grace-note attachment (`GraceNoteGroup`), cue-size behavior, ornament mapping, tuplet drawing, and baseline repeat/ending stave semantics (`BarlineType`/`VoltaType`).
  - Added M6 advanced conformance fixture (`advanced-m6-notation-baseline`) and expanded unit/integration/svg/conformance coverage for each advanced construct.
  - Added M6 advanced fallback policy doc (`docs/advanced-notation-policy.md`) and refreshed notation/rendering/tips docs plus AI handoff state.
  - Replaced hand-authored demos with canonical LilyPond fixture downloads (`01c`, `71g`) and added `demos/lilypond/manifest.json` plus generated `lilypond-roadmap.html` for category-level coverage planning.
  - Researched quality and evaluation references for engraving/readability, visual diffing, cross-renderer parity, and model-assisted assessment.
  - Added M7 strategy document (now split across `docs/planning/milestone-7.completed.md` and `docs/planning/milestone-7A.completed.md` through `docs/planning/milestone-7D.completed.md`) with executable track-level checklists and initial pass/fail quality thresholds.
  - Reframed M7 into four execution tracks (M7A-M7D) to keep comprehensiveness, quality, eval infrastructure, and VexFlow upstreaming independently measurable.
  - Added canonical LilyPond corpus index sync pipeline (`scripts/sync-lilypond-corpus.mjs`) and generated `fixtures/corpus/lilypond-collated-v2.25.json` with all 30 categories and 156 fixtures.
  - Refactored demo build pipeline to load seeded demos from `demos/lilypond/manifest.json` and validate seeded entries against the canonical corpus manifest.
  - Expanded seeded LilyPond demos to 8 canonical fixtures across categories `01`, `02`, `03`, `11`, `13`, `61`, and `71`.
  - Added M7A integration guardrails (`tests/integration/lilypond-corpus.test.ts`) for corpus integrity, roadmap alignment, and seeded demo source/path validation.
  - Activated first LilyPond conformance tranche under `fixtures/conformance/lilypond/` (8 seeded fixtures across categories `01/02/03/11/13/61/71`) with active expected-pass metadata.
  - Activated second LilyPond conformance tranche under `fixtures/conformance/lilypond/` (+22 active expected-pass fixtures) spanning categories `12/14/21/22/23/24/31/32/33/41/42/43/45/46/51/52/72/73/74/75/90/99`.
  - Resolved grace-note beaming crash (`24a-GraceNotes.xml`) by adding graceful unbeamed fallback diagnostics (`GRACE_NOTES_BEAMING_FAILED`) and promoting the fixture from skip/fail to active/pass.
  - Completed full LilyPond collated-suite import into conformance (`fixtures/conformance/lilypond/`): 156 active fixtures aligned to the canonical corpus manifest with per-fixture expected outcomes and metadata.
  - Added bulk promotion tooling (`npm run conformance:lilypond:promote`) to auto-import remaining fixtures and classify expected pass/fail deterministically from current parser/renderer behavior.
  - Added representative real-world corpus manifest (`fixtures/corpus/real-world-samples.json`) with provenance/license metadata and imported first active real-world conformance set (`fixtures/conformance/realworld/`, 5 fixtures).
  - Expanded real-world corpus coverage with required M7A breadth buckets (`solo-lead-sheet`, `orchestral-excerpt`) and promoted corresponding active conformance fixtures (`fixtures/conformance/realworld/`, now 8 fixtures including long-form chamber stress coverage).
  - Added reusable LilyPond conformance import tooling (`scripts/import-lilypond-fixtures.mjs`, `npm run corpus:lilypond:import`) for deterministic case-ID-driven tranche promotion.
  - Completed M7A closeout with test-backed long-form real-world metadata gates (`complexity_level`, `part_count_hint`, `long_form`), explicit expected-fail policy for malformed source fixture `lilypond-23c-tuplet-display-nonstandard`, and conformance-threshold assertions for expected-pass/unexpected-failure/category-floor targets.
  - Completed M7B quality-rubric rollout by adding deterministic `Q1..Q7` scoring to conformance execution/reporting, codifying catastrophic/collision waiver semantics, and enforcing M7B gate thresholds in `tests/conformance/execution.test.ts` with green full-test validation.
  - Completed M7C layered evaluation rollout with versioned split/gate/prompt configs, deterministic split evaluator utilities, layered runner artifacts (`artifacts/evaluation/*`), and evaluation runbook docs.
  - Completed M7D upstream/release hardening rollout with VexFlow gap registry validation (`vexflow:gaps:check`), upstream brief artifact generation (`vexflow:gaps:brief`), and release/sync governance docs.
  - Added generalized renderer quality remediation for two high-impact regressions:
    - stave-aware formatter pass (`formatToStave`) to prevent noteheads bleeding through barlines.
    - automatic beam generation/drawing per voice to restore core beaming in complex real-world scores.
  - Added reusable notation-geometry audit tooling (`src/testkit/notation-geometry.ts`) and regression coverage for `lilypond-01a-pitches-pitches` + `realworld-music21-bach-bwv1-6`.
  - Opened M8 planning and execution scope in `docs/planning/milestone-8.md`, defining golden-reference ingestion, deterministic geometry inspection expansion, headless golden-diff infrastructure, and fixture-wave remediation gates.
  - Implemented M8A golden sync pipeline (`npm run golden:sync`) and generated `/Users/mo/git/musicxml/fixtures/golden/manifest.json` plus 156 cached reference images under `/Users/mo/git/musicxml/fixtures/golden/lilypond-v2.24/`, with explicit `referenceKind` tagging for v2.24 primary vs v2.25 fallback mappings.
  - Implemented M8B first remediation slice for `lilypond-01a-pitches-pitches`: generalized first-column width compensation to avoid opening-measure over-compression, added deterministic measure-spacing ratio tooling, and removed noisy overflow diagnostics in favor of geometry-based containment checks.
  - Added style-fidelity milestone planning (`docs/planning/milestone-9.md`) with source-linked engraving references, style dimensions (`S1..S6`), proof-point fixtures, deterministic gate strategy, and explicit burndown execution waves.
- Implemented M8C initial headless golden comparison runner (`npm run test:golden`, `scripts/run-golden-comparison.mjs`) with fixture-level thresholds, blocking/advisory policy, excerpt crop support, and artifact reports under `artifacts/golden-comparison/`.
- Added first real-world proof-point golden fixture (`realworld-music21-bach-bwv1-6-8bars`) using `fixtures/images/bwv-1.6-8bars.png`; current advisory failure establishes baseline mismatch evidence prior to pagination/title/label support.
  - Opened pagination/publishing-layout milestone (`docs/planning/milestone-10.md`) to deliver paginated-default rendering, continuous-mode fallback, and page-level score metadata elements (title, instrument labels, page numbers).
  - Implemented M10 baseline renderer API/layout engine: paginated default mode, horizontal-continuous fallback, deterministic system/page planning, part labels at system starts, and multi-page SVG output.
  - Added deterministic SVG page background rect injection (`mx-page-background`) to eliminate transparent/black viewer artifacts in headless/browser screenshot workflows.
  - Added regression assertions for page-background presence in renderer integration tests and revalidated render-quality regression suites.
  - Added page-window-aware spanner rendering checks so off-window spanners no longer emit false `SPANNER_ANCHOR_NOT_RENDERED` warnings in paginated mode.
  - Added metadata fallback parsing from centered MusicXML credit words so title/page-number rendering works for real-world files lacking explicit `<work-title>`.
  - Added parser + renderer support for MusicXML `<print new-system/new-page>` directives and validated forced system/page breaks with new integration tests.
  - Re-ran Bach proof-point inspection and golden comparison after break/title/spanner updates; render diagnostics are now clean, while advisory mismatch remains (`mismatchRatio=0.129628`, `ssim=0.288110`) and still requires M10D spacing/geometry tuning.
  - Added geometry-driven proof-point auto-crop support (`autoCropActual.systems`) in the golden runner and switched Bach proof-point config from brittle ratio crop to system-window crop.
  - Re-ran Bach proof-point with system-window auto-crop baseline (`mismatchRatio=0.214865`, `ssim=0.189070`, advisory fail); next M10D work will focus on alignment/region metrics and spacing calibration rather than manual crop tuning.
  - Added MusicXML `measure@width` capture + renderer weighted system-column planning from source width hints; Bach spacing ratio improved (`1.173 -> 1.1411`) with clean diagnostics, but proof-point remains advisory fail (`mismatchRatio=0.214798`, `ssim=0.192180`).
  - Added MusicXML defaults `system-layout/system-margins` parsing + paginated layout usage, improving Bach proof-point mismatch further (`0.214798 -> 0.203193`) while preserving clean render diagnostics.
  - Added structural mismatch reporting in headless golden comparison output (`report.json`/`report.md`) to separate style/glyph drift from raw pixel mismatch during M10D calibration.
  - Added parser/model support for MusicXML note-level `default-x` and explicit `<stem>` direction metadata to preserve source engraving intent for later M10D spacing/stem parity work.
  - Added renderer stem-direction parity path (`stem_direction` mapping + beam generation with maintained stem directions) and associated deterministic parser/unit/integration coverage.
  - Added parser/model support for authored MusicXML beam markers (`<beam number=\"...\">`) and renderer preference for source beam grouping (level-1 begin/continue/end) before auto-beam fallback.
- Added optional centroid-based alignment controls to headless visual diffs (`alignByInkCentroid`, `maxAlignmentShift`, `alignmentAxis`) and wired proof-point normalization support into `test:golden`.
- Extended golden proof-point reports with alignment telemetry (`alignmentShiftX`, `alignmentShiftY`) for triage, then constrained Bach proof-point alignment to horizontal-only (`alignmentAxis: "x"`).
- Fixed beaming regression where flags were still visible on beamed notes by preparing beam groups before `voice.draw()`, then drawing prepared beams post-voice render; added deterministic conformance gate coverage for expected-pass flag/beam overlaps (`expectedPassFlagBeamOverlapCount`).
- Added adaptive inter-part gap expansion based on adjacent-part notation complexity to reduce cross-part collisions in dense real-world systems.
- Added robust left-label fit logic under source system margins so label text wraps/truncates safely without stealing notation lane width.
- Improved slur routing stability by selecting curve side via endpoint skew minimization (with placement override support) and aligning endpoint anchor calculations with rendered curve positions.
- Expanded headless curve-anomaly detection to parse absolute and relative cubic path commands, improving deterministic detection coverage for diagonal cut-through slur regressions.
- Re-ran proof-point inspections after these changes:
  - `realworld-music21-bach-bwv1-6`: `flags=0`, `flagBeamOverlaps=0`, spacing ratio `1.0395`.
  - `realworld-music21-beethoven-op133-longform`: no cross-page diagonal slur artifacts on inspected page (`extremeCurveCount=0`).
  - `realworld-music21-beethoven-op18no1-m1`: cut-through slur regression resolved on inspected page (`extremeCurveCount=0`), but spacing ratio remains low (`0.6459`) and stays in active follow-up.
- Hardened dense-measure auto layout by increasing density-aware minimum fitted widths and adding peak-local dense-rhythm pressure to measures-per-system planning; `lilypond-03a-rhythm-durations` now renders without barline overflow on headless inspection (`barlineIntrusions=0`, `compressed(<0.75)=0/2`).
- Tuned grand-staff intra-part spacing heuristics (center-register + curved-relation weighting) to reduce residual cross-staff collisions in dense piano fixtures, while keeping deterministic spacing telemetry inside non-catastrophic ranges.
- Retuned demo build rendering geometry for browser readability/fill (`layout.scale=1.1`, demo page `980x1400` with tighter margins, larger site container) to reduce "tiny score + large right blank area" behavior in generated demo pages.
- Added deterministic regression checks for `lilypond-03a-rhythm-durations` spacing-band compression and a Schumann proof-point floor guard to prevent severe spacing regressions.
- Re-ran `B-003` proof-point after dense-layout tuning; `realworld-music21-beethoven-op18no1-m1` moved from severe to partial compression (`compressed bands 6/8 -> 1/8`, min ratio `0.2753 -> 0.5577`) and remains in mitigation until the remaining dense band is resolved.
- Applied a follow-up layout pass blending density with source width hints and increasing grand-staff spacing ceilings; regression suites remain green, `03a` remains clean, and `B-003` stays at partial compression (`1/8` compressed bands) while Schumann residual compression persists (`min band ratio ~0.671`).
- Demo scale was reset to `0.8` (matching library default) as requested, and demos were rebuilt.
