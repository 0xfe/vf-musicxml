# Milestone 7A (Completed): Corpus Comprehensiveness

This document tracks M7A execution details and gates.

## Track A: Comprehensiveness (Can We Parse and Render Complex Scores?)

### A.1 Corpus Strategy
- `Tier 1 (Conformance Core)`: LilyPond collated suite categories 01–99.
- `Tier 2 (Real-World Breadth)`: Public domain / permissive corpora with multi-part and long-form scores.
  - OpenScore Lieder (CC0): https://github.com/OpenScore/Lieder
  - Additional public test pieces via Verovio converter examples (Bach/Chopin/Haydn etc.) for scale stress tests.
- `Tier 3 (Adversarial Inputs)`: Broken or edge MusicXML (`.mxl` container anomalies, inconsistent durations, missing optional nodes).

### A.2 Corpus Manifest + Metadata (Planned Artifacts)
- Add a machine-readable corpus manifest (CSV/JSON) with:
  - source URL, license, category, instrumentation complexity, expected status, parse mode, owner.
- Extend fixture metadata with:
  - `complexity_level`, `reference_renderers`, `quality_gate_profile`.

### A.3 Comprehensiveness Checklist
- [x] Import all LilyPond categories into the manifest (01–99).
- [x] Assign each fixture an expected outcome (`pass` / `fail`) with rationale for every expected failure.
- [x] Ensure each failure maps to a concrete TODO/risk item.
- [x] Add representative real-world scores:
  - [x] solo lead sheet
  - [x] piano solo (multi-voice, pedals optional)
  - [x] SATB choral
  - [x] chamber ensemble
  - [x] orchestral movement excerpt
- [x] Add at least one `.mxl` sample per major complexity bucket.
- [x] Verify deterministic parsing/rendering in headless CI for each new bucket.

### A.4 Comprehensiveness Gates (Initial Targets)
- Parse success (active expected-pass set): `>= 97%`.
- Render success after parse success: `>= 97%`.
- Unexpected failure rate: `<= 1%`.
- Category floor: no category below `90%` expected-pass success once activated.

## Completion
- Status: Completed (2026-02-10 US).
- Exit evidence:
  - `tests/integration/realworld-corpus.test.ts` enforces required real-world bucket coverage and long-form breadth metadata.
  - `tests/integration/lilypond-corpus.test.ts` enforces corpus parity and explicit malformed-source waiver policy for `lilypond-23c-tuplet-display-nonstandard`.
  - `tests/conformance/execution.test.ts` enforces M7A threshold gates:
    - expected-pass success rate `>= 97%`
    - unexpected failure rate `<= 1%`
    - per-category LilyPond expected-pass floor `>= 90%`
  - Latest conformance report (`artifacts/conformance/conformance-report.json`) satisfies gates with margin:
    - expected-pass success rate: `1.00`
    - unexpected failure rate: `0.00`
    - worst LilyPond category expected-pass rate: `1.00`
