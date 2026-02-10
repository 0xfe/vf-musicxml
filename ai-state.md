# AI State (Dense)

## Repo intent
- Build staged MusicXML parser + VexFlow renderer with strict milestone discipline (`docs/planning/status.md` + `docs/planning/logs.md`).
- M6 completed; M7 has started with a split execution model (M7A-M7D) for comprehensiveness, quality rubric, layered evaluation, and VexFlow upstream hardening.
- M7A baseline landed: LilyPond collated-suite corpus manifest + sync script + expanded seeded demos + roadmap/corpus alignment tests.

## High-signal files
- Plan/risk:
  - `/Users/mo/git/musicxml/docs/planning/status.md`
  - `/Users/mo/git/musicxml/docs/planning/logs.md`
  - `/Users/mo/git/musicxml/docs/planning/todo.md`
  - `/Users/mo/git/musicxml/docs/planning/todo.completed.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7A.completed.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7B.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7C.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7D.md`
- Corpus/demo M7A:
  - `/Users/mo/git/musicxml/fixtures/corpus/lilypond-collated-v2.25.json`
  - `/Users/mo/git/musicxml/fixtures/corpus/real-world-samples.json`
  - `/Users/mo/git/musicxml/demos/lilypond/manifest.json`
  - `/Users/mo/git/musicxml/scripts/sync-lilypond-corpus.mjs`
  - `/Users/mo/git/musicxml/scripts/import-lilypond-fixtures.mjs`
  - `/Users/mo/git/musicxml/scripts/promote-lilypond-conformance.mjs`
  - `/Users/mo/git/musicxml/scripts/import-realworld-samples.mjs`
  - `/Users/mo/git/musicxml/scripts/build-demos.mjs`
- Public API:
  - `/Users/mo/git/musicxml/src/public/api.ts`
- Parser core:
  - `/Users/mo/git/musicxml/src/parser/parse.ts`
  - `/Users/mo/git/musicxml/src/parser/parse-header.ts`
  - `/Users/mo/git/musicxml/src/parser/parse-note.ts`
  - `/Users/mo/git/musicxml/src/parser/parse-timewise.ts`
  - `/Users/mo/git/musicxml/src/parser/mxl.ts`
- Rendering core:
  - `/Users/mo/git/musicxml/src/vexflow/render.ts`
  - `/Users/mo/git/musicxml/src/vexflow/render-note-mapper.ts`
  - `/Users/mo/git/musicxml/src/vexflow/render-notations.ts`
- Conformance/testkit:
  - `/Users/mo/git/musicxml/src/testkit/conformance.ts`
  - `/Users/mo/git/musicxml/src/testkit/conformance-execution.ts`
  - `/Users/mo/git/musicxml/src/testkit/svg-collision.ts`
- Demo pipeline:
  - `/Users/mo/git/musicxml/demos/scores/*.musicxml`
  - `/Users/mo/git/musicxml/demos/lilypond/manifest.json`
  - `/Users/mo/git/musicxml/scripts/build-demos.mjs`
  - `/Users/mo/git/musicxml/scripts/serve-demos.mjs`
- Suite tips:
  - `/Users/mo/git/musicxml/docs/lilypond-suite-tips.md`
  - `/Users/mo/git/musicxml/docs/evaluation-tips.md`
  - `/Users/mo/git/musicxml/docs/realworld-corpus-tips.md`

## Current conformance model
- Metadata schema: `/Users/mo/git/musicxml/fixtures/conformance/schema/conformance-fixture-meta.schema.json`
- Per fixture: `*.meta.yaml` + `*.musicxml|*.xml|*.mxl`.
- `expected` is authoritative (`pass`/`fail`), `status` gates execution (`active`/`skip`).
- `parse_mode` can override parser mode per fixture (`lenient` default, `strict` when needed).
- Optional `collision_audit` block drives overlap checks.

## M7 execution model (active)
- `M7A` corpus comprehensiveness:
  - completed: collated-suite index sync/import parity, real-world breadth + long-form coverage gates, and malformed-source expected-fail policy are test-backed.
- `M7B` quality rubric + deterministic gates:
  - formal `Q1..Q7` quality scoring dimensions.
  - deterministic proxies (collision severity, spacing floors, overflow checks, spanner geometry checks).
- `M7C` layered evaluation framework:
  - deterministic SVG checks -> visual/perceptual metrics -> cross-renderer comparisons -> model-assisted sampled audits.
- `M7D` VexFlow upstream loop:
  - gap registry, patch-package traceability, upstream issue/PR lifecycle, de-patch strategy.

## Conformance execution semantics
- Implemented in `executeConformanceFixture`:
  - Compute observed outcome from actual parse/render/collision signals.
  - Compare observed vs expected.
  - `success === expectationMatched` (not raw parse success).
- Aggregate report includes diagnostic histograms:
  - `parseDiagnosticCodeHistogram`
  - `renderDiagnosticCodeHistogram`
  - `diagnosticSeverityHistogram`
- Aggregate report also includes category rollups:
  - `categoryRollups[category].{fixtureCount,passCount,failCount,...histograms}`
- Report artifact command:
  - `npm run test:conformance:report`
  - emits `artifacts/conformance/conformance-report.json|md`

## Fixture set (active baseline)
- `smoke-minimal-partwise` (`expected: pass`)
- `timewise-minimal` (`expected: pass`)
- `rhythm-backup-forward-two-voices` (`expected: pass`)
- `parser-malformed-xml` (`expected: fail`) control fixture for expected-fail gating.
- `parser-unsupported-root-opus` (`expected: fail`) unsupported MusicXML root fixture.
- `mxl-invalid-container` (`expected: fail`) malformed `.mxl` container fixture.
- `notation-invalid-pitch-step-lenient` (`expected: pass`) warning-tolerant notation fixture.
- `notation-invalid-pitch-step-strict` (`expected: fail`) strict-mode notation fixture.
- `notation-m4-baseline` (`expected: pass`) end-to-end M4 notation/direction baseline fixture.
- `layout-m5-multipart-baseline` (`expected: pass`) multi-part/multi-staff M5 layout baseline fixture.
- `text-m5-lyrics-harmony-baseline` (`expected: pass`) lyric/harmony M5 text baseline fixture.
- `advanced-m6-notation-baseline` (`expected: pass`) M6 advanced notation fixture (grace/cue/ornament/tuplet/repeat+ending).
- M7A seeded LilyPond tranche (`expected: pass`):
  - `lilypond-01a-pitches-pitches`
  - `lilypond-01c-pitches-no-voice`
  - `lilypond-02a-rests-durations`
  - `lilypond-03a-rhythm-durations`
  - `lilypond-11a-time-signatures`
  - `lilypond-13a-key-signatures`
  - `lilypond-61a-lyrics`
  - `lilypond-71g-multiple-chordnames`
- M7A tranche-2 active LilyPond categories now include:
  - `lilypond-12`, `lilypond-14`, `lilypond-21`, `lilypond-22`, `lilypond-23`
  - `lilypond-31`, `lilypond-32`, `lilypond-33`
  - `lilypond-41`, `lilypond-42`, `lilypond-43`
  - `lilypond-45`, `lilypond-46`
  - `lilypond-51`, `lilypond-52`
  - `lilypond-72`, `lilypond-73`, `lilypond-74`, `lilypond-75`
  - `lilypond-90`, `lilypond-99`
- M7A current coverage summary:
  - `lilypond` conformance fixtures: 156 active (`155 expected: pass`, `1 expected: fail`).
  - `realworld` conformance fixtures: 8 active (`8 expected: pass`).
  - total active conformance fixtures: 176 (`171 expected: pass`, `5 expected: fail`).
  - expected-fail LilyPond fixture: `lilypond-23c-tuplet-display-nonstandard` (explicit malformed-source waiver for undefined entity + `XML_NOT_WELL_FORMED` parse failure).
- Recently resolved M7A blocker:
  - `lilypond-24a-gracenotes` moved to `status: active`, `expected: pass` after graceful fallback handling for VexFlow grace beaming failures (`GRACE_NOTES_BEAMING_FAILED` warning path).

## Diagnostics to know
- XML/root: `XML_NOT_WELL_FORMED`, `UNSUPPORTED_ROOT`
- Timing: `BACKUP_BEFORE_MEASURE_START`, `MEASURE_CURSOR_OVERFLOW`
- Timewise: `SCORE_TIMEWISE_NORMALIZED`
- MXL: `MXL_INVALID_ARCHIVE`, `MXL_CONTAINER_*`, `MXL_SCORE_FILE_*`
- Part grouping: `PART_GROUP_STOP_WITHOUT_START`
- Notation parse/link: `UNMATCHED_*`, `UNCLOSED_*`, `WEDGE_ANCHOR_NOT_FOUND`
- Notation/text render: `SPANNER_*`, `*_RENDER_FAILED`, `WEDGE_DIRECTION_TEXT_FALLBACK`, `LYRIC_TEXT_RENDERED`, `HARMONY_TEXT_STACK_HIGH`
- Advanced notation render: `UNSUPPORTED_ORNAMENT`, `GRACE_NOTES_WITHOUT_ANCHOR`, `UNMATCHED_TUPLET_STOP`, `UNCLOSED_TUPLET_START`, `OVERLAPPING_TUPLET_START`, `TUPLET_*`, `CUE_NOTE_RENDERED`
- Layout render baseline: `MULTI_VOICE_NOT_SUPPORTED_IN_M2` still applies per staff when more than one voice targets the same staff.

## Test commands
- Fast confidence loop:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:integration`
  - `npm run test:conformance`
- Full:
  - `npm run test`
  - `npm run test:visual -- --workers=4`
- Demos:
  - `npm run corpus:lilypond:sync`
  - `npm run corpus:lilypond:import -- --cases 12a,14a`
  - `npm run conformance:lilypond:promote`
  - `npm run conformance:realworld:import`
  - `npm run demos:build`
  - `npm run demos:serve` (open `http://localhost:4173/` and `http://localhost:4173/lilypond-roadmap.html`)

## Playwright notes
- Browser-required tests: prefer MCP Playwright browser tool.
- Local CLI visual tests require repo-local browser path:
  - `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium`
  - `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4`
- Visual sentinel spec now covers active pass fixtures across categories including M4 notation and M5 layout/text:
  - `/Users/mo/git/musicxml/tests/visual/conformance-sentinels.spec.ts`
- Snapshot baselines live at:
  - `/Users/mo/git/musicxml/tests/visual/conformance-sentinels.spec.ts-snapshots`
  - `/Users/mo/git/musicxml/tests/visual/render-visual.spec.ts-snapshots`
- Latest run status: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:svg`, `npm run test:conformance`, and `npm run test` pass.
- Visual status: local Playwright visual runs are currently passing with repo-local browser binaries (`PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4`).

## Next likely work (M7 start)
- Execute M7B next: wire rubric dimensions/proxy metrics into conformance report outputs and set initial gating thresholds.
- Execute M7C after M7B thresholds are stable: add perceptual and model-assisted audit layers.
- Start M7D in parallel: maintain VexFlow gap registry with fixture reproducer links and upstream status.
