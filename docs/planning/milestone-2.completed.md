## M2: Basic Rendering Adapter (Single Staff First)
Outcome:
- First CSM -> VexFlow rendering path for single-part/single-voice scores.

Deliverables:
- Mapper for clef/key/time, notes/rests, and basic barlines.
- High-level `renderToSVGPages` and low-level `renderToElement` APIs.
- Playwright harness introduced here (not earlier).

Testing gates:
- Node-only SVG structural snapshots for simple fixtures.
- Assertions for expected element counts and semantic anchors.
- Small Playwright visual baseline set for high-signal fixtures.

Docs gates:
- Rendering pipeline doc and current limitations.

