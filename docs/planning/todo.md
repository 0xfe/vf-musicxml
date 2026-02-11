# TODO / Risks Backlog

Status legend:
- `OPEN`: active and unmitigated.
- `MITIGATING`: work in progress.
- `CLOSED`: risk no longer material; leave item for history.

## P0

### R-001: Non-deterministic visual regression baselines
- Priority: P0
- Status: MITIGATING
- Risk: Font/rendering differences can cause noisy screenshot diffs and block CI.
- Mitigation plan:
  - M2 baseline landed: Playwright smoke harness (`tests/visual`) plus MCP browser verification path.
- M3/M4 conformance visual sentinel specs (`tests/visual/conformance-sentinels.spec.ts`) now cover `smoke`/`timewise`/`rhythm` plus `notation-m4-baseline`.
- M5 added `layout-m5-multipart-baseline` visual sentinel + snapshot to catch multi-part/multi-staff layout regressions.
- M6 kept visual scope selective; advanced notation fixture promoted in headless conformance first.
- Visual suite re-run under elevated permissions succeeded (`npm run test:visual -- --workers=4` passes for smoke + conformance sentinel specs).
- Visual snapshot baselines now exist for smoke + conformance sentinel specs, including the M4 notation sentinel (`tests/visual/*-snapshots/`).
- Local visual runs are currently stable when repo-local browser binaries are used (`PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4`); keep CI/browser-environment controls in place to avoid regressions.
  - Browser-free visual portability path is now available and should be used as default gate/triage in constrained environments:
    - `npm run test:visual:headless`
    - `npm run test:visual:headless:update`
    - `npm run inspect:score -- --input=<path>`
  - Pin browser version and font set in CI.
  - Keep visual tests small and high-signal.
  - Use headless SVG structural/collision tests as primary gate.
- Close criteria:
  - CI visual tests stable for 2 consecutive weeks with no flaky retries.

### R-002: VexFlow capability gaps for target MusicXML features
- Priority: P0
- Status: MITIGATING
- Risk: Some MusicXML constructs may not map cleanly to current VexFlow APIs.
- Mitigation plan:
  - M4 baseline landed tie/slur/wedge rendering with explicit diagnostics and API-compatibility fixes (`Curve` options + `StaveHairpin` key/render option shape).
  - M5 baseline landed multi-part/multi-staff connectors and staff-routing; keep validating connector semantics against broader fixture corpus.
  - M6 baseline landed grace/cue/ornament/tuplet/repeat+ending support with deterministic tests and diagnostics.
  - M7D will maintain a gap registry that links each blocker to fixture IDs, local patch IDs, and upstream issue/PR status.
  - Track gaps with minimal reproducer fixtures.
  - Patch via dedicated VexFlow branches (`codex/vexflow-*`) and upstream PRs.
  - Add local compatibility layer to isolate upstream changes.
- Close criteria:
  - All blocking gaps for current milestone resolved or explicitly waived with documented fallback.

### R-011: Quality blind spots despite high parse/render pass rates
- Priority: P0
- Status: MITIGATING
- Risk: Scores can pass parse/render/conformance gates but still produce poor engraving quality (spacing/collision/readability regressions).
- Mitigation plan:
  - M7B landed: weighted quality rubric dimensions (`Q1..Q7`) and deterministic conformance quality gates are now enforced in `tests/conformance/execution.test.ts`.
  - M7B landed: conformance reports now emit quality summaries and fixture-level metrics (collision severity, spacing floors, overflow/clipping, spanner geometry checks).
  - Added notation-geometry intrusion metrics (`noteheadBarlineIntrusionCount`) and hooked them into `Q6` layout scoring to catch measure bleed regressions automatically.
  - Added explicit regression harness for beam presence and barline intrusion checks (`tests/integration/render-quality-regressions.test.ts`).
  - M7C landed: layered evaluation runner (`npm run eval:run`) with split-aware deterministic gates, fail-fast classifier outputs, and optional perceptual/model layers with versioned configs/prompts.
  - Keep high-signal visual sentinels for cases where structural metrics are insufficient.
  - Add periodic rubric audits on stratified fixture samples and track trend drift.
- Close criteria:
  - Quality rubric and deterministic proxies are integrated into CI/nightly gates and no active expected-pass fixture falls below agreed critical thresholds without waiver.

### R-016: Golden reference mismatch or incompleteness for LilyPond fixtures
- Priority: P0
- Status: OPEN
- Risk: If fixture-to-golden mapping is incomplete or unstable (missing/changed reference assets), M8 quality gates can produce noisy or misleading outcomes.
- Mitigation plan:
  - Build and validate a version-pinned golden manifest (`fixtures/golden/manifest.json`) with source URL + checksum per fixture.
  - Add sync tooling/tests that fail when active fixtures lack golden references.
  - Record provenance and version pinning (LilyPond v2.24) in manifest metadata.
  - Keep explicit waivers for fixtures with unavailable or ambiguous references.
- Close criteria:
  - 100% active LilyPond fixtures map to validated golden assets or explicit waivers.

## P1

### R-004: XML parser stack mismatch (strictness vs performance)
- Priority: P1
- Status: MITIGATING
- Risk: Wrong parser choice can create correctness bugs or poor diagnostics.
- Mitigation plan:
  - Target parser stack: `saxes` + custom location-aware AST (documented in ADR-0001).
  - Benchmark candidate parser approach on representative fixtures.
  - Keep parser adapter boundary to allow replacement.
- Close criteria:
  - Parser decision ADR written and benchmark committed.

### R-005: Text metrics and lyric placement drift between Node and browser
- Priority: P1
- Status: MITIGATING
- Risk: Headless measurements can diverge from browser rendering.
- Mitigation plan:
  - M5 landed baseline lyric/harmony rendering and added text-focused conformance fixture + visual sentinel coverage.
  - Headless path now uses deterministic width estimation instead of browser-dependent SVG `getBBox`.
  - Keep textual placement assertions tolerant in Node checks.
  - Validate sensitive cases with Playwright visual suite.
  - Normalize fonts in both environments.
- Close criteria:
  - Lyric/harmony visual baselines stable across local + CI.

### R-009: VexFlow Node vs browser rendering divergence
- Priority: P1
- Status: MITIGATING
- Risk: VexFlow output can differ between Node/headless and browser environments due to font fallback and text/path rendering behavior.
- Mitigation plan:
  - M2 baseline landed: headless SVG structure assertions + browser smoke test for the same fixture.
  - Keep Node SVG tests structural and semantic, not pixel-level.
  - Generate visual baselines in a single canonical CI environment.
  - Validate sensitive spacing/layout cases with Playwright in browser.
- Close criteria:
  - Stable cross-environment visual baseline process documented and passing in CI.

### R-010: Demo credibility drift vs canonical MusicXML fixtures
- Priority: P1
- Status: MITIGATING
- Risk: Hand-authored demo scores can mask parser/renderer issues and make regressions hard to triage.
- Mitigation plan:
  - Seed demos only from canonical web sources (LilyPond collated suite fixture URLs).
  - Keep source URL and fixture identity on each demo page.
  - Track suite category coverage in `demos/lilypond/manifest.json`.
  - Keep `demos/site/lilypond-roadmap.html` aligned with conformance fixture metadata.
- Close criteria:
  - Every imported LilyPond conformance fixture has a source-linked demo entry and rendered preview page.

### R-012: Corpus provenance/license drift during comprehensiveness expansion
- Priority: P1
- Status: MITIGATING
- Risk: Large-scale score imports can introduce unclear licensing or unstable source links, reducing reproducibility and distribution safety.
- Mitigation plan:
  - M7A baseline landed: canonical LilyPond corpus manifest includes suite source URL and license context (`MIT`) plus per-fixture source URLs.
  - M7A real-world onboarding expanded: manifest now includes source repo + license metadata per sample and active coverage for required breadth buckets.
  - Require source URL + license metadata in corpus manifest rows.
  - Prefer LilyPond collated fixtures and permissive/public-domain corpora for broad imports.
  - Keep checksum/version notes for imported external fixtures where possible.
  - Block fixture activation when provenance metadata is incomplete.
- Close criteria:
  - Every active imported fixture has verified provenance and license metadata in the manifest.

### R-013: Cross-renderer disagreement creates ambiguous quality truth
- Priority: P1
- Status: OPEN
- Risk: LilyPond/MuseScore/Verovio references can disagree on layout details, making automated pass/fail rules noisy or conflicting.
- Mitigation plan:
  - Use cross-renderer results as comparative signals, not absolute truth.
  - Anchor blocking quality checks to internal rubric + deterministic gates first.
  - Document renderer-specific caveats and acceptable variance windows by category.
  - Keep per-fixture waiver notes when external renderers diverge materially.
- Close criteria:
  - Comparison policy and tolerance thresholds documented and applied consistently across active comparison fixtures.

### R-014: Model-assisted evaluation drift (cost, latency, prompt instability)
- Priority: P1
- Status: MITIGATING
- Risk: Image-model scoring can be expensive, nondeterministic, or prompt-sensitive, causing unstable quality trends.
- Mitigation plan:
  - M7C landed: model-audit integration path in `scripts/run-evaluation.mjs` with explicit sample controls and advisory/non-blocking semantics.
  - M7C landed: prompt + schema are versioned under `fixtures/evaluation/prompts/`.
  - Restrict model-assisted audits to sampled nightly/weekly runs.
  - Version prompts/schemas and retain historical outputs for drift detection.
  - Treat model scores as advisory until correlation with deterministic metrics is demonstrated.
  - Add budget/time guardrails and fallback behavior when model eval is unavailable.
- Close criteria:
  - Model-assisted pipeline runs within agreed budget/time limits and demonstrates stable, useful correlation with deterministic quality signals.

### R-015: Local VexFlow patches diverge from upstream too long
- Priority: P1
- Status: MITIGATING
- Risk: Prolonged local patching can increase maintenance cost and delay dependency upgrades.
- Mitigation plan:
  - Maintain a patch registry tied to fixture repro cases and upstream issue/PR links.
  - Require each patch to have explicit owner, upstream target version, and de-patch plan.
  - Regularly revalidate patches against latest upstream releases.
  - Keep patch-package diffs minimal and isolated by scope.
- Close criteria:
  - Every active patch has upstream status visibility and no stale patch lacks an owner/de-patch path.

### R-017: Overfitting renderer behavior to raster goldens
- Priority: P1
- Status: OPEN
- Risk: Tuning only for visual similarity can hide semantic/layout correctness regressions and reduce generalization to non-golden corpora.
- Mitigation plan:
  - Keep deterministic geometry/presence/spacing rules as primary blocking checks.
  - Treat golden-image similarity as secondary evidence (with region-aware thresholds).
  - Require semantic regression tests for every major visual fix.
  - Track and review disagreements between deterministic and visual signals.
- Close criteria:
  - M8 gating policy enforces deterministic correctness first and documents acceptable golden variance.

### R-018: Geometry extraction blind spots for untagged/complex symbols
- Priority: P1
- Status: OPEN
- Risk: Missing or inconsistent SVG tagging can prevent deterministic detection of key notation elements, leaving quality gaps.
- Mitigation plan:
  - Expand geometry extractor coverage and add fallback selectors/heuristics per element family.
  - Add fixture-backed coverage tests for each tracked symbol class.
  - Introduce diagnostics for "unable-to-inspect" regions to prevent silent pass-through.
  - Add renderer instrumentation hooks where VexFlow output lacks stable selectors.
- Close criteria:
  - Geometry inspector covers all M8-targeted symbol classes with deterministic tests and explicit diagnostics for unsupported cases.

## P2

### R-007: Parse/render performance on large orchestral scores
- Priority: P2
- Status: OPEN
- Risk: High memory or slow render can hurt practical adoption.
- Mitigation plan:
  - Establish baseline benchmarks in M7.
  - Profile hotspots before optimization work.
- Close criteria:
  - Baseline throughput and memory targets documented and met.

### R-008: Public API churn during early milestones
- Priority: P2
- Status: MITIGATING
- Risk: Frequent API changes can destabilize downstream usage.
- Mitigation plan:
  - Freeze minimal API surface in M0/M1.
  - Version internal interfaces separately from public exports.
- Close criteria:
  - API compatibility checks added and breaking changes documented by version.

## Bug Backlog
- B-001 (P1, OPEN): Local Playwright browser launch intermittently fails with macOS MachPort/session errors (`bootstrap_check_in ... Permission denied (1100)`), blocking visual snapshot refresh in this environment while headless suites continue to pass.
