# Notation Style Tips

## Purpose
Quick reference for engraving-style decisions and checks while implementing M8/M9 quality work.

## Source anchors
- LilyPond spacing and engraving behavior:
  - https://lilypond.org/doc/v2.24/Documentation/notation/horizontal-spacing-overview
  - https://lilypond.org/doc/v2.24/Documentation/essay-big-page
  - https://lilypond.org/doc/v2.24/Documentation/notation/automatic-beams
  - https://lilypond.org/doc/v2.24/Documentation/notation-fix/vertical-collision-avoidance
- SMuFL engraving constants:
  - https://w3c.github.io/smufl/latest/specification/engravingdefaults.html
- Orchestral preparation guidance:
  - https://mola-inc.s3.amazonaws.com/MOLA_guidelines-for-music-preparation.pdf
- Behind Bars preview (authorized excerpt):
  - https://www.pageplace.co.uk/media/67780/behind-bars-preview.pdf

## Style checklist (high signal)
1. Horizontal spacing:
   - No local measure looks visibly compressed versus neighboring measures with similar rhythm.
   - In proof fixtures, inspect `spacingSummary.firstToMedianOtherGapRatio` from `inspect:score`.
2. Containment:
   - `noteheadBarlineIntrusionCount` must remain zero for expected-pass fixtures.
3. Beam/stem readability:
   - Beam groups present where source rhythm implies grouping.
   - Stem outliers are limited and justified by context.
4. Collision control:
   - No critical collisions among noteheads, accidentals, dots, or text.
5. Text readability:
   - Lyrics/chord symbols/directions do not collide with staff symbols.
6. System balance:
   - Avoid visibly overfilled or underfilled systems when alternatives exist.

## Fast workflow
```bash
# one fixture, full triage artifact bundle
npm run inspect:score -- --input=fixtures/conformance/lilypond/01a-pitches-pitches.musicxml

# deterministic regression checks
npm run test:unit -- tests/unit/notation-geometry.test.ts
npm run test:integration -- tests/integration/render-quality-regressions.test.ts

# headless visual check against baselines
npm run test:visual:headless -- --fixtures=lilypond-01a-pitches-pitches

# external golden comparison (LilyPond + proof-points)
npm run test:golden -- --fixtures=realworld-music21-bach-bwv1-6-8bars
```

## Proof-point fixtures
- `lilypond-01a-pitches-pitches` (opening measure spacing).
- `lilypond-61a-lyrics` (text clearance).
- `lilypond-71g-multiple-chordnames` (harmony stacking).
- `realworld-music21-bach-bwv1-6` (beaming/stem readability).
