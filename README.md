# musicxml

TypeScript-first MusicXML parsing and rendering library for VexFlow.

Current milestone: `M6` completed (advanced notation baseline: grace/cue/ornaments/tuplets/repeats/endings).

## Project goals
- Parser + canonical score model that is independent from rendering backend.
- VexFlow adapter for browser and server-side SVG flows.
- Headless-first validation and conformance testing.
- Progressive support for LilyPond collated MusicXML fixtures.

## Architecture (M0 layout)
- `src/core/`: shared types and diagnostics.
- `src/parser/`: parser pipeline (`saxes` AST + AST-to-CSM transform).
- `src/vexflow/`: rendering adapter (M6 advanced-notation baseline).
- `src/public/`: exported API surface.
- `src/testkit/`: conformance fixture and metadata tooling.
- `tests/`: unit, integration, conformance, headless SVG, and browser visual suites.
- `fixtures/conformance/`: test fixtures plus `.meta.yaml` metadata files.

## Requirements
- Node.js `>=20.11`

## Quickstart
```bash
npm install
npm run lint
npm run typecheck
npm run test
```

## Demos
Demo sources live in:
- `demos/scores/lilypond-01c-pitches-no-voice.musicxml`
- `demos/scores/lilypond-71g-multiple-chordnames.musicxml`
- `demos/lilypond/manifest.json` (suite coverage roadmap)

Build static demo pages:
```bash
npm run demos:build
```

Serve locally and open in a browser:
```bash
npm run demos:serve
```

Then visit:
- `http://localhost:4173/`
- `http://localhost:4173/lilypond-roadmap.html`

## Playwright Browser Setup (Local)
Install and run visual tests with a repo-local browser cache:

```bash
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4
```

Why this is required:
- Avoids default cache path issues under `/Users/mo/Library/Caches/ms-playwright`.
- Keeps browser binaries in-repo for consistent local/agent behavior.
- Allows local CLI visual runs (`npm run test:visual`) even when global cache state is unknown.

For interactive browser checks in Codex, use the Playwright MCP browser tools. Use the local CLI setup above when running the repository Playwright test command.

If you see an executable-path mismatch (for example Playwright looks for `mac-x64` but only `mac-arm64` exists), reinstall from this repo environment:

```bash
rm -rf /Users/mo/git/musicxml/.playwright
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium --force
```

## Commands
- `npm run build`: build TypeScript output into `dist/`.
- `npm run lint`: run ESLint.
- `npm run typecheck`: run strict TypeScript checks.
- `npm run test`: run all tests.
- `npm run test:unit`: run unit tests only.
- `npm run test:integration`: run integration tests only.
- `npm run test:svg`: run headless SVG structure tests.
- `npm run test:conformance`: run conformance metadata, fixture loading, and baseline parse/render/collision execution tests.
- `npm run test:conformance:report`: run conformance execution and emit JSON/Markdown artifacts (diagnostic histograms + category rollups) into `artifacts/conformance/`.
- `npm run test:visual`: run Playwright browser visual smoke tests.
- `npm run test:visual:update`: update Playwright visual snapshot baselines.
- `npm run demos:build`: build static demo HTML pages from `demos/scores/*.musicxml`.
- `npm run demos:serve`: build demos and serve them locally at `http://localhost:4173/`.

## Testkit utilities
- `src/testkit/svg-collision.ts` provides headless SVG collision-audit helpers:
  - `extractSvgElementBounds(...)`
  - `detectSvgOverlaps(...)`
- `src/testkit/conformance.ts` provides conformance loader + collision report plumbing:
  - `loadConformanceFixtures(...)`
  - `runConformanceCollisionAudit(...)`

## Conformance metadata model
Each fixture has a companion `.meta.yaml` with these fields:
- `id`: stable fixture identifier.
- `source`: upstream source URL or identifier.
- `category`: feature grouping.
- `expected`: `pass` or `fail` for the current implementation stage.
- `status`: `active` or `skip`.
- `parse_mode`: optional parser mode override (`lenient` default, or `strict`).
- `notes`: optional rationale.
- `linked_todo`: optional TODO/risk id.
- `waivers`: optional list of temporary waivers.
- `collision_audit`: optional headless SVG overlap checks for rendered fixture output.
  - `selector`: CSS selector for elements to audit.
  - `padding`: optional overlap expansion (number).
  - `min_overlap_area`: optional area threshold to ignore tiny intersections.
  - `max_overlaps`: optional max allowed overlaps (defaults to `0`).

Schema reference: `fixtures/conformance/schema/conformance-fixture-meta.schema.json`.

Current staged conformance fixtures:
- `fixtures/conformance/smoke/minimal-partwise.musicxml`
- `fixtures/conformance/timewise/minimal-timewise.musicxml`
- `fixtures/conformance/rhythm/backup-forward-two-voices.musicxml`
- `fixtures/conformance/parser/malformed-xml.musicxml` (`expected: fail` control fixture)
- `fixtures/conformance/parser/unsupported-root-opus.musicxml` (`expected: fail` unsupported-root fixture)
- `fixtures/conformance/mxl/invalid-container.mxl` (`expected: fail` malformed-container fixture)
- `fixtures/conformance/notation/invalid-pitch-step-lenient.musicxml` (`expected: pass`, `parse_mode: lenient`)
- `fixtures/conformance/notation/invalid-pitch-step-strict.musicxml` (`expected: fail`, `parse_mode: strict`)
- `fixtures/conformance/notation/m4-notation-baseline.musicxml` (`expected: pass`, M4 notation/direction baseline)
- `fixtures/conformance/layout/m5-multipart-baseline.musicxml` (`expected: pass`, M5 multi-part/multi-staff baseline)
- `fixtures/conformance/text/m5-lyrics-harmony-baseline.musicxml` (`expected: pass`, M5 lyric/harmony text baseline)
- `fixtures/conformance/advanced/m6-advanced-notation-baseline.musicxml` (`expected: pass`, M6 advanced notation baseline)

Visual sentinel coverage:
- `tests/visual/conformance-sentinels.spec.ts` exercises browser rendering for active pass fixtures in `smoke`, `timewise`, `rhythm`, M4 `notation`, and M5 `layout` + `text`.
- Snapshot baselines are stored in:
  - `tests/visual/conformance-sentinels.spec.ts-snapshots/`
  - `tests/visual/render-visual.spec.ts-snapshots/`

## Distribution policy
- ESM-first output.
- `vexflow` is a peer dependency.
- Pinned dev dependency for tested baseline: `vexflow@4.2.3`.

## Current API state
- `parseMusicXML`: supports `score-partwise` parsing and `score-timewise` normalization to partwise.
- `parseMusicXMLAsync`: supports XML and `.mxl` (ZIP) container decode with `META-INF/container.xml` rootfile resolution and diagnostics.
- `renderToSVGPages`: includes M4/M5 baselines plus M6 advanced notation support (grace/cue notes, ornament mapping baseline, tuplet draw pass, repeat/ending stave semantics).
- `renderToElement`: implemented with DOM lifecycle (`dispose`) for browser integration.

## Notation Support Matrix
- See `/Users/mo/git/musicxml/docs/notation-support-matrix.md` for supported M6 notation features, degradation diagnostics, and known gaps.

## Core docs
- `docs/adr/0001-xml-parser-stack.md`
- `docs/parser-architecture.md`
- `docs/diagnostics-taxonomy.md`
- `docs/csm-overview.md`
- `docs/rendering-pipeline.md`
- `docs/timing-model.md`
- `docs/notation-support-matrix.md`
- `docs/advanced-notation-policy.md`
- `docs/layout-heuristics.md`
- `docs/modularization-decision.md`
- `docs/musicxml-tips.md`
- `docs/vexflow-tips.md`
- `docs/playwright-tips.md`
- `docs/lilypond-suite-tips.md`
- `ai-state.md` (dense agent handoff/context file)
