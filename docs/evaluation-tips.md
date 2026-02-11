# Evaluation Tips (M7)

## Why this exists
Quick context for quality-eval tooling so future agents do not need to re-derive library choices, caveats, and ordering.

## Layer order (recommended)
1. Deterministic SVG analytics (fast + blocking).
2. Visual snapshots/perceptual metrics (blocking for targeted sentinels).
3. Cross-renderer references (diagnostic signal, not absolute truth).
4. Model-assisted rubric audits (sampled/non-blocking initially).

## Tooling notes
- Playwright snapshots:
  - Use stable browser/font runtime.
  - Keep sentinel set intentionally small and high-signal.
- pixelmatch:
  - Good for direct pixel diffs and fast CI thresholds.
  - Sensitive to anti-aliasing/font drift; tune threshold conservatively.
- SSIM:
  - Better structural similarity signal than raw pixel diffs.
  - Useful companion metric for layout-level drift.
- LPIPS:
  - Strong perceptual metric but heavier runtime/dependency cost.
  - Prefer nightly/batch usage first.

## M7B deterministic rubric implementation
- Source: `/Users/mo/git/musicxml/src/testkit/conformance-execution.ts`
- Report outputs:
  - per fixture: `result.quality.{weightedScore,dimensions,metrics,...}`
  - aggregate: `report.qualitySummary`
- Dimension IDs:
  - `Q1` spacing, `Q2` collisions, `Q3` stems/beams/rests, `Q4` spanners, `Q5` text, `Q6` layout, `Q7` symbol fidelity
- Added deterministic layout-specific signal for barline bleed regressions:
  - `noteheadBarlineIntrusionCount` from `src/testkit/notation-geometry.ts`
  - counted in fixture metrics and penalized in `Q6` layout quality scoring
- Gate semantics:
  - expected-pass weighted mean must be `>= 4.2`
  - expected-pass catastrophic readability list must be empty
  - expected-pass critical collision count must be `0` unless fixture waiver exists
- Waiver keys:
  - `quality-critical-collision`
  - `quality-catastrophic-readability`

## M7C execution entrypoints
- Layered run command:
  - `npm run eval:run`
- Config files:
  - `/Users/mo/git/musicxml/fixtures/evaluation/splits.json`
  - `/Users/mo/git/musicxml/fixtures/evaluation/gates.json`
- Outputs:
  - `/Users/mo/git/musicxml/artifacts/evaluation/evaluation-report.json`
  - `/Users/mo/git/musicxml/artifacts/evaluation/evaluation-report.md`
  - `/Users/mo/git/musicxml/artifacts/evaluation/perceptual-diffs/**` (when baseline/candidate dirs are provided)
- Operational runbook:
  - `/Users/mo/git/musicxml/docs/evaluation-runbook.md`

## Cross-renderer caveats
- LilyPond, MuseScore, and Verovio can disagree on legal engraving decisions.
- Treat renderer comparisons as reference signals, not strict truth labels.
- Document fixture-level variance waivers when references conflict.

## OpenAI-assisted audits
- Use image-input prompts with fixed JSON schema output.
- Keep prompts/version IDs in source control for drift tracking.
- Run on stratified sample sets (nightly/weekly) instead of full-PR gating.
- Track correlation between model scores and deterministic metrics before promotion to stronger gates.

## References
- Playwright snapshots: https://playwright.dev/docs/test-snapshots
- pixelmatch: https://github.com/mapbox/pixelmatch
- SSIM background: https://www.cns.nyu.edu/~lcv/ssim/
- OpenCV SSIM API: https://docs.opencv.org/4.x/d9/db5/classcv_1_1quality_1_1QualitySSIM.html
- LPIPS: https://github.com/richzhang/PerceptualSimilarity
- OpenAI vision guide: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI evals API reference: https://developers.openai.com/api/reference/resources/evals
