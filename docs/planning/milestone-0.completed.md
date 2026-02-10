## M0: Repo Foundation + Core Test Harness
Outcome:
- Reproducible development environment and CI with no rendering complexity.

Deliverables:
- Initial files: `AGENTS.md`, `README.md`, `.gitignore`, `tsconfig*`, lint/format config, test configs, CI workflow.
- Single-package project layout (`src/*`, `tests/*`, `fixtures/*`).
- Test runner selected and configured: Vitest.
- Scripts: `build`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:conformance`.
- Conformance fixture loader and metadata schema.
- VexFlow version pinned to a specific tested release (target latest stable `4.x`) and documented.

Testing gates:
- CI green on lint/typecheck/unit/integration harness.
- Fixture loading and metadata parsing tested.

Docs gates:
- README quickstart and command reference.
- AGENTS contribution/testing conventions.
- Distribution policy (ESM + peer dependency) documented.

