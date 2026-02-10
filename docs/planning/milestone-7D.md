# Milestone 7D: VexFlow Gap Upstreaming + Release Hardening

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
- [ ] Minimal standalone VexFlow reproduction in upstream test style.
- [ ] Add/adjust VexFlow tests and run upstream suite (`grunt test`, browser tests).
- [ ] Open upstream issue with MusicXML context + screenshots + reduced case.
- [ ] Open PR linked to issue with:
  - [ ] failing test before fix
  - [ ] passing test after fix
  - [ ] visual before/after evidence
- [ ] Track merge + release versions.
- [ ] Remove local patch when released version is adopted.

