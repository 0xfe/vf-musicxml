# Planning Status

This file is the current snapshot of planning state. Update this first as milestones progress.

## Status

- Last updated: 2026-02-10 (US)
- Planning location: all planning artifacts now live under `/Users/mo/git/musicxml/docs/planning/`.
- Current state: M6 and M7A are completed. M7A exit criteria are now test-backed (corpus breadth/long-form coverage, expected-fail triage policy for `lilypond-23c`, and conformance threshold gates), and the project is ready to execute M7B quality-rubric implementation.
- Review integration: Feedback items `F-001` through `F-024` are accepted and incorporated across the planning docs.

### Next step when execution continues:
  1. Execute M7B: lock rubric dimensions (`Q1..Q7`) and land deterministic collision/spacing/layout gate metrics in conformance reports.
  2. Execute M7D in parallel: track every VexFlow gap with reproducer fixture, patch-package linkage, and upstream PR status.
  3. Execute M7C once M7B thresholds are stable: add perceptual/model-assisted evaluation layers and artifact pipelines.

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
| M7 | Full Conformance + Quality Program (Umbrella) | In progress | Execution is now split into M7A-M7D tracks with independent quality gates and release criteria. |
| M7A | Corpus Comprehensiveness | Completed | Canonical collated corpus manifest + full LilyPond conformance import (156 active fixtures), expanded real-world onboarding (8 fixtures including lead-sheet/orchestral + long-form chamber coverage), explicit `23c` malformed-source waiver policy, and executable M7A threshold gates are in place. |
| M7B | Quality Rubric + Deterministic Quality Gates | Not started | Define page-level quality rubric and deterministic analytical proxies with per-category thresholds. |
| M7C | Layered Evaluation Framework | Not started | Add visual/perceptual/model-assisted eval layers and artifact/report pipeline. |
| M7D | VexFlow Gap Upstreaming + Release Hardening | Not started | Operationalize patch/PR lifecycle, de-patch flow, and release readiness policies. |



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
  - Added M7 strategy document (now split across `docs/planning/milestone-7.md` and `docs/planning/milestone-7A.completed.md` through `docs/planning/milestone-7D.md`) with executable track-level checklists and initial pass/fail quality thresholds.
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
