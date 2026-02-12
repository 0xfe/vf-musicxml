# Plan Feedback — Review 3

- **Date**: 2026-02-12
- **Reviewer**: Claude Opus 4.6 (claude-opus-4-6) via Claude Code CLI agent
- **Scope**: Full codebase review — planning docs, CSM types, parser, renderer, layout engine, testkit, conformance framework, and public API
- **Focus**: Directional assessment toward producing beautiful, publication-quality music notation

---

## Overall Assessment

The project has made remarkable progress from M0 through M10. The planning is thorough, the conformance framework is sophisticated, and the quality measurement infrastructure (Q1-Q7 rubric, golden comparisons, geometry analysis) is well ahead of most notation projects at this stage. The parser is clean, well-typed, and handles real-world MusicXML robustly. The diagnostic system is excellent.

However, the review identified several issues — some architectural, some implementation-level — that will block the stated goal of "absolutely beautiful music notation" if not addressed. The most critical is the single-voice-per-staff limitation, which makes it impossible to correctly render the vast majority of real-world scores. Several other issues relate to engraving fundamentals (proportional spacing, dynamics glyph rendering, text measurement accuracy) that distinguish professional-quality output from functional-but-amateur output.

The feedback below is numbered F-025 through F-039, continuing from Review 2.

---

### F-025: Single-voice-per-staff rendering is the critical path blocker
**Severity: Critical | Affects: Renderer (render-note-mapper.ts:83-89), all milestones**

The renderer currently drops all but the first voice per staff with a diagnostic `MULTI_VOICE_NOT_SUPPORTED_IN_M2`. This is the single largest gap between the current output and beautiful notation. Nearly every real-world score uses multiple voices:

- Bach chorales: SATB on two staves (2 voices each)
- Piano music: melody + accompaniment patterns in the same hand
- String quartets: divisi passages
- Any score with independent rhythms on the same staff

Without multi-voice support:
- Stem directions cannot be correct (voice 1 stems up, voice 2 stems down)
- Rest positioning cannot be correct (rests offset vertically per voice)
- Counter-melodies are silently lost
- The conformance scores are artificially inflated because the missing content isn't penalized

This was flagged in the M6 notation support matrix as a "known gap" but has not been elevated to the risk backlog or given a milestone target. Given that it affects the visual correctness of essentially every non-trivial score, it should be the highest-priority renderer work.

**Recommendation:** Create an explicit milestone track (M8F or M12) for multi-voice rendering. VexFlow supports multiple voices per stave via `Formatter.joinVoices()` and `Voice` objects — the API exists, it just needs to be wired. The work involves:
1. Creating multiple `Voice` objects per staff from `VoiceTimeline[]`
2. Joining voices via VexFlow's `Formatter.joinVoices()` before formatting
3. Setting stem directions per voice (voice 1 up, voice 2 down by convention)
4. Adjusting rest positions for secondary voices
5. Updating the spanner/notation passes to handle multi-voice event keys

This is a prerequisite for any claim of publication-quality output. Add to the risk backlog as P0.

---

### F-026: No proportional horizontal spacing
**Severity: High | Affects: Renderer (render.ts layout engine), M9 style fidelity**

The layout engine uses density-pressure heuristics to determine measure widths, but does not implement proportional spacing — the fundamental engraving principle that horizontal distance between notes should be proportional to their duration. In professional notation:

- A whole note gets ~4x the horizontal space of a quarter note
- An eighth note gets ~half the space of a quarter note
- This ratio is typically logarithmic (Ross, Behind Bars), not linear

Currently, the system allocates equal column widths per measure (modulated by density heuristics), and VexFlow's `Formatter` distributes notes within those columns. But the inter-measure column widths themselves don't reflect the rhythmic content — a measure of whole notes gets roughly the same width as a measure of sixteenth notes, with only the heuristic boost differentiating them.

This produces output where:
- Simple measures look too spread out
- Dense measures look too compressed
- The visual rhythm doesn't match the musical rhythm

**Recommendation:** Implement duration-weighted measure width allocation. For each measure, sum the durations of its densest voice, then allocate column widths proportionally across the system. VexFlow's `Formatter` already does proportional allocation within a single measure — the gap is in the system-level planning that happens in `render.ts`. The M10D source `measure@width` hints are a step toward this, but the fallback (when source hints are absent) should still be duration-proportional. Reference: LilyPond's spring-rod model; Behind Bars Chapter 2 on horizontal spacing.

---

### F-027: Dynamics rendered as plain text instead of engraved glyphs
**Severity: High | Affects: Renderer (render-notations-text.ts, render-drawing.ts), visual quality**

Dynamic markings (pp, p, mp, mf, f, ff, sfz, etc.) are currently rendered as text annotations. In professional notation, dynamics use dedicated music font glyphs (SMuFL codepoints U+E520-U+E54F) that are visually distinct — italic, with specific weights and proportions designed for readability below the staff.

Text-rendered dynamics:
- Don't match the visual language musicians expect
- Can't be distinguished from other direction text at a glance
- Look amateurish compared to any commercial notation software
- Don't scale properly with staff size

This is flagged as a "known M6 gap" in the notation support matrix but affects every score with dynamics — which is essentially all of them.

**Recommendation:** Map dynamics strings to SMuFL glyph codepoints and render them using VexFlow's `TextDynamics` class (or direct glyph placement if TextDynamics is insufficient). The mapping is straightforward:
- `p` → U+E520, `pp` → U+E521, `ppp` → U+E522
- `f` → U+E522, `ff` → U+E52F, `fff` → U+E530
- `mp` → U+E52C, `mf` → U+E52D
- `sfz` → composite U+E539+U+E53B+U+E53C

VexFlow has built-in dynamics glyph support. Wire the `DirectionEvent.dynamics` array through the glyph renderer instead of the text annotation path.

---

### F-028: Text width estimation is a pervasive quality limiter
**Severity: High | Affects: Renderer (render-notations-text.ts:270, svg-collision.ts), layout quality**

The text width estimation formula `text.length * fontSize * 0.6` is used in two critical paths:
1. Layout: determining where to place harmony symbols, lyrics, and direction text
2. Quality measurement: computing text bounding boxes for collision detection

This approximation is wrong by 20-50% for common cases:
- Proportional fonts: "W" is ~2x wider than "i"
- Music symbols in text (flats, sharps): different widths entirely
- Multi-byte Unicode characters: counted as 1 but may render wider or narrower
- Font weight/style: bold text is ~10-15% wider than regular

The consequences compound:
- Text overlap avoidance (`resolveTextRowWithoutOverlap`) makes bad placement decisions
- Collision detection reports false positives and false negatives
- Quality scores (Q5 text quality) are inaccurate
- The overlap gates (B-009) may be passing based on incorrect measurements

**Recommendation:** Replace the linear estimation with a character-class-weighted model:
```typescript
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += (CHAR_WIDTH_TABLE[char] ?? 0.6) * fontSize;
  }
  return width;
}
```
Where `CHAR_WIDTH_TABLE` contains per-character width ratios for the target font. This can be pre-computed from font metrics (e.g., via `opentype.js` at build time or a static lookup table for common music notation fonts). Even a rough table with 10 character classes (narrow: `iIl1`, medium: `a-z`, wide: `WMm@`, numeric: `0-9`) would be a significant improvement. Long-term, consider using `@resvg/resvg-js` (already a dependency) to measure actual text extents at layout time.

---

### F-029: Cross-staff notation completely unsupported
**Severity: Medium-High | Affects: Renderer (render-notations-spanners.ts:178), piano/keyboard scores**

Cross-staff operations — notes beamed across staves, slurs connecting notes on different staves, and cross-staff voice assignments — are completely skipped with a hard-coded 90px Y-delta threshold:

```typescript
if (Math.abs(firstStave.getY() - lastStave.getY()) > 90) {
  // Skip cross-staff slurs
}
```

This affects:
- Piano music (extremely common): left-hand notes reaching into treble staff
- Harp parts: similar cross-staff patterns
- Organ music: three staves with cross-staff movement
- Any grand-staff instrument

The 90px threshold is also fragile — it doesn't scale with the configurable staff spacing (`STAFF_ROW_HEIGHT`, `intraStaffGap`). A score rendered at a different scale or with different staff spacing could trigger false rejections or false acceptances.

**Recommendation:** Short-term: make the cross-staff threshold relative to the configured staff distance (e.g., `1.5 * resolvedStaffDistance`). Medium-term: implement cross-staff slur/tie routing using VexFlow's multi-stave connector capabilities. This is a prerequisite for acceptable piano music rendering. Track as a specific item in the VexFlow gap registry if VexFlow APIs are insufficient.

---

### F-030: Chord modifier anchor index is a no-op function
**Severity: Medium | Affects: Renderer (render-note-mapper.ts:396-398), chord visual quality**

```typescript
function resolveChordModifierAnchorIndex(event: NoteEvent): number {
  return event.notes.length > 0 ? 0 : 0;
}
```

This function always returns 0 regardless of input. The ternary is meaningless. While the comment says "simple and deterministic," the result is that chord-level modifiers (articulations, ornaments) always attach to the first note in the chord, regardless of stem direction or notehead position.

In proper engraving:
- Articulations on upward-stemmed chords should attach to the top note
- Articulations on downward-stemmed chords should attach to the bottom note
- Fermatas always go above the chord regardless of stem direction

**Recommendation:** Implement stem-direction-aware anchor resolution:
```typescript
function resolveChordModifierAnchorIndex(event: NoteEvent): number {
  if (event.notes.length <= 1) return 0;
  const stemUp = event.stemDirection === 'up';
  // Stem up: anchor on last (highest) note; stem down: anchor on first (lowest)
  return stemUp ? event.notes.length - 1 : 0;
}
```
This is a small change with outsized visual impact on any chord-heavy score.

---

### F-031: Conformance quality scores are inflated by the multi-voice gap
**Severity: Medium | Affects: Testkit (conformance-quality.ts), quality measurement accuracy**

The quality scoring system (Q1-Q7) evaluates what was rendered, but cannot penalize what was not rendered. Since multi-voice content is silently dropped (F-025), the quality scores reflect a simpler, cleaner rendering that omits the complexity of the actual score.

This means:
- A Bach chorale with 4 voices rendered as 2 voices gets a high Q1 (spacing) score because there's less content to collide
- Q2 (collision avoidance) looks good because the dropped voices would have been the source of most collisions
- The weighted mean score (4.8591 per M7B) is artificially high
- As multi-voice support is added, quality scores will likely drop significantly

**Recommendation:** Add an explicit quality dimension or gate modifier for "content completeness" — the ratio of rendered events to parsed events. When `MULTI_VOICE_NOT_SUPPORTED_IN_M2` diagnostics are present, the score should be penalized or flagged. This prevents false confidence in quality metrics and prepares the team for the score regression that multi-voice support will inevitably cause. Consider adding a `Q0: Content Fidelity` dimension that checks `renderedNotes / parsedNotes` ratio.

---

### F-032: Hardcoded layout coefficients lack documentation and configurability
**Severity: Medium | Affects: Renderer (render.ts), layout tuning, M9/M11**

The layout engine in `render.ts` contains over 20 hardcoded constants and at least 6 multi-factor pressure formulas with undocumented weight coefficients:

```typescript
// Pressure formula (render.ts)
targetMinimumMeasureWidth = MINIMUM_MEASURE_WIDTH +
  densityPressure * 28 +
  denseRhythmPressure * 44 +
  peakDenseMeasurePressure * 72 +
  grandStaffPressure * 56 +
  accidentalPressure * 32
```

```typescript
// Complexity scoring (render.ts)
complexity = 0.35*beamRatio + 0.3*curvedRatio + 0.2*chordRatio + 0.15*denseRatio
```

```typescript
// Intra-staff gap (render.ts)
baseGap = 22 + complexity * 18
riskBoost = centerRatio * 36 + curvedRatio * 34 + denseRatio * 20
```

These coefficients were presumably tuned empirically, but:
- No comments explain why 28, 44, 72, 56, 32 (or any other coefficients)
- No reference to engraving literature justifying the ratios
- Not configurable via the public API or render options
- Not testable in isolation (tightly coupled to the full render pipeline)
- Changing one coefficient can cascade unpredictably

**Recommendation:**
1. Extract all layout coefficients into a single `LayoutCoefficients` configuration object with documented defaults
2. Add JSDoc comments linking each coefficient to the engraving principle it implements (e.g., "28px density boost per unit — prevents sub-8px notehead gaps per Behind Bars 2.1.3")
3. Expose `LayoutCoefficients` as an optional field on `RenderLayoutOptions` so advanced users can tune
4. Add unit tests that validate specific coefficient effects in isolation (e.g., "doubling density pressure increases measure width by X%")

This is prerequisite work for M11 (auto-formatting/layout optimization) — you can't optimize what you can't configure and measure.

---

### F-033: No rehearsal marks, codas, segnos, or navigation symbols
**Severity: Medium | Affects: Parser + Renderer, real-world score completeness**

The parser and renderer have no support for:
- Rehearsal marks (`<direction-type><rehearsal>`) — letters/numbers at section starts
- Coda symbols (`<direction-type><coda>`)
- Segno symbols (`<direction-type><segno>`)
- Fine, D.C., D.S. text markings as structured direction types

These appear in essentially every score longer than a few measures and are visually prominent. Their absence makes rendered scores look incomplete even when notes/rhythms are correct.

This is not tracked in the notation support matrix, the risk backlog, or any milestone.

**Recommendation:** Add parser support for `<rehearsal>`, `<coda>`, `<segno>` direction types in M8/M9 scope. Renderer support can use VexFlow's `StaveModifier` system (rehearsal marks as boxed text, coda/segno as SMuFL glyphs U+E048/U+E047). Track in the notation support matrix.

---

### F-034: Pedal markings not parsed or rendered
**Severity: Medium | Affects: Parser + Renderer, keyboard score completeness**

Piano pedal markings (`<direction-type><pedal type="start|stop|change">`) are not parsed or rendered. Pedal markings are ubiquitous in piano music and include:
- `Ped.` / `*` symbols
- Line-based pedal notation (bracket with notches)
- Half-pedal markings

Given the importance of piano music in the corpus (Bach, Beethoven sonatas, Schumann, Mozart), and that several proof-point fixtures are piano scores, pedal marks are a notable visual gap.

**Recommendation:** Add to M9 or a dedicated notation-expansion milestone. Parser support is straightforward (direction-type child element). Renderer support can start with text-based `Ped.`/`*` placement and graduate to line-based rendering later.

---

### F-035: `parseMusicXMLAsync` is synchronous despite the name
**Severity: Low-Medium | Affects: Public API (api.ts:53-88), developer experience**

The `parseMusicXMLAsync` function is declared `async` but performs no asynchronous work. The MXL extraction (`extractMusicXmlFromMxl`) is synchronous, and `parseMusicXML` is synchronous. The function returns a `Promise<ParseResult>` but never awaits anything.

This was by design per F-023 (M1 exports async API shape while deferring actual async work), but now that MXL support is fully implemented synchronously via manual ZIP parsing (no `fflate` or `JSZip` dependency), the async wrapper adds overhead and confusion:
- Callers must `await` for no reason
- The function signature implies I/O that doesn't happen
- Error behavior differs between sync and async paths (the async path has its own diagnostic normalization)

**Recommendation:** Either:
1. **Deprecate `parseMusicXMLAsync`** and add MXL support to the synchronous `parseMusicXML` (since the ZIP parsing is already sync). This simplifies the API to a single entry point.
2. **Document explicitly** that the async signature is forward-compatible (e.g., for future streaming parse or web worker support) and the current implementation is sync.

Option 1 is cleaner for consumers. The format detection (`isMxlArchive`) can be called internally.

---

### F-036: Slur routing quality needs side-selection refinement
**Severity: Low-Medium | Affects: Renderer (render-notations-spanners.ts), visual quality**

The slur side-selection algorithm (`resolveDesiredSlurSide`) minimizes endpoint skew, which is a good heuristic. However, it doesn't account for:
- Notes between the slur endpoints (slurs should avoid colliding with interior notes)
- Staff position (slurs near the top of a staff should go above, near the bottom should go below)
- Concurrent slurs (nested slurs should alternate sides to remain distinguishable)
- Phrasing slurs vs. articulation slurs (different visual conventions)

The `MAX_MIXED_STEM_SLUR_ANCHOR_DELTA` (48px) and `MAX_SLUR_ANCHOR_DELTA` (68px) thresholds cause slurs to be silently dropped in legitimate musical passages where the endpoint spread is wide but visually correct (e.g., a slur over a large interval leap).

**Recommendation:** Rather than dropping wide slurs, cap the anchor delta and flatten the curve. Most notation software renders wide slurs with reduced curvature rather than omitting them entirely. For the side-selection, add a simple heuristic: check if any interior notes would collide with the slur path on the chosen side, and flip if so. This is a meaningful quality improvement for lyrical passages.

---

### F-037: No ottava (8va/8vb) line support
**Severity: Low-Medium | Affects: Parser + Renderer, notation completeness**

Ottava lines (`<direction-type><octave-shift>`) are not parsed or rendered. These are common in:
- Piano music (high treble passages)
- Piccolo/celesta parts
- Bass clef instruments in extreme low register

Ottava lines affect both the visual output (dashed line with "8va" text) and the semantic interpretation (notes sound an octave higher/lower than written). Without them, affected passages render at the wrong octave with excessive ledger lines, which is both visually ugly and semantically incorrect.

**Recommendation:** Add ottava parsing to `parse-direction-events.ts` and renderer support as a spanner type (similar to wedge/hairpin). VexFlow has `OttavaShift` support. This is higher impact than it might seem because it directly causes wrong-register rendering for affected passages.

---

### F-038: Quality waivers completely bypass scoring instead of applying partial penalty
**Severity: Low-Medium | Affects: Testkit (conformance-quality.ts), quality measurement integrity**

When a fixture has a quality waiver (e.g., `quality-catastrophic-readability`), the waived dimension is completely excluded from scoring. This means:
- A fixture with catastrophic spacing and a waiver reports the same score as a fixture with perfect spacing
- Waivers hide regressions — if a waived fixture gets worse, nobody knows
- There's no incentive to fix waived issues because the scores look fine

**Recommendation:** Apply a reduced penalty instead of full bypass. For example:
- Waived catastrophic readability: score clamped to minimum 2.0 instead of excluded
- Waived critical collision: score capped at 3.0 instead of excluded

This preserves the gate-bypass function of waivers (the fixture won't fail CI) while still reflecting quality reality in the aggregate scores. It also creates a natural signal when waived fixtures improve — their scores rise toward the cap.

---

### F-039: No clef-change rendering at mid-measure positions
**Severity: Low | Affects: Renderer, notation correctness**

The parser correctly captures mid-measure attribute changes as `AttributeEvent[]` with tick offsets, including clef changes. However, the renderer only applies `effectiveAttributes` at the start of each measure — mid-measure clef changes are parsed but not rendered.

In real-world scores, mid-measure clef changes are common in:
- Cello parts (frequent bass-to-tenor clef switches)
- Viola parts
- Piano left hand
- Trombone parts

A missing clef change means subsequent notes in the measure render in the wrong register, producing visually incorrect output.

**Recommendation:** During the note-mapping pass, check `measure.attributeChanges` for clef events. When a clef change occurs mid-measure, insert a VexFlow `ClefNote` at the appropriate position in the voice. VexFlow supports inline clef changes via `ClefNote` objects that can be added to a voice alongside `StaveNote` objects.

---

## Summary

| # | Feedback | Severity | Affects | Action |
|---|----------|----------|---------|--------|
| F-025 | Multi-voice rendering not supported | Critical | Renderer, all scores | Create milestone track, implement multi-voice |
| F-026 | No proportional horizontal spacing | High | Layout engine, M9 | Implement duration-weighted measure widths |
| F-027 | Dynamics rendered as text, not glyphs | High | Renderer, visual quality | Use VexFlow TextDynamics / SMuFL glyphs |
| F-028 | Text width estimation is crude | High | Layout, quality measurement | Character-class-weighted width model |
| F-029 | Cross-staff notation unsupported | Medium-High | Renderer, piano scores | Scale threshold, implement cross-staff routing |
| F-030 | Chord anchor index always returns 0 | Medium | Renderer, chord quality | Stem-direction-aware anchor resolution |
| F-031 | Quality scores inflated by missing voices | Medium | Testkit, quality metrics | Add content fidelity dimension (Q0) |
| F-032 | Layout coefficients undocumented/hardcoded | Medium | Layout, M9/M11 | Extract to config, document rationale |
| F-033 | No rehearsal marks / coda / segno | Medium | Parser + Renderer | Add to notation expansion scope |
| F-034 | No pedal markings | Medium | Parser + Renderer | Add to notation expansion scope |
| F-035 | parseMusicXMLAsync is synchronous | Low-Medium | Public API | Deprecate or document forward-compat intent |
| F-036 | Slur routing drops wide slurs | Low-Medium | Renderer, lyrical passages | Cap curvature instead of dropping |
| F-037 | No ottava (8va/8vb) lines | Low-Medium | Parser + Renderer | Add octave-shift spanner support |
| F-038 | Quality waivers fully bypass scoring | Low-Medium | Testkit, quality integrity | Apply reduced penalty instead of exclusion |
| F-039 | No mid-measure clef change rendering | Low | Renderer, notation correctness | Insert VexFlow ClefNote at offset |

### Priority Grouping

**Must-fix for "beautiful notation" claim:**
- F-025 (multi-voice) — without this, no polyphonic score renders correctly
- F-026 (proportional spacing) — fundamental engraving principle
- F-027 (dynamics glyphs) — every score with dynamics looks wrong

**Should-fix for professional quality:**
- F-028 (text measurement) — affects all text placement accuracy
- F-029 (cross-staff) — blocks piano music quality
- F-030 (chord anchors) — easy fix, high impact on chord scores
- F-031 (inflated scores) — quality metrics should reflect reality

**Nice-to-fix for completeness:**
- F-032 through F-039 — incremental improvements that each make the output meaningfully better
