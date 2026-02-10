# AI State (Dense)

## Repo intent
- Build staged MusicXML parser + VexFlow renderer with strict milestone discipline (`plan.md`).
- M6 completed: advanced notation baseline (grace/cue/ornaments/tuplets/repeats/endings) is implemented and test-gated.

## High-signal files
- Plan/risk:
  - `/Users/mo/git/musicxml/plan.md`
  - `/Users/mo/git/musicxml/todo.md`
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
  - `/Users/mo/git/musicxml/scripts/build-demos.mjs`
  - `/Users/mo/git/musicxml/scripts/serve-demos.mjs`

## Current conformance model
- Metadata schema: `/Users/mo/git/musicxml/fixtures/conformance/schema/conformance-fixture-meta.schema.json`
- Per fixture: `*.meta.yaml` + `*.musicxml|*.xml|*.mxl`.
- `expected` is authoritative (`pass`/`fail`), `status` gates execution (`active`/`skip`).
- `parse_mode` can override parser mode per fixture (`lenient` default, `strict` when needed).
- Optional `collision_audit` block drives overlap checks.

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
  - `npm run demos:build`
  - `npm run demos:serve` (open `http://localhost:4173/`)

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
- Visual status: Playwright launch is currently blocked in this local runtime by MachPort/session errors; keep visual updates environment-gated until browser launch context is stable.

## Next likely work (M7 start)
- Push broader LilyPond conformance fixture import/promotion with explicit expected-fail rationales.
- Add parse/render performance baselines and profiling artifacts.
- Stabilize visual baseline regeneration in canonical CI/browser environment.
