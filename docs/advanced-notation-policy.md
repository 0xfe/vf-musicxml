# Advanced Notation Policy (M6)

This policy defines how advanced MusicXML constructs are handled in the M6 baseline.

## Scope (M6)
- Grace notes (`<grace>`)
- Cue notes (`<cue>`)
- Ornaments (`<notations><ornaments>`)
- Tuplets (`<notations><tuplet>` + `<time-modification>`)
- Repeats and endings (`<barline><repeat|ending>`)

## Policy
1. Parse-first correctness: advanced data is preserved in CSM even when rendering falls back.
2. Deterministic fallback: unsupported tokens degrade with stable diagnostic codes.
3. Headless default: behavior is validated with parser/integration/svg tests first.
4. Selective browser checks: visual tests are sentinel-based, not exhaustive.

## Rendering behavior by domain
- Grace notes:
  - Parsed as non-advancing note events.
  - Attached to the next rendered note using `GraceNoteGroup`.
  - If no anchor note exists, emit `GRACE_NOTES_WITHOUT_ANCHOR`.
- Cue notes:
  - Parsed from `<cue/>`.
  - Rendered with reduced glyph scale.
  - Emit informational `CUE_NOTE_RENDERED` when cue rendering is applied.
- Ornaments:
  - Known token map is explicit and test-covered.
  - Unknown tokens emit `UNSUPPORTED_ORNAMENT` and are skipped.
- Tuplets:
  - Start/stop endpoints and ratio metadata are parsed per note event.
  - Renderer groups captured notes and draws VexFlow `Tuplet` modifiers.
  - Broken/ambiguous groups emit `UNMATCHED_TUPLET_STOP`, `UNCLOSED_TUPLET_START`, or `OVERLAPPING_TUPLET_START`.
- Repeats/endings:
  - Measure barlines preserve left/right repeat and ending metadata.
  - Renderer maps to stave begin/end repeat barlines and volta styles.

## Conformance expectations
- Each advanced fixture must include explicit metadata and collision audit policy.
- Any expected-fail fixture requires rationale and linked TODO/risk id.
- Promotion from expected-fail to expected-pass must include deterministic regression tests.

## Out-of-scope in M6
- Full repeat-playback graph semantics.
- Dense nested tuplet engraving across voices/staves.
- Full ornament vocabulary and advanced placement tuning.
