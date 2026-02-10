# Notation Support Matrix (M4)

This matrix tracks current notation/direction behavior after M4.

## Implemented in M4 baseline

| Area | Parser | Renderer | Notes |
|---|---|---|---|
| Tie endpoints (`<tie type="start/stop">`) | Yes | Yes | Linked into `Score.spanners[]` and drawn via `StaveTie`. |
| Slur endpoints (`<notations><slur ...>`) | Yes | Yes | `number`/`placement`/`line-type` are preserved; curves drawn via `Curve`. |
| Articulations (`<notations><articulations>`) | Yes | Partial | Supported render tokens: `staccato`, `tenuto`, `accent`, `staccatissimo`, `marcato`. Unknown tokens emit `UNSUPPORTED_ARTICULATION`. |
| Direction words (`<direction-type><words>`) | Yes | Yes | Drawn as text above stave with offset-based placement. |
| Tempo (`<sound tempo="...">`) | Yes | Yes | Rendered as text (`q = N`) in direction lane. |
| Dynamics (`<direction-type><dynamics>`) | Yes | Yes | Rendered as text token list in direction lane. |
| Wedges (`<direction-type><wedge>`) | Yes | Yes | Start/stop linked into wedge spanners; drawn via `StaveHairpin` when anchors resolve. |

## Diagnostics / graceful degradation
- Parser spanner linking diagnostics:
  - `UNMATCHED_TIE_STOP`, `UNCLOSED_TIE_START`
  - `UNMATCHED_SLUR_STOP`, `UNCLOSED_SLUR_START`
  - `WEDGE_ANCHOR_NOT_FOUND`, `UNMATCHED_WEDGE_STOP`, `UNCLOSED_WEDGE_START`
- Renderer notation diagnostics:
  - `SPANNER_END_MISSING`, `SPANNER_ANCHOR_NOT_RENDERED`
  - `TIE_RENDER_FAILED`, `SLUR_RENDER_FAILED`, `WEDGE_RENDER_FAILED`
  - `WEDGE_DIRECTION_TEXT_FALLBACK`, `DIRECTION_CONTEXT_UNAVAILABLE`

## Known M4 gaps
- Rendering remains first-part / first-voice baseline; notation spanner anchors outside rendered scope are skipped with diagnostics.
- Slur `placement` and `line-type` are preserved in CSM but not fully expressed as visual style variants yet.
- Dynamics are text-rendered only (no dedicated engraving glyph/layout system yet).
- Advanced notation domains (grace notes, ornaments, repeats/endings, complex tuplets, cue sizing) remain out of scope until later milestones.

## Promotion path
- M5: multi-part/multi-voice anchor coverage and richer text/layout interactions.
- M6+: advanced notation support and conformance promotion across broader LilyPond fixture categories.
