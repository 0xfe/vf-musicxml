## M3: Rhythm, Voices, Timewise Conversion, Collision Audits
Outcome:
- Voice timing correctness and first collision audit utilities.

Deliverables:
- `backup`/`forward` handling and voice timeline normalization.
- Timewise-to-partwise normalization pass.
- `.mxl` ZIP container decode + `META-INF/container.xml` resolution.
- Measure-level consistency checks with recoverable diagnostics.
- First collision audit helpers (headless) for core overlap classes.

Testing gates:
- Property-style duration conservation tests.
- Conformance fixtures for multi-voice/time-shift/timewise cases.
- SVG structural + collision audit tests.

Docs gates:
- Timing model design note with examples.

