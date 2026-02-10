# AGENTS.md

This repository tracks a staged buildout of a MusicXML parser + VexFlow renderer.

## Scope discipline
- Execute milestone scope only. Do not pull advanced notation work into early milestones.
- Keep `plan.md` status and progress log current while milestones execute.
- Track bugs, risks, and waivers in `todo.md` with priority and status.
- Keep `/Users/mo/git/musicxml/ai-state.md` current so future AI agents can resume quickly without deep rediscovery.
- For complex dependencies/tooling, maintain focused tips docs under `/Users/mo/git/musicxml/docs/` (for example VexFlow, MusicXML, Playwright/tooling).
- Keep demo coverage current: as milestones add capabilities, add or update MusicXML demos under `/Users/mo/git/musicxml/demos/scores/` and keep demo build/view instructions current.

## Branch and change policy
- We might have to make changes to vexflow, make patch updates locally and track all vexflow changes in a separate branch, so we can
  send PRs to vexflow when we're ready.

### Design

Write cohesive, decoupled, modular code. Interfaces should be simple, crisp, and clear. Design for testability and extensibility. Try to keep functions small, tight, and reusable. Try to avoid very large files -- break them up into smaller cohesive files as needed.

Always write tests -- and run them in between changes.

### Commenting Style

Write lots of comments, be detailed (but concise) -- humans should be able to read the code and understand what's going on. Pay attention to the why more than the what or how, however do comment on the what and how if things are complex.

Every function, constant, enum, class, or major relevant identifier should be clearly commented. Try to avoid long functions, but in cases where they're unavoidable, make sure to add a lot more commenting to the body so a human can understand what's going on.

## Test policy
- Default to headless tests for parser/model correctness.
- Visual regression tests are selective and introduced after rendering baseline exists.
  - Even here, try to avoid visual tests unless there's no other option. E.g., consider building test tooling to compare SVG structure, look for collisions, etc.
  - But don't overdo it -- visual tests are still useful for catching regressions, especially where the SVG structure is complex or hard to reason about.
- Every behavior change should have at least one deterministic test.
- Use the Playwright MCP server for tests that require the browser.
- Local Playwright CLI setup (for `npm run test:visual`) must use repo-local browser binaries:
  - Install: `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npx playwright install chromium`
  - Run tests: `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4`
  - Do not assume default Playwright cache under `~/Library/Caches/ms-playwright` is available.
  - If browser architecture path mismatches (e.g. expected `mac-x64` but only `mac-arm64` exists), reinstall from this repo runtime with `--force`.

## Conformance policy
- Use per-fixture metadata under `fixtures/conformance/**`.
- Every expected failure requires rationale and linked TODO/risk.

## Command set
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:svg`
- `npm run test:conformance`
- `npm run test:conformance:report`
- `npm run test:visual`
- `npm run test:visual:update`
- `npm run demos:build`
- `npm run demos:serve`

## Distribution
- ESM-first package layout.
- `vexflow` remains a peer dependency (with a pinned dev version for testing).
