# MusicXML Tips

## Forms and normalization
- Root forms:
  - `score-partwise` (primary parse path)
  - `score-timewise` (normalized to partwise-compatible model in parser)
- Timewise normalization happens before core partwise parse flow.

## Timing rules in this repo
- Canonical timing uses integer ticks (`ticksPerQuarter = 480`).
- `<backup>` rewinds cursor, `<forward>` advances cursor.
- `<chord/>` notes share onset and do not independently advance the cursor.
- Grace notes (`<grace>`) are non-advancing events in measure cursor math.
- Timing invariants and diagnostics are documented in:
  - `/Users/mo/git/musicxml/docs/timing-model.md`

## Advanced notation parsing notes (M6)
- Tuplets:
  - Parse `<notations><tuplet type="start|stop"...>` endpoints.
  - Parse `<time-modification>` (`actual-notes`, `normal-notes`) for ratio hints.
- Ornaments:
  - Parse children under `<notations><ornaments>` as explicit tokens; renderer maps a supported subset.
- Cue notes:
  - Parse `<cue/>` as note-level rendering hint (does not alter timing).
- Repeats/endings:
  - Parse `<barline><repeat direction="...">` and `<barline><ending ...>` by location (`left`/`right`/`middle`).

## Container (`.mxl`) rules
- `.mxl` decode reads ZIP central directory and resolves score via:
  1. `META-INF/container.xml` rootfile path
  2. fallback score-like XML entry selection
- Key diagnostics:
  - `MXL_INVALID_ARCHIVE`
  - `MXL_CONTAINER_MISSING`
  - `MXL_CONTAINER_INVALID`
  - `MXL_SCORE_FILE_NOT_FOUND`
  - `MXL_SCORE_FILE_READ_FAILED`

## Diagnostics strategy
- Prefer stable machine-readable codes over brittle message matching.
- Include location/path context when available.
- Strict mode escalates warning-level recoveries to errors in async/container path.

## Conformance fixture authoring quick rules
- Add `<fixture>.musicxml` and `<fixture>.meta.yaml` side-by-side.
- Required metadata:
  - `id`, `source`, `category`, `expected`, `status`
- Every `expected: fail` needs rationale (`notes`) + linked risk/TODO (`linked_todo`).
- Use `collision_audit` only when rendered SVG overlap checks are meaningful for fixture intent.
