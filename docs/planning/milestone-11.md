# Milestone 11: Auto-Formatting + Layout Optimization

This milestone is a forward plan for first-class auto-layout quality, focused on reducing collisions and improving readability across dense real-world scores without fixture-specific hand tuning.

## Scope intent
- Build a deterministic layout optimizer layer on top of current parser + renderer primitives.
- Keep fixes generalized (system-level and staff-level heuristics), not per-demo patches.
- Integrate optimizer outcomes into existing geometry/style quality gates so regressions are automatically detected.

## Early goals

### M11A: Layout telemetry + objective function
- Define a compact objective that balances:
  - collision penalties (note-note, note-text, text-text, curve intrusions),
  - readability targets (minimum staff gap, lyric/chord-name spacing),
  - proportional spacing consistency (first-measure and system-level fairness),
  - page economy constraints (avoid excessive page bloat).
- Emit deterministic telemetry per rendered page/system for optimization loops.

Exit checklist:
- [ ] Objective function documented and versioned.
- [ ] Telemetry payload available from headless inspection/eval path.

### M11B: Vertical spacing optimizer
- Add adaptive staff/system spacing pass that reacts to detected collision pressure.
- Prioritize multi-staff piano/quartet scores where voice-crossing and ledger density are high.

Exit checklist:
- [ ] Deterministic before/after metric improvement on proof-points.
- [ ] No new clipping/canvas overflow regressions.

### M11C: Horizontal spacing and justification optimizer
- Add per-system spacing redistribution beyond uniform/measure-width hints:
  - reserve space for complex beamed groups/ornaments/lyrics,
  - prevent compressed opening measures,
  - maintain readable justification without over-stretching sparse bars.

Exit checklist:
- [ ] Improved spacing ratios on dense proof-points.
- [ ] Geometry gates remain green for pass fixtures.

### M11D: Text and annotation layout engine
- Add row-packing/routing improvements for:
  - chord names,
  - multi-verse lyrics,
  - direction text.
- Add deterministic overflow fallback policy (truncate/wrap/stack with diagnostics).

Exit checklist:
- [ ] Zero text-text overlap on selected lyric/chord-name stress fixtures.
- [ ] Fallback behavior documented and test-backed.

### M11E: Gate integration + promotion policy
- Promote proven optimizer checks into M8/M9 blocking gates for stable categories.
- Keep staged adoption with explicit waivers for unsupported notation classes.

Exit checklist:
- [ ] Quality gate thresholds updated with optimizer metrics.
- [ ] Planning docs and risk backlog updated with promotion status.

## Initial proof-points
- `realworld-music21-schumann-clara-polonaise-op1n1`
- `realworld-music21-mozart-k545-exposition`
- `realworld-music21-beethoven-op18no1-m1`
- `lilypond-32a-notations`
- `lilypond-61b-multiplelyrics`
- `lilypond-71g-multiplechordnames`

## Current status
- `OPEN` (planning only; implementation deferred until current M10/M8/M9 closeout blockers are resolved).
- Review-3 linkage: this milestone now owns coefficient-governance/configurability work (`R-028`) and text-metrics optimization follow-up (`R-024`) after M10/M8/M9 and before broader M12 polish waves are finalized.
