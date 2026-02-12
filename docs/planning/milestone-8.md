# Milestone 8: Golden-Driven Visual Quality Program

This document defines the execution strategy for making LilyPond + selected real-world demos visually high quality against canonical references.

## Outcome
- Every LilyPond collated-suite demo and selected real-world demo is rendered with high visual quality.
- Quality is enforced by deterministic geometry rules first, visual/reference checks second, and human/AI review last.
- Regressions are caught quickly through headless tooling that runs on CI and local headless hosts.

## Scope
- In scope:
  - All active LilyPond conformance fixtures (`fixtures/conformance/lilypond/*`) with reference images from LilyPond collated pages.
  - Selected complex real-world fixtures (`fixtures/conformance/realworld/*`) with explicit quality expectations.
  - Deterministic geometry/presence/spacing/collision/justification tooling and gates.
  - Repeatable fixture-by-fixture triage/remediation workflow and governance.
- Out of scope:
  - Pixel-perfect font parity with LilyPond (minor typography/kerning differences are allowed).
  - New advanced notation feature expansion outside quality fixes needed to match existing fixture scope.

## Track M8A: Golden Reference Corpus + Mapping

### A.1 Reference policy
- LilyPond golden references:
  - Source: `https://lilypond.org/doc/v2.24/input/regression/musicxml/collated-files.html`.
  - Goal: each local LilyPond fixture maps to a stable golden image URL + local cached asset + checksum.
  - Operational fallback: when a local active fixture does not exist in v2.24 docs, allow explicit v2.25 fallback mapping tagged in manifest metadata.
- Real-world references:
  - Use curated, source-traceable references (published engraving, trusted renderer output, or accepted baseline images).
  - Each non-LilyPond reference must include provenance and license metadata.

### A.2 Deliverables
- `fixtures/golden/lilypond-v2.24/` mirrored reference images (or normalized derivatives).
- `fixtures/golden/manifest.json`:
  - `fixture_id`, `source_url`, `golden_image_path`, `checksum`, `reference_kind`, `notes`.
- Script and command:
  - `scripts/sync-golden-references.mjs`
  - `npm run golden:sync`
- Validation tests:
  - manifest completeness (all active LilyPond fixtures mapped),
  - URL/path integrity,
  - checksum stability checks.

### A.3 Exit checklist
- [x] 100% active LilyPond fixtures have mapped reference images.
- [ ] All selected real-world demo fixtures have explicit reference assets or documented waiver.
- [x] Golden manifest validation tests are green.

## Track M8B: Geometry Extraction + Deterministic Rule Engine

### B.1 Geometry model
- Extend existing notation geometry extraction (`src/testkit/notation-geometry.ts`) into a richer scene graph:
  - noteheads, stems, beams, flags, rests, accidentals, dots,
  - articulations/ornaments,
  - lyrics/harmony/direction text,
  - barlines, clefs, key/time signatures, slurs/ties/hairpins, tuplets.
- Normalize coordinates into staff/system/measure-local frames for stable rule checks.
- Add deterministic element identity when needed (measure index, part/staff index, voice index).

### B.2 Rule packs
- Collision rules:
  - critical and non-critical overlap classes with severity buckets.
- Spacing rules:
  - minimum horizontal gaps (notehead/accidental/dot clusters),
  - lyric and harmony clearance,
  - system crowding/utilization thresholds.
- Justification/system rules:
  - over-compression, under-fill, and ragged spacing anomalies.
- Presence/semantic rules:
  - expected beams, dots, tuplets, ornaments, slurs/ties, repeats/endings when source semantics require them.

### B.3 Deliverables
- Rule engine modules under `src/testkit/` with stable diagnostic codes.
- Fixture-level geometry/rule reports in `artifacts/evaluation/` and/or `artifacts/conformance/`.
- Deterministic test coverage:
  - unit tests per rule class,
  - regression tests for known failures.

### B.4 Exit checklist
- [ ] Core rule packs implemented and test-backed.
- [ ] Each rule emits stable machine-readable diagnostics.
- [ ] Deterministic quality gates include collision + spacing + presence + justification signals.

### B.5 Progress notes (2026-02-11)
- Implemented generalized first-column width compensation in renderer layout so measures with opening clef/key/time modifiers do not compress note spacing.
- Added deterministic measure-spacing extraction in `src/testkit/notation-geometry.ts` (`summarizeMeasureSpacingByBarlines`) and surfaced spacing-ratio output in `npm run inspect:score`.
- Added regression coverage to guard first-measure spacing quality for `lilypond-01a-pitches-pitches`.
- Removed noisy `MEASURE_LAYOUT_OVERFLOW` warning path and now rely on deterministic geometry intrusions for barline-bleed detection.
- Added parser/renderer clef-state hardening for partial multi-staff updates (staff-specific merge semantics + non-leaking clef fallback) and revalidated Schumann/Mozart proof-point fixtures.
- Added overlap-aware lyric/chord-name row packing improvements (`61b`, `71g`) with deterministic text-overlap reporting in headless inspection.
- Added unsupported-duration skip diagnostics for explicit out-of-vocabulary note types (used by `03a`) to avoid misleading fallback rendering.
- Extended `inspect:score` spacing output with per-band compression telemetry (`min/max` ratio + compressed-band count) to support M8/M9 gate calibration on dense real-world fixtures (`B-003`).

### B.6 Progress notes (2026-02-12)
- Expanded parser coverage for notation-heavy fixtures:
  - parse all repeated `<notations>` blocks (articulations, ornaments, slurs, tuplets) rather than only the first block,
  - parse ornament payload details (`accidental-mark:*`, `tremolo:*`) for richer render mapping.
- Expanded renderer category-32 mapping to dedicated VexFlow modifiers where available:
  - articulations/ornaments/vibrato/stroke/fret-hand fingering/tremolo mappings,
  - technical-token fallback annotations (`hammer-on`, `pull-off`, `thumb-position`, tonguing variants, etc.),
  - remaining unsupported note-notation diagnostics reduced to `NON_ARPEGGIATE_UNSUPPORTED` for `32a`.
- Added deterministic parser/mapper regression coverage for multi-notation parsing and category-32 modifier attachment (`tests/integration/parser-csm.test.ts`, `tests/unit/render-note-mapper.test.ts`).
- Revalidated with `npm run lint`, `npm run typecheck`, and full `npm run test` (all green).
- Improved category-31/32 readability with generalized text/modifier routing updates:
  - chord-shared articulations/ornaments are now deduplicated at chord anchor level instead of being reattached per notehead,
  - note-specific technical text/fingering markers are routed per-note with compact multi-token fallback to avoid stacked collisions,
  - direction text now uses overlap-aware row packing (same strategy family as harmony/lyric placement).
- Added deterministic category-specific regression gates in `tests/integration/render-quality-regressions.test.ts`:
  - `31a-Directions`: bounded text-overlap threshold,
  - `32a-Notations`: bounded text-overlap threshold + explicit unsupported-symbol coverage.
- Headless inspection deltas after the slice:
  - `31a-Directions`: text overlaps `13 -> 7`,
  - `32a-Notations`: text overlaps `21 -> 4` (remaining warnings only `NON_ARPEGGIATE_UNSUPPORTED`).

## Track M8C: Golden Image Comparison Pipeline (Headless)

### C.1 Comparison strategy
- Keep browser-free path as default:
  - SVG -> PNG rasterization (`resvg`) + robust comparison metrics.
- Use alignment before diff:
  - normalize canvas bounds,
  - register by system/staff geometry and/or edge profile,
  - compare globally and by system region.
- Ignore tolerable typography differences:
  - allow text-sensitive masks or lower weights for text-only regions.

### C.2 Metrics
- Primary:
  - mismatch ratio,
  - SSIM.
- Secondary:
  - edge-map overlap and region-weighted diff scores.
- Outlier detection:
  - severe-localized layout defects (e.g., barline bleed, missing beams) should fail even if global metrics look acceptable.

### C.3 Deliverables
- `scripts/run-golden-comparison.mjs` (or extension of current headless visual runner).
- Baseline/golden artifacts:
  - actual, expected, diff, and aligned overlays.
- Per-fixture comparison report fields:
  - metric values, worst regions, fail reasons, linked diagnostics.

### C.4 Exit checklist
- [ ] Golden comparison runs headlessly across the full active fixture set.
- [ ] Metrics are stable across repeated runs.
- [ ] Diff artifacts are actionable for quick triage.

### C.5 Progress notes (2026-02-11)
- Added `npm run test:golden` runner (`scripts/run-golden-comparison.mjs`) with:
  - direct fixture-vs-golden comparison (not self-generated baselines),
  - per-fixture thresholds and blocking/advisory status,
  - crop support for excerpt-level references,
  - geometry-driven auto-crop support (`autoCropActual.systems`) to lock comparisons to deterministic system windows instead of brittle fixed ratios,
  - artifact bundle output under `artifacts/golden-comparison/` (`actual`, `expected`, `diff`, JSON/markdown report).
- Added proof-point manifest (`fixtures/evaluation/golden-proofpoints.json`) with first real-world advisory fixture:
  - `realworld-music21-bach-bwv1-6-8bars` using `fixtures/images/bwv-1.6-8bars.png`.
- Current proof-point result correctly flags a severe mismatch (advisory fail), which establishes a measurable baseline before pagination/title/instrument-label parity work lands.

### C.6 Progress notes (2026-02-12)
- Improved demo-site canvas sizing by trimming SVG viewports to notation-first bounds and including only nearby text bounds (lyrics/chords/annotations), reducing excessive blank-space regions.
- Demo-scale update for visual triage: generated demos now use `layout.scale=0.7`.
- Added three new complex real-world conformance/demo fixtures:
  - `realworld-music21-beethoven-op59no2-m1`
  - `realworld-music21-mozart-k458-m1`
  - `realworld-music21-bach-bwv244-10`
- Demo index/category navigation now includes explicit LilyPond category labels (`NN - Name`) across index and roadmap pages.

## Track M8D: Human + AI Triage Workflow

### D.1 Triage process
- Every failing fixture gets a deterministic triage bundle:
  - source diagnostics,
  - geometry rule failures,
  - golden diff artifacts,
  - first-bad-system/measure hint.
- Keep a prioritized queue:
  - P0 readability blockers,
  - P1 quality degradations,
  - P2 cosmetic variance.

### D.2 Review policy
- Deterministic failures are blocking.
- For issues not deterministically capturable:
  - manual review plus optional model-assisted rubric pass (advisory).
- Every accepted waiver must include rationale and re-evaluation trigger.

### D.3 Deliverables
- Triage command path (fixture or batch scoped).
- Standard review template for logs/todo updates.
- Evidence checklist per fix (before/after metrics + screenshots/diffs + tests).

### D.4 Exit checklist
- [ ] Triage queue is reproducible from commands and artifacts.
- [ ] Every visual blocker has an owner and linked issue/todo item.
- [ ] Manual-only waivers are explicit, minimal, and time-bounded.

## Track M8E: Fixture-by-Fixture Remediation Execution

### E.1 Execution waves
- Wave 1: foundational categories (`01`, `02`, `03`, `11`, `12`, `13`, `14`) to stabilize pitch/rhythm/attributes spacing.
- Wave 2: notation-heavy categories (`21`-`46`) for beams/slurs/tuplets/articulations/directions.
- Wave 3: text/chord/lyrics categories (`61`, `71`-`75`).
- Wave 4: remaining categories (`90`, `99`) and real-world complexity set.

### E.2 Per-fixture loop
1. Run deterministic geometry + golden comparison reports.
2. Identify root cause category:
   - parser semantics,
   - renderer layout logic,
   - VexFlow limitation/bug.
3. Implement generalized fix (avoid single-fixture patching).
4. Add/extend deterministic tests.
5. Re-run:
   - targeted fixture checks,
   - category regression set,
   - global gates.
6. Update planning/todo/logs and gap registry as needed.

### E.3 VexFlow gap handling
- Any required VexFlow workaround must be:
  - tracked in the existing registry,
  - linked to fixture failures and local patch IDs,
  - prepared for upstream PR flow.

### E.4 Exit checklist
- [ ] All fixture fixes are generalized and test-backed.
- [ ] No unresolved blocker lacks tracking metadata.
- [ ] Regression suites prove no major backsliding across earlier categories.

## Track M8F: Gates, Reporting, and Completion Criteria

### F.1 Blocking gates
- Deterministic geometry gate:
  - zero critical collisions on active expected-pass fixtures.
  - zero severe measure-overflow/barline-intrusion incidents.
  - presence-rule pass rate for required features above agreed threshold.
- Golden comparison gate:
  - full-suite aggregate thresholds for mismatch/SSIM.
  - no unresolved severe outliers.

### F.2 Reporting
- Extend conformance/evaluation reports with M8 sections:
  - golden coverage and pass rate,
  - geometry rule fail histograms,
  - top regressions by severity,
  - per-category trend deltas.

### F.3 Completion criteria
- [ ] 100% active LilyPond fixtures evaluated against mapped goldens.
- [ ] Selected real-world fixtures pass deterministic quality gates and visual review.
- [ ] No P0 visual quality blockers remain open.
- [ ] M8 documentation/runbook is complete and operational for future agents.
- [ ] Milestone doc renamed to `milestone-8.completed.md` with cross-reference updates.

## Planned Commands (to implement during M8)
- `npm run golden:sync`
- `npm run test:geometry`
- `npm run test:golden`
- `npm run triage:fixture -- --id=<fixture-id>`

## Immediate first execution steps
1. Complete current M10D blocker wave first (`B-011`, `B-012`) so M8 gates calibrate against stable pagination/layout behavior.
2. Continue M8B rule-pack expansion (presence + justification + text clearances + dynamic-lane overlap signals).
3. Continue M8C threshold/alignment calibration and promote selected proof-points from advisory to blocking.
4. Add M8F completeness-aware reporting hooks (`Q0`/equivalent) and reduced-penalty waiver behavior so quality metrics do not hide missing content.
5. Resume M8E wave execution with updated blocking gate policy and close P0 visual blockers before declaring M8 complete.
