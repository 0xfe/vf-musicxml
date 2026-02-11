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
- `formatVoiceToStave` (`src/vexflow/render.ts`) uses `Formatter.formatToStave(...)` so first-measure modifier widths (clef/key/time) are respected; avoid fixed-width formatter calls for production layout.
- `drawMeasureBeams` (`src/vexflow/render.ts`) centralizes `Beam.generateBeams(...)` + draw logic for reusable beam-quality diagnostics.

## Geometry audit helpers for renderer triage
- `src/testkit/notation-geometry.ts` exposes reusable SVG geometry tooling:
  - `collectNotationGeometry(...)`
  - `detectNoteheadBarlineIntrusions(...)`
  - `summarizeNotationGeometry(...)`
- Primary use cases:
  - detect notehead/barline bleed regressions caused by spacing/format bugs
  - assert beam presence in complex fixtures (for example real-world chorales)
- Current regression gates:
  - `tests/integration/render-quality-regressions.test.ts`

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

## M7D tracking and release-hardening docs
- Gap registry:
  - `/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json`
- Registry validation:
  - `npm run vexflow:gaps:check`
- Upstream brief generation:
  - `npm run vexflow:gaps:brief`
- Upstream playbook:
  - `/Users/mo/git/musicxml/docs/vexflow-upstream-playbook.md`
- Sync log:
  - `/Users/mo/git/musicxml/docs/vexflow-upstream-sync-log.md`
- Release checklist:
  - `/Users/mo/git/musicxml/docs/release-hardening-checklist.md`
