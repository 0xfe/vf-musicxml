# VexFlow Gap Registry

This file documents the operational contract for `/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json`.

## Why this exists
- Keeps VexFlow-related gaps traceable to concrete MusicXML fixtures and diagnostics.
- Prevents patch/workaround drift by forcing explicit lifecycle + upstream metadata.
- Provides one source of truth for M7D release-hardening checks.

## Registry validation
- Runtime validation code:
  - `/Users/mo/git/musicxml/src/testkit/vexflow-gap-registry.ts`
- Validation command:
  - `npm run vexflow:gaps:check`
- CI-facing test:
  - `/Users/mo/git/musicxml/tests/integration/vexflow-gap-registry.test.ts`

## Required fields per entry
- `id`: stable key (`VF-GAP-###` style).
- `lifecycle_stage`: one of
  - `detected`
  - `reproduced`
  - `local_patch`
  - `upstream_pr`
  - `merged`
  - `released`
  - `de_patched`
- `musicxml_fixture_ids`: fixture IDs that reproduce the gap.
- `diagnostic_codes`: diagnostics connected to the behavior.
- `local_patch`: workaround/patch metadata (`wrapper` or `patch-package`).
- `upstream`: issue/PR/branch status metadata.
- `tests`: regression tests that guard against regression.

## Policy
- Every active gap must include at least one conformance fixture ID.
- Every active gap must include at least one regression test path.
- Upstream branch targets must use `codex/vexflow-<scope>`.
- `patch-package` entries must reference a concrete patch file under `patches/`.

## Current entry
- `VF-GAP-001`: grace-note beaming instability fallback tracking.
