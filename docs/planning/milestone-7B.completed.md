# Milestone 7B (Completed): Quality Rubric + Deterministic Quality Gates

This document tracks M7B execution details and gates.

## Track B: Quality (How Good Is the Notation?)

### B.1 Quality Dimensions (Rubric)
Use a page-level rubric (0-5 each, weighted):
- `Q1` Rhythm spacing quality (optical spacing, crowding balance).
- `Q2` Collision avoidance (noteheads, accidentals, lyrics, dynamics, articulations).
- `Q3` Beams/stems/rest positioning (voice clarity, readable grouping).
- `Q4` Spanner quality (ties, slurs, wedges, tuplets: placement and continuity).
- `Q5` Text quality (lyrics, harmony, direction text overlap and legibility).
- `Q6` System/page layout quality (balanced systems, margin fit, avoid avoidable turns).
- `Q7` Symbol fidelity (glyph sizing/alignment aligned to SMuFL/music font expectations).

### B.2 Quality Checklist
- [x] Define expected rubric minimums (`Q1..Q7`) and weights in code (`CONFORMANCE_QUALITY_WEIGHTS`) and report outputs.
- [x] Add deterministic analytical proxies for each rubric dimension where possible (`src/testkit/conformance-execution.ts`).
- [x] Keep visual checks selective for dimensions that cannot be reliably inferred analytically (existing Playwright sentinel suite retained).
- [x] Document known degradation policy with explicit waiver keys (`quality-critical-collision`, `quality-catastrophic-readability`) and fixture-level metadata integration.
- [x] For each quality regression, require:
  - [x] analytical signal (quality metrics + dimension scores in conformance JSON/markdown report)
  - [x] visual diff path (Playwright conformance sentinel suite remains available for targeted regressions)
  - [x] human/model rubric impact handoff path (completed via M7C layered evaluation pipeline)

### B.3 Quality Gates (Initial Targets)
- Weighted rubric mean on active pass fixtures: `>= 4.2 / 5`.
- No fixture with catastrophic readability (`any critical dimension < 2`).
- Collision severity gate:
  - hard collisions on critical symbols: `0`.
  - minor tolerated overlaps only where waiver exists.

## Completion
- Status: Completed (2026-02-11 US).
- Exit evidence:
  - `src/testkit/conformance-execution.ts` now computes deterministic fixture quality reports:
    - rubric dimensions `Q1..Q7`
    - weighted score with explicit weights
    - critical-dimension and critical-collision gate semantics
    - fixture-level waiver handling
  - `ConformanceExecutionReport` now includes `qualitySummary` plus per-fixture `quality` payload in JSON/markdown artifacts.
  - `tests/conformance/execution.test.ts` enforces M7B gates:
    - expected-pass weighted mean `>= 4.2`
    - no expected-pass catastrophic readability fixtures
    - expected-pass critical collision count `=== 0` (after waiver policy)
- Latest conformance report evidence (`artifacts/conformance/conformance-report.json`):
  - expected-pass weighted mean: `4.8591`
  - expected-pass catastrophic readability fixture count: `0`
  - expected-pass critical collision count: `0`
