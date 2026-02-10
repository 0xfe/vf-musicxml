# Timing Model (M3)

This note defines how MusicXML event timing is normalized into the canonical score model (CSM).

## Goals
- Keep timing deterministic and integer-based.
- Preserve voice-relative offsets for parser and renderer consumers.
- Surface malformed timing with stable diagnostics, while remaining lenient by default.

## Core Units
- `Score.ticksPerQuarter` is fixed at `480`.
- Every parsed duration is converted from MusicXML divisions into ticks:
  - `ticksPerDivision = ticksPerQuarter / divisions`
  - `durationTicks = duration * ticksPerDivision`

If divisions are missing/invalid, parser diagnostics are emitted and conservative defaults are used in lenient mode.

## Measure Cursor Model
Each part-measure parse uses a mutable measure cursor:
- Cursor starts at tick `0`.
- `<note>` and `<forward>` advance cursor by their converted duration.
- `<backup>` moves cursor backward by its converted duration.
- `<chord/>` notes do not advance cursor and reuse the previous note start offset.

For each logical voice, events are appended into that voice timeline using:
- `offsetTicks`: cursor value at event start.
- `durationTicks`: normalized duration in ticks.

## Timing Invariants
The parser enforces these invariants and maps violations to diagnostics:

1. Cursor must not go below measure start (`0`).
   - Diagnostic: `BACKUP_BEFORE_MEASURE_START`
2. Cursor should not exceed expected measure duration when time signature is known.
   - Diagnostic: `MEASURE_CURSOR_OVERFLOW`
3. Normalized event durations must be positive to render meaningfully.
   - Diagnostic: `NON_POSITIVE_DURATION` (render-time warning for unsupported/invalid events)

## Worked Example: Two Voices with Backup/Forward

Input sketch (single 4/4 measure, `divisions=1`):

```xml
<note voice="1" duration="1" />
<backup duration="1" />
<note voice="2" duration="1" />
<forward duration="3" />
```

Normalization (`ticksPerDivision=480`):
- Voice 1 note at `offsetTicks=0`, `durationTicks=480`
- Backup rewinds cursor from `480` to `0`
- Voice 2 note at `offsetTicks=0`, `durationTicks=480`
- Forward advances cursor from `480` to `1920` (measure end for 4/4)

## Worked Example: Chord Semantics

Input sketch:

```xml
<note duration="2"><pitch>...</pitch></note>
<note><chord/><duration>2</duration><pitch>...</pitch></note>
```

Normalization:
- First note creates a timed event at cursor `offsetTicks`.
- Chord note is folded into the same event's `notes[]` payload.
- Cursor advances once for the full chord duration, not per chord member.

## Strict vs Lenient Behavior
- `lenient` mode: recoverable timing issues can continue with warnings.
- `strict` mode: warning-level normalization issues are promoted to errors and fail parse output.

## Test Coverage Pointers
- Parser timing/property coverage:
  - `/Users/mo/git/musicxml/tests/integration/parser-csm.test.ts`
- Conformance fixture coverage for timing shifts:
  - `/Users/mo/git/musicxml/fixtures/conformance/rhythm/backup-forward-two-voices.musicxml`
- Conformance execution gate:
  - `/Users/mo/git/musicxml/tests/conformance/execution.test.ts`
