# Playwright / Visual Test Tips

## Which path to use
- Browser-required interactive checks in Codex: use Playwright MCP browser tools.
- Repository visual test command (`npm run test:visual`): local Playwright CLI.

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
- Treat visual tests as selective regression sentinels.
- Keep primary correctness checks headless (`test:unit`, `test:integration`, `test:svg`, `test:conformance`).
- Prefer structural SVG assertions and collision audits before expanding screenshot baselines.

## Environment caveat (restricted sandboxes)
- Some restricted macOS sandboxes can fail Chromium headless launch with:
  - `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`
- MCP Chrome launches can also fail when the profile is already attached to an existing browser session (`Opening in existing browser session`).
- In this repository, visual tests do pass when runtime permissions allow launch.
- If that permission error appears again:
  - Keep non-visual gates as merge blockers.
  - Use Playwright MCP browser checks for targeted browser validation.
