# Rendering Pipeline (M2 Baseline)

This document describes the currently implemented `Score -> VexFlow` rendering path.

## Scope
- Target milestone: `M2` (single-part, single-staff, single-page baseline).
- Goal: deterministic rendering path that can be validated mostly with headless SVG tests.
- Non-goals in M2:
  - No pagination.
  - No multi-part layout.
  - No multi-voice engraving in a single measure (only first voice rendered with warning).

## Entry Points
- `renderToSVGPages(score, options)`:
  - Uses JSDOM + VexFlow SVG backend.
  - Returns `pages: string[]` and renderer diagnostics.
  - Used for server-side/headless tests and fixture assertions.
- `renderToElement(score, container, options)`:
  - Renders directly into a caller-provided DOM node.
  - Returns `pageCount`, diagnostics, and `dispose()` to clear rendered output.

## Pipeline Steps
1. Input validation:
   - Empty score/part conditions are reported as diagnostics.
   - Unsupported options (`backend: "canvas"`, `paginate: true`) degrade with warnings.
2. Environment setup:
   - A rendering host element is created under the target container.
   - DOM globals are temporarily bridged so VexFlow can render in both browser and JSDOM contexts.
3. Measure pass:
   - Render one stave per measure in the first part.
   - First measure applies clef, key signature, and time signature.
4. Event mapping:
   - Notes/rests are converted from CSM events into `StaveNote`s.
   - Chords are supported through `NoteEvent.notes[]` mapping.
   - Accidentals and dotted durations are applied where recognized.
5. Voice formatting:
   - A soft-mode VexFlow `Voice` is formatted into the measure width.
   - Unsupported timed events (e.g., tuplet placeholders) emit warnings and are skipped.

## Duration Mapping
- CSM durations are normalized on `ticksPerQuarter`.
- M2 supports common baseline values:
  - whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, sixteenth.
- Unknown ratios currently fall back to quarter note with diagnostic code `UNSUPPORTED_DURATION`.

## Diagnostics Contract
Common M2 renderer diagnostics:
- `CANVAS_NOT_SUPPORTED_IN_M2`
- `PAGINATION_NOT_SUPPORTED_IN_M2`
- `MULTI_PART_NOT_SUPPORTED_IN_M2`
- `MULTI_VOICE_NOT_SUPPORTED_IN_M2`
- `UNSUPPORTED_DURATION`
- `UNSUPPORTED_CLEF`
- `UNSUPPORTED_TIMED_EVENT`
- `EMPTY_SCORE` / `EMPTY_PART`

## Test Strategy (M2)
- Headless-first:
  - `tests/svg/render-structure.test.ts` asserts presence of SVG/stave/note structures and warning behavior.
- Browser smoke:
  - `tests/visual/render-visual.spec.ts` confirms visible SVG rendering in Playwright.
- Conformance tie-in:
  - M2 currently validates against smoke-level fixtures only; broader corpus expansion starts in M3+.

## Known Limitations
- Single part rendered, first voice only.
- No explicit support for tuplets, beams, ties/slurs, dynamics, lyrics, harmony, or wedges.
- No timewise normalization in renderer input (handled in parser milestones).
- No pixel-baseline snapshots yet; browser visual coverage is currently smoke-level.
