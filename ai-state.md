# AI State (Dense)

## Repo intent
- Build staged MusicXML parser + VexFlow renderer with strict milestone discipline (`plan.md`).
- M3 completed: timing normalization, `.mxl` parsing, collision audits, conformance execution/reporting, expected-fail gating, category rollups, and visual sentinel snapshots.

## High-signal files
- Plan/risk:
  - `/Users/mo/git/musicxml/plan.md`
  - `/Users/mo/git/musicxml/todo.md`
- Public API:
  - `/Users/mo/git/musicxml/src/public/api.ts`
- Parser core:
  - `/Users/mo/git/musicxml/src/parser/parse.ts`
  - `/Users/mo/git/musicxml/src/parser/parse-timewise.ts`
  - `/Users/mo/git/musicxml/src/parser/mxl.ts`
- Rendering core:
  - `/Users/mo/git/musicxml/src/vexflow/render.ts`
  - `/Users/mo/git/musicxml/src/vexflow/render-note-mapper.ts`
- Conformance/testkit:
  - `/Users/mo/git/musicxml/src/testkit/conformance.ts`
  - `/Users/mo/git/musicxml/src/testkit/conformance-execution.ts`
  - `/Users/mo/git/musicxml/src/testkit/svg-collision.ts`

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

## Diagnostics to know
- XML/root: `XML_NOT_WELL_FORMED`, `UNSUPPORTED_ROOT`
- Timing: `BACKUP_BEFORE_MEASURE_START`, `MEASURE_CURSOR_OVERFLOW`
- Timewise: `SCORE_TIMEWISE_NORMALIZED`
- MXL: `MXL_INVALID_ARCHIVE`, `MXL_CONTAINER_*`, `MXL_SCORE_FILE_*`

## Test commands
- Fast confidence loop:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:integration`
  - `npm run test:conformance`
- Full:
  - `npm run test`

## Playwright notes
- Browser-required tests: prefer MCP Playwright browser tool.
- Local CLI visual tests require repo-local browser path:
  - `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium`
  - `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual`
- Visual sentinel spec now covers active pass fixtures across categories:
  - `/Users/mo/git/musicxml/tests/visual/conformance-sentinels.spec.ts`
- Snapshot baselines live at:
  - `/Users/mo/git/musicxml/tests/visual/conformance-sentinels.spec.ts-snapshots`
  - `/Users/mo/git/musicxml/tests/visual/render-visual.spec.ts-snapshots`
- Latest run status: `npm run test:visual` passes under elevated permissions.

## Next likely work (M4 start)
- Begin notation/direction implementation scope (ties/slurs/articulations/dynamics/tempo/wedges).
- Promote selected expected-fail notation fixtures to expected-pass as behavior lands.
- Expand collision-focused fixtures once multi-voice rendering is richer.
