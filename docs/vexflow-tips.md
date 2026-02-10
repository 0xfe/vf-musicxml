# VexFlow Tips

## Versioning and dependency model
- Runtime contract is `vexflow` as a peer dependency.
- Dev/test baseline is pinned in `package.json` (`4.2.3` currently).
- Keep local compatibility shims in `src/vexflow/*`; avoid leaking VexFlow specifics into parser/core.

## Current renderer scope (M2/M3)
- Rendering intentionally constrained:
  - first part only
  - first voice for each measure
  - single-page horizontal measure layout
- Unsupported/partial behavior should emit diagnostics instead of silently failing.

## Important integration patterns in this repo
- `renderScoreToSVGPages` for deterministic headless SVG assertions.
- `renderScoreToElement` for browser DOM integration.
- `ensureDomGlobals` bridges jsdom/browser differences for VexFlow internals.
- `render-note-mapper.ts` is the main translation boundary from CSM events to `StaveNote`.

## Common pitfalls
- Text/layout can differ between Node/jsdom and browser environments.
  - Keep structural tests headless.
  - Keep visual tests selective and high-signal.
- Duration mapping currently supports a limited vocabulary.
  - Unmapped durations degrade with warnings.
- Multi-part/multi-voice rendering is intentionally deferred; do not widen scope inside M3.

## If VexFlow patches are needed
- Keep app changes isolated with small compatibility wrappers first.
- For temporary local fixes, prefer small patch-based approach.
- Track intended upstream PR scope in `todo.md` with fixture-backed repro.
- Use dedicated branch for VexFlow patch prep when needed (`codex/vexflow-<scope>`).
