# Testkit Layout

Testkit code is organized by responsibility:

- `src/testkit/conformance-execution.ts`: fixture execution orchestration and artifact writing.
- `src/testkit/conformance-types.ts`: shared conformance report/result/quality types.
- `src/testkit/conformance-report.ts`: markdown/json formatting plus histogram/category rollups.
- `src/testkit/conformance-quality.ts`: deterministic quality evaluation orchestration and summary rollups.
- `src/testkit/conformance-quality-geometry.ts`: SVG geometry extraction and overlap/viewport helpers.
- `src/testkit/conformance-quality-scoring.ts`: rubric dimension scoring and weighted-score math.
- `src/testkit/conformance.ts`: fixture discovery and collision-audit execution.
- `src/testkit/execution-loop.ts`: shared fixture-loop concurrency and timing-budget utilities.
- `src/testkit/notation-geometry.ts` and `src/testkit/svg-collision.ts`: notation-aware SVG bounds extraction and geometry analysis.
- `src/testkit/headless-visual.ts`: browser-free screenshot/diff tooling.
- `src/testkit/evaluation.ts`: split-level pass/fail and classifier evaluation helpers.

The goal is to keep deterministic scoring, reporting, and execution plumbing isolated so each layer can be tested independently.
