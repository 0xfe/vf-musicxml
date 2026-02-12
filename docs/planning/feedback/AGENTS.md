# Feedback Review Agents

This directory contains structured feedback reviews of the musicxml project's plans, designs, and implementation.

## Instructions for Feedback Agents

When conducting a review round:

1. **Scope**: Review all planning docs (`docs/planning/`), design docs (`docs/`), source code (`src/`), tests (`tests/`), and tooling (`scripts/`). The goal is a holistic assessment of the project's trajectory toward producing beautiful, publication-quality music notation.

2. **Prioritization**: Use severity levels (Critical, High, Medium, Low) and tag affected areas (parser, renderer, layout, API, testing, planning). Focus on:
   - Design problems that will compound if not addressed early
   - Major bugs or correctness issues
   - Gaps that block the goal of beautiful notation output
   - Architectural decisions that limit future quality improvements

3. **Awareness of active work**: Check `git status` and `docs/planning/status.md` to understand what is currently being worked on. Be mindful that in-progress code may have temporary inconsistencies. Note known issues from `docs/planning/todo.md` to avoid duplicating already-tracked concerns.

4. **Feedback format**: Follow the established format from prior reviews:
   - Unique ID per item (e.g., `F-025`, `F-026`, ...)
   - Severity and affected area
   - Clear problem statement
   - Concrete recommendation
   - Summary table at the end

5. **File naming**: Use `feedback-R{N}.md` where N is the review round number. Include a timestamp and reviewer metadata at the top of each document.

6. **Context**: Prior reviews are in `feedback-R1-R2.md`. Check the disposition sections to understand what was already accepted and incorporated. Do not re-raise items that have been addressed unless they were addressed inadequately.

## Review History

| Round | File | Date | Reviewer | Items |
|-------|------|------|----------|-------|
| R1 | feedback-R1-R2.md | 2026-02-10 | Human reviewer | F-001 to F-016 |
| R2 | feedback-R1-R2.md | 2026-02-10 | Human reviewer | F-017 to F-024 |
| R3 | feedback-R3.md | 2026-02-12 | Claude Opus 4.6 agent | F-025 to F-039 |
