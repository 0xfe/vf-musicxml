# VexFlow Adapter

Current baseline implementation is in:
- `src/vexflow/render.ts` (orchestration/layout)
- `src/vexflow/render-note-mapper.ts` (event-to-note mapping)
- `src/vexflow/render-notations.ts` (direction and spanner rendering)

Supported in current M6 baseline:
- Multi-part rendering with vertical part stacking.
- Multi-staff rendering per part (`EffectiveAttributes.staves`) with staff routing.
- Part/staff connector drawing baseline (`singleLeft`, `brace`, score-level/group-derived `bracket`/`brace`/`line`).
- Clef, key signature, time signature (first measure).
- Notes, rests, basic accidentals, basic dotted durations, and barlines.
- Repeat barline and ending/volta semantics from MusicXML `<barline>` metadata.
- Articulation mapping for baseline tokens (`staccato`, `tenuto`, `accent`, `staccatissimo`, `marcato`).
- Ornament mapping baseline (`trill-mark`, `turn`, `inverted-turn`, `mordent`, `inverted-mordent`, `schleifer`).
- Cue note rendering baseline (reduced glyph scale).
- Grace note attachment baseline (`GraceNoteGroup` to following note anchor).
- Tuplet rendering baseline from parsed tuplet endpoints and time-modification ratios.
- Direction text rendering (words, tempo, dynamics).
- Baseline harmony-symbol and lyric text attachment.
- Tie/slur/wedge spanner rendering where anchors resolve.

Deferred beyond current M6 baseline:
- Pagination/system breaking.
- Full multi-voice engraving per staff.
- Deep nested tuplet handling, full repeat-playback semantics, and advanced text engraving.

Design and limitation details are documented in `/Users/mo/git/musicxml/docs/rendering-pipeline.md`.
