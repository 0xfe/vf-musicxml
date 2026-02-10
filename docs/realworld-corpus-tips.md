# Real-World Corpus Tips (M7A)

## Purpose
Quick context for onboarding non-LilyPond scores into conformance with provenance metadata.

## Current source manifests
- `/Users/mo/git/musicxml/fixtures/corpus/real-world-samples.json`
- `/Users/mo/git/musicxml/fixtures/conformance/realworld/`

Current M7A required buckets (all active):
- `solo-lead-sheet`
- `piano-solo`
- `chorale-satb`
- `chamber-quartet`
- `orchestral-excerpt`

Current active real-world set also includes long-form stress coverage:
- `realworld-music21-beethoven-op133-longform` (bucket: `chamber-quartet`)

Recommended metadata fields per sample row:
- `complexity_level`: `small|medium|large`
- `part_count_hint`: integer part-count estimate used for comprehensiveness bucketing
- `long_form`: boolean for sustained-density/long-work coverage gates

## Import command
```bash
cd /Users/mo/git/musicxml
npm run conformance:realworld:import
```

Behavior:
- Downloads each sample `.mxl`.
- Classifies expected pass/fail from current lenient parse + render behavior.
- Writes conformance sidecars with source + license context.

Validation gate:
- `tests/integration/realworld-corpus.test.ts` enforces required-bucket presence and source-to-conformance parity.

## Current data sources
- OpenScore Lieder repo (CC0):
  - https://github.com/OpenScore/Lieder
- music21 corpus repo (BSD-3-Clause):
  - https://github.com/cuthbertLab/music21

## Onboarding policy
- Keep source URL + source repo + license in the corpus manifest.
- Prefer publicly redistributable formats (`.mxl`, `.musicxml`).
- If expected result is `fail`, include linked risk/todo (`R-002` unless a narrower bug ID exists).
- Preserve deterministic IDs so conformance history remains stable across updates.
