# ADR-0001: XML Parser Stack

- Status: Accepted
- Date: 2026-02-10
- Milestone: M1

## Context
We need a MusicXML parser with:
- namespace correctness,
- location-aware diagnostics (line/column),
- predictable behavior in strict and lenient modes,
- a path toward efficient conformance testing.

## Decision
Use `saxes` as the XML tokenizer and build a lightweight internal XML AST layer.

## Rationale
- `saxes` provides precise parser position tracking.
- We retain full control over AST shape (`name`, `attributes`, `children`, `text`, `path`, `location`).
- This avoids DOM coupling and lets us preserve MusicXML-specific paths for diagnostics.

## Alternatives Considered
- `@xmldom/xmldom`: easier DOM access but weaker node-level location tracking.
- `fast-xml-parser`: fast object mapping but not a fit for location-aware diagnostics.

## Consequences
- Slightly more custom code in parser front-end.
- Better long-term quality for diagnostics and conformance triage.

## Follow-up
- If performance issues appear, benchmark AST build + transform pipeline and optimize hot paths.
