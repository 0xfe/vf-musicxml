# Playwright / Visual Test Tips

## Which path to use
- Default visual regression in CI/headless hosts: use browser-free command `npm run test:visual:headless`.
- Fast single-score triage path: `npm run inspect:score -- --input=<path-to-score.musicxml-or-.mxl>`.
- Browser-required interactive checks in Codex: use Playwright MCP browser tools.
- Browser snapshot suite (`npm run test:visual`): keep as selective sentinel/triage coverage.

## Local CLI setup required in this repo
```bash
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4
```

## Why repo-local browser path is mandatory
- Avoids host cache dependency on `~/Library/Caches/ms-playwright`.
- Prevents architecture mismatch churn across agent/runtime environments.
- Keeps local/CI behavior more predictable.

## Architecture mismatch fix
If executable path mismatch appears (e.g., expected `mac-x64` but only `mac-arm64` exists):
```bash
rm -rf /Users/mo/git/musicxml/.playwright
PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium --force
```

## Test strategy in this repo
- Treat browser snapshots as selective regression sentinels.
- Prefer browser-free visual diffs for high-volume fixture checks.
- Keep primary correctness checks headless (`test:unit`, `test:integration`, `test:svg`, `test:conformance`).
- Prefer structural SVG assertions and collision audits before expanding screenshot baselines.

## Browser-free visual pipeline
```bash
npm run test:visual:headless:update
npm run test:visual:headless
npm run inspect:score -- --input=fixtures/conformance/lilypond/01a-pitches-pitches.musicxml
```

- Uses `resvg` for SVG-to-PNG rasterization (no Chromium).
- Diffs with `pixelmatch` and computes SSIM.
- Artifacts:
  - baselines: `/Users/mo/git/musicxml/tests/visual-headless/baselines/`
  - run outputs: `/Users/mo/git/musicxml/artifacts/visual-headless/`
- Fixture list:
  - `/Users/mo/git/musicxml/fixtures/evaluation/headless-visual-sentinels.json`

## Environment caveat (restricted sandboxes)
- Some restricted macOS sandboxes can fail Chromium headless launch with:
  - `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`
- MCP Chrome launches can also fail when the profile is already attached to an existing browser session (`Opening in existing browser session`).
- In this repository, visual tests do pass when runtime permissions allow launch.
- If that permission error appears again:
  - Keep non-visual gates as merge blockers.
  - Use Playwright MCP browser checks for targeted browser validation.
