## M7: Full Conformance + Quality Program (Umbrella)
Outcome:
- Demonstrable high-quality rendering across the vast majority of representative MusicXML fixtures.
- Repeatable quality evidence from deterministic, perceptual, and model-assisted evaluation layers.
- Explicit VexFlow upstream path for every blocking renderer gap.
- Track status: `M7A` completed; `M7B` is the active next track.

Execution strategy:
- M7 is now split into four tracks so progress can be measured independently and executed in parallel where safe.
- Canonical design + thresholds + references are maintained in:
  - `/Users/mo/git/musicxml/docs/planning/milestone-7A.completed.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7B.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7C.md`
  - `/Users/mo/git/musicxml/docs/planning/milestone-7D.md`

### M7A: Corpus Comprehensiveness
Outcome:
- Broad and representative corpus coverage with explicit expected behavior per fixture.

Deliverables:
- Unified corpus manifest (LilyPond + representative real-world scores + adversarial cases).
- Category activation schedule with expected pass/fail rationale and ownership.
- Demo parity tracking in `demos/lilypond/manifest.json` and generated roadmap pages.
- Performance baseline fixture subset (small/medium/large complexity buckets).

Testing gates:
- Active expected-pass parse success `>= 97%`.
- Active expected-pass render success `>= 97%`.
- Unexpected failure rate `<= 1%`.
- No activated LilyPond category below `90%` pass rate.

Docs gates:
- Corpus provenance/license/source fields documented.
- Every expected failure linked to a concrete `/Users/mo/git/musicxml/docs/planning/todo.md` item.

### M7B: Quality Rubric + Deterministic Quality Gates
Outcome:
- Project-wide definition of "high-quality notation" with enforceable gates.

Deliverables:
- Weighted rubric (`Q1..Q7`) for spacing, collisions, beaming/stems/rests, spanners, text, system layout, and symbol fidelity.
- Deterministic SVG analytics for quality proxies:
  - collision severity counts
  - minimum spacing checks
  - layout overflow/clipping checks
  - spanner geometry sanity checks
- Conformance report extensions for rubric/metric output.

Testing gates:
- Weighted rubric mean on active expected-pass set `>= 4.2/5`.
- No catastrophic readability failures (`critical dimension < 2`) on active expected-pass fixtures.
- Critical collision count must remain zero unless a waiver exists.

Docs gates:
- Quality rubric and scoring interpretation guide.
- Diagnostic-to-rubric mapping (how diagnostics impact quality scores).

### M7C: Layered Evaluation Framework
Outcome:
- Regression framework that catches both structural and perceptual quality failures.

Deliverables:
- Layer 1: deterministic analytical SVG gates (blocking in PR runs).
- Layer 2: Playwright + perceptual metrics (pixelmatch/SSIM first; LPIPS where available).
- Layer 3: cross-renderer comparisons (LilyPond/MuseScore and optional Verovio caveated usage).
- Layer 4: model-assisted scoring (OpenAI image rubric audits) on sampled datasets.
- Artifact pipeline for JSON metrics, visual diffs, and rubric outputs.

Testing gates:
- PR path: analytical + targeted visual sentinel checks.
- Nightly path: extended fixture set + perceptual metrics + model-assisted audit sampling.
- Baseline drift detection with trend history and alert thresholds.

Docs gates:
- Evaluation runbooks (PR vs nightly), threshold rationale, and failure triage workflow.
- Prompt/version governance for model-assisted evaluation.

### M7D: VexFlow Gap Upstreaming + Release Hardening
Outcome:
- Blocking renderer gaps have a traceable lifecycle from detection to upstream merge/de-patch.

Deliverables:
- Gap registry tied to conformance fixture IDs and diagnostic evidence.
- Local patch policy (`patch-package`) with minimal isolated patches.
- Upstream branch/PR workflow:
  - branch naming `codex/vexflow-<scope>`
  - minimal reproducer tests in VexFlow style
  - before/after screenshots and fixture references
- Release readiness docs (version policy, compatibility matrix, troubleshooting).

Testing gates:
- Every active VexFlow workaround has a regression test in this repo and linked upstream issue/PR or waiver.
- No untracked local VexFlow patches.

Docs gates:
- Upstream sync log and de-patch checklist.
- Release hardening checklist covering dependency/version transitions.
