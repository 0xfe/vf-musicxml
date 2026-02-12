import { Curve, StaveHairpin, StaveTie, Tuplet, type Stave, type StaveNote } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { EventRef, HarmonyEvent, Measure, NoteEvent, Score, SpannerRelation } from '../core/score.js';
import { buildVoiceEventKey, type BuildMeasureNotesResult, type RenderedTupletSpec } from './render-note-mapper.js';

/** Non-null render context alias used by notation drawing helpers. */
type VexRenderContext = NonNullable<ReturnType<Stave['getContext']>>;

/** Mixed-stem slurs with larger anchor deltas often indicate bad anchor pairing. */
const MAX_MIXED_STEM_SLUR_ANCHOR_DELTA = 48;
/** Any slur with extreme anchor spread becomes visually unstable in current baseline. */
const MAX_SLUR_ANCHOR_DELTA = 68;
/** Minimum x-gap between adjacent harmony symbols on the same row. */
const HARMONY_MIN_HORIZONTAL_GAP = 8;
/** Minimum x-gap between adjacent lyric syllables on the same line. */
const LYRIC_MIN_HORIZONTAL_GAP = 6;
/** Minimum x-gap between adjacent direction-text labels on the same row. */
const DIRECTION_MIN_HORIZONTAL_GAP = 8;
/** Hard cap for extra lyric lines added by overlap-avoidance routing. */
const MAX_ADDITIONAL_LYRIC_LINES = 8;
/** Fixed row step for stacked harmony labels to prevent vertical text collisions. */
const HARMONY_ROW_SPACING = 14;
/** Fixed row step for stacked lyric lines to preserve readability in dense verses. */
const LYRIC_ROW_SPACING = 14;
/** Fixed row step for stacked direction labels above the stave. */
const DIRECTION_ROW_SPACING = 12;

/** Measure range currently rendered on one page (`endMeasure` is exclusive). */
export interface RenderMeasureWindow {
  startMeasure: number;
  endMeasure: number;
}

/** Flat event key used for tie/slur/wedge note lookup during rendering. */
export function buildEventRefLookupKey(ref: EventRef): string {
  return `${ref.partId}|${ref.measureIndex}|${ref.voiceId}|${ref.eventIndex}`;
}

/** Copy one measure's local note map into a score-level event map. */
export function registerMeasureEventNotes(
  target: Map<string, StaveNote>,
  partId: string,
  measureIndex: number,
  result: BuildMeasureNotesResult
): void {
  for (const [voiceEventKey, note] of result.noteByEventKey.entries()) {
    const [voiceId, eventIndexText] = voiceEventKey.split(':');
    if (!voiceId || !eventIndexText) {
      continue;
    }

    const eventIndex = Number.parseInt(eventIndexText, 10);
    if (!Number.isFinite(eventIndex)) {
      continue;
    }

    target.set(
      buildEventRefLookupKey({
        partId,
        measureIndex,
        voiceId,
        eventIndex
      }),
      note
    );
  }
}

/** Draw direction words/tempo/dynamics above a stave with offset-based x placement. */
export function drawMeasureDirections(
  measure: Measure,
  stave: Stave,
  ticksPerQuarter: number,
  diagnostics: Diagnostic[]
): void {
  if (measure.directions.length === 0) {
    return;
  }

  const context = stave.getContext();
  if (!context) {
    diagnostics.push({
      code: 'DIRECTION_CONTEXT_UNAVAILABLE',
      severity: 'warning',
      message: `Skipping direction text rendering for measure ${measure.index + 1}; stave context is unavailable.`
    });
    return;
  }

  const measureTicks = estimateMeasureTicks(measure, ticksPerQuarter);
  const availableWidth = Math.max(32, stave.getWidth() - 36);
  const rowRightEdges = new Map<number, number>();
  let maxRow = 0;

  for (const direction of measure.directions) {
    const chunks: string[] = [];
    if (direction.words) {
      chunks.push(direction.words);
    }
    if (direction.dynamics && direction.dynamics.length > 0) {
      chunks.push(direction.dynamics.join(' '));
    }
    if (direction.tempo !== undefined) {
      chunks.push(`q = ${Math.round(direction.tempo)}`);
    }

    if (chunks.length === 0) {
      continue;
    }

    const ratio = measureTicks > 0 ? clamp(direction.offsetTicks / measureTicks, 0, 1) : 0;
    const x = stave.getX() + 16 + availableWidth * ratio;
    const text = chunks.join('  ');
    const width = estimateTextWidth(text, 11);
    const left = x;
    const right = x + width;
    const row = resolveTextRowWithoutOverlap(
      rowRightEdges,
      0,
      left,
      right,
      DIRECTION_MIN_HORIZONTAL_GAP,
      10
    );
    const y = stave.getY() - 18 - row * DIRECTION_ROW_SPACING;

    // Render lightweight direction text without introducing additional VexFlow tickables.
    context.save();
    context.setFont('Serif', 11, '');
    context.fillText(text, x, y);
    context.restore();
    rowRightEdges.set(row, right);
    maxRow = Math.max(maxRow, row);

    if (direction.wedge) {
      diagnostics.push({
        code: 'WEDGE_DIRECTION_TEXT_FALLBACK',
        severity: 'info',
        message: `Direction wedge '${direction.wedge.type}' parsed; rendered via hairpin spanners when anchors resolve.`
      });
    }
  }

  if (maxRow >= 2) {
    diagnostics.push({
      code: 'DIRECTION_TEXT_STACK_HIGH',
      severity: 'info',
      message: `Measure ${measure.index + 1} drew ${maxRow + 1} direction-text rows.`
    });
  }
}

/** Draw measure-level harmony symbols above the stave with note-anchor fallback. */
export function drawMeasureHarmonies(
  measure: Measure,
  stave: Stave,
  ticksPerQuarter: number,
  staffNumber: number,
  noteByEventKey: Map<string, StaveNote>,
  diagnostics: Diagnostic[]
): void {
  if (!measure.harmonies || measure.harmonies.length === 0) {
    return;
  }

  const context = stave.getContext();
  if (!context) {
    return;
  }

  const rowRightEdges = new Map<number, number>();
  const harmonyBaseY = stave.getYForTopText(2);
  let maxRow = 0;
  for (const harmony of measure.harmonies) {
    if (harmony.staff !== undefined && harmony.staff !== staffNumber) {
      continue;
    }

    const label = formatHarmonyLabel(harmony);
    if (!label) {
      continue;
    }

    const anchorX = resolveHarmonyX(measure, harmony.offsetTicks, stave, ticksPerQuarter, staffNumber, noteByEventKey);
    const width = estimateTextWidth(label, 12);
    const staveLeft = stave.getX() + 4;
    const staveRight = stave.getX() + stave.getWidth() - 4;
    const x = clamp(anchorX - width / 2, staveLeft, Math.max(staveLeft, staveRight - width));
    const row = resolveTextRowWithoutOverlap(
      rowRightEdges,
      0,
      x,
      x + width,
      HARMONY_MIN_HORIZONTAL_GAP
    );
    const y = harmonyBaseY - row * HARMONY_ROW_SPACING;

    context.save();
    context.setFont('Times New Roman', 12, 'italic');
    context.fillText(label, x, y);
    context.restore();
    rowRightEdges.set(row, x + width);
    maxRow = Math.max(maxRow, row);
  }

  if (maxRow >= 2) {
    diagnostics.push({
      code: 'HARMONY_TEXT_STACK_HIGH',
      severity: 'info',
      message: `Measure ${measure.index + 1} drew ${maxRow + 1} harmony rows on staff ${staffNumber}.`
    });
  }
}

/** Draw note-attached lyric tokens below the target stave. */
export function drawMeasureLyrics(
  measure: Measure,
  stave: Stave,
  staffNumber: number,
  noteByEventKey: Map<string, StaveNote>,
  diagnostics: Diagnostic[]
): void {
  const context = stave.getContext();
  if (!context) {
    return;
  }

  const lineRightEdges = new Map<number, number>();
  const lyricBaseY = stave.getYForBottomText(2);
  let renderedCount = 0;
  let maxLineIndex = 0;
  for (const voice of measure.voices) {
    for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
      const event = voice.events[eventIndex];
      if (!event || event.kind !== 'note' || (event.staff ?? 1) !== staffNumber) {
        continue;
      }

      const note = noteByEventKey.get(buildVoiceEventKey(voice.id, eventIndex));
      if (!note) {
        continue;
      }

      for (const lyric of collectEventLyrics(event)) {
        const text = lyric.text ?? (lyric.extend ? '_' : undefined);
        if (!text) {
          continue;
        }

        const parsedLine = Number.parseInt(lyric.number ?? '1', 10);
        const preferredLine = Number.isFinite(parsedLine) ? Math.max(0, parsedLine - 1) : 0;
        const width = estimateTextWidth(text, 11);
        const left = note.getAbsoluteX() - width / 2;
        const right = note.getAbsoluteX() + width / 2;
        const lineIndex = resolveTextRowWithoutOverlap(
          lineRightEdges,
          preferredLine,
          left,
          right,
          LYRIC_MIN_HORIZONTAL_GAP,
          MAX_ADDITIONAL_LYRIC_LINES
        );
        const y = lyricBaseY + lineIndex * LYRIC_ROW_SPACING;

        context.save();
        context.setFont('Times New Roman', 11, '');
        context.fillText(text, left, y);
        context.restore();
        lineRightEdges.set(lineIndex, right);
        maxLineIndex = Math.max(maxLineIndex, lineIndex);
        renderedCount += 1;
      }
    }
  }

  if (renderedCount > 0) {
    diagnostics.push({
      code: 'LYRIC_TEXT_RENDERED',
      severity: 'info',
      message: `Rendered ${renderedCount} lyric token(s) in measure ${measure.index + 1} on staff ${staffNumber}.`
    });
  }

  if (maxLineIndex >= 3) {
    diagnostics.push({
      code: 'LYRIC_TEXT_STACK_HIGH',
      severity: 'info',
      message: `Measure ${measure.index + 1} drew ${maxLineIndex + 1} lyric lines on staff ${staffNumber}.`
    });
  }
}

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
  try {
    new StaveTie({
      first_note: first,
      last_note: last,
      first_indices: [spanner.start.noteIndex ?? 0],
      last_indices: [spanner.end?.noteIndex ?? 0]
    })
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
  return {
    invert,
    position: firstPosition,
    position_end: endPosition
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

/** Estimate measure duration ticks for offset-to-x direction placement. */
function estimateMeasureTicks(measure: Measure, ticksPerQuarter: number): number {
  const time = measure.effectiveAttributes.timeSignature;
  if (time && time.beatType > 0) {
    return Math.round((time.beats * 4 * ticksPerQuarter) / time.beatType);
  }

  let max = 0;
  for (const voice of measure.voices) {
    for (const event of voice.events) {
      max = Math.max(max, event.offsetTicks + event.durationTicks);
    }
  }

  return max;
}

/** Clamp numeric ranges for deterministic offset interpolation. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Deterministic text-width estimate for headless contexts lacking SVG `getBBox`. */
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

/** Format one harmony event into display text used by baseline rendering. */
function formatHarmonyLabel(harmony: HarmonyEvent): string {
  const root = harmony.rootStep ? `${harmony.rootStep}${formatAlter(harmony.rootAlter)}` : '';
  const quality = harmony.text ?? harmony.kind ?? '';
  return [root, quality].filter((item) => item.length > 0).join(' ');
}

/** Format harmony root alteration into baseline accidental text. */
function formatAlter(alter: number | undefined): string {
  if (alter === undefined || alter === 0) {
    return '';
  }

  if (alter > 0) {
    return '#'.repeat(Math.max(1, Math.round(alter)));
  }

  return 'b'.repeat(Math.max(1, Math.round(Math.abs(alter))));
}

/** Resolve harmony anchor x-position using nearest rendered note or ratio fallback. */
function resolveHarmonyX(
  measure: Measure,
  offsetTicks: number,
  stave: Stave,
  ticksPerQuarter: number,
  staffNumber: number,
  noteByEventKey: Map<string, StaveNote>
): number {
  let best:
    | {
        distance: number;
        note: StaveNote;
      }
    | undefined;

  for (const voice of measure.voices) {
    for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
      const event = voice.events[eventIndex];
      if (!event || event.kind !== 'note' || (event.staff ?? 1) !== staffNumber) {
        continue;
      }

      const note = noteByEventKey.get(buildVoiceEventKey(voice.id, eventIndex));
      if (!note) {
        continue;
      }

      const distance = Math.abs(event.offsetTicks - offsetTicks);
      if (!best || distance < best.distance) {
        best = { distance, note };
      }
    }
  }

  if (best) {
    return best.note.getAbsoluteX();
  }

  const measureTicks = estimateMeasureTicks(measure, ticksPerQuarter);
  const availableWidth = Math.max(32, stave.getWidth() - 36);
  const ratio = measureTicks > 0 ? clamp(offsetTicks / measureTicks, 0, 1) : 0;
  return stave.getX() + 16 + availableWidth * ratio;
}

/** Gather lyric tokens from all noteheads in one note event. */
function collectEventLyrics(event: NoteEvent): Array<{ number?: string; text?: string; extend?: boolean }> {
  const lyrics: Array<{ number?: string; text?: string; extend?: boolean }> = [];
  for (const noteData of event.notes) {
    if (!noteData.lyrics) {
      continue;
    }

    for (const lyric of noteData.lyrics) {
      lyrics.push({
        number: lyric.number,
        text: lyric.text,
        extend: lyric.extend
      });
    }
  }

  return lyrics;
}

/**
 * Pick a non-overlapping text row using left-to-right packing.
 * This keeps harmony/lyric labels readable without introducing browser-specific
 * text-measurement or force-directed layout behavior.
 */
function resolveTextRowWithoutOverlap(
  rowRightEdges: Map<number, number>,
  preferredRow: number,
  left: number,
  right: number,
  minGap: number,
  maxAdditionalRows = 6
): number {
  let row = Math.max(0, preferredRow);
  const maxRow = row + Math.max(0, maxAdditionalRows);
  while (row <= maxRow) {
    const previousRight = rowRightEdges.get(row);
    if (previousRight === undefined || left >= previousRight + minGap) {
      return row;
    }
    row += 1;
  }

  return maxRow;
}
