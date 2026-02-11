# Milestone 7D (Completed): VexFlow Gap Upstreaming + Release Hardening

This document tracks M7D execution details and gates.

## Track D: VexFlow Gaps and Upstream Strategy

### D.1 Gap Lifecycle
- `detected` -> `reproduced` -> `local patch` -> `upstream PR` -> `merged` -> `released` -> `de-patched`.

### D.2 Implementation Policy
- Keep VexFlow as dependency in this repo.
- Use `patch-package` for small/urgent local fixes.
- Keep patch files small, isolated, and traceable to issue IDs.
- Mirror each patch in a dedicated VexFlow branch: `codex/vexflow-<scope>`.

### D.3 Upstream Checklist
- [x] Minimal standalone VexFlow reproduction + fixture linkage tracked in registry (`VF-GAP-001`).
- [x] Add/adjust MusicXML-side regression tests and validate tracked links.
- [x] Operationalize upstream issue/PR packaging via generated brief artifacts (`npm run vexflow:gaps:brief`).
- [x] Track merge + release versions via registry lifecycle fields and sync log.
- [x] Define de-patch flow and release hardening checklist.

## Completion
- Status: Completed (2026-02-11 US).
- Exit evidence:
  - Added registry and validation pipeline:
    - `/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json`
    - `/Users/mo/git/musicxml/src/testkit/vexflow-gap-registry.ts`
    - `/Users/mo/git/musicxml/tests/integration/vexflow-gap-registry.test.ts`
    - command: `npm run vexflow:gaps:check`
  - Added upstream brief generation:
    - `/Users/mo/git/musicxml/scripts/build-vexflow-upstream-brief.mjs`
    - command: `npm run vexflow:gaps:brief`
    - artifacts: `/Users/mo/git/musicxml/artifacts/vexflow-upstream/upstream-brief.md`
  - Added playbook + sync + release docs:
    - `/Users/mo/git/musicxml/docs/vexflow-upstream-playbook.md`
    - `/Users/mo/git/musicxml/docs/vexflow-upstream-sync-log.md`
    - `/Users/mo/git/musicxml/docs/release-hardening-checklist.md`
