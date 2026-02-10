## M4: Notations and Directions
Outcome (Completed):
- Baseline support for ties/slurs/articulations/dynamics/tempo words/wedges.

Delivered:
- Notation mapping with graceful degradation diagnostics.
- Direction placement baseline strategy.
- Spanner linking pass (`tie`/`slur`/`wedge`) into `Score.spanners[]`.
- Baseline notation conformance fixture (`notation-m4-baseline`) and visual sentinel snapshot coverage.

Testing gates (Completed):
- Fixture/integration tests for tie/slur/wedge continuity and slur placement metadata continuity.
- Structural assertions for articulation mapping and direction attachment in headless tests.
- Targeted Playwright visual tests for notation baseline curve/placement regressions.

Docs gates (Completed):
- Notation support matrix with current gaps (`docs/notation-support-matrix.md`).

