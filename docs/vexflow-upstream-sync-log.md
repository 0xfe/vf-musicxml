# VexFlow Upstream Sync Log

## 2026-02-14
- Prepared `VF-GAP-002` for upstream-oriented follow-up:
  - confirmed local fallback stage remains `local_patch` with target branch `codex/vexflow-non-arpeggiate-support`,
  - strengthened parity proof-points in `tests/integration/render-quality-regressions.test.ts` so fallback diagnostics match parsed non-arpeggiate marker counts and rendered bracket-anchor counts on `lilypond-32a-notations` and `lilypond-32d-arpeggio`.

## 2026-02-11
- Established registry-first upstream tracking:
  - `/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json`
  - validation command: `npm run vexflow:gaps:check`
  - upstream brief generator: `npm run vexflow:gaps:brief`
- Current tracked gap:
  - `VF-GAP-001` grace-note beaming instability fallback.
  - target branch: `codex/vexflow-grace-beaming-fallback`
  - upstream status: `planned`

## Update policy
- Add one dated log row for each status transition:
  - `planned -> opened -> merged -> released -> de_patched`
- Include linked issue/PR URLs when available.
