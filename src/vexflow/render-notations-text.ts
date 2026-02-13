import { Glyph } from 'vexflow';
import type { Stave, StaveNote } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { HarmonyEvent, Measure, NoteEvent } from '../core/score.js';
import { buildVoiceEventKey } from './render-note-mapper.js';

/** One occupied horizontal interval in a text row. */
interface TextRowSpan {
  left: number;
  right: number;
}

/** Reusable lane state for direction text rows on one staff within one system. */
export interface DirectionTextLaneState {
  aboveRowSpans: Map<number, TextRowSpan[]>;
  belowRowSpans: Map<number, TextRowSpan[]>;
}

/** Reusable lane state for harmony text rows on one staff within one system. */
export interface HarmonyTextLaneState {
  rowSpans: Map<number, TextRowSpan[]>;
}

/** Reusable lane state for lyric lines on one staff within one system. */
export interface LyricTextLaneState {
  lineSpans: Map<number, TextRowSpan[]>;
}

/** Minimum x-gap between adjacent harmony symbols on the same row. */
const HARMONY_MIN_HORIZONTAL_GAP = 12;
/** Minimum x-gap between adjacent lyric syllables on the same line. */
const LYRIC_MIN_HORIZONTAL_GAP = 12;
/** Minimum x-gap between adjacent direction-text labels on the same row. */
const DIRECTION_MIN_HORIZONTAL_GAP = 22;
/** Hard cap for extra lyric lines added by overlap-avoidance routing. */
const MAX_ADDITIONAL_LYRIC_LINES = 8;
/** Fixed row step for stacked harmony labels to prevent vertical text collisions. */
const HARMONY_ROW_SPACING = 18;
/** Safety side padding applied to harmony labels during collision packing. */
const HARMONY_LABEL_SIDE_PADDING = 5;
/** Hard cap for extra harmony rows in dense chord-symbol systems. */
const MAX_ADDITIONAL_HARMONY_ROWS = 10;
/** Fixed row step for stacked lyric lines to preserve readability in dense verses. */
const LYRIC_ROW_SPACING = 17;
/** Fixed row step for stacked direction labels above the stave. */
const DIRECTION_ROW_SPACING = 40;
/** Extra top-lane offset for direction rows to avoid notehead/ledger collisions. */
const DIRECTION_TOP_BASE_OFFSET = 24;
/** Extra bottom-lane offset for direction rows to avoid staff-line collisions. */
const DIRECTION_BOTTOM_BASE_OFFSET = 46;
/** Shared serif font stack for readable textual score annotations. */
const SCORE_TEXT_FONT = 'Times New Roman';
/** Direction text size (words/tempo) for M10 readability baseline. */
const DIRECTION_TEXT_SIZE = 12;
/** Extra safety padding after direction words before appending dynamics glyph runs. */
const DIRECTION_TEXT_WIDTH_PADDING = 24;
/** Harmony text size for chord symbols and analysis marks. */
const HARMONY_TEXT_SIZE = 13;
/** Lyric text size tuned for multi-line readability in dense fixtures. */
const LYRIC_TEXT_SIZE = 12;
/** Dynamic glyph point size used when drawing SMuFL dynamics above staves. */
const DYNAMICS_GLYPH_POINT = 34;
/** Horizontal gap between direction text and following dynamics glyph run. */
const DYNAMICS_TEXT_GAP = 34;
/** Extra side bearing reserved for each dynamics glyph to reduce overlap under-estimation. */
const DYNAMICS_GLYPH_SIDE_BEARING = 3;
/** Baseline shift used for dynamics in above-placement direction lanes. */
const DYNAMICS_BASELINE_SHIFT_ABOVE = 14;
/** Baseline shift used for dynamics in below-placement direction lanes. */
const DYNAMICS_BASELINE_SHIFT_BELOW = 4;

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

/**
 * Compact chord-kind suffixes aligned with common lead-sheet practice.
 * Long MusicXML kind labels (for example `major-seventh`) are normalized to
 * concise symbols so dense harmony fixtures remain readable.
 */
const HARMONY_KIND_SUFFIX: Record<string, string> = {
  major: '',
  minor: 'm',
  augmented: 'aug',
  diminished: 'dim',
  dominant: '7',
  majorseventh: 'maj7',
  minorseventh: 'm7',
  diminishedseventh: 'dim7',
  augmentedseventh: 'aug7',
  halfdiminished: 'm7♭5',
  majorminor: 'm(maj7)',
  majorsixth: '6',
  minorsixth: 'm6',
  dominantninth: '9',
  majorninth: 'maj9',
  minorninth: 'm9',
  dominant11th: '11',
  major11th: 'maj11',
  minor11th: 'm11',
  dominant13th: '13',
  major13th: 'maj13',
  minor13th: 'm13',
  suspendedsecond: 'sus2',
  suspendedfourth: 'sus4',
  power: '5',
  none: ''
};

/** Draw direction words/tempo/dynamics above a stave with offset-based x placement. */
export function drawMeasureDirections(
  measure: Measure,
  stave: Stave,
  ticksPerQuarter: number,
  staffNumber: number,
  staffCount: number,
  diagnostics: Diagnostic[],
  laneState?: DirectionTextLaneState
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
  const rowSpansAbove = laneState?.aboveRowSpans ?? new Map<number, TextRowSpan[]>();
  const rowSpansBelow = laneState?.belowRowSpans ?? new Map<number, TextRowSpan[]>();
  let maxAboveRow = 0;
  let maxBelowRow = 0;
  const belowBaseY = stave.getYForBottomText(2) + DIRECTION_BOTTOM_BASE_OFFSET;

  for (const direction of measure.directions) {
    // MusicXML directions without an explicit staff target should be rendered
    // once per part (top staff) for multi-staff parts. Rendering them on every
    // staff duplicates dynamics/words and causes false collision pressure.
    if (direction.staff === undefined && staffCount > 1 && staffNumber !== 1) {
      continue;
    }
    if (direction.staff !== undefined && direction.staff !== staffNumber) {
      continue;
    }

    const explicitDynamicSequence = normalizeDynamicsSequence(direction.dynamics);
    const wordDynamicSequence = normalizeDynamicsWords(direction.words);
    const dynamicSequence = mergeDynamicsSequences(explicitDynamicSequence, wordDynamicSequence);
    const words = resolveDirectionWordsForRender(direction.words, dynamicSequence);
    const chunks: string[] = [];
    if (words) {
      chunks.push(words);
    }
    if (direction.tempo !== undefined) {
      chunks.push(`q = ${Math.round(direction.tempo)}`);
    }
    const text = chunks.join('  ');
    const textWidth = text.length > 0 ? measureDirectionTextWidth(text, context) : 0;
    const paddedTextWidth = textWidth > 0 ? textWidth + DIRECTION_TEXT_WIDTH_PADDING : 0;
    const dynamicsWidth = dynamicSequence ? estimateDynamicsSequenceWidth(dynamicSequence) : 0;
    const totalWidth =
      paddedTextWidth + (paddedTextWidth > 0 && dynamicsWidth > 0 ? DYNAMICS_TEXT_GAP : 0) + dynamicsWidth;

    if (totalWidth <= 0) {
      continue;
    }

    const placement = direction.placement ?? 'above';
    const rowSpans = placement === 'below' ? rowSpansBelow : rowSpansAbove;
    const ratio = measureTicks > 0 ? clamp(direction.offsetTicks / measureTicks, 0, 1) : 0;
    const offsetX = stave.getX() + 16 + availableWidth * ratio;
    const x = clamp(offsetX, staveLeft, Math.max(staveLeft, staveRight - totalWidth));
    const left = x;
    const right = x + totalWidth;
    const row = resolveTextRowWithoutOverlap(
      rowSpans,
      0,
      left,
      right,
      DIRECTION_MIN_HORIZONTAL_GAP,
      10
    );
    const y =
      placement === 'below'
        ? belowBaseY + row * DIRECTION_ROW_SPACING
        : stave.getY() - DIRECTION_TOP_BASE_OFFSET - row * DIRECTION_ROW_SPACING;

    // Render lightweight direction text without introducing additional VexFlow tickables.
    if (text.length > 0) {
      context.save();
      context.setFont(SCORE_TEXT_FONT, DIRECTION_TEXT_SIZE, '');
      context.fillText(text, x, y);
      context.restore();
    }
    if (dynamicSequence) {
      const dynamicX = x + paddedTextWidth + (paddedTextWidth > 0 ? DYNAMICS_TEXT_GAP : 0);
      const dynamicsBaselineShift = placement === 'below' ? DYNAMICS_BASELINE_SHIFT_BELOW : DYNAMICS_BASELINE_SHIFT_ABOVE;
      drawDynamicsSequence(context, dynamicSequence, dynamicX, y + dynamicsBaselineShift);
    }
    registerTextRowSpan(rowSpans, row, left, right);
    if (placement === 'below') {
      maxBelowRow = Math.max(maxBelowRow, row);
    } else {
      maxAboveRow = Math.max(maxAboveRow, row);
    }

    if (direction.wedge) {
      diagnostics.push({
        code: 'WEDGE_DIRECTION_TEXT_FALLBACK',
        severity: 'info',
        message: `Direction wedge '${direction.wedge.type}' parsed; rendered via hairpin spanners when anchors resolve.`
      });
    }
  }

  if (maxAboveRow >= 2) {
    diagnostics.push({
      code: 'DIRECTION_TEXT_STACK_HIGH',
      severity: 'info',
      message: `Measure ${measure.index + 1} drew ${maxAboveRow + 1} direction-text rows above staff ${staffNumber}.`
    });
  }
  if (maxBelowRow >= 2) {
    diagnostics.push({
      code: 'DIRECTION_TEXT_STACK_HIGH',
      severity: 'info',
      message: `Measure ${measure.index + 1} drew ${maxBelowRow + 1} direction-text rows below staff ${staffNumber}.`
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

/** Measure harmony-label width using the same bold/italic style used when drawing. */
function measureHarmonyTextWidth(
  text: string,
  context: NonNullable<ReturnType<Stave['getContext']>>
): number {
  context.save();
  context.setFont(SCORE_TEXT_FONT, HARMONY_TEXT_SIZE, 'bold', 'italic');
  const width = estimateTextWidth(text, HARMONY_TEXT_SIZE, context, 'bold italic');
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
  diagnostics: Diagnostic[],
  laneState?: HarmonyTextLaneState
): void {
  if (!measure.harmonies || measure.harmonies.length === 0) {
    return;
  }

  const context = stave.getContext();
  if (!context) {
    return;
  }

  const rowSpans = laneState?.rowSpans ?? new Map<number, TextRowSpan[]>();
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
    const width = measureHarmonyTextWidth(label, context);
    const staveLeft = stave.getX() + 4;
    const staveRight = stave.getX() + stave.getWidth() - 4;
    const x = clamp(
      anchorX - width / 2,
      staveLeft + HARMONY_LABEL_SIDE_PADDING,
      Math.max(staveLeft + HARMONY_LABEL_SIDE_PADDING, staveRight - width - HARMONY_LABEL_SIDE_PADDING)
    );
    const spanLeft = x - HARMONY_LABEL_SIDE_PADDING;
    const spanRight = x + width + HARMONY_LABEL_SIDE_PADDING;
    const row = resolveTextRowWithoutOverlap(
      rowSpans,
      0,
      spanLeft,
      spanRight,
      HARMONY_MIN_HORIZONTAL_GAP,
      MAX_ADDITIONAL_HARMONY_ROWS
    );
    const y = harmonyBaseY - row * HARMONY_ROW_SPACING;

    context.save();
    context.setFont(SCORE_TEXT_FONT, HARMONY_TEXT_SIZE, 'bold', 'italic');
    context.fillText(label, x, y);
    context.restore();
    registerTextRowSpan(rowSpans, row, spanLeft, spanRight);
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
  diagnostics: Diagnostic[],
  laneState?: LyricTextLaneState
): void {
  const context = stave.getContext();
  if (!context) {
    return;
  }

  const lineSpans = laneState?.lineSpans ?? new Map<number, TextRowSpan[]>();
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
        const width = estimateTextWidth(text, LYRIC_TEXT_SIZE, context);
        const left = note.getAbsoluteX() - width / 2;
        const right = note.getAbsoluteX() + width / 2;
        const lineIndex = resolveTextRowWithoutOverlap(
          lineSpans,
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
        registerTextRowSpan(lineSpans, lineIndex, left, right);
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
  context?: NonNullable<ReturnType<Stave['getContext']>>,
  fontStyle = ''
): number {
  if (text.length === 0) {
    return 0;
  }

  // Prefer renderer-native width metrics when available so row packing follows
  // the same glyph widths that VexFlow actually draws into the SVG context.
  if (context && typeof context.measureText === 'function') {
    try {
      context.save();
      context.setFont(SCORE_TEXT_FONT, fontSize, fontStyle);
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
  const quality = resolveHarmonyQualityLabel(harmony);
  if (!root) {
    return quality.label;
  }
  if (!quality.label) {
    return root;
  }
  return quality.compact ? `${root}${quality.label}` : `${root} ${quality.label}`;
}

/** Resolve one harmony quality label and whether it can be rendered compactly. */
function resolveHarmonyQualityLabel(harmony: HarmonyEvent): { label: string; compact: boolean } {
  const text = harmony.text?.trim();
  const normalizedKind = normalizeHarmonyKindKey(harmony.kind);
  const compactSuffix = normalizedKind ? HARMONY_KIND_SUFFIX[normalizedKind] : undefined;

  if (text && text.length > 0) {
    // MusicXML often repeats verbose words in `kind@text` while `kind` carries
    // the machine-readable chord quality token. Prefer compact symbols in that
    // case, but preserve explicit custom text when it appears intentionally
    // styled (accidentals, punctuation, or short abbreviations).
    const normalizedText = text.toLowerCase();
    const textLooksVerboseWords = /^[a-z][a-z\s-]+$/.test(normalizedText);
    if (compactSuffix !== undefined && textLooksVerboseWords) {
      return { label: compactSuffix, compact: true };
    }
    return { label: text, compact: isCompactHarmonyText(text) };
  }

  if (compactSuffix !== undefined) {
    return { label: compactSuffix, compact: true };
  }

  const fallbackKind = harmony.kind?.trim() ?? '';
  return { label: fallbackKind, compact: isCompactHarmonyText(fallbackKind) };
}

/** Normalize MusicXML harmony kind strings into map keys used by compact lookup. */
function normalizeHarmonyKindKey(kind: string | undefined): string | undefined {
  if (!kind) {
    return undefined;
  }

  const normalized = kind.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length > 0 ? normalized : undefined;
}

/** True when harmony text is already short/compact enough for no extra separator. */
function isCompactHarmonyText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed.length <= 3) {
    return true;
  }

  return /[#♭♯0-9()+/.-]/u.test(trimmed);
}

/** Format harmony root alteration into baseline accidental text. */
function formatAlter(alter: number | undefined): string {
  if (alter === undefined || alter === 0) {
    return '';
  }

  if (alter > 0) {
    const steps = Math.max(1, Math.round(alter));
    return steps === 1 ? '#' : '##';
  }

  const steps = Math.max(1, Math.round(Math.abs(alter)));
  return steps === 1 ? 'b' : 'bb';
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
  rowSpans: Map<number, TextRowSpan[]>,
  preferredRow: number,
  left: number,
  right: number,
  minGap: number,
  maxAdditionalRows = 6
): number {
  let row = Math.max(0, preferredRow);
  const maxRow = row + Math.max(0, maxAdditionalRows);
  while (row <= maxRow) {
    const spans = rowSpans.get(row) ?? [];
    const overlapsExisting = spans.some((span) => spansOverlapWithGap(span, left, right, minGap));
    if (!overlapsExisting) {
      return row;
    }
    row += 1;
  }

  return maxRow;
}

/** True when one candidate span overlaps an existing span under row-gap constraints. */
function spansOverlapWithGap(span: TextRowSpan, left: number, right: number, minGap: number): boolean {
  return left < span.right + minGap && right > span.left - minGap;
}

/** Append one occupied span to the selected text row. */
function registerTextRowSpan(
  rowSpans: Map<number, TextRowSpan[]>,
  row: number,
  left: number,
  right: number
): void {
  const spans = rowSpans.get(row) ?? [];
  spans.push({ left, right });
  rowSpans.set(row, spans);
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

/**
 * Normalize words text into a dynamics-like token sequence when possible.
 * This allows us to suppress duplicate rendering when MusicXML encodes the
 * same dynamic both as `<words>` and `<dynamics>`.
 */
function normalizeDynamicsWords(words: string | undefined): string | undefined {
  if (!words) {
    return undefined;
  }

  const cleaned = words
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim();
  if (!cleaned) {
    return undefined;
  }

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return undefined;
  }

  const dynamicsTokens: string[] = [];
  for (const token of tokens) {
    if (!/^[fpmzsr]+$/.test(token)) {
      return undefined;
    }
    dynamicsTokens.push(token);
  }

  return dynamicsTokens.join(' ');
}

/**
 * Resolve direction words for rendering.
 * If words are dynamics-equivalent to parsed dynamics markers, we drop the
 * textual duplicate and keep glyph rendering only.
 */
function resolveDirectionWordsForRender(
  words: string | undefined,
  dynamicSequence: string | undefined
): string | undefined {
  const normalizedWordsDynamics = normalizeDynamicsWords(words);
  if (!dynamicSequence) {
    return words;
  }

  // Dynamics-only `<words>` should be rendered as SMuFL dynamics glyphs, not
  // as plain text duplicates, even when the parsed `<dynamics>` sequence uses
  // a different token order/content.
  if (normalizedWordsDynamics) {
    return undefined;
  }
  return words;
}

/**
 * Merge explicit `<dynamics>` and dynamics-only `<words>` into one glyph run.
 * This keeps visual output consistent and avoids dropping authored dynamic
 * intent when some exporters encode markers in both channels.
 */
function mergeDynamicsSequences(
  explicitSequence: string | undefined,
  wordsSequence: string | undefined
): string | undefined {
  if (!explicitSequence && !wordsSequence) {
    return undefined;
  }

  const merged = `${explicitSequence ?? ''} ${wordsSequence ?? ''}`
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (merged.length === 0) {
    return undefined;
  }

  const deduped: string[] = [];
  for (const token of merged) {
    if (deduped.includes(token)) {
      continue;
    }
    deduped.push(token);
  }

  return deduped.join(' ');
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
