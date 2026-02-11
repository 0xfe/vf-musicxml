# Release Hardening Checklist (M7D)

Use this checklist before publishing a release that includes VexFlow-related behavior changes.

## Registry + patch state
- [ ] `npm run vexflow:gaps:check` passes.
- [ ] Every non-released gap has owner, fixture links, diagnostics, and regression tests.
- [ ] Every `patch-package` entry (if any) has a linked patch file and de-patch plan.

## Quality + conformance
- [ ] `npm run test:conformance:report` passes.
- [ ] `npm run eval:run` passes blocking layers.
- [ ] Visual sentinel suite passes:
  - `PLAYWRIGHT_BROWSERS_PATH=/Users/mo/git/musicxml/.playwright npm run test:visual -- --workers=4`

## Compatibility + dependency readiness
- [ ] Peer dependency contract for `vexflow` is unchanged or documented.
- [ ] Dev-pinned VexFlow version is validated against conformance + visual gates.
- [ ] Any local workarounds have explicit upstream status in sync log.

## Documentation + handoff
- [ ] `/Users/mo/git/musicxml/docs/vexflow-upstream-sync-log.md` updated.
- [ ] `/Users/mo/git/musicxml/ai-state.md` updated with current milestone and gate outputs.
- [ ] `/Users/mo/git/musicxml/docs/planning/logs.md` appended with release-hardening evidence.
