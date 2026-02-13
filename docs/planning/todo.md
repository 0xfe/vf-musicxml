# TODO / Risks Backlog

Status legend:
- `OPEN`: active and unmitigated.
- `MITIGATING`: work in progress.
- `CLOSED`: risk no longer material; leave item for history.

## Linear execution lanes (current)

### Now (blocking milestone closeout)
- M10D layout blockers: `B-012`, `B-003`, `B-007`.
- M10D fidelity blockers: `R-020`, `R-023`.

### Next (after M10D blockers are closed)
- M8 gate closeout: `R-016`, `R-018`, `R-027`, `R-034`.
- M9 style closeout: `R-019`, `R-024`, `R-026`, `R-032`.

### Later (new structural scope; post M10/M8/M9)
- M12 completeness lane: `R-022`, `R-025`, `R-029`, `R-030`, `R-033`, `R-035`, `R-031`.
- M11 optimizer/config lane: `R-028`.

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
  - Added deterministic flag/beam overlap scoring and expected-pass gate (`expectedPassFlagBeamOverlapCount == 0`) in conformance execution to catch beam-suppression regressions where flags remain visible on beamed notes.
  - Added deterministic measure-spacing summaries (`summarizeMeasureSpacingByBarlines`) and regression ratio checks so first-measure compression bugs are automatically detected.
  - Removed noisy `MEASURE_LAYOUT_OVERFLOW` warnings that produced false positives; geometry containment/intrusion checks now act as the reliable blocking signal.
  - M7C landed: layered evaluation runner (`npm run eval:run`) with split-aware deterministic gates, fail-fast classifier outputs, and optional perceptual/model layers with versioned configs/prompts.
  - Keep high-signal visual sentinels for cases where structural metrics are insufficient.
  - Add periodic rubric audits on stratified fixture samples and track trend drift.
- Close criteria:
  - Quality rubric and deterministic proxies are integrated into CI/nightly gates and no active expected-pass fixture falls below agreed critical thresholds without waiver.

### R-016: Golden reference mismatch or incompleteness for LilyPond fixtures
- Priority: P0
- Status: MITIGATING
- Risk: If fixture-to-golden mapping is incomplete or unstable (missing/changed reference assets), M8 quality gates can produce noisy or misleading outcomes.
- Mitigation plan:
  - M8A baseline landed: `npm run golden:sync` now produces a version-pinned golden manifest (`fixtures/golden/manifest.json`) with source URLs, local image paths, and sha256 checksums per active LilyPond fixture.
  - M8A baseline landed: integration gate `tests/integration/lilypond-golden-manifest.test.ts` enforces full active fixture mapping and asset/checksum validity.
  - M8A baseline landed: explicit `referenceKind` tagging distinguishes v2.24 primary references from v2.25 fallback references for fixtures not present in v2.24 collated docs.
  - M8C initial runner landed: `npm run test:golden` compares rendered output directly to mapped golden assets with per-fixture thresholds and blocking/advisory policy.
  - Keep explicit waivers for fixtures with unavailable or ambiguous references and narrow fallback usage over time.
- Close criteria:
  - 100% active LilyPond fixtures map to validated golden assets or explicit waivers.

### R-020: Missing first-class pagination/page metadata support blocks PDF/image parity
- Priority: P0
- Status: MITIGATING
- Risk: Without paginated rendering (systems/pages) and publishing metadata (title/instrument labels/page numbers), real-world score comparisons remain low-signal and quality improvements cannot be validated against canonical page-oriented references.
- Mitigation plan:
  - M10 baseline landed: paginated default rendering, continuous-mode fallback, system/page planning, and multi-page output.
  - M10 baseline landed: part labels and header/footer/title/page-number hooks plus deterministic SVG page background rects for stable screenshot pipelines.
  - M10 baseline landed: parser + renderer support for MusicXML `<print new-system/new-page>` directives so system/page starts follow source break hints.
  - M10 baseline landed: paginated spanner pass now suppresses off-window false positives (`SPANNER_ANCHOR_NOT_RENDERED`) in real-world proof-points.
  - M8C/M10D update: golden proof-point runner now supports deterministic system-window cropping (`autoCropActual.systems`) to reduce manual ratio-crop drift during Bach parity tuning.
  - M10D update: parser + renderer now consume defaults `system-layout/system-margins`, reducing system-width drift in Bach proof-point.
  - M10D update: golden reports now include structural mismatch metrics for triage (raw pixel mismatch remains primary configured threshold).
  - M10D update: parser/model now captures note-level source default-x and explicit stem direction metadata; stem-direction parity is now applied in rendering/beaming.
  - M10D update: parser/model now captures authored beam markers and renderer prefers source beam-group topology before auto-beam fallback.
  - M10D update: headless golden comparisons now support optional centroid alignment controls and emit alignment telemetry (`alignmentShiftX`, `alignmentShiftY`) for proof-point triage.
  - M10D update: adaptive inter-part gap planning is active, with complexity-driven spacing expansion between dense neighboring parts.
  - M10D update: label rendering under source system margins now wraps/truncates to the true left-of-notation lane (prevents label clipping without reducing notation width).
  - M10D update: slur routing now uses side-aware endpoint anchors and side selection by endpoint skew minimization; extreme diagonal cut-through slurs are reduced in real-world proof-points.
  - Continue proof-point parity tuning for `realworld-music21-bach-bwv1-6-8bars` using external reference imagery (currently advisory fail).
  - Add deterministic checks for header/footer/label collision and page-break stability.
  - Add deterministic dense-spacing gate for multi-part proof-points where first-system compression remains (`realworld-music21-beethoven-op18no1-m1`).
- Close criteria:
  - Paginated renderer API and publishing metadata elements are implemented and proof-point parity thresholds are met.

### R-022: Single-voice-per-staff renderer limits content fidelity
- Priority: P0
- Status: OPEN
- Risk: Multi-voice passages are still flattened or degraded in dense real-world fixtures, causing missing/incorrect musical content and misleading quality scores.
- Mitigation plan:
  - Add a dedicated multi-voice milestone (`milestone-12.md`) with renderer architecture updates (`Voice` per staff voice + `Formatter.joinVoices` flow).
  - Add deterministic conformance accounting for rendered-vs-parsed voice content so unsupported multi-voice cases are explicitly scored and gated.
  - Promote at least two proof-point fixtures (`realworld-music21-bach-bwv244-10`, `realworld-music21-mozart-k458-m1`) as blocking multi-voice correctness checks.
- Close criteria:
  - Active proof-point fixtures render all expected voices without voice-drop diagnostics and pass new content-fidelity gates.

### R-023: System-level spacing proportionality still needs broader proof-point coverage
- Priority: P0
- Status: MITIGATING
- Risk: Left-bar squeeze/overflow is substantially reduced on primary proof-points, but residual compression can still reappear on additional pages/fixtures when column allocation underweights duration density.
- Mitigation plan:
  - Treat this as an M10D blocker: add duration-weighted system column planning fallback when authoritative source-width hints are missing or insufficient.
  - Keep first-measure compression and barline-intrusion gates active for dense fixtures (`lilypond-03a-rhythm-durations`, `realworld-music21-bach-bwv244-10`, `realworld-music21-mozart-k458-m1`).
  - Expand spacing-band telemetry to report per-system left-bar pressure and overflow risk (including density-aware width-ratio classification to avoid false positives from note-count differences).
- Close criteria:
  - No compressed left-bar bands below agreed width-ratio thresholds on active proof-points and no measure overflow diagnostics for expected-pass fixtures.

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
- Status: MITIGATING
- Risk: Missing or inconsistent SVG tagging can prevent deterministic detection of key notation elements, leaving quality gaps.
- Mitigation plan:
  - M8B first slice landed: measure-spacing extraction by barline partitions with stable center-collapse tolerances.
  - Expand geometry extractor coverage and add fallback selectors/heuristics per element family.
  - Add fixture-backed coverage tests for each tracked symbol class.
  - Introduce diagnostics for "unable-to-inspect" regions to prevent silent pass-through.
  - Add renderer instrumentation hooks where VexFlow output lacks stable selectors.
- Close criteria:
  - Geometry inspector covers all M8-targeted symbol classes with deterministic tests and explicit diagnostics for unsupported cases.

### R-019: Engraving style policy drift (readability without explicit style gates)
- Priority: P1
- Status: MITIGATING
- Risk: Without a source-linked style rulebook and measurable style gates, outputs can be functionally correct but still look inconsistent or hard to read.
- Mitigation plan:
  - M9 milestone opened with source-linked style references (LilyPond, SMuFL, MOLA, Behind Bars preview).
  - Implement style dimensions (`S1..S6`) and deterministic checks for spacing, collisions, stem/beam readability, text placement, and system balance.
  - Maintain proof-point fixtures and burndown waves so style fixes are prioritized and generalized.
- Close criteria:
  - M9 style gates are operational in reports/CI and no unresolved P0 style blockers remain across active fixtures.

### R-024: Approximate text measurement causes avoidable collisions
- Priority: P1
- Status: OPEN
- Risk: Linear text-width estimation (`len * size * constant`) misestimates label extents, causing overlap drift for lyrics, dynamics, and direction text.
- Mitigation plan:
  - Land a character-class width model in M9/M11 and use it consistently in both layout and geometry quality checks.
  - Add fixture-backed regression tests for text-density categories (`31a`, `61b`, `71g`) plus real-world dynamic-text lanes.
- Close criteria:
  - Text overlap rates and false-positive collision diagnostics are reduced and stable across targeted fixtures.

### R-025: Cross-staff spanner routing remains partial
- Priority: P1
- Status: OPEN
- Risk: Cross-staff slur/tie/wedge routing can be skipped or visually degraded in piano/grand-staff writing.
- Mitigation plan:
  - Replace fixed cross-staff rejection thresholds with staff-distance-relative routing policies.
  - Track unsupported cases as explicit diagnostics and VexFlow gaps where APIs are insufficient.
  - Add cross-staff proof-point gates in M10D/M12.
- Close criteria:
  - No untracked cross-staff spanner skips in active proof-point fixtures.

### R-026: Chord-anchor selection for modifiers is not fully engraving-aware
- Priority: P1
- Status: OPEN
- Risk: Chord-level modifiers can attach to suboptimal noteheads, reducing readability in chord-heavy writing.
- Mitigation plan:
  - Implement stem-direction and note-position-aware anchor selection and validate with chord-focused regression fixtures.
  - Add deterministic modifier-placement checks in M9 gates.
- Close criteria:
  - Chord modifier collisions/overlaps remain under gate thresholds in style proof-points.

### R-027: Quality scoring still underweights content completeness
- Priority: P1
- Status: OPEN
- Risk: Aggregate quality scores can look healthy while musical content is missing (especially when unsupported voice/layer content is dropped).
- Mitigation plan:
  - Add content-completeness dimension (`Q0`) or equivalent penalty model in M8F.
  - Surface rendered-vs-parsed event coverage in conformance reports and use it for gate calibration.
- Close criteria:
  - Quality reports expose completeness explicitly and no longer hide missing musical content.

### R-028: Layout coefficients are hardcoded and weakly explainable
- Priority: P1
- Status: OPEN
- Risk: Tuning regressions are hard to isolate because layout coefficients are scattered and undocumented.
- Mitigation plan:
  - Consolidate coefficients into versioned config objects and document rationale links in M11.
  - Add targeted unit tests for coefficient sensitivity in isolation.
- Close criteria:
  - Layout coefficients are centralized, documented, and independently testable.

### R-029: Navigation symbol support (rehearsal/coda/segno) is incomplete
- Priority: P1
- Status: OPEN
- Risk: Longer-form scores appear incomplete without rehearsal/navigation symbols.
- Mitigation plan:
  - Add parser/model coverage and renderer mapping in M12 notation-expansion scope.
  - Add deterministic presence checks for rehearsal/coda/segno markers.
- Close criteria:
  - Active fixtures using these markers render them without unsupported diagnostics.

### R-030: Pedal notation support is missing for keyboard repertoire
- Priority: P1
- Status: OPEN
- Risk: Piano-heavy fixtures lose essential expressive notation and visual completeness.
- Mitigation plan:
  - Add parser support for pedal direction types and staged renderer support (text baseline, then line notation) in M12.
  - Add proof-point fixtures and diagnostics/gates for pedal presence.
- Close criteria:
  - Pedal markings are rendered (or explicitly waived) on targeted keyboard fixtures.

### R-032: Slur routing still drops or degrades wide-interval cases
- Priority: P1
- Status: MITIGATING
- Risk: Wide slurs can still flatten poorly or get skipped in edge passages, hurting phrase readability.
- Mitigation plan:
  - Replace drop-first behavior with bounded-curvature fallback in M9/M10D.
  - Add deterministic slur-path sanity checks for wide-interval fixtures.
- Close criteria:
  - No severe slur omissions in expected-pass proof-point fixtures.

### R-033: Ottava (8va/8vb) support is absent
- Priority: P1
- Status: OPEN
- Risk: Scores using octave-shift notation render with wrong readability/semantic context.
- Mitigation plan:
  - Add parser + renderer octave-shift spanner support in M12.
  - Track any VexFlow limitations in gap registry.
- Close criteria:
  - Ottava lines are rendered or explicitly waived on targeted fixtures.

### R-034: Quality waivers currently over-hide degraded fixtures
- Priority: P1
- Status: OPEN
- Risk: Full waiver bypass can hide quality regressions in aggregate metrics.
- Mitigation plan:
  - Introduce reduced-penalty waiver scoring in M8F and expose waived-dimension deltas in reports.
- Close criteria:
  - Waived fixtures still contribute bounded quality penalties in aggregate scoring.

### R-035: Mid-measure clef changes are parsed but not fully rendered
- Priority: P1
- Status: OPEN
- Risk: Inline clef changes can be missed, producing wrong-register notation in affected passages.
- Mitigation plan:
  - Add inline `ClefNote` insertion path during mapping/rendering in M12.
  - Add proof-point tests for mid-measure clef changes.
- Close criteria:
  - Inline clef-change fixtures render correctly without unsupported diagnostics.

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

### R-031: `parseMusicXMLAsync` naming vs behavior mismatch
- Priority: P2
- Status: OPEN
- Risk: Async API naming can mislead callers while implementation remains mostly synchronous.
- Mitigation plan:
  - Decide in M12 API cleanup whether to document forward-compat intent clearly or deprecate/unify API.
  - Add explicit API docs/tests for chosen behavior.
- Close criteria:
  - Public API docs and behavior are aligned and tested.

## Bug Backlog
- B-001 (P1, OPEN): Local Playwright browser launch intermittently fails with macOS MachPort/session errors (`bootstrap_check_in ... Permission denied (1100)`), blocking visual snapshot refresh in this environment while headless suites continue to pass.
- B-003 (P1, MITIGATING): `realworld-music21-beethoven-op18no1-m1` spacing has improved materially after density/planning tuning (first/median ratio `~1.0994`; compressed bands `1/8`, `min ratio ~0.5577`), but one dense staff band is still below target. Continue M8/M9 spacing-gate calibration and formatter strategy until compressed bands reach zero or an explicit waiver threshold.
- B-006 (P1, MITIGATING): `lilypond-03a-rhythm-durations` duration overflow is no longer causing barline bleed (`barlineIntrusions=0` in headless inspection), and `128th`/`256th` note types now map directly. Remaining unsupported extreme duration types still degrade with diagnostics (`UNSUPPORTED_DURATION_TYPE_SKIPPED`); upstream gap tracking + fallback visualization strategy remains open for true `512th+` support.
- B-007 (P1, MITIGATING): Schumann proof-point page 1 remains clean under density-aware spacing classification (`compressed(<0.75 width-ratio)=0/4`). Sparse-opening false positives were reduced by tightening width-ratio normalization in `notation-geometry` (note-count scaling now applies only when first bars are denser). Remaining work is focused on residual tie/curve proximity tuning and per-page layout calibration for later sparse pages before the proof-point set can be fully blocking.
- B-008 (P2, MITIGATING): Demo pages had oversized blank canvas regions and inconsistent perceived scale; demo build uses `layout.scale=0.7` plus notation-first SVG trimming with nearby-text inclusion and tighter crop windows (`top/horizontal inclusion` reduced on 2026-02-12). Continue monitoring very sparse fixtures for residual whitespace and tune crop paddings if clipping/over-trim appears.
- B-009 (P1, MITIGATING): Category-31/32 text-overlap pressure is materially reduced after chord-level modifier dedupe + direction-row packing (`31a overlaps 13 -> 2`, `32a overlaps 21 -> 4` in current headless inspections). Deterministic overlap gates are now tightened in `tests/integration/render-quality-regressions.test.ts` (`31a text overlaps <= 4`, `31a dynamics-text <= 4`, `32a text overlaps <= 6`). Continue tuning until thresholds can be tightened further without flakiness.
- B-010 (P1, OPEN): `non-arpeggiate` note notation remains unsupported (`NON_ARPEGGIATE_UNSUPPORTED`) in `lilypond-32a-notations`; implement a generalized renderer fallback or patch VexFlow, then track upstream in the VexFlow gap registry.
- B-011 (P0, MITIGATING): Generalized first-column spacing hardening is now active in `src/vexflow/render.ts` (justification shrink path honors minimum widths and first-column floor constraints), with additional density-aware first-column guards and local dense-system splitting. Current proof-point snapshot: `realworld-music21-mozart-k458-m1` reports `barlineIntrusions=0`, `compressed bands=0/8`; `realworld-music21-bach-bwv244-10` reports `barlineIntrusions=0`, `compressed bands=0/4`, `min band ratio=1.0`; `lilypond-03a-rhythm-durations` remains `barlineIntrusions=0`, `compressed bands=0/3`. Keep this MITIGATING until additional proof-point pages are promoted to blocking checks.
- B-012 (P1, MITIGATING): Direction/dynamics/text lane collisions are substantially reduced. Current generalized mitigations include top-staff-only default routing for unstaffed directions, per-system lane persistence (directions/harmonies/lyrics), interval-based row occupancy routing, expanded direction-lane vertical clearance, dynamics/words dedupe when both encode the same marking, style-accurate harmony width measurement with side-padding row packing, compact harmony-kind formatting (for readable chord symbols), and text-pressure-aware automatic inter-system gap expansion that discounts dynamics-only pressure. Latest snapshots: `31a` text overlaps `2`, `31d` text overlaps `1` (from `8`), `71f` text overlaps `0` (from `10`), `61b` text overlaps `0`, and `31a` dynamics-to-text overlaps remain within gate budget.
