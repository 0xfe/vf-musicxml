# Diagnostics Taxonomy (M1)

Severity levels:
- `error`: parse cannot proceed or strict-mode validation failure.
- `warning`: recoverable issue in lenient mode.
- `info`: non-blocking informational notices.

Core codes currently used:
- `XML_NOT_WELL_FORMED`
- `UNSUPPORTED_SCORE_TIMEWISE`
- `UNSUPPORTED_ROOT`
- `MISSING_PART_LIST`
- `MISSING_PARTS`
- `MISSING_DIVISIONS`
- `DURATION_OVERFLOW`
- `DIVISIONS_INVALID`
- `TIME_SIGNATURE_INVALID`
- `NOTE_WITHOUT_PITCH`

Each diagnostic may include:
- source location (`line`, `column`, optional source name)
- XML path (e.g. `/score-partwise[1]/part[1]/measure[1]/note[2]`)
