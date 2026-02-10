# Rendering Pipeline (M6 Baseline)

This document describes the current `Score -> VexFlow` rendering path.

## Scope
- Target milestone: `M6` (advanced notation baseline on top of M5 layout/text support).
- Goal: deterministic rendering path that can be validated mostly with headless SVG tests.
- Non-goals in M6:
  - No pagination.
  - No advanced system-breaking/page-breaking layout.
  - No full multi-voice engraving in a single staff (only first voice per staff rendered with warning).

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
3. Layout planning:
   - Compute maximum measure count across parts.
   - Compute per-part staff counts and vertical row positions.
4. Measure/staff pass:
   - Render staves for each part and each staff across measure columns.
   - First measure applies clef per staff and key/time on staff 1.
   - Draw baseline connectors (`singleLeft`, `brace`, and score-level `bracket` for multi-part).
5. Event mapping:
   - Notes/rests are converted from CSM events into `StaveNote`s.
   - Chords are supported through `NoteEvent.notes[]` mapping.
   - Accidentals and dotted durations are applied where recognized.
6. Voice formatting and draw:
   - A soft-mode VexFlow `Voice` is formatted into measure width.
   - Rendering is currently first-voice-per-staff baseline.
   - Cue notes render with reduced glyph scale.
   - Parsed grace events are attached to following anchors as `GraceNoteGroup`.
7. Tuplet pass:
   - Tuplet start/stop + ratio metadata collected during note mapping.
   - Tuplet groups are drawn after voice draw using VexFlow `Tuplet`.
   - Broken groups degrade with diagnostics.
8. Direction draw pass:
   - Words, dynamics, and tempo are drawn as text above each measure stave.
   - Direction x-position is derived from measure-relative tick offset.
   - Directions are currently drawn on staff 1 in each part/measure.
9. Harmony/Lyric text pass:
   - Harmony symbols are drawn above staff and anchored to nearest rendered note.
   - Lyrics are drawn below staff from note-attached lyric tokens.
   - Text width uses deterministic estimation in headless mode.
10. Spanner draw pass:
   - Tie/slur/wedge relations from `Score.spanners[]` are resolved against rendered event-note anchors.
   - Ties: `StaveTie`
   - Slurs: `Curve`
   - Wedges: `StaveHairpin`
   - Missing anchors degrade with diagnostics (no hard failure).

## Duration Mapping
- CSM durations are normalized on `ticksPerQuarter`.
- Baseline supports common values:
  - whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, sixteenth.
- MusicXML `<type>` + `<dot/>` are preferred when available, which improves tuplet/grace mapping fidelity.
- Unknown ratios currently fall back to quarter note with diagnostic code `UNSUPPORTED_DURATION`.

## Diagnostics Contract
Common renderer diagnostics:
- `CANVAS_NOT_SUPPORTED_IN_M2`
- `PAGINATION_NOT_SUPPORTED_IN_M2`
- `MULTI_VOICE_NOT_SUPPORTED_IN_M2`
- `UNSUPPORTED_DURATION`
- `UNSUPPORTED_CLEF`
- `UNSUPPORTED_TIMED_EVENT`
- `EMPTY_SCORE` / `EMPTY_PART`
- `SPANNER_END_MISSING`
- `SPANNER_ANCHOR_NOT_RENDERED`
- `TIE_RENDER_FAILED`
- `SLUR_RENDER_FAILED`
- `WEDGE_RENDER_FAILED`
- `WEDGE_DIRECTION_TEXT_FALLBACK`
- `UNSUPPORTED_ORNAMENT`
- `GRACE_NOTES_WITHOUT_ANCHOR`
- `UNMATCHED_TUPLET_STOP`
- `UNCLOSED_TUPLET_START`
- `OVERLAPPING_TUPLET_START`
- `TUPLET_NOT_ENOUGH_NOTES`
- `TUPLET_RENDER_FAILED`
- `CUE_NOTE_RENDERED`

## Test Strategy (M6)
- Headless-first:
  - `tests/svg/render-structure.test.ts` asserts SVG structure, M4 notation, and M5 multi-part/multi-staff baseline behavior.
  - `tests/unit/render-note-mapper.test.ts` asserts articulation mapping/degradation and per-staff event routing behavior.
- Browser smoke:
  - `tests/visual/render-visual.spec.ts` confirms visible SVG rendering.
  - `tests/visual/conformance-sentinels.spec.ts` includes notation + layout baseline visual sentinels.
- Conformance tie-in:
  - M4 notation fixture (`notation-m4-baseline`), M5 layout fixture (`layout-m5-multipart-baseline`), M5 text fixture (`text-m5-lyrics-harmony-baseline`), and M6 advanced fixture (`advanced-m6-notation-baseline`) are active in conformance.

## Known Limitations
- Voice engraving remains first-voice-per-staff baseline.
- Complex nested/multi-voice tuplets and advanced beam orchestration remain out of scope.
- Lyric/harmony support is baseline only; advanced typography, melisma alignment, and dense collision avoidance remain pending.
- Slur placement style attributes are parsed but not fully rendered as style variants.
- Dynamics are rendered as text tokens, not full engraving glyph layouts.
- Repeat/ending rendering is baseline stave semantics only, not playback navigation logic.
- No timewise normalization in renderer input (handled in parser milestones).
- Visual snapshots are focused sentinels, not exhaustive score-level pixel baselines.
