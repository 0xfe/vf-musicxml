# Plan Feedback

## Disposition — Review 2 (2026-02-10)

All items from `F-017` to `F-024` are **ACCEPTED** and incorporated into planning artifacts.

| ID | Status | Note |
|---|---|---|
| F-017 | ACCEPTED | Removed `BackupForwardEvent` from CSM event union; backup/forward are now parser-only normalization mechanics. |
| F-018 | ACCEPTED | Replaced chord continuation artifact with chord-capable `NoteEvent` (`notes[]`) in CSM sketch. |
| F-019 | ACCEPTED | Added `ticksPerQuarter` to `Score` for global tick resolution. |
| F-020 | ACCEPTED | Added minimal `EffectiveAttributes` type shape in CSM sketch. |
| F-021 | ACCEPTED | Added explicit `SpannerRelation` and `EventRef` table shape to `Score`. |
| F-022 | ACCEPTED | Added explicit `Diagnostic` type sketch with severity/code/message/source/xmlPath. |
| F-023 | ACCEPTED | Clarified M1 exports async parse API shape while deferring `.mxl` ZIP decode to M3 scope. |
| F-024 | ACCEPTED | Named Vitest as target test runner in M0 deliverables. |

## Review 2 — 2026-02-10

### Overall Assessment

Strong improvement. All 16 items from Review 1 are properly incorporated. The plan is now substantially more actionable — the CSM sketch, API split, parser decision, and scope adjustments all move in the right direction. Review 2 focuses on issues in the new content, primarily the CSM type sketch and a few M0/M1 clarifications.

---

### F-017: `BackupForwardEvent` should not survive into the CSM [new]
**Severity: High | Affects: M1 CSM design**

`BackupForwardEvent` is in the `TimedEvent` union, but this is a MusicXML encoding artifact. In MusicXML, `<backup>` and `<forward>` exist because the format encodes multiple voices as a single sequential stream — `<backup>` rewinds the time cursor to write a second voice.

But the CSM already has explicit `VoiceTimeline[]` per measure. If voices are separate timelines with `offsetTicks` on each event, backup/forward have already been resolved during the AST-to-CSM transform. They should be consumed during parsing, not preserved in the model.

Keeping them in `TimedEvent` means:
- The renderer has to skip/handle them (they carry no semantic meaning)
- Voice timelines aren't truly self-contained
- The CSM is encoding-aware rather than semantically clean

**Recommendation:** Remove `BackupForwardEvent` from `TimedEvent`. The AST-to-CSM transformer should consume `<backup>`/`<forward>` to split events into the correct `VoiceTimeline` with computed `offsetTicks`. The CSM should only contain semantically meaningful events.

---

### F-018: Chord representation needs clarification [new]
**Severity: Medium | Affects: M1 CSM design**

`ChordContinuationEvent` appears in the `TimedEvent` union but its meaning is unclear. In MusicXML, chords are encoded as sequential `<note>` elements where the second and subsequent notes have a `<chord/>` child — meaning "same onset as previous note." This is again an encoding artifact.

Two clean CSM options:
1. **Single `NoteEvent` with `pitches: Pitch[]`** — a chord is one event with multiple pitches. Simple, but loses per-note articulations/ties/fingerings.
2. **`NoteEvent` with `notes: NoteData[]`** — each `NoteData` carries pitch, accidental, articulations, tie info. Chord is one event, but individual note data is preserved.

Option 2 is better for music notation because individual chord tones can have different tie directions, articulations, and accidentals.

**Recommendation:** Replace `ChordContinuationEvent` with a `notes: NoteData[]` field on `NoteEvent`. A single note is `notes.length === 1`; a chord is `notes.length > 1`. Each `NoteData` carries pitch, accidental, notehead, tie/slur references, articulations. This eliminates another encoding artifact from the CSM.

---

### F-019: `ticksPerQuarter` not shown in the type hierarchy [new]
**Severity: Medium | Affects: M1 CSM design**

Design decision #1 says "ticksPerQuarter is normalized from encountered `<divisions>` values" but this value doesn't appear anywhere in the type sketch. Every `offsetTicks` and `durationTicks` value is meaningless without knowing the resolution.

**Recommendation:** Add `ticksPerQuarter: number` to the `Score` type. Choose a fixed normalization value (e.g., 480 or 960 ticks per quarter — standard MIDI resolutions) so all parts use the same base, regardless of what `<divisions>` each part originally declared. This eliminates cross-part tick interpretation issues.

---

### F-020: `EffectiveAttributes` type not sketched [new]
**Severity: Low-Medium | Affects: M1 completeness**

`Measure.effectiveAttributes` is referenced but `EffectiveAttributes` is not defined. This type is critical for M2 rendering — the mapper needs to know what clef, key, and time signature are active. At minimum it should contain:
```
clef, keySignature, timeSignature, staves (number of staves for this part)
```

**Recommendation:** Add a minimal `EffectiveAttributes` sketch to the CSM section. Even 4-5 fields is enough to verify the design is complete for M2.

---

### F-021: Cross-measure relations (ties/slurs/wedges) need a type shape [new]
**Severity: Low-Medium | Affects: M1 design, M4 implementation**

Design decision #4 says "linked with stable IDs and start/stop references in a relation table during normalization" but no type is shown. This is one of the harder design problems — ties span notes across measures, slurs can span many measures, wedges (crescendo/diminuendo) span from a start direction to an end direction.

Options:
1. **Relation table on `Score`**: `relations: SpannerRelation[]` where each has `{type, startRef, endRef, ...}`.
2. **Forward/back pointers on events**: each `NoteEvent` carries `tieStart?: string`, `tieEnd?: string` referencing a shared ID.
3. **Both**: relation table for global lookup, plus IDs on events for local traversal.

**Recommendation:** Show at least the relation table shape. Even a placeholder like `Score.spanners: SpannerRelation[]` with `type: 'tie' | 'slur' | 'wedge'` signals the intent and prevents M4 from retrofitting the CSM.

---

### F-022: `Diagnostic` type never sketched [new]
**Severity: Low-Medium | Affects: M1**

`Diagnostic[]` appears in every API result but the type is never defined. Since diagnostics are a "first-order design constraint" (plan goals), the shape matters:
- Severity: error vs warning vs info
- Code: stable string/enum for programmatic filtering (e.g., `"MISSING_DIVISIONS"`, `"DURATION_OVERFLOW"`)
- Message: human-readable text
- Source location: file name + line + column (from the `saxes` position tracking)
- MusicXML path: logical path like `/score-partwise/part[1]/measure[3]/note[2]`

**Recommendation:** Add a `Diagnostic` type sketch to the CSM section or API section. Having stable diagnostic codes from M1 onward enables downstream tooling to filter/suppress specific warnings.

---

### F-023: `.mxl` implementation timing vs API definition [new]
**Severity: Low | Affects: M1 scope clarity**

M1 lists "Parse API split: sync XML + async container-support path" as a deliverable, but R-006 in todo.md says "Start with `.xml`/`.musicxml` first." This is slightly ambiguous — does M1 implement `.mxl` decompression or just define the async API signature?

**Recommendation:** Clarify: M1 defines the `parseMusicXMLAsync` signature and exports a stub that only handles XML strings (same as sync path). Actual `.mxl` ZIP handling is implemented when R-006 is actively mitigated (likely M2 or M3). This avoids adding a ZIP dependency in M1 while locking down the API shape.

---

### F-024: M0 doesn't specify test runner [new]
**Severity: Low | Affects: M0**

M0 deliverables include test configs and multiple test scripts but doesn't name a test runner. For a 2026 TypeScript project, Vitest is the natural choice (fast, native ESM/TS, compatible with Playwright for later). Jest is also viable but requires more configuration for ESM.

**Recommendation:** Name Vitest as the target test runner in M0. Minor point but removes a decision during implementation.

---

### Summary of Review 2

| # | Feedback | Priority | Action |
|---|----------|----------|--------|
| F-017 | Remove BackupForwardEvent from CSM | High | Fix CSM sketch |
| F-018 | Chord = NoteEvent with notes[] | Medium | Fix CSM sketch |
| F-019 | Add ticksPerQuarter to Score | Medium | Fix CSM sketch |
| F-020 | Sketch EffectiveAttributes | Low-Med | Add to CSM |
| F-021 | Sketch spanner/relation table | Low-Med | Add to CSM |
| F-022 | Sketch Diagnostic type | Low-Med | Add to CSM or API |
| F-023 | Clarify .mxl timing in M1 | Low | Clarify M1 scope |
| F-024 | Name Vitest as test runner | Low | Add to M0 |

The high-priority item (F-017) is a correctness issue — shipping BackupForwardEvent in the CSM will create confusion in every downstream consumer. F-018 and F-019 are important design decisions that are much cheaper to get right now than to retrofit later. The rest are clarifications that improve plan precision.

---

## Disposition — 2026-02-10

All items from `F-001` to `F-016` are **ACCEPTED** and incorporated into planning artifacts.

| ID | Status | Note |
|---|---|---|
| F-001 | ACCEPTED | Switched early architecture to single-package; package extraction deferred to M5 decision gate. |
| F-002 | ACCEPTED | Added CSM design sketch and explicit core representation decisions. |
| F-003 | ACCEPTED | Split parse API into sync XML path + async `.mxl` path. |
| F-004 | ACCEPTED | Replaced single render API with high-level SVG pages + low-level DOM render API. |
| F-005 | ACCEPTED | Added parser shortlist and selected `saxes` + custom AST as plan target (ADR-0001 in M1). |
| F-006 | ACCEPTED | Added `score-timewise` detection in M1 and normalization target in M3. |
| F-007 | ACCEPTED | Added VexFlow pinning requirement to M0 with documented tested baseline. |
| F-008 | ACCEPTED | Moved Playwright setup from M0 to M2. |
| F-009 | ACCEPTED | Moved collision audits from M2 to M3. |
| F-010 | ACCEPTED | Defined strict vs lenient parse behavior and initial recovery heuristics. |
| F-011 | ACCEPTED | Added distribution strategy (ESM-first, VexFlow peer dependency). |
| F-012 | ACCEPTED | Added VexFlow patch strategy (`patch-package` first, fork only if needed). |
| F-013 | ACCEPTED | Replaced single manifest with per-fixture metadata + generated aggregate index. |
| F-014 | ACCEPTED | Added `<part-list>` parsing to M1 scope and CSM. |
| F-015 | ACCEPTED | Added self-review checklist to Definition of Done. |
| F-016 | ACCEPTED | Added TODO risk for Node vs browser rendering divergence. |

## Review 1 — 2026-02-10

### Overall Assessment

The plan is strong on structure, testing philosophy, and risk awareness. The milestone progression is logical, the conformance program is well-conceived, and the headless-first testing strategy is pragmatic. The main gaps are in (1) premature architectural complexity, (2) underspecified core data structures, and (3) several missing technical decisions that will block early milestones if not addressed upfront.

---

### F-001: Four-package monorepo is premature [new]
**Severity: High | Affects: M0**

The plan splits into `musicxml-core`, `musicxml-parser`, `musicxml-vexflow`, and `musicxml-testkit` from day one. This introduces significant M0 overhead:
- Workspace tooling (pnpm/yarn workspaces, tsconfig project references, cross-package builds)
- Circular dependency management between packages
- Import path ergonomics during rapid iteration

**Recommendation:** Start as a single package (`musicxml`) with clear internal directory boundaries (`src/core/`, `src/parser/`, `src/vexflow/`, `tests/testkit/`). Extract packages later (M5+) when the module boundaries have been proven through real usage. The internal structure can mirror the eventual package split without paying the tooling cost early.

---

### F-002: Canonical Score Model (CSM) has zero type detail [new]
**Severity: High | Affects: M1**

The CSM is the most critical data structure in the entire project — everything flows through it. Yet the plan says only "CSM v0 with strong TypeScript types" without any sketch of what it contains. Before M1 coding starts, the plan should include at least a rough type outline:
- `Score` -> `Part[]` -> `Measure[]` -> what?
- How are voices represented? Inline in measures or parallel timelines?
- How are divisions/durations normalized? Rational numbers, ticks, or floating point?
- Where do attributes (clef/key/time) live — on measures, as events in a timeline, or both?
- How are cross-measure constructs (ties, slurs, wedges) linked?

**Recommendation:** Add a "CSM Design Sketch" section to plan.md with the top-level type hierarchy and explicit decisions on voice representation and duration model. This is the single highest-value addition to the plan. Prior art to study:
- OSMD's object graph (already linked in plan)
- music21's stream model
- `musicxml-interfaces` npm package (by Joshua Netterfield/Ripieno) — provides TypeScript type definitions generated from the MusicXML DTD/XSD. Unmaintained and targets MusicXML 3.x, but the type shapes are a useful reference for understanding which fields exist on each element. Do not use as a dependency.

---

### F-003: `parseMusicXML` is sync but `.mxl` requires async [new]
**Severity: Medium | Affects: M1 API**

The API sketch shows `parseMusicXML` as synchronous, but `.mxl` files are ZIP archives — decompression in JS is typically async (e.g., `fflate`, `JSZip`). Options:
1. Make the API `async` from the start (simplest, but changes every call site).
2. Provide both `parseMusicXML` (sync, string/XML only) and `parseMusicXMLAsync` (handles `.mxl`).
3. Require callers to decompress `.mxl` externally before calling parse.

**Recommendation:** Option 2. Keep the core sync parse for the common case (already-decompressed XML string), and add an async wrapper that handles `.mxl` containers. Document this in the API section.

---

### F-004: `renderWithVexFlow` API is underspecified [new]
**Severity: Medium | Affects: M2 API**

The render function returns `{ svg?: string }` but:
- VexFlow rendering requires a rendering context (Factory/Renderer). Who owns the lifecycle?
- Returning an SVG string works for headless testing but not for interactive browser use (attaching to a DOM element, handling events).
- No provision for pagination — a multi-page score can't be a single SVG string.
- Canvas backend returns... what? `svg` field would be undefined.

**Recommendation:** Design two tiers:
1. **High-level**: `renderToSVGString(score, options)` — self-contained, returns string. Great for testing and server-side.
2. **Low-level**: `renderToElement(score, container, options)` — renders into a provided DOM element. Needed for browser integration.

Pagination should be an option that returns an array of pages.

---

### F-005: No XML parser decision or short-list [new]
**Severity: Medium | Affects: M1**

R-004 identifies parser choice as a risk, but there's no short-list or evaluation criteria. After research, the main candidates are:

| Library | Style | Location tracking | Namespaces | TS types | Notes |
|---------|-------|-------------------|------------|----------|-------|
| `saxes` | SAX/streaming | Full (line/col in all callbacks) | Full | Yes | Used by jsdom. Must build your own tree. |
| `@xmldom/xmldom` | DOM (W3C API) | Errors only, not on nodes | Full | Yes | Used by OSMD. Familiar DOM API. Heavier. |
| `fast-xml-parser` | DOM (JS objects) | None | Partial | Yes | Fastest, but lacks location tracking AND namespace support. |

MusicXML processing requires random access to the tree (cross-references, sibling navigation), which favors DOM-style. However, the plan explicitly requires "location-aware diagnostics" (M1), and MusicXML uses XML namespaces — both of which rule out `fast-xml-parser`.

**Recommendation:** Use `saxes` as the low-level tokenizer + build a lightweight custom AST on top that preserves `{line, column}` on every node. This is a common pattern (~100-200 lines for the tree builder) and gives both DOM-style navigation ergonomics and precise diagnostic locations. OSMD uses `@xmldom/xmldom` (which lacks node-level locations), so this approach would be a quality improvement over the main prior art. Make this an explicit M1 ADR deliverable.

**Fallback:** If speed-to-M1 is prioritized over diagnostic quality, `@xmldom/xmldom` gives a standard DOM API immediately. Location tracking can be retrofitted later (harder after the fact).

---

### F-006: `score-timewise` format not mentioned anywhere [new]
**Severity: Low-Medium | Affects: M1-M3**

The plan says "score-partwise support first" but never mentions score-timewise in any milestone. The MusicXML spec defines both formats and provides XSLT for converting between them (`parttime.xsl`, `timepart.xsl`). In practice, `score-partwise` is overwhelmingly dominant (99%+ of real-world files — Finale, Sibelius, MuseScore, Dorico, LilyPond all default to partwise). OSMD also only supports partwise (or converts timewise first).

**Recommendation:** At minimum, mention timewise in the plan and add detection + a clear error diagnostic in M1 ("score-timewise detected; not yet supported, convert to score-partwise"). Add timewise-to-partwise normalization as an M3 deliverable — it's a straightforward tree restructure and the official XSLT can guide the logic. Not urgent for M1 since the test suites are almost entirely partwise.

---

### F-007: VexFlow version not pinned [new]
**Severity: Medium | Affects: M0**

VexFlow has had major API changes between v3, v4, and v5. The plan references VexFlow broadly without specifying which version. This matters because:
- V4+ uses `Factory` and `EasyScore` APIs that differ significantly from v3.
- V5 (if released) may have further changes.
- The vendoring strategy depends on knowing the base version.

**Recommendation:** Pin VexFlow version in M0 (likely latest v4.x stable). Add to `package.json` as an explicit dependency with a version constraint. Document the minimum version in README.

---

### F-008: Playwright in M0 is premature overhead [new]
**Severity: Low-Medium | Affects: M0 scope**

M0 includes "Playwright harness integrated" and "one Playwright screenshot smoke test." But M0 has no rendering code — there's nothing meaningful to screenshot. Playwright adds:
- ~300MB browser download in CI
- Docker/CI complexity for consistent screenshots
- Configuration boilerplate that won't be exercised until M2

**Recommendation:** Move Playwright setup to M2 when the first rendering adapter lands. M0 should focus exclusively on: build, typecheck, lint, unit test runner, and fixture loading infrastructure. This keeps M0 lean and achievable fast, which is critical for momentum.

---

### F-009: SVG collision detection in M2 is too ambitious [new]
**Severity: Low-Medium | Affects: M2 scope**

M2 testing gates include "Basic collision checks for notehead/stem/accidental overlaps." Building a bounding-box computation engine from SVG path data is a significant sub-project. In M2, the rendering adapter is brand new — verifying that notes appear at all is the real gate.

**Recommendation:** Move collision detection to M3 or M4. M2 testing should focus on:
- Correct number of notes/rests in SVG output
- Correct clef/key/time elements present
- Basic structural snapshot matching
- Manual visual spot-checks

---

### F-010: Error recovery strategy is undefined [new]
**Severity: Medium | Affects: M1**

The `strict` option is mentioned in ParseOptions but there's no definition of what non-strict mode does. Real-world MusicXML files frequently have:
- Missing or inconsistent `<divisions>` values
- Duration sums that don't equal the time signature
- Malformed element content (wrong child order, missing required attributes)

**Recommendation:** Define three behaviors explicitly:
1. **Strict**: Any validation failure produces an error diagnostic and `score` is undefined.
2. **Default (lenient)**: Best-effort parse with warning diagnostics. Fill in missing values with sensible defaults.
3. Document which recovery heuristics are applied (e.g., "missing divisions defaults to 1", "duration overshoot truncated to measure boundary").

---

### F-011: Missing browser bundle / distribution strategy [new]
**Severity: Low | Affects: M0-M2**

The plan mentions "Node+browser support" but doesn't discuss how the library will be distributed:
- ESM-only? CJS+ESM dual?
- Will VexFlow be a peer dependency or bundled?
- Will there be a UMD/IIFE bundle for script-tag usage?

**Recommendation:** Add a brief "Distribution" section. For a new TypeScript library in 2026, ESM-only with VexFlow as a peer dependency is the cleanest starting point. Defer UMD/browser bundle until there's demand.

---

### F-012: VexFlow vendoring mechanism unspecified [new]
**Severity: Low | Affects: M0 when patching needed**

"Vendor/checkout VexFlow source in `vendor/vexflow`" could mean git submodule, npm with `patch-package`, full fork, or manual copy. Each has different tradeoffs:
- **Git submodule**: Clean versioning, but submodule workflows are painful.
- **`patch-package`**: Lightweight, patches live in-repo. Best for small fixes.
- **Fork**: Maximum control but maintenance burden.

**Recommendation:** Start with VexFlow as a normal npm dependency. Use `patch-package` for small fixes. Only escalate to a fork if patches are too large or too numerous. Document this decision in plan.md.

---

### F-013: Conformance manifest as single JSON may not scale [new]
**Severity: Low | Affects: M1+**

A single `fixtures/conformance/manifest.json` will grow large and create merge conflicts when multiple features are in flight.

**Recommendation:** Consider a directory convention where each fixture has a companion `.meta.json` or use YAML for better human-editability. Alternatively, keep the single manifest but auto-generate it from per-directory metadata.

---

### F-014: `<part-list>` parsing should start in M1, not M5 [new]
**Severity: Low | Affects: M1 completeness**

The `<part-list>` element (part names, abbreviations, MIDI instruments, score-instrument, part-group) is required in every valid MusicXML file. Parsing it in M1 (even if rendering only uses it in M5) ensures the CSM has complete data from the start and avoids retrofitting later.

**Recommendation:** Parse `<part-list>` fully in M1. Store it in the CSM. Defer rendering of part names/brackets to M5.

---

### F-015: Definition of Done lacks self-review checklist [new]
**Severity: Low | Affects: All milestones**

The DoD covers code, tests, docs, and status updates but doesn't mention code quality review. For a complex project built incrementally, a lightweight self-review checklist helps catch:
- Dead code from exploratory work
- TODO comments that should be in todo.md
- Inconsistent naming between CSM types and MusicXML element names

**Recommendation:** Add a 3-5 item self-review checklist to the DoD section.

---

### F-016: Missing risk — VexFlow Node vs browser rendering divergence [new]
**Severity: Low | Affects: M2+**

R-005 covers text metrics drift, but there's a broader risk: VexFlow itself may render differently in Node (using node-canvas or JSDOM SVG) vs a real browser. Font substitution, path rendering precision, and text measurement all differ. This affects SVG snapshot stability.

**Recommendation:** Add as R-009 in todo.md. Mitigation: always generate reference snapshots from the same environment (CI), and keep Node-based SVG tests structural (not pixel-level).

---

### Summary of Recommendations by Priority

| # | Feedback | Priority | Action |
|---|----------|----------|--------|
| F-001 | Single package first | High | Restructure M0 plan |
| F-002 | CSM type sketch | High | Add section to plan.md |
| F-003 | Sync/async API split | Medium | Revise API section |
| F-004 | Render API tiers | Medium | Revise API section |
| F-005 | XML parser: saxes + custom AST | Medium | Add ADR to M1 |
| F-006 | score-timewise mention + detect | Low-Med | Detect in M1, convert in M3 |
| F-007 | Pin VexFlow version | Medium | Add to M0 |
| F-008 | Defer Playwright to M2 | Low-Med | Trim M0 scope |
| F-009 | Defer collision detection | Low-Med | Move from M2 to M3+ |
| F-010 | Error recovery strategy | Medium | Define in plan.md |
| F-011 | Bundle/distribution plan | Low | Add section |
| F-012 | VexFlow vendoring mechanism | Low | Document decision |
| F-013 | Manifest scaling | Low | Consider alternatives |
| F-014 | Parse part-list in M1 | Low | Add to M1 scope |
| F-015 | Self-review checklist | Low | Add to DoD |
| F-016 | Node vs browser risk | Low | Add R-009 to todo.md |
