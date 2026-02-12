import { Curve, StaveHairpin, StaveTie, Tuplet, type Stave, type StaveNote } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { Score, SpannerRelation } from '../core/score.js';
import type { RenderedTupletSpec } from './render-note-mapper.js';
import { buildEventRefLookupKey, type RenderMeasureWindow } from './render-notations-core.js';

/** Non-null render context alias used by notation drawing helpers. */
type VexRenderContext = NonNullable<ReturnType<Stave['getContext']>>;

/** Mixed-stem slurs with larger anchor deltas often indicate bad anchor pairing. */
const MAX_MIXED_STEM_SLUR_ANCHOR_DELTA = 48;
/** Any slur with extreme anchor spread becomes visually unstable in current baseline. */
const MAX_SLUR_ANCHOR_DELTA = 68;
/** Ties should connect equal-pitch anchors; large deltas indicate unstable pairing. */
const MAX_TIE_ANCHOR_DELTA = 56;

/** Draw parsed tuplet groups for the current measure/staff after note formatting. */
export function drawMeasureTuplets(
  tuplets: RenderedTupletSpec[],
  diagnostics: Diagnostic[],
  context: VexRenderContext
): void {
  for (const tuplet of tuplets) {
    if (tuplet.notes.length < 2) {
      diagnostics.push({
        code: 'TUPLET_NOT_ENOUGH_NOTES',
        severity: 'warning',
        message: 'Skipping tuplet draw because fewer than two notes were captured.'
      });
      continue;
    }

    try {
      new Tuplet(tuplet.notes, {
        num_notes: tuplet.numNotes,
        notes_occupied: tuplet.notesOccupied,
        bracketed: tuplet.bracketed,
        ratioed: tuplet.ratioed,
        location: tuplet.location
      })
        .setContext(context)
        .draw();
    } catch (error) {
      diagnostics.push({
        code: 'TUPLET_RENDER_FAILED',
        severity: 'warning',
        message: error instanceof Error ? error.message : 'Tuplet render failed.'
      });
    }
  }
}

/** Draw tie/slur/wedge spanners that reference currently rendered event notes. */
export function drawScoreSpanners(
  score: Score,
  renderedPartId: string,
  eventNotes: Map<string, StaveNote>,
  diagnostics: Diagnostic[],
  context: VexRenderContext,
  renderWindow?: RenderMeasureWindow
): void {
  for (const spanner of score.spanners) {
    if (spanner.start.partId !== renderedPartId) {
      continue;
    }

    if (!spanner.end) {
      diagnostics.push({
        code: 'SPANNER_END_MISSING',
        severity: 'warning',
        message: `Spanner '${spanner.id}' has no end anchor and was not rendered.`
      });
      continue;
    }

    if (renderWindow && !spannerIntersectsMeasureWindow(spanner, renderWindow)) {
      // Spanner is outside this page window, so anchor absence on this page is expected.
      continue;
    }

    const first = eventNotes.get(buildEventRefLookupKey(spanner.start));
    const last = eventNotes.get(buildEventRefLookupKey(spanner.end));
    if (!first || !last) {
      diagnostics.push({
        code: 'SPANNER_ANCHOR_NOT_RENDERED',
        severity: 'warning',
        message: `Spanner '${spanner.id}' references note anchors that are not rendered in current M5 baseline.`
      });
      continue;
    }

    if (!anchorsShareStaffRow(first, last)) {
      diagnostics.push({
        code: 'SPANNER_CROSS_ROW_UNSUPPORTED',
        severity: 'info',
        message: `Skipping spanner '${spanner.id}' because anchors are on different staff rows.`
      });
      continue;
    }

    switch (spanner.type) {
      case 'tie':
        drawTie(spanner, first, last, diagnostics, context);
        break;
      case 'slur':
        drawSlur(spanner, first, last, diagnostics, context);
        break;
      case 'wedge':
        drawWedge(spanner, first, last, diagnostics, context);
        break;
      default:
        break;
    }
  }
}

/** True when spanner anchors sit on the same rendered staff row. */
function anchorsShareStaffRow(first: StaveNote, last: StaveNote): boolean {
  const firstY = first.checkStave().getY();
  const lastY = last.checkStave().getY();
  return Math.abs(firstY - lastY) <= 2;
}

/** Determine whether a spanner's full anchor range is expected on this page window. */
function spannerIntersectsMeasureWindow(
  spanner: SpannerRelation,
  renderWindow: RenderMeasureWindow
): boolean {
  if (!spanner.end) {
    return spanner.start.measureIndex >= renderWindow.startMeasure && spanner.start.measureIndex < renderWindow.endMeasure;
  }

  return (
    spanner.start.measureIndex >= renderWindow.startMeasure &&
    spanner.start.measureIndex < renderWindow.endMeasure &&
    spanner.end.measureIndex >= renderWindow.startMeasure &&
    spanner.end.measureIndex < renderWindow.endMeasure
  );
}

/** Draw one tie with optional chord-note index routing. */
function drawTie(
  spanner: SpannerRelation,
  first: StaveNote,
  last: StaveNote,
  diagnostics: Diagnostic[],
  context: VexRenderContext
): void {
  const firstIndex = spanner.start.noteIndex ?? 0;
  const lastIndex = spanner.end?.noteIndex ?? 0;
  const firstYs = first.getYs();
  const lastYs = last.getYs();
  const firstY = firstYs[Math.max(0, Math.min(firstYs.length - 1, firstIndex))];
  const lastY = lastYs[Math.max(0, Math.min(lastYs.length - 1, lastIndex))];
  if (
    Number.isFinite(firstY) &&
    Number.isFinite(lastY) &&
    Math.abs((firstY ?? 0) - (lastY ?? 0)) > MAX_TIE_ANCHOR_DELTA
  ) {
    diagnostics.push({
      code: 'TIE_EXTREME_ANCHOR_DELTA_UNSUPPORTED',
      severity: 'warning',
      message: `Skipping tie '${spanner.id}' due extreme anchor delta (${Math.abs((firstY ?? 0) - (lastY ?? 0)).toFixed(1)}).`
    });
    return;
  }

  try {
    const tie = new StaveTie({
      first_note: first,
      last_note: last,
      first_indices: [firstIndex],
      last_indices: [lastIndex]
    });
    // Keep tie side stable using first-anchor stem direction unless explicit
    // placement metadata is later modeled in score-core.
    tie.setDirection(normalizeStemDirection(first.getStemDirection()));
    tie.render_options.y_shift = 9;
    tie.render_options.cp1 = 7;
    tie.render_options.cp2 = 12;
    tie
      .setContext(context)
      .draw();
  } catch (error) {
    diagnostics.push({
      code: 'TIE_RENDER_FAILED',
      severity: 'warning',
      message: error instanceof Error ? error.message : `Tie '${spanner.id}' failed to render.`
    });
  }
}

/** Draw one slur curve between two note anchors. */
function drawSlur(
  spanner: SpannerRelation,
  first: StaveNote,
  last: StaveNote,
  diagnostics: Diagnostic[],
  context: VexRenderContext
): void {
  const firstStave = first.checkStave();
  const lastStave = last.checkStave();
  // Cross-staff slurs are not yet modeled explicitly. Guard against accidental
  // long-distance matches that can draw through unrelated systems.
  if (Math.abs(firstStave.getY() - lastStave.getY()) > 90) {
    diagnostics.push({
      code: 'SLUR_CROSS_STAFF_UNSUPPORTED',
      severity: 'warning',
      message: `Skipping slur '${spanner.id}' because anchors resolve to different staff rows.`
    });
    return;
  }

  const startStem = normalizeStemDirection(first.getStemDirection());
  const endStem = normalizeStemDirection(last.getStemDirection());
  const slurSide = resolveDesiredSlurSide(spanner, first, last, startStem, endStem);
  const startAnchorY = resolveSlurAnchorYForSide(first, slurSide, startStem, spanner.start.noteIndex);
  const endAnchorY = resolveSlurAnchorYForSide(last, slurSide, endStem, spanner.end?.noteIndex);
  const anchorDeltaY = Math.abs(startAnchorY - endAnchorY);
  const anchorDeltaX = Math.abs(first.getAbsoluteX() - last.getAbsoluteX());
  // When one end has an up-stem and the other has a down-stem, very large
  // anchor deltas usually produce diagonal slurs that cut through unrelated
  // notation. Until cross-staff/cross-voice slur routing is first-class, skip
  // these pathological cases deterministically.
  if (startStem !== endStem && anchorDeltaY > MAX_MIXED_STEM_SLUR_ANCHOR_DELTA) {
    diagnostics.push({
      code: 'SLUR_MIXED_STEM_DELTA_UNSUPPORTED',
      severity: 'warning',
      message: `Skipping slur '${spanner.id}' due mixed stems with large anchor delta (${anchorDeltaY.toFixed(1)}).`
    });
    return;
  }
  // Even with aligned stems, very large Y deltas on moderate X spans frequently
  // indicate incorrect anchor pairing in complex real-world imports. Guard these
  // until the slur router can model cross-voice/cross-system continuation.
  if (anchorDeltaY > MAX_SLUR_ANCHOR_DELTA && anchorDeltaX > 24) {
    diagnostics.push({
      code: 'SLUR_EXTREME_ANCHOR_DELTA_UNSUPPORTED',
      severity: 'warning',
      message: `Skipping slur '${spanner.id}' due extreme anchor delta (dx=${anchorDeltaX.toFixed(1)}, dy=${anchorDeltaY.toFixed(1)}).`
    });
    return;
  }

  try {
    new Curve(first, last, resolveSlurCurveOptions(spanner, first, last, slurSide))
      .setContext(context)
      .draw();
  } catch (error) {
    diagnostics.push({
      code: 'SLUR_RENDER_FAILED',
      severity: 'warning',
      message: error instanceof Error ? error.message : `Slur '${spanner.id}' failed to render.`
    });
  }
}

/** Resolve slur curve options so mixed-stem slurs stay on one consistent side. */
function resolveSlurCurveOptions(
  spanner: SpannerRelation,
  first: StaveNote,
  last: StaveNote,
  slurSide: 'above' | 'below'
): ConstructorParameters<typeof Curve>[2] {
  const startStem = normalizeStemDirection(first.getStemDirection());
  const endStem = normalizeStemDirection(last.getStemDirection());
  const desiredDirection = slurSide === 'above' ? -1 : 1;
  const invert = desiredDirection !== endStem;
  const firstPosition = resolveCurvePositionForSide(slurSide, startStem);
  const endPosition = resolveCurvePositionForSide(slurSide, endStem);
  const spanX = Math.abs(first.getAbsoluteX() - last.getAbsoluteX());
  const yShift = clampNumber(11 + spanX * 0.015, 11, 18);
  const cpY = clampNumber(11 + spanX * 0.03, 11, 20);
  return {
    invert,
    position: firstPosition,
    position_end: endPosition,
    y_shift: yShift,
    cps: [
      { x: 0, y: cpY },
      { x: 0, y: cpY }
    ]
  };
}

/** Normalize parser slur placement text into strict above/below values. */
function normalizeSlurPlacement(placement: unknown): 'above' | 'below' | undefined {
  if (placement === 'above' || placement === 'below') {
    return placement;
  }
  return undefined;
}

/** Normalize stem direction values into the +/-1 form used by VexFlow curves. */
function normalizeStemDirection(direction: number | undefined): 1 | -1 {
  return direction === -1 ? -1 : 1;
}

/** Pick a stable slur side when MusicXML placement is absent. */
function resolveDesiredSlurDirection(
  placement: 'above' | 'below' | undefined,
  startStem: 1 | -1
): 1 | -1 {
  if (placement === 'above') {
    return -1;
  }
  if (placement === 'below') {
    return 1;
  }
  // Default to the side opposite the first note stem for readability.
  return startStem === 1 ? 1 : -1;
}

/** Resolve a stable slur side, preferring explicit placement and otherwise minimizing endpoint skew. */
function resolveDesiredSlurSide(
  spanner: SpannerRelation,
  first: StaveNote,
  last: StaveNote,
  startStem: 1 | -1,
  endStem: 1 | -1
): 'above' | 'below' {
  const explicit = normalizeSlurPlacement(spanner.data?.placement);
  if (explicit) {
    return explicit;
  }

  const aboveDelta = Math.abs(
    resolveSlurAnchorYForSide(first, 'above', startStem, spanner.start.noteIndex) -
      resolveSlurAnchorYForSide(last, 'above', endStem, spanner.end?.noteIndex)
  );
  const belowDelta = Math.abs(
    resolveSlurAnchorYForSide(first, 'below', startStem, spanner.start.noteIndex) -
      resolveSlurAnchorYForSide(last, 'below', endStem, spanner.end?.noteIndex)
  );

  if (aboveDelta !== belowDelta) {
    return aboveDelta < belowDelta ? 'above' : 'below';
  }

  return resolveDesiredSlurDirection(undefined, startStem) < 0 ? 'above' : 'below';
}

/** Resolve one endpoint Y anchor using the same side/position mapping used for Curve rendering. */
function resolveSlurAnchorYForSide(
  note: StaveNote,
  slurSide: 'above' | 'below',
  stemDirection: 1 | -1,
  noteIndex: number | undefined
): number {
  const position = resolveCurvePositionForSide(slurSide, stemDirection);
  if (position === Curve.Position.NEAR_TOP) {
    return note.getStemExtents().topY;
  }

  // NEAR_HEAD endpoint uses notehead-side Y. For chords we choose the targeted
  // note index when available to keep diagnostics aligned with tie/slur anchors.
  const yValues = note.getYs();
  if (yValues.length === 0) {
    return note.getStemExtents().baseY;
  }
  const safeIndex = Math.max(0, Math.min(yValues.length - 1, noteIndex ?? 0));
  return yValues[safeIndex] ?? yValues[0] ?? note.getStemExtents().baseY;
}

/** Map a desired slur side and stem direction to VexFlow Curve endpoint position. */
function resolveCurvePositionForSide(
  slurSide: 'above' | 'below',
  stemDirection: 1 | -1
): number {
  if (slurSide === 'above') {
    return stemDirection === 1 ? Curve.Position.NEAR_TOP : Curve.Position.NEAR_HEAD;
  }

  return stemDirection === 1 ? Curve.Position.NEAR_HEAD : Curve.Position.NEAR_TOP;
}

/** Clamp numeric ranges for stable curve/tie routing heuristics. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Draw one crescendo/diminuendo hairpin between two note anchors. */
function drawWedge(
  spanner: SpannerRelation,
  first: StaveNote,
  last: StaveNote,
  diagnostics: Diagnostic[],
  context: VexRenderContext
): void {
  const kind = spanner.data?.kind;
  const type =
    kind === 'diminuendo' ? StaveHairpin.type.DECRESC : StaveHairpin.type.CRESC;

  try {
    new StaveHairpin(
      {
        first_note: first,
        last_note: last
      },
      type
    )
      .setContext(context)
      .setRenderOptions({
        height: 10,
        y_shift: 8,
        left_shift_px: 0,
        right_shift_px: 0
      })
      .draw();
  } catch (error) {
    diagnostics.push({
      code: 'WEDGE_RENDER_FAILED',
      severity: 'warning',
      message: error instanceof Error ? error.message : `Wedge '${spanner.id}' failed to render.`
    });
  }
}
