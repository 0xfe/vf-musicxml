# Evaluation Runbook (M7C)

## PR path (blocking)
1. `npm run test:conformance:report`
2. `npm run eval:run`
3. (Optional high-signal visual sentinels) `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4`

Blocking layers:
- Layer 1 deterministic (always required).
- Layer 2 perceptual (required only when baseline/candidate image dirs are provided; otherwise skipped).

## Nightly path (extended)
1. Run PR path commands.
2. Run perceptual compare with explicit dirs:
   - `npm run eval:run -- --baseline-dir <baseline-png-root> --candidate-dir <candidate-png-root>`
3. Run cross-renderer ingestion (if artifacts exist):
   - `npm run eval:run -- --cross-renderer-dir <cross-renderer-json-root>`
4. Run model audit sample (advisory):
   - `OPENAI_API_KEY=... npm run eval:run -- --model-image-dir <png-root> --model-sample 20`

## Threshold rationale
- Deterministic thresholds are versioned in:
  - `/Users/mo/git/musicxml/fixtures/evaluation/gates.json`
- Current defaults:
  - expected-pass rate floor: `0.97` (extended/nightly)
  - weighted mean floor: `4.2`
  - catastrophic expected-pass fixtures: `0`
  - critical expected-pass collisions: `0`

## Triage workflow
1. Open `/Users/mo/git/musicxml/artifacts/evaluation/evaluation-report.md`.
2. Identify failed layer/split and gate breach.
3. For deterministic failures:
   - inspect `/Users/mo/git/musicxml/artifacts/conformance/conformance-report.json`
   - prioritize classifier buckets:
     - `layout_overflow`
     - `symbol_collision`
     - `text_legibility`
     - `spanner_quality`
     - `symbol_fidelity`
4. For perceptual failures:
   - inspect `artifacts/evaluation/perceptual-diffs/**`.
5. If issue is a VexFlow behavior gap:
   - add/update `/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json`
   - run `npm run vexflow:gaps:check`.
