# Layout Heuristics (M5 Baseline)

This document captures the current deterministic layout rules used by the renderer after M5 baseline work.

## Goals
- Keep layout deterministic for headless and visual regression tests.
- Support multi-part and multi-staff scores without introducing unstable engraving heuristics.
- Preserve parser/renderer decoupling by deriving layout from CSM only.

## Current rules

1. System shape
- Single-page, single-system baseline.
- No pagination or system-breaking in M5.

2. Horizontal measure grid
- Measure columns are aligned across parts.
- `measureCount = max(part.measures.length)` across parts.
- `measureWidth = max(160, floor((pageWidth - margins) / measureCount))`.
- Parts with fewer measures leave later columns visually empty for alignment stability.

3. Vertical part/staff layout
- Each part gets a contiguous vertical block.
- Per-part staff count is `max(measure.effectiveAttributes.staves)` across that part's measures.
- Staff rows are evenly spaced with fixed constants:
  - `STAFF_ROW_HEIGHT = 110`
  - `PART_GAP = 30`

4. Clef/key/time placement
- Clef is applied per staff on the first measure column.
- Key/time are applied to staff 1 on first measure column.

5. Voice baseline
- Renderer remains single-voice-per-staff in M5.
- If multiple voices target one staff, first voice is rendered and diagnostic `MULTI_VOICE_NOT_SUPPORTED_IN_M2` is emitted.

6. Staff routing
- Events route by `event.staff` when present, else default to staff 1.
- Routing is applied consistently to notes/rests and note-anchor maps used by notations/lyrics/harmony.

7. Connectors
- Intra-part multi-staff connectors:
  - `singleLeft` each measure column.
  - `brace` on first column.
- Inter-part connectors:
  - Derived from `part-list` part-group metadata (`groupPath` tokens from parser).
  - Symbol mapping:
    - `brace` -> `brace`
    - `bracket` -> `bracket`
    - `line` -> `singleLeft`
    - `none` -> omit connector
  - If no part-group connectors are produced and score has multiple parts, fallback score-level `bracket` is drawn.

8. Text overlays
- Directions: above staff 1.
- Harmony symbols: above staff, anchored to nearest rendered note (offset interpolation fallback).
- Lyrics: below staff, centered by deterministic text-width estimate.

## Stability notes
- Text width is estimated (`fontSize * 0.6 * text.length`) for headless consistency; this avoids JSDOM `getBBox` dependency.
- Collision auditing now supports `<text>` bounds for lyric/harmony overlap checks.

## Known limitations
- No dynamic spacing for dense lyric/harmony passages.
- No advanced lyric alignment (melisma extension lines, hyphen continuation lines, verse stacking policies beyond simple line numbers).
- No pagination/system balancing.
