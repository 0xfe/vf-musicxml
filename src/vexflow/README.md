# VexFlow Adapter

Current baseline implementation is in:
- `src/vexflow/render.ts` (orchestration/layout)
- `src/vexflow/render-note-mapper.ts` (event-to-note mapping)
- `src/vexflow/render-notations.ts` (direction and spanner rendering)

Supported in current M5 baseline:
- Multi-part rendering with vertical part stacking.
- Multi-staff rendering per part (`EffectiveAttributes.staves`) with staff routing.
- Part/staff connector drawing baseline (`singleLeft`, `brace`, score-level/group-derived `bracket`/`brace`/`line`).
- Clef, key signature, time signature (first measure).
- Notes, rests, basic accidentals, basic dotted durations, and barlines.
- Articulation mapping for baseline tokens (`staccato`, `tenuto`, `accent`, `staccatissimo`, `marcato`).
- Direction text rendering (words, tempo, dynamics).
- Baseline harmony-symbol and lyric text attachment.
- Tie/slur/wedge spanner rendering where anchors resolve.

Deferred beyond current M5 baseline:
- Pagination/system breaking.
- Full multi-voice engraving per staff.
- Advanced notation domains and advanced text engraving.

Design and limitation details are documented in `/Users/mo/git/musicxml/docs/rendering-pipeline.md`.
