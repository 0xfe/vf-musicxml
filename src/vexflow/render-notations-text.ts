import { Glyph } from 'vexflow';
import type { Stave, StaveNote } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { HarmonyEvent, Measure, NoteEvent } from '../core/score.js';
import { buildVoiceEventKey } from './render-note-mapper.js';

/** Minimum x-gap between adjacent harmony symbols on the same row. */
const HARMONY_MIN_HORIZONTAL_GAP = 8;
/** Minimum x-gap between adjacent lyric syllables on the same line. */
const LYRIC_MIN_HORIZONTAL_GAP = 6;
/** Minimum x-gap between adjacent direction-text labels on the same row. */
const DIRECTION_MIN_HORIZONTAL_GAP = 16;
/** Hard cap for extra lyric lines added by overlap-avoidance routing. */
const MAX_ADDITIONAL_LYRIC_LINES = 8;
/** Fixed row step for stacked harmony labels to prevent vertical text collisions. */
const HARMONY_ROW_SPACING = 14;
/** Fixed row step for stacked lyric lines to preserve readability in dense verses. */
const LYRIC_ROW_SPACING = 14;
/** Fixed row step for stacked direction labels above the stave. */
const DIRECTION_ROW_SPACING = 22;
/** Shared serif font stack for readable textual score annotations. */
const SCORE_TEXT_FONT = 'Times New Roman';
/** Direction text size (words/tempo) for M10 readability baseline. */
const DIRECTION_TEXT_SIZE = 12;
/** Harmony text size for chord symbols and analysis marks. */
const HARMONY_TEXT_SIZE = 13;
/** Lyric text size tuned for multi-line readability in dense fixtures. */
const LYRIC_TEXT_SIZE = 12;
/** Dynamic glyph point size used when drawing SMuFL dynamics above staves. */
const DYNAMICS_GLYPH_POINT = 40;
/** Horizontal gap between direction text and following dynamics glyph run. */
const DYNAMICS_TEXT_GAP = 24;
/** Extra side bearing reserved for each dynamics glyph to reduce overlap under-estimation. */
const DYNAMICS_GLYPH_SIDE_BEARING = 3;

/** Supported dynamics glyph map (mirrors VexFlow TextDynamics glyph set). */
const DYNAMICS_GLYPH_CODE: Record<string, string> = {
  f: 'dynamicForte',
  p: 'dynamicPiano',
  m: 'dynamicMezzo',
  s: 'dynamicSforzando',
  z: 'dynamicZ',
  r: 'dynamicRinforzando'
};

/** Approximate per-letter advance widths for dynamics glyph layout. */
const DYNAMICS_GLYPH_ADVANCE: Record<string, number> = {
  f: 14,
  p: 15,
  m: 19,
  s: 12,
  z: 13,
  r: 13
};

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
  const staveLeft = stave.getX() + 12;
  const staveRight = stave.getX() + stave.getWidth() - 12;
  const rowRightEdges = new Map<number, number>();
  let maxRow = 0;

  for (const direction of measure.directions) {
    const chunks: string[] = [];
    if (direction.words) {
      chunks.push(direction.words);
    }
    if (direction.tempo !== undefined) {
      chunks.push(`q = ${Math.round(direction.tempo)}`);
    }
    const dynamicSequence = normalizeDynamicsSequence(direction.dynamics);
    const text = chunks.join('  ');
    const textWidth = text.length > 0 ? measureDirectionTextWidth(text, context) : 0;
    const dynamicsWidth = dynamicSequence ? estimateDynamicsSequenceWidth(dynamicSequence) : 0;
    const totalWidth = textWidth + (textWidth > 0 && dynamicsWidth > 0 ? DYNAMICS_TEXT_GAP : 0) + dynamicsWidth;

    if (totalWidth <= 0) {
      continue;
    }

    const ratio = measureTicks > 0 ? clamp(direction.offsetTicks / measureTicks, 0, 1) : 0;
    const offsetX = stave.getX() + 16 + availableWidth * ratio;
    const x = clamp(offsetX, staveLeft, Math.max(staveLeft, staveRight - totalWidth));
    const left = x;
    const right = x + totalWidth;
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
    if (text.length > 0) {
      context.save();
      context.setFont(SCORE_TEXT_FONT, DIRECTION_TEXT_SIZE, '');
      context.fillText(text, x, y);
      context.restore();
    }
    if (dynamicSequence) {
      const dynamicX = x + textWidth + (textWidth > 0 ? DYNAMICS_TEXT_GAP : 0);
      drawDynamicsSequence(context, dynamicSequence, dynamicX, y + 1);
    }
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

/** Measure direction-word width using the exact font/style used during draw. */
function measureDirectionTextWidth(
  text: string,
  context: NonNullable<ReturnType<Stave['getContext']>>
): number {
  context.save();
  context.setFont(SCORE_TEXT_FONT, DIRECTION_TEXT_SIZE, '');
  const width = estimateTextWidth(text, DIRECTION_TEXT_SIZE, context);
  context.restore();
  return width;
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
    const width = estimateTextWidth(label, HARMONY_TEXT_SIZE);
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
    context.setFont(SCORE_TEXT_FONT, HARMONY_TEXT_SIZE, 'bold', 'italic');
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
        const width = estimateTextWidth(text, LYRIC_TEXT_SIZE);
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
        context.setFont(SCORE_TEXT_FONT, LYRIC_TEXT_SIZE, '');
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
function estimateTextWidth(
  text: string,
  fontSize: number,
  context?: NonNullable<ReturnType<Stave['getContext']>>
): number {
  if (text.length === 0) {
    return 0;
  }

  // Prefer renderer-native width metrics when available so row packing follows
  // the same glyph widths that VexFlow actually draws into the SVG context.
  if (context && typeof context.measureText === 'function') {
    try {
      context.save();
      context.setFont(SCORE_TEXT_FONT, fontSize, '');
      const measured = context.measureText(text);
      context.restore();
      if (Number.isFinite(measured?.width) && (measured?.width ?? 0) > 0) {
        return Math.ceil(measured?.width ?? 0);
      }
    } catch {
      // Fallback below keeps deterministic behavior when a backend does not
      // support text metrics APIs.
    }
  }

  let width = 0;
  for (const character of text) {
    width += estimateCharacterWidthScale(character) * fontSize;
  }
  return Math.ceil(width);
}

/** Approximate per-character width scale used when renderer metrics are unavailable. */
function estimateCharacterWidthScale(character: string): number {
  if (character === ' ') {
    return 0.34;
  }
  if (character === '\t') {
    return 0.68;
  }
  if (/[A-Z]/.test(character)) {
    return 0.64;
  }
  if (/[0-9]/.test(character)) {
    return 0.58;
  }
  if (/[.,:;'"!]/.test(character)) {
    return 0.28;
  }
  if (/[(){}[\]/\\|]/.test(character)) {
    return 0.35;
  }
  if (/[#♭♯𝄪𝄫]/u.test(character)) {
    return 0.62;
  }
  return 0.56;
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
    const steps = Math.max(1, Math.round(alter));
    if (steps === 1) {
      return '♯';
    }
    return '𝄪';
  }

  const steps = Math.max(1, Math.round(Math.abs(alter)));
  if (steps === 1) {
    return '♭';
  }
  return '𝄫';
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

/** Normalize parsed dynamics into one glyph-renderable sequence. */
function normalizeDynamicsSequence(markers: string[] | undefined): string | undefined {
  if (!markers || markers.length === 0) {
    return undefined;
  }

  const tokens: string[] = [];
  for (const marker of markers) {
    const token = marker
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .trim();
    if (!token || !/^[fpmzsr]+$/.test(token)) {
      continue;
    }
    tokens.push(token);
  }

  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

/** Estimate one dynamics glyph-run width using TextDynamics-compatible advances. */
function estimateDynamicsSequenceWidth(sequence: string): number {
  let width = 0;
  for (const character of sequence) {
    if (character === ' ') {
      width += 8;
      continue;
    }
    width += (DYNAMICS_GLYPH_ADVANCE[character] ?? 12) + DYNAMICS_GLYPH_SIDE_BEARING;
  }
  return Math.max(0, width - DYNAMICS_GLYPH_SIDE_BEARING);
}

/** Draw one dynamics sequence using SMuFL glyphs instead of plain text. */
function drawDynamicsSequence(
  context: NonNullable<ReturnType<Stave['getContext']>>,
  sequence: string,
  x: number,
  y: number
): void {
  let cursor = x;
  context.openGroup('vf-dynamics-text');
  for (const character of sequence) {
    if (character === ' ') {
      cursor += 8;
      continue;
    }

    const code = DYNAMICS_GLYPH_CODE[character];
    if (!code) {
      continue;
    }

    Glyph.renderGlyph(context, cursor, y, DYNAMICS_GLYPH_POINT, code, {
      category: 'textNote'
    });
    cursor += (DYNAMICS_GLYPH_ADVANCE[character] ?? 12) + DYNAMICS_GLYPH_SIDE_BEARING;
  }
  context.closeGroup();
}
