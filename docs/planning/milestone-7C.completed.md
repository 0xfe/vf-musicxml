# Milestone 7C (Completed): Layered Evaluation Framework

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
- [x] Formalize eval dataset splits: `smoke`, `core`, `extended`, `nightly` (`fixtures/evaluation/splits.json`).
- [x] Implement layered gate ordering:
  - [x] analytical hard-fail first (deterministic split gates via `evaluateDeterministicSplit`).
  - [x] perceptual threshold second (`pixelmatch` + `ssim.js` layer when baseline/candidate dirs are provided).
  - [x] model-assisted audit third (non-blocking/advisory by default, OpenAI key + sample-required).
- [x] Version all baselines and rubric prompts (`fixtures/evaluation/gates.json` + `fixtures/evaluation/prompts/*`).
- [x] Store evaluation artifacts:
  - [x] JSON metrics (`artifacts/evaluation/evaluation-report.json`)
  - [x] PNG/SVG diffs (`artifacts/evaluation/perceptual-diffs/**` when perceptual layer is configured)
  - [x] rubric outputs (model-layer JSON payloads in evaluation report)
  - [x] triage summary markdown (`artifacts/evaluation/evaluation-report.md`)
- [x] Add fail-fast classifiers (`layout-overflow`, `symbol-collision`, `text-legibility`, etc.) in deterministic split summaries.

## Completion
- Status: Completed (2026-02-11 US).
- Exit evidence:
  - Added deterministic evaluation module:
    - `/Users/mo/git/musicxml/src/testkit/evaluation.ts`
    - `/Users/mo/git/musicxml/tests/unit/evaluation.test.ts`
  - Added layered evaluation runner:
    - `/Users/mo/git/musicxml/scripts/run-evaluation.mjs`
    - command: `npm run eval:run`
  - Added runbook and prompt governance docs:
    - `/Users/mo/git/musicxml/docs/evaluation-runbook.md`
    - `/Users/mo/git/musicxml/fixtures/evaluation/prompts/music-notation-rubric-v1.md`
    - `/Users/mo/git/musicxml/fixtures/evaluation/prompts/music-notation-rubric-v1.schema.json`
  - Latest evaluation artifact (`artifacts/evaluation/evaluation-report.json`) shows:
    - deterministic layer: `pass` across `smoke`, `core`, `extended`, and `nightly`
    - blocking pass: `true`
