# VexFlow Adapter

M2 baseline implementation is in `src/vexflow/render.ts`.

Supported in M2:
- Single-part rendering (first part only).
- Clef, key signature, time signature (first measure).
- Notes, rests, basic accidentals, basic dotted durations, and barlines.

Deferred beyond M2:
- Pagination and multi-part layout.
- Full multi-voice engraving.
- Advanced notations/directions and collision management.

Design and limitation details are documented in `/Users/mo/git/musicxml/docs/rendering-pipeline.md`.
