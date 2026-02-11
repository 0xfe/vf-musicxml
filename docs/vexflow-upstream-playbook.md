# VexFlow Upstream Playbook (M7D)

## Goal
Move VexFlow-related MusicXML renderer gaps through a repeatable lifecycle:

`detected -> reproduced -> local_patch -> upstream_pr -> merged -> released -> de_patched`

## Workflow
1. Add/update gap entry in `/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json`.
2. Ensure fixture linkage:
   - add reproducer fixture IDs (`fixtures/conformance/**`).
   - ensure diagnostics are emitted for degraded behavior.
3. Add regression coverage:
   - unit/integration/conformance test in this repo.
   - list test file paths in gap entry.
4. Prepare upstream branch:
   - `codex/vexflow-<scope>`
5. Open upstream issue + PR with:
   - reproducer fixture context
   - before/after screenshots
   - failing-then-passing test in VexFlow style.
6. Track release:
   - update `upstream.status` (`opened` -> `merged` -> `released`).
7. De-patch:
   - remove local workaround/patch when released VexFlow is adopted.
   - move entry to `de_patched`.

## Local patch policy
- Prefer compatibility wrappers in `/Users/mo/git/musicxml/src/vexflow/` first.
- Use `patch-package` only for small, isolated, time-critical fixes.
- Keep patches minimal and tied to one gap entry.

## Validation gates
- `npm run vexflow:gaps:check`
- `/Users/mo/git/musicxml/tests/integration/vexflow-gap-registry.test.ts`
