# Milestone 12: Polyphonic + Notation Completeness

This milestone is reserved for structural notation-completeness work that should begin only after current M10/M8/M9 closeout blockers are resolved.

## Why this milestone exists
- Review-3 feedback (`F-025` to `F-039`) identified several architectural gaps that are larger than incremental polish slices.
- These items are critical for publication-quality output, but they are also high-regression-risk changes.
- Isolating them in M12 keeps M10/M8/M9 closeout linear and measurable.

## Outcome
- Multi-voice rendering is first-class and content-complete on proof-point scores.
- Quality scoring includes explicit completeness accounting.
- Missing high-impact notation families (navigation symbols, pedal, ottava, inline clef changes) have parser+renderer coverage with deterministic tests.
- Remaining unsupported items are explicitly tracked as VexFlow gaps with upstream-ready repros.

## Track M12A: Multi-Voice Renderer Architecture (Critical)
- Build true multi-voice-per-staff mapping from `VoiceTimeline[]`.
- Join voices in VexFlow (`Formatter.joinVoices`) before system formatting.
- Enforce deterministic stem/rest behavior for multi-voice staves.
- Add blocking proof-points:
  - `realworld-music21-bach-bwv244-10`
  - `realworld-music21-mozart-k458-m1`

Exit checklist:
- [ ] Multi-voice content is rendered on proof-points with no voice-drop diagnostics.
- [ ] Deterministic regression tests cover voice count, stems, and rest placement.

## Track M12B: Completeness-Aware Quality Model
- Add explicit content-fidelity dimension (`Q0`) or equivalent penalty model.
- Report parsed-vs-rendered coverage in conformance and evaluation artifacts.
- Apply partial penalties for waived dimensions instead of full bypass.

Exit checklist:
- [ ] Quality reports surface content completeness and waiver penalties.
- [ ] Gates are recalibrated to avoid inflated quality scores from missing content.

## Track M12C: Missing Notation Families
- Add parser+renderer support for:
  - rehearsal marks / coda / segno,
  - pedal marks,
  - ottava lines (`8va/8vb`),
  - inline (mid-measure) clef changes.
- Add deterministic presence and placement tests for each family.

Exit checklist:
- [ ] Each notation family has fixture-backed parser+renderer coverage.
- [ ] Unsupported fallback paths are explicit diagnostics only (no silent drops).

## Track M12D: Cross-Staff + Slur/Tie Robustness
- Replace fixed cross-staff rejection thresholds with staff-distance-relative logic.
- Improve wide-interval slur handling by curvature bounding instead of drop-first behavior.
- Add deterministic curve/path sanity checks for cross-staff and wide-interval proof-points.

Exit checklist:
- [ ] Cross-staff slur/tie behavior is stable on piano/chamber proof-points.
- [ ] Extreme-curve anomalies remain below agreed thresholds.

## Track M12E: Layout Coefficient Governance + API Cleanup
- Consolidate layout coefficients into documented config structures.
- Add isolated unit tests for coefficient sensitivity.
- Resolve `parseMusicXMLAsync` naming/behavior mismatch by documented policy or API deprecation path.

Exit checklist:
- [ ] Coefficients are centralized and documented.
- [ ] API naming/behavior decision is documented and test-backed.

## Execution order (after M10/M8/M9 close)
1. M12A (multi-voice) because it is the primary correctness blocker.
2. M12B (quality model) to prevent misleading scores during/after M12A rollout.
3. M12C (missing notation families) with proof-point expansion.
4. M12D (cross-staff/slur refinements).
5. M12E (config/API cleanup and stabilization).

## Completion criteria
- [ ] Proof-point corpus renders multi-voice content without major omissions.
- [ ] Conformance quality score includes completeness-aware penalties.
- [ ] M12 notation families are covered with deterministic tests.
- [ ] No unresolved P0 completeness blockers remain open.
- [ ] Milestone doc renamed to `milestone-12.completed.md` with all references updated.
