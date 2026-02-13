# musicxml

TypeScript-first MusicXML parsing and rendering library for VexFlow.

Current milestones: `M8`/`M9`/`M10` in progress (golden-driven quality, style fidelity, and pagination/publishing layout).

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
Featured seed demo sources live in:
- `demos/scores/lilypond-01a-pitches-pitches.musicxml`
- `demos/scores/lilypond-01c-pitches-no-voice.musicxml`
- `demos/scores/lilypond-02a-rests-durations.musicxml`
- `demos/scores/lilypond-03a-rhythm-durations.musicxml`
- `demos/scores/lilypond-11a-time-signatures.musicxml`
- `demos/scores/lilypond-13a-key-signatures.musicxml`
- `demos/scores/lilypond-61a-lyrics.musicxml`
- `demos/scores/lilypond-71g-multiple-chordnames.musicxml`
- `demos/lilypond/manifest.json` (suite coverage roadmap)
- `fixtures/corpus/lilypond-collated-v2.25.json` (canonical collated-suite index)
- `fixtures/corpus/real-world-samples.json` (representative non-LilyPond sample set + provenance)

Generated demo output includes:
- all active LilyPond conformance fixtures (`fixtures/conformance/lilypond/*`) as individual demo pages.
- selected complex real-world fixtures (`fixtures/conformance/realworld/*`) from medium/large/long-form corpus samples.
- featured seed demos from `demos/scores/*` highlighted at the top of the index.

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

## Fast Headless Visual Checks (No Browser)
Default visual-regression path for CI/headless servers:

```bash
npm run test:visual:headless:update
npm run test:visual:headless
npm run test:golden
```

What this does:
- Parses/render fixtures with the library (no browser runtime).
- Rasterizes SVG via `resvg` to PNG.
- Compares PNGs with pixel diff + SSIM.
- Emits artifacts to:
  - `tests/visual-headless/baselines/` (snapshots)
  - `artifacts/visual-headless/` (actual/diff images + report)

Useful focused run:
```bash
npm run test:visual:headless -- --fixtures=lilypond-01a-pitches-pitches,realworld-music21-bach-bwv1-6
```

Quick one-score inspection (writes SVG/PNG/report without a browser):
```bash
npm run inspect:score -- --input=fixtures/conformance/lilypond/01a-pitches-pitches.musicxml
npm run inspect:score -- --input=fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl
```

Optional reference diff for one score:
```bash
npm run inspect:score -- --input=fixtures/conformance/lilypond/01a-pitches-pitches.musicxml --reference-png=tests/visual-headless/baselines/lilypond-01a-pitches-pitches.png
```

One-score artifacts are emitted under `artifacts/score-inspection/<score-id>/`.

## Fast Iteration Loop
Use these tiers to minimize turnaround during rendering/debug sessions:

```bash
# Tier 1: deterministic smoke quality checks.
npm run loop:quick

# Tier 2: fixture-focused visual + geometry triage pack.
npm run loop:targeted -- --fixtures=lilypond-01a-pitches-pitches,realworld-music21-bach-bwv1-6

# Tier 3: full quality gate run.
npm run loop:full
```

Hot fixture pack artifacts are written to `artifacts/hot-fixture-pack/` and aggregate:
- golden comparison status (`artifacts/hot-fixture-pack/golden/`)
- headless visual regression status (`artifacts/visual-headless/`)
- per-fixture inspect reports (`artifacts/hot-fixture-pack/inspect/`)
- triage runs are report-first by default; add `--strict` to fail on comparison errors.

Detailed loop/caching guidance: `/Users/mo/git/musicxml/docs/iteration-speed-tips.md`.

Targeted demo rebuilds (no full-site rebuild needed):
```bash
npm run demos:build:fixtures -- --fixtures=realworld-music21-schumann-clara-polonaise-op1n1,lilypond-03a-rhythm-durations
npm run demos:build:changed
```

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
- `npm run test:visual:headless`: run browser-free visual regression checks (SVG->PNG + pixel/SSIM).
- `npm run test:visual:headless:update`: refresh browser-free baseline images.
- `npm run test:golden`: compare rendered fixtures directly against external golden references (`fixtures/golden/manifest.json` + `fixtures/evaluation/golden-proofpoints.json`).
- `npm run test:golden:fixtures -- --fixtures=<ids>`: run golden comparison on selected fixtures only.
- `npm run inspect:score -- --input=<path>`: inspect one score headlessly and emit SVG/PNG/report artifacts.
- `npm run eval:run`: run layered evaluation report generation (`artifacts/evaluation/`).
- `npm run eval:run:fixtures -- --fixtures=<ids>`: run layered evaluation on selected fixture IDs only.
- `npm run vexflow:gaps:check`: validate VexFlow gap registry links and lifecycle metadata.
- `npm run vexflow:gaps:brief`: generate upstream issue/PR briefing artifacts from the gap registry.
- `npm run patches:apply`: apply `patch-package` patches (when present).
- `npm run golden:sync`: sync LilyPond golden reference images (v2.24 primary, v2.25 fallback) into `fixtures/golden/`.
- `npm run corpus:lilypond:sync`: refresh canonical LilyPond corpus manifest (`fixtures/corpus/lilypond-collated-v2.25.json`).
- `npm run corpus:lilypond:import -- --cases 12a,14a`: import selected LilyPond cases into `fixtures/conformance/lilypond/`.
- `npm run conformance:lilypond:promote`: bulk-import remaining LilyPond fixtures and auto-classify expected pass/fail from current parse/render behavior.
- `npm run conformance:realworld:import`: import representative real-world `.mxl` samples into `fixtures/conformance/realworld/`.
- `npm run demos:build`: build static demo HTML pages for full LilyPond conformance coverage plus selected complex real-world fixtures.
- `npm run demos:build:fixtures -- --fixtures=<ids>`: incrementally rebuild selected demo pages only.
- `npm run demos:build:changed`: rebuild demos affected by `origin/master...HEAD` changes.
- `npm run demos:serve`: build demos and serve them locally at `http://localhost:4173/`.
- `npm run triage:fixtures -- --fixtures=<ids>`: execute automated fixture triage pack (golden + headless + inspect + consolidated report).
- `npm run check:parallel`: run lint, typecheck, and unit tests concurrently.
- `npm run loop:quick`: tier-1 fast deterministic loop.
- `npm run loop:targeted -- --fixtures=<ids>`: tier-2 focused fixture loop.
- `npm run loop:full`: tier-3 full quality gate loop.

## Testkit utilities
- `src/testkit/svg-collision.ts` provides headless SVG collision-audit helpers:
  - `extractSvgElementBounds(...)`
  - `detectSvgOverlaps(...)`
- `src/testkit/notation-geometry.ts` provides notation-aware SVG quality probes:
  - `collectNotationGeometry(...)`
  - `detectNoteheadBarlineIntrusions(...)`
  - `summarizeNotationGeometry(...)`
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
- `fixtures/conformance/lilypond/*.musicxml|*.mxl` (M7A active LilyPond tranches across categories `01/02/03/11/12/13/14/21/22/23/24/31/32/33/41/42/43/45/46/51/52/61/71/72/73/74/75/90/99`)
- `fixtures/conformance/realworld/*.mxl` (M7A representative real-world samples: solo lead-sheet, vocal song, SATB chorale, chamber quartet incl. long-form stress sample, piano solo/sonata, orchestral excerpt)

Visual sentinel coverage:
- `tests/visual/conformance-sentinels.spec.ts` exercises browser rendering for active pass fixtures in `smoke`, `timewise`, `rhythm`, M4 `notation`, M5 `layout` + `text`, plus focused regression sentinels for `lilypond-01a-pitches-pitches` and `realworld-music21-bach-bwv1-6`.
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
- `docs/planning/status.md`
- `docs/planning/logs.md`
- `docs/planning/todo.md`
- `docs/planning/todo.completed.md`
- `docs/planning/milestone-0.completed.md`
- `docs/planning/milestone-1.completed.md`
- `docs/planning/milestone-2.completed.md`
- `docs/planning/milestone-3.completed.md`
- `docs/planning/milestone-4.completed.md`
- `docs/planning/milestone-5.completed.md`
- `docs/planning/milestone-6.completed.md`
- `docs/planning/milestone-7.completed.md`
- `docs/planning/milestone-7A.completed.md`
- `docs/planning/milestone-7B.completed.md`
- `docs/planning/milestone-7C.completed.md`
- `docs/planning/milestone-7D.completed.md`
- `docs/planning/feedback.md`
- `docs/layout-heuristics.md`
- `docs/modularization-decision.md`
- `docs/musicxml-tips.md`
- `docs/vexflow-tips.md`
- `docs/playwright-tips.md`
- `docs/lilypond-suite-tips.md`
- `docs/evaluation-tips.md`
- `docs/evaluation-runbook.md`
- `docs/realworld-corpus-tips.md`
- `docs/vexflow-gap-registry.md`
- `docs/vexflow-upstream-playbook.md`
- `docs/vexflow-upstream-sync-log.md`
- `docs/release-hardening-checklist.md`
- `ai-state.md` (dense agent handoff/context file)
