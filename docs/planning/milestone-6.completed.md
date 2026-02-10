## M6: Advanced Notation Coverage
Outcome (Completed):
- Advanced notation baseline with explicit fallback rules.

Delivered:
- Parser/model support for:
  - Grace notes (`<grace>`), cue notes (`<cue>`), ornaments (`<notations><ornaments>`).
  - Tuplet endpoint + ratio metadata (`<notations><tuplet>` and `<time-modification>`).
  - Repeat and ending metadata on measure barlines (`<barline><repeat|ending>`).
- Renderer support for:
  - Grace-note attachment via `GraceNoteGroup`.
  - Cue-sized notes (reduced glyph scale + informational diagnostics).
  - Ornament mapping baseline.
  - Tuplet drawing pass via VexFlow `Tuplet`.
  - Repeat/ending stave semantics (`setBegBarType`, `setEndBarType`, `setVoltaType`).
- Conformance promotion:
  - Added active M6 fixture (`advanced-m6-notation-baseline`) with collision-audit policy.

Testing gates (Completed):
- Added deterministic unit/integration/svg/conformance regressions for grace, cue, ornament, tuplet, repeat, and ending behavior.
- Expanded conformance execution assertions to include advanced category rollups and expected-pass verification.

Docs gates (Completed):
- Added advanced fallback policy (`docs/advanced-notation-policy.md`).
- Updated notation matrix and rendering pipeline docs for M6 behavior and known gaps.

