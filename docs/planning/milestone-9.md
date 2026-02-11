# Milestone 9: Engraving Style Fidelity Program

This milestone formalizes notation style quality so outputs are not only correct, but visually pleasant and consistent with established engraving practice.

## Outcome
- Define a concrete, testable style profile for our renderer.
- Measure and enforce that profile with deterministic geometry checks plus targeted visual review.
- Drive style conformance across all active LilyPond fixtures and selected real-world fixtures.
- Coordinate with M10 pagination/publishing-layout work so style gates can evaluate page-oriented references accurately.

## Reference set (style inputs)
- LilyPond documentation (engraving behavior and spacing policy):
  - [Horizontal spacing overview](https://lilypond.org/doc/v2.24/Documentation/notation/horizontal-spacing-overview)
  - [Music engraving and LilyPond](https://lilypond.org/doc/v2.24/Documentation/essay-big-page)
  - [Automatic beams](https://lilypond.org/doc/v2.24/Documentation/notation/automatic-beams)
  - [Vertical collision avoidance](https://lilypond.org/doc/v2.24/Documentation/notation-fix/vertical-collision-avoidance)
- SMuFL engraving defaults (glyph metrics and engraving constants):
  - [SMuFL specification: engraving defaults](https://w3c.github.io/smufl/latest/specification/engravingdefaults.html)
- Professional preparation guidance:
  - [MOLA Guidelines for Music Preparation](https://mola-inc.s3.amazonaws.com/MOLA_guidelines-for-music-preparation.pdf)
- Behind Bars reference alignment:
  - [Authorized preview (Faber, Chapter 1 excerpt)](https://www.pageplace.co.uk/media/67780/behind-bars-preview.pdf)
  - Full text is copyrighted; we will use preview-accessible rules plus LilyPond/SMuFL-compatible proxies and human review checkpoints.

## Style dimensions and deterministic proxies

### S1. Horizontal spacing and proportional rhythm
- Goal: notes of similar rhythmic weight should not look compressed in one measure while evenly spaced elsewhere.
- Deterministic checks:
  - per-measure gap statistics from notehead centers,
  - first-measure vs median-other ratio checks for representative fixtures,
  - under-fill/over-fill checks at system level.

### S2. Barline integrity and measure containment
- Goal: noteheads and stems should remain visually inside their intended measure.
- Deterministic checks:
  - notehead/barline intrusion count,
  - right-edge overflow proxies at measure boundaries.

### S3. Stem and beam readability
- Goal: default stem lengths/slopes and beam grouping should produce legible rhythmic structure.
- Deterministic checks:
  - non-zero beam presence where source semantics imply beams,
  - stem length/slope outlier checks by duration/context.

### S4. Collision avoidance and clearance
- Goal: avoid collisions among noteheads, accidentals, dots, articulations, and text.
- Deterministic checks:
  - critical/minor overlap counters by class pair,
  - minimum clearance floors for key element pairs.

### S5. Text placement (lyrics, harmony, directions)
- Goal: text should be readable and not interfere with staff objects.
- Deterministic checks:
  - lyric-to-staff clearance floors,
  - chord-symbol stacking overlap checks,
  - text-notehead collision counters.

### S6. System balance and justification
- Goal: each system should look balanced and avoid visually awkward crowding/raggedness.
- Deterministic checks:
  - horizontal usage ratios by system,
  - per-system spacing variance checks,
  - minimum staff gap checks.

## Track M9A: Style Rule Inventory + Rulebook Mapping
- Build a machine-readable rule catalog (`S1..S6`) with:
  - rationale,
  - detection method,
  - threshold defaults,
  - known caveats/waivers.
- Map each rule to source rationale (LilyPond/SMuFL/MOLA/Behind Bars preview).
- Add style glossary + examples in docs for fast reviewer alignment.

Exit checklist:
- [ ] Rule catalog exists and is source-linked.
- [ ] Every style dimension has at least one deterministic metric.
- [ ] Waiver policy exists for rules that cannot yet be deterministic.

## Track M9B: Deterministic Style Gates
- Extend geometry tooling and conformance scoring with style-specific metrics:
  - measure-spacing consistency,
  - beam/stem quality outliers,
  - text-clearance and collision severity.
- Add fixture-level style diagnostics with stable codes and evidence payloads.
- Integrate style gates into conformance/eval reports as non-optional quality checks.

Exit checklist:
- [ ] Style metrics emitted in conformance/evaluation artifacts.
- [ ] At least one regression test per style dimension.
- [ ] Style gate thresholds are versioned and documented.

## Track M9C: Proof-Point Review Set
- Maintain a compact proof-point suite for fast human/AI inspection:
  - `lilypond-01a-pitches-pitches` (horizontal spacing consistency),
  - `lilypond-11a-time-signatures` (opening-measure modifier spacing),
  - `lilypond-13a-key-signatures` (attribute spacing and accidentals),
  - `lilypond-61a-lyrics` (text clearance),
  - `lilypond-71g-multiple-chordnames` (harmony stacking),
  - `realworld-music21-bach-bwv1-6` (beams/stems readability),
  - `realworld-music21-beethoven-op133-longform` (system balance under stress).
- For each proof-point, keep:
  - deterministic metric snapshot,
  - golden diff summary,
  - short human-review note template.

Exit checklist:
- [ ] Proof-point fixture pack and command workflow documented.
- [ ] Each proof-point has deterministic + visual evidence artifacts.
- [ ] Human review template is linked from planning docs.

## Track M9D: Style Burndown Across Full Corpus

### Burndown board (ordered by readability impact)
1. Horizontal spacing anomalies (compressed/uneven measures).
2. Missing/incorrect beam grouping and stem outliers.
3. Critical collisions (note/text/symbol collisions).
4. Text placement readability (lyrics/chord symbols/directions).
5. System justification and page-balance polish.

### Execution loop per wave
1. Detect failures with deterministic metrics + golden diff.
2. Group failures by root-cause pattern (parser semantics vs renderer layout vs VexFlow gap).
3. Implement generalized fix (no one-off fixture hacks).
4. Add regression tests and update thresholds/waivers.
5. Re-run wave gates and update burndown counts.

Exit checklist:
- [ ] Open burndown item count trends down each wave.
- [ ] No P0 readability blockers remain open.
- [ ] Remaining waivers are explicit, minimal, and time-bounded.

## Track M9E: Completion Criteria
- [ ] Style gates run as part of default quality workflow.
- [ ] LilyPond fixtures have no unresolved P0 style defects.
- [ ] Selected real-world fixtures meet style proof-point thresholds.
- [ ] M9 documentation is complete and operational for future agents.
- [ ] Milestone doc renamed to `milestone-9.completed.md` with cross-reference updates.

## Planned commands (M9)
- `npm run inspect:score -- --input=<fixture>`
- `npm run test:integration -- tests/integration/render-quality-regressions.test.ts`
- `npm run test:visual:headless -- --fixtures=<ids>`
- `npm run eval:run`

## Immediate execution order
1. Finalize M9A rule catalog with source-linked rationale and default thresholds.
2. Land M9B spacing/beam/text style diagnostics and fixture regression tests.
3. Run M9C proof-point suite each time a style fix lands.
4. Execute M9D burndown waves in parallel with M8 remediation.
