# TODO / Risks Backlog (Completed)

This file tracks closed risks and bugs moved out of the active backlog.

## Closed Risks

### R-021: Clef-state drift under partial multi-staff attribute updates
- Priority: P0
- Status: CLOSED
- Risk: Partial `<attributes><clef>` updates could replace the full clef state and leak wrong clefs across staves, producing register and collision regressions in real-world multi-staff scores.
- Mitigation plan:
  - Parser now merges clef updates by `staff` instead of replacing the whole clef array.
  - Clef parsing honors `clef@number` and uses source-order fallback when multiple unnumbered clefs appear.
  - Added parser regression test for partial-clef updates preserving unchanged staves.
  - Renderer clef lookup now avoids cross-staff fallback and supports small mid-system clef-change glyphs.
- Close criteria:
  - Schumann/Mozart proof-point pages no longer show staff-clef swaps from partial updates.
  - Parser regression tests pass.

### R-003: Conformance scope creep (LilyPond suite breadth)
- Priority: P0
- Status: CLOSED
- Risk: Trying to support all tests without phased gating may stall progress.
- Mitigation plan:
  - Used milestone-based expected pass/fail metadata and explicit failure rationale.
  - Imported the full LilyPond collated suite into active conformance fixtures (156 total) with deterministic source parity checks.
  - Added representative real-world breadth set (8 active fixtures) with required bucket + long-form coverage gates.
  - Added executable M7A threshold assertions for expected-pass success, unexpected failures, and category floors.
  - Added explicit malformed-source waiver policy for the only LilyPond expected-fail fixture (`lilypond-23c-tuplet-display-nonstandard`).
- Close criteria:
  - Conformance metadata exists with ownership/expected status for every imported fixture.

### R-006: `.mxl` container handling edge cases
- Priority: P1
- Status: CLOSED
- Risk: Compressed container support can fail on real-world archives.
- Mitigation plan:
  - Implemented baseline `.mxl` ZIP/container support in M3 (`container.xml` rootfile resolution + fallback lookup + diagnostics).
  - Added malformed/archive edge coverage: missing referenced rootfile path, malformed `container.xml` fallback, unsupported compression method handling, and truncated archive rejection.
  - Keep extending fixture corpus as broader conformance suites are imported.
- Close criteria:
  - `.mxl` happy path and malformed archive cases covered by tests.

## Closed Bugs

- B-002 (P1, CLOSED): `24a-GraceNotes.xml` runtime throw (`BadArguments` from `GraceNoteGroup` beaming) is mitigated by graceful beaming fallback (`GRACE_NOTES_BEAMING_FAILED` warning), and fixture `lilypond-24a-gracenotes` is now active expected-pass.
- B-003 (P1, CLOSED): `lilypond-01a-pitches-pitches` first-measure noteheads intruded across the opening barline due fixed-width formatting (`measureWidth - 30`); renderer now uses stave-aware formatting (`Formatter.formatToStave`) with first-column width compensation and deterministic geometry regression checks.
- B-004 (P1, CLOSED): `realworld-music21-bach-bwv1-6` rendered without beam groups; renderer now performs centralized per-voice `Beam.generateBeams(...)` drawing and regression tests enforce non-zero beam output for this fixture family.
- B-005 (P1, CLOSED): Beamed notes rendered with visible flags in `realworld-music21-bach-bwv1-6` and similar fixtures; renderer now prepares beam groups before note draw (so VexFlow suppresses flags) and conformance gates enforce zero expected-pass flag/beam overlaps.
- B-012 (P1, CLOSED): Direction/dynamics/text lane-collision hardening is now locked by broader category-31/71 deterministic overlap gates (`31a<=2`, `31d<=2`, `71f<=1`, plus added `31b/31c/31f/71a/71c/71d/71e` sweep at zero overlaps) and maintained without regressions in current targeted integration coverage.
