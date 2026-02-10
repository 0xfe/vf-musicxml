# Modularization Decision (M5)

## Decision
Keep the codebase as a single ESM package through M6.

## Status
Accepted for current stage (M5 closeout).

## Context
- M5 introduced richer renderer boundaries (multi-part/multi-staff layout, connectors, lyric/harmony overlays).
- Parser, CSM, renderer, and testkit boundaries are clearer, but still tightly coupled through fast-moving internal types and milestone-driven feature growth.
- Premature package split would introduce release/version friction while interfaces are still evolving quickly.

## Drivers
- Preserve implementation velocity during active conformance expansion.
- Avoid cross-package API churn while CSM and renderer contracts continue to expand.
- Keep deterministic test loops simple (`lint`, `typecheck`, `test`, `test:visual`) without workspace orchestration overhead.

## Considered options
1. Split now into `core/parser/renderer/testkit` packages
- Pros: cleaner dependency graph, future publish flexibility.
- Cons: immediate overhead in build/release/test orchestration; high churn risk for internal contracts.

2. Stay single-package now, split later when boundaries harden
- Pros: lower friction while milestone scope is still shifting.
- Cons: package-level isolation is deferred.

## Rationale
Option 2 is selected because current milestones prioritize breadth of MusicXML/VexFlow support and conformance promotion. The value of a split is real, but timing is wrong until boundary volatility drops.

## Revisit criteria
Re-open at M6/M7 when all are true:
- CSM surface is stable across two consecutive milestones.
- Renderer module dependencies stop requiring frequent cross-module type edits.
- External consumers need independent parser vs renderer versioning.
- CI demonstrates stable visual + conformance gates with low flake rates.

## Consequences
- Continue enforcing modularity at folder/API boundaries inside one package.
- Keep `src/public/` exports conservative and additive.
- Document split candidate seams continuously in `ai-state.md` and milestone docs.
