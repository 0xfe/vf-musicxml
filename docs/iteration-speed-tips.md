# Iteration Speed Tips

Use this runbook when fixing rendering/layout regressions so loops stay fast and deterministic.

## Tiered Loop
- Tier 1 (`npm run loop:quick`): deterministic quality smoke tests.
- Tier 2 (`npm run loop:targeted -- --fixtures=<ids>`): focused golden/headless/inspect triage.
- Tier 3 (`npm run loop:full`): full quality gate before milestone closure.

## Fixture-Scoped Commands
- Golden: `npm run test:golden:fixtures -- --fixtures=<id1,id2>`
- Evaluation: `npm run eval:run:fixtures -- --fixtures=<id1,id2>`
- Headless visual: `npm run test:visual:headless -- --fixtures=<id1,id2>`
- Single score inspect: `npm run inspect:score -- --input=<fixture-path>`

## Incremental Demo Build
- Build selected demo pages only:
  - `npm run demos:build:fixtures -- --fixtures=<demo-id1,demo-id2>`
- Build only pages affected by local changes:
  - `npm run demos:build:changed`
- Force index/roadmap refresh during targeted builds:
  - `npm run demos:build:fixtures -- --fixtures=<ids> --with-index --with-roadmap`

## Cache + Concurrency
- `run-golden-comparison`, `run-headless-visual-regression`, and `inspect-score-headless`
  now reuse render cache entries from:
  - `artifacts/.cache/fixture-render/`
- Disable cache for correctness debugging:
  - add `--no-cache`
- Tune throughput:
  - add `--concurrency=<n>` to golden/headless/demo build loops.
- Add timing guardrails:
  - `--timing-budget-ms=<n>`
  - `--fail-on-budget-exceeded`

## Automated Triage Pack
- Run once per focused bug wave:
  - `npm run triage:fixtures -- --fixtures=<id1,id2>`
- Default behavior is report-first (does not fail the command for golden/headless mismatches).
- Enable strict fail-fast mode when needed:
  - `npm run triage:fixtures -- --fixtures=<id1,id2> --strict`
- Headless visual checks run only for fixtures present in `fixtures/evaluation/headless-visual-sentinels.json`; non-sentinel fixture sets are skipped automatically without failing the pack.
- Output:
  - `artifacts/hot-fixture-pack/report.md`
  - golden/headless/inspect links for the same fixture set.
