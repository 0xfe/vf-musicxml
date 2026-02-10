# Diagnostics Taxonomy (M3 Baseline)

Severity levels:
- `error`: parse cannot proceed or strict-mode validation failure.
- `warning`: recoverable issue in lenient mode.
- `info`: non-blocking informational notices.

Core XML/parser codes:
- `XML_NOT_WELL_FORMED`
- `UNSUPPORTED_ROOT`
- `MISSING_PART_LIST`
- `MISSING_PARTS`
- `MISSING_DIVISIONS`
- `DURATION_OVERFLOW`
- `MEASURE_CURSOR_OVERFLOW`
- `BACKUP_BEFORE_MEASURE_START`
- `DIVISIONS_INVALID`
- `TIME_SIGNATURE_INVALID`
- `NOTE_WITHOUT_PITCH`
- `SCORE_TIMEWISE_NORMALIZED`

Container (`.mxl`) codes:
- `MXL_INVALID_ARCHIVE`
- `MXL_CONTAINER_MISSING`
- `MXL_CONTAINER_INVALID`
- `MXL_CONTAINER_READ_FAILED`
- `MXL_SCORE_FILE_NOT_FOUND`
- `MXL_SCORE_FILE_READ_FAILED`

Each diagnostic may include:
- source location (`line`, `column`, optional source name)
- XML path (e.g. `/score-partwise[1]/part[1]/measure[1]/note[2]`)
