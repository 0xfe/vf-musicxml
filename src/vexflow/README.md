# VexFlow Adapter

Current baseline implementation is split into focused modules:
- `src/vexflow/render.ts`: top-level orchestration and system/page planning.
- `src/vexflow/render-drawing.ts`: page text, part labels, beam preparation, and connector/barline drawing helpers.
- `src/vexflow/render-note-mapper.ts`: note/rest/grace/tuplet mapping orchestration for one measure+staff.
- `src/vexflow/render-note-mapper-mappings.ts`: duration/accidental/articulation/ornament mapping tables and helpers.
- `src/vexflow/render-notations-core.ts`: event-note lookup registration helpers shared by notation passes.
- `src/vexflow/render-notations-text.ts`: direction, harmony, and lyric text rendering.
- `src/vexflow/render-notations-spanners.ts`: tuplet, tie, slur, and wedge drawing.
- `src/vexflow/render-notations.ts`: stable public re-export surface for notation helpers.

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
