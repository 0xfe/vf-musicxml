# musicxml

TypeScript-first MusicXML parsing and rendering library for VexFlow.

Current milestone: `M3` in progress (timewise normalization landed; rhythm/container/collision work pending).

## Project goals
- Parser + canonical score model that is independent from rendering backend.
- VexFlow adapter for browser and server-side SVG flows.
- Headless-first validation and conformance testing.
- Progressive support for LilyPond collated MusicXML fixtures.

## Architecture (M0 layout)
- `src/core/`: shared types and diagnostics.
- `src/parser/`: parser pipeline (`saxes` AST + AST-to-CSM transform).
- `src/vexflow/`: rendering adapter (M2 baseline implemented).
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

## Playwright Browser Setup (Local)
Install and run visual tests with a repo-local browser cache:

```bash
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual
```

Why this is required:
- Avoids default cache path issues under `/Users/mo/Library/Caches/ms-playwright`.
- Keeps browser binaries in-repo for consistent local/agent behavior.

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
- `npm run test:conformance`: run conformance metadata/fixture tests.
- `npm run test:visual`: run Playwright browser visual smoke tests.

## Conformance metadata model
Each fixture has a companion `.meta.yaml` with these fields:
- `id`: stable fixture identifier.
- `source`: upstream source URL or identifier.
- `category`: feature grouping.
- `expected`: `pass` or `fail` for the current implementation stage.
- `status`: `active` or `skip`.
- `notes`: optional rationale.
- `linked_todo`: optional TODO/risk id.
- `waivers`: optional list of temporary waivers.

Schema reference: `fixtures/conformance/schema/conformance-fixture-meta.schema.json`.

## Distribution policy
- ESM-first output.
- `vexflow` is a peer dependency.
- Pinned dev dependency for tested baseline: `vexflow@4.2.3`.

## Current API state
- `parseMusicXML`: supports `score-partwise` parsing and `score-timewise` normalization to partwise.
- `parseMusicXMLAsync`: supports XML and `.mxl` (ZIP) container decode with `META-INF/container.xml` rootfile resolution and diagnostics.
- `renderToSVGPages`: implemented for M2 single-part/single-voice rendering baseline.
- `renderToElement`: implemented with DOM lifecycle (`dispose`) for browser integration.

## Core docs
- `docs/adr/0001-xml-parser-stack.md`
- `docs/parser-architecture.md`
- `docs/diagnostics-taxonomy.md`
- `docs/csm-overview.md`
- `docs/rendering-pipeline.md`
