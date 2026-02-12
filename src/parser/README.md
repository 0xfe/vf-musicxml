# Parser Layout

Parser responsibilities are now split into cohesive modules:

- `src/parser/parse.ts`: top-level MusicXML parse orchestration and score assembly.
- `src/parser/parse-note.ts`: note/rest event orchestration plus stable re-exports for note-related helpers.
- `src/parser/parse-note-data.ts`: pitch/unpitched/accidental/tie parsing and `NoteData` assembly.
- `src/parser/parse-note-notations.ts`: articulations, ornaments, slurs, lyrics, tuplets, and time-modification parsing.
- `src/parser/parse-direction-events.ts`: direction words/tempo/dynamics/wedge parsing.
- `src/parser/parse-measure-events.ts`: barlines, harmony events, attribute updates, and duration-tick conversion.
- `src/parser/parse-timing.ts`: measure timing normalization and attribute application.
- `src/parser/parse-spanners.ts`: cross-event tie/slur/wedge relation assembly.
- `src/parser/xml-ast.ts` + `src/parser/xml-utils.ts`: XML parsing and AST utilities.

`src/parser/parse-note.ts` keeps the existing public import surface used by `parse.ts` and tests, while delegating heavy logic to the extracted modules.
