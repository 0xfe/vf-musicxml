# VexFlow Tips

## Versioning and dependency model
- Runtime contract is `vexflow` as a peer dependency.
- Dev/test baseline is pinned in `package.json` (`4.2.3` currently).
- Keep local compatibility shims in `src/vexflow/*`; avoid leaking VexFlow specifics into parser/core.

## Current renderer scope (M6)
- Rendering supports:
  - multi-part vertical stacking
  - multi-staff routing
  - single-voice-per-staff baseline
  - notation/text layers (ties/slurs/wedges, harmony/lyrics, tuplets)
- M6 additions:
  - `GraceNote` + `GraceNoteGroup` for grace attachment.
  - `Ornament` for mapped ornament tokens.
  - `Tuplet` for parsed tuplet endpoint groups.
  - `BarlineType` + `VoltaType` for repeat and ending semantics.
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
- Grace notes often have no `<duration>`; map them to a stable visual default instead of treating as fatal.
- MusicXML `<type>` + `<dot/>` usually gives better VexFlow duration mapping than pure tick ratios.
- Tuplet groups should be built from explicit start/stop markers, then rendered after voice draw.

## If VexFlow patches are needed
- Keep app changes isolated with small compatibility wrappers first.
- For temporary local fixes, prefer small patch-based approach.
- Track intended upstream PR scope in `/Users/mo/git/musicxml/docs/planning/todo.md` with fixture-backed repro.
- Use dedicated branch for VexFlow patch prep when needed (`codex/vexflow-<scope>`).
