import { Curve, StaveHairpin, StaveTie, Tuplet, type Stave, type StaveNote } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { EventRef, HarmonyEvent, Measure, NoteEvent, Score, SpannerRelation } from '../core/score.js';
import { buildVoiceEventKey, type BuildMeasureNotesResult, type RenderedTupletSpec } from './render-note-mapper.js';

/** Non-null render context alias used by notation drawing helpers. */
type VexRenderContext = NonNullable<ReturnType<Stave['getContext']>>;

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
  let textRow = 0;

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
    const y = stave.getY() - 18 - textRow * 12;

    // Render lightweight direction text without introducing additional VexFlow tickables.
    context.save();
    context.setFont('Serif', 11, '');
    context.fillText(chunks.join('  '), x, y);
    context.restore();
    textRow += 1;

    if (direction.wedge) {
      diagnostics.push({
        code: 'WEDGE_DIRECTION_TEXT_FALLBACK',
        severity: 'info',
        message: `Direction wedge '${direction.wedge.type}' parsed; rendered via hairpin spanners when anchors resolve.`
      });
    }
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

  let row = 0;
  for (const harmony of measure.harmonies) {
    if (harmony.staff !== undefined && harmony.staff !== staffNumber) {
      continue;
    }

    const label = formatHarmonyLabel(harmony);
    if (!label) {
      continue;
    }

    const x = resolveHarmonyX(measure, harmony.offsetTicks, stave, ticksPerQuarter, staffNumber, noteByEventKey);
    const y = stave.getYForTopText(2 + row);

    context.save();
    context.setFont('Serif', 11, '');
    context.fillText(label, x, y);
    context.restore();
    row += 1;
  }

  if (row > 2) {
    diagnostics.push({
      code: 'HARMONY_TEXT_STACK_HIGH',
      severity: 'info',
      message: `Measure ${measure.index + 1} drew ${row} harmony rows on staff ${staffNumber}.`
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

  let renderedCount = 0;
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

        const lyricLine = Number.parseInt(lyric.number ?? '1', 10);
        const y = stave.getYForBottomText(2 + (Number.isFinite(lyricLine) ? Math.max(0, lyricLine - 1) : 0));
        const width = estimateTextWidth(text, 11);

        context.save();
        context.setFont('Serif', 11, '');
        context.fillText(text, note.getAbsoluteX() - width / 2, y);
        context.restore();
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
  try {
    new Curve(first, last, {})
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
