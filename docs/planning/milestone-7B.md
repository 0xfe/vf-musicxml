# Milestone 7B: Quality Rubric + Deterministic Quality Gates

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
- [ ] Define per-category expected rubric minimums (`Q1..Q7`).
- [ ] Add deterministic analytical proxies for each rubric dimension when possible.
- [ ] Keep visual checks for dimensions that cannot be reliably inferred analytically.
- [ ] Document known intentional degradations with diagnostic codes and examples.
- [ ] For each quality regression:
  - [ ] analytical signal (if available)
  - [ ] visual diff
  - [ ] human/model rubric impact

### B.3 Quality Gates (Initial Targets)
- Weighted rubric mean on active pass fixtures: `>= 4.2 / 5`.
- No fixture with catastrophic readability (`any critical dimension < 2`).
- Collision severity gate:
  - hard collisions on critical symbols: `0`.
  - minor tolerated overlaps only where waiver exists.

