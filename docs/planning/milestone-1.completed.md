## M1: Parser Core + CSM v0
Outcome:
- Parse minimal `score-partwise` with attributes, notes/rests, part-list, and diagnostics.

Deliverables:
- CSM v0 implemented from design sketch.
- `saxes`-based AST builder with location-aware nodes.
- AST-to-CSM transformer for simple partwise documents.
- Explicit score-timewise detection baseline (superseded by M3 normalization).
- `ADR-0001` parser choice and rationale.
- Parse API split finalized: sync XML path + async API exported.
- `.mxl` ZIP decoding explicitly deferred from M1 (delivered in M3).

Testing gates:
- Unit coverage for pitch/duration/time signature basics.
- Fixture tests for valid/invalid minimal examples.
- Parser mode tests (`strict` vs `lenient`) for defined heuristics.
- Initial conformance entries with explicit expected statuses.

Docs gates:
- Parser architecture and diagnostics taxonomy.
- CSM schema overview with examples.

