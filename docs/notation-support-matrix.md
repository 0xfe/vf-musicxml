# Notation Support Matrix (M6)

This matrix tracks current notation and direction behavior after M6.

## Implemented in baseline

| Area | Parser | Renderer | Notes |
|---|---|---|---|
| Tie endpoints (`<tie type="start/stop">`) | Yes | Yes | Linked into `Score.spanners[]` and drawn via `StaveTie`. |
| Slur endpoints (`<notations><slur ...>`) | Yes | Yes | `number`/`placement`/`line-type` are preserved; curves drawn via `Curve`. |
| Articulations (`<notations><articulations>`) | Yes | Partial | Supported render tokens: `staccato`, `tenuto`, `accent`, `staccatissimo`, `marcato`. |
| Direction words/tempo/dynamics/wedges | Yes | Yes | Words, tempo, and dynamics are text-rendered; wedges render as `StaveHairpin` when anchors resolve. |
| Harmony/lyric text | Yes | Yes | Baseline attachment and deterministic headless width estimation. |
| Grace notes (`<grace .../>`) | Yes | Yes | Parsed as non-advancing note events and attached as `GraceNoteGroup` to following anchor note. |
| Cue notes (`<cue/>`) | Yes | Partial | Cue flag parsed; rendered with reduced glyph scale (`CUE_NOTE_RENDERED` info diagnostic). |
| Ornaments (`<notations><ornaments>`) | Yes | Partial | Supported tokens: `trill-mark`, `turn`, `inverted-turn`, `mordent`, `inverted-mordent`, `schleifer`. |
| Tuplets (`<notations><tuplet>`, `<time-modification>`) | Yes | Yes (baseline) | Tuplet start/stop and ratios parse to event metadata and render via `Tuplet` groups. |
| Repeats/endings (`<barline><repeat|ending>`) | Yes | Yes (baseline) | Barline repeat + volta metadata parsed and mapped to `setBegBarType`/`setEndBarType`/`setVoltaType`. |

## Diagnostics / graceful degradation
- Parser/linking diagnostics:
  - `UNMATCHED_TIE_STOP`, `UNCLOSED_TIE_START`
  - `UNMATCHED_SLUR_STOP`, `UNCLOSED_SLUR_START`
  - `WEDGE_ANCHOR_NOT_FOUND`, `UNMATCHED_WEDGE_STOP`, `UNCLOSED_WEDGE_START`
- Renderer notation diagnostics:
  - `SPANNER_END_MISSING`, `SPANNER_ANCHOR_NOT_RENDERED`
  - `TIE_RENDER_FAILED`, `SLUR_RENDER_FAILED`, `WEDGE_RENDER_FAILED`
  - `UNSUPPORTED_ARTICULATION`, `UNSUPPORTED_ORNAMENT`
  - `GRACE_NOTES_WITHOUT_ANCHOR`
  - `UNMATCHED_TUPLET_STOP`, `UNCLOSED_TUPLET_START`, `OVERLAPPING_TUPLET_START`
  - `TUPLET_NOT_ENOUGH_NOTES`, `TUPLET_RENDER_FAILED`
  - `CUE_NOTE_RENDERED` (informational cue-size marker)

## Known M6 gaps
- Rendering remains single-voice-per-staff baseline in mixed-voice measures.
- Ornament coverage is intentionally partial and token-based.
- Tuplet rendering is measure-local baseline; complex nested/multi-voice tuplets need deeper layout work.
- Volta/repeat handling is first-pass and not a full playback/navigation model.
- Dynamics remain text-rendered (not engraved glyph layout).

## Promotion path
- M7: broaden conformance promotion across LilyPond advanced categories and tighten fallback behavior where currently partial.
