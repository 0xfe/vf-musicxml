# CSM Overview (M4)

The canonical score model (CSM) is the parser output and renderer input.

## Core hierarchy
- `Score`
- `PartDefinition[]` + `Part[]`
- `Part.measures[]`
- `Measure.voices[]`
- `VoiceTimeline.events[]` (`NoteEvent | RestEvent | TupletEvent`)

## Timing model
- Global `Score.ticksPerQuarter` (currently `480`) defines timing resolution.
- Measure events use integer `offsetTicks` and `durationTicks`.
- `<backup>` / `<forward>` are consumed during transform and do not survive in CSM.
- `<chord/>` notes are merged into `NoteEvent.notes[]` at one shared onset.

## Direction and notation model
- Measure-level directions:
  - `Measure.directions[]` stores words, tempo, dynamics, and wedge tokens.
- Measure-level harmony:
  - `Measure.harmonies[]` stores harmony symbols with measure-relative offsets.
- Note-level notation:
  - `NoteData.ties[]`, `NoteData.slurs[]`, `NoteData.articulations[]`, and `NoteData.lyrics[]`.
- Cross-event relations:
  - `Score.spanners[]` stores normalized tie/slur/wedge relations with `EventRef` anchors.
  - Spanner linking is built after measure parsing and emits diagnostics for unmatched/unclosed markers.

## Why this shape
- Parser and renderer are decoupled by stable, backend-independent structures.
- Renderer can degrade gracefully: if notation anchors cannot be resolved, diagnostics are emitted and core rendering continues.
- Testability is improved: parser tests assert CSM semantics, and renderer tests assert mapping behavior independently.
