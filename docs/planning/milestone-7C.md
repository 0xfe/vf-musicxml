# Milestone 7C: Layered Evaluation Framework

This document tracks M7C execution details and gates.

## Track C: Evaluation Framework (Deterministic + Perceptual + Model-Assisted)

### C.1 Evaluation Layers
- `Layer 1: Analytical SVG checks` (fast, deterministic)
  - bounding-box overlap audits
  - minimum spacing checks
  - geometry sanity for slurs/ties/wedges/tuplets
  - system overflow / clipping checks
- `Layer 2: Pixel/perceptual visual regression`
  - Playwright screenshot baselines (`toHaveScreenshot`, stable env)
  - pixelmatch mismatch metrics (`maxDiffPixels`, threshold tuning)
  - SSIM for structural fidelity
  - LPIPS for perceptual drift scoring
- `Layer 3: Cross-renderer comparison`
  - compare against reference outputs produced by:
    - LilyPond (`musicxml2ly` -> `lilypond`)
    - MuseScore CLI exports (`-j` conversion jobs)
    - optional Verovio (with explicit caveat: conversion/import limitations)
- `Layer 4: Model-assisted quality audit`
  - OpenAI image-input rubric scoring for sampled pages.
  - Structured rubric output (JSON) per page:
    - dimension scores, critical issues, confidence, rationale.

### C.2 OpenAI-Assisted Eval Strategy
- Input:
  - rendered image(s) + reference image(s) + targeted rubric prompt.
  - use image detail controls for high-resolution diagnostics where needed.
- Output:
  - strict structured JSON schema for machine-ingestible results.
- Workflow:
  - run on stratified sample sets (not every page in every CI run).
  - run full model-audit batch nightly/weekly.
  - track score drift over time and correlate with deterministic metrics.

### C.3 Eval Checklist
- [ ] Formalize eval dataset splits: `smoke`, `core`, `extended`, `nightly`.
- [ ] Implement layered gate ordering:
  - [ ] analytical hard-fail first
  - [ ] perceptual threshold second
  - [ ] model-assisted audit third (non-blocking initially)
- [ ] Version all baselines and rubric prompts.
- [ ] Store evaluation artifacts:
  - [ ] JSON metrics
  - [ ] PNG/SVG diffs
  - [ ] rubric outputs
  - [ ] triage summary markdown
- [ ] Add fail-fast classifiers (`layout-overflow`, `symbol-collision`, `text-legibility`, etc.).

