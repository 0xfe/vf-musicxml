# CSM Overview (M1)

Core hierarchy:
- `Score`
- `PartDefinition[]` + `Part[]`
- `Part.measures[]`
- `Measure.voices[]`
- `VoiceTimeline.events[]` (`NoteEvent | RestEvent | TupletEvent`)

Timing model:
- Global `Score.ticksPerQuarter` (480 in M1).
- Measure events use integer `offsetTicks` and `durationTicks`.

Normalization rules:
- `<backup>` / `<forward>` are consumed during transform.
- `<chord/>` notes are merged into `NoteEvent.notes[]`.

Cross-measure relations:
- `Score.spanners[]` reserved for tie/slur/wedge relation linking in later milestones.
