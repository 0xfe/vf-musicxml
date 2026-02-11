# TODO / Risks Backlog (Completed)

This file tracks closed risks and bugs moved out of the active backlog.

## Closed Risks

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
