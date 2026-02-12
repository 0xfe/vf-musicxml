import {
  BarlineType,
  Beam,
  Formatter,
  type Renderer,
  StaveConnector,
  type StaveConnectorType,
  type StaveNote,
  VoltaType
} from 'vexflow';
import type { Stave, Voice } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { Measure, Part, PartDefinition, Score } from '../core/score.js';
import { buildVoiceEventKey } from './render-note-mapper.js';

/** Approximate character width multiplier for text placement without `measureText`. */
const TEXT_WIDTH_FACTOR = 0.56;

/** Config subset used by page header/footer and part-label drawing helpers. */
export interface RenderDrawingConfig {
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  contentStartX: number;
  labelWidth: number;
  showPartNames: boolean;
  showPartAbbreviations: boolean;
  repeatOnSystemBreak: boolean;
  showTitle: boolean;
  showMovementTitle: boolean;
  showPageNumber: boolean;
  leftHeader?: string;
  rightHeader?: string;
  leftFooter?: string;
  rightFooter?: string;
}

/** Part layout subset used for part-group connector range resolution. */
export interface ConnectorPartLayout {
  part: Part;
}

/** First-column stave bounds for one rendered part, used by group connectors. */
export interface ConnectorPartBoundary {
  topStave: Stave;
  bottomStave: Stave;
}

/** Beam-group construction result used to hide flags before `voice.draw()`. */
export interface PreparedMeasureBeams {
  beams: Beam[];
}

/** Draw page title/header/footer text overlays. */
export function drawPageHeaderFooter(
  context: ReturnType<Renderer['getContext']>,
  score: Score,
  pageNumber: number,
  pageCount: number,
  pageWidth: number,
  pageHeight: number,
  config: RenderDrawingConfig
): void {
  const headerTop = config.margins.top;
  const footerY = pageHeight - Math.max(10, config.margins.bottom - 12);
  const headerLineCount = Math.max(countTextLines(config.leftHeader), countTextLines(config.rightHeader));
  const headerBlockHeight = headerLineCount > 0 ? headerLineCount * 12 + 4 : 0;
  const titleTop = headerTop + (headerBlockHeight > 0 ? headerBlockHeight + 18 : 22);

  if (pageNumber === 1 && config.showTitle && score.metadata?.workTitle) {
    drawText(context, score.metadata.workTitle, centerX(pageWidth, score.metadata.workTitle, 20), titleTop, 20, 'bold');
  }

  if (pageNumber === 1 && config.showMovementTitle && score.metadata?.movementTitle) {
    drawText(
      context,
      score.metadata.movementTitle,
      centerX(pageWidth, score.metadata.movementTitle, 14),
      titleTop + 22,
      14,
      'normal'
    );
  }

  if (config.leftHeader) {
    drawText(context, config.leftHeader, config.margins.left, headerTop + 12, 11, 'normal');
  }
  if (config.rightHeader) {
    const x = pageWidth - config.margins.right - estimateTextWidth(config.rightHeader, 11);
    drawText(context, config.rightHeader, x, headerTop + 12, 11, 'normal');
  }

  if (config.leftFooter) {
    drawText(context, config.leftFooter, config.margins.left, footerY, 11, 'normal');
  }
  if (config.rightFooter) {
    const x = pageWidth - config.margins.right - estimateTextWidth(config.rightFooter, 11);
    drawText(context, config.rightFooter, x, footerY, 11, 'normal');
  }

  if (config.showPageNumber) {
    const label = `${pageNumber}${pageCount > 1 ? ` / ${pageCount}` : ''}`;
    const x = pageWidth - config.margins.right - estimateTextWidth(label, 11);
    drawText(context, label, x, footerY, 11, 'normal');
  }
}

/** Draw one part label at the left edge of the system start. */
export function drawPartLabel(
  context: ReturnType<Renderer['getContext']>,
  definition: PartDefinition | undefined,
  systemIndex: number,
  y: number,
  config: RenderDrawingConfig
): void {
  if (config.labelWidth <= 0) {
    return;
  }

  const isFirstSystem = systemIndex === 0;
  const label = resolvePartLabel(definition, isFirstSystem, config);
  if (!label) {
    return;
  }

  const labelPadding = 6;
  // Label drawing should never rely on more horizontal room than the actual
  // gap between page-left and notation start. This avoids left-edge clipping
  // when source system margins are narrow.
  const maxLeftSpace = Math.max(28, config.contentStartX - 8 - labelPadding);
  const availableWidth = Math.max(20, Math.min(config.labelWidth - labelPadding * 2, maxLeftSpace));
  const lines = wrapTextToWidth(label, availableWidth, 12, 3);
  const x = Math.max(8, config.contentStartX - availableWidth - labelPadding);
  drawText(context, lines.join('\n'), x, y, 12, isFirstSystem ? 'bold' : 'normal');
}

/**
 * Format one voice against the stave's computed note area instead of a fixed width.
 * This prevents first-column collisions where clef/time/key modifiers consume
 * horizontal space and leaves too little room for tickables.
 */
export function formatVoiceToStave(
  voice: Voice,
  stave: Stave,
  diagnostics: Diagnostic[],
  measureIndex: number,
  staffNumber: number
): void {
  try {
    new Formatter().joinVoices([voice]).formatToStave([voice], stave, { align_rests: true });
  } catch (error) {
    diagnostics.push({
      code: 'VOICE_FORMAT_FAILED',
      severity: 'warning',
      message: `Measure ${measureIndex + 1}, staff ${staffNumber} failed stave-aware formatting (${String(error)}).`
    });

    // Fallback preserves deterministic rendering even when VexFlow formatting throws.
    const fallbackWidth = Math.max(32, stave.getWidth() - 30);
    new Formatter().joinVoices([voice]).format([voice], fallbackWidth, { align_rests: true });
  }
}

/**
 * Prepare beam groups before drawing notes.
 * This is critical: VexFlow suppresses per-note flags when notes already carry
 * beam attachments at draw time.
 */
export function prepareMeasureBeams(
  measure: Measure,
  notes: StaveNote[],
  noteByEventKey: Map<string, StaveNote>,
  diagnostics: Diagnostic[],
  measureIndex: number,
  staffNumber: number
): PreparedMeasureBeams {
  if (notes.length < 2) {
    return {
      beams: []
    };
  }

  try {
    const sourceBeamGroups = collectSourceBeamGroups(measure, noteByEventKey, staffNumber);
    if (sourceBeamGroups && sourceBeamGroups.length > 0) {
      return {
        beams: sourceBeamGroups.map((group) => new Beam(group))
      };
    }

    const beams = Beam.generateBeams(notes, {
      beam_rests: false,
      maintain_stem_directions: true,
      show_stemlets: false
    });

    return {
      beams
    };
  } catch (error) {
    diagnostics.push({
      code: 'BEAM_RENDER_FAILED',
      severity: 'warning',
      message: `Measure ${measureIndex + 1}, staff ${staffNumber} beam generation failed (${String(error)}).`
    });
    return {
      beams: []
    };
  }
}

/** Draw already prepared beams after voice noteheads/stems have been rendered. */
export function drawPreparedBeams(
  prepared: PreparedMeasureBeams,
  context: ReturnType<Renderer['getContext']>,
  diagnostics: Diagnostic[],
  measureIndex: number,
  staffNumber: number
): void {
  for (const beam of prepared.beams) {
    try {
      beam.setContext(context).draw();
    } catch (error) {
      diagnostics.push({
        code: 'BEAM_RENDER_FAILED',
        severity: 'warning',
        message: `Measure ${measureIndex + 1}, staff ${staffNumber} beam drawing failed (${String(error)}).`
      });
    }
  }
}

/** Apply repeat-barline and volta metadata to a stave before drawing. */
export function applyMeasureBarlineSemantics(stave: Stave, measure: Measure, staffNumber: number): void {
  const barlines =
    measure.barlines && measure.barlines.length > 0 ? measure.barlines : measure.barline ? [measure.barline] : [];
  if (barlines.length === 0) {
    return;
  }

  let hasForwardRepeat = false;
  let hasBackwardRepeat = false;
  let endingStart = false;
  let endingMid = false;
  let endingStop = false;
  let endingLabel = '';

  for (const barline of barlines) {
    for (const repeat of barline.repeats ?? []) {
      if (repeat.direction === 'forward' && repeat.location === 'left') {
        hasForwardRepeat = true;
      }
      if (repeat.direction === 'backward' && repeat.location === 'right') {
        hasBackwardRepeat = true;
      }
    }

    for (const ending of barline.endings ?? []) {
      if (!endingLabel) {
        endingLabel = ending.number ?? ending.text ?? '';
      }
      if (ending.type === 'start') {
        endingStart = true;
      }
      if (ending.type === 'continue') {
        endingMid = true;
      }
      if (ending.type === 'stop' || ending.type === 'discontinue') {
        endingStop = true;
      }
    }
  }

  if (hasForwardRepeat) {
    stave.setBegBarType(BarlineType.REPEAT_BEGIN);
  }

  if (hasBackwardRepeat) {
    stave.setEndBarType(hasForwardRepeat ? BarlineType.REPEAT_BOTH : BarlineType.REPEAT_END);
  }

  if (staffNumber === 1) {
    if (endingStart && endingStop) {
      stave.setVoltaType(VoltaType.BEGIN_END, endingLabel, 8);
    } else if (endingStart) {
      stave.setVoltaType(VoltaType.BEGIN, endingLabel, 8);
    } else if (endingMid) {
      stave.setVoltaType(VoltaType.MID, endingLabel, 8);
    } else if (endingStop) {
      stave.setVoltaType(VoltaType.END, endingLabel, 8);
    }
  }
}

/** Draw part-group connectors derived from parsed part-list group metadata. */
export function drawPartGroupConnectors(
  score: Score,
  layouts: ConnectorPartLayout[],
  boundaries: Map<string, ConnectorPartBoundary>,
  context: ReturnType<Renderer['getContext']>
): number {
  const partOrder = new Map(layouts.map((layout, index) => [layout.part.id, index]));
  const ranges = new Map<string, { start: number; end: number }>();

  for (const partDefinition of score.partList) {
    const partIndex = partOrder.get(partDefinition.id);
    if (partIndex === undefined || !partDefinition.groupPath) {
      continue;
    }

    for (const token of partDefinition.groupPath) {
      const range = ranges.get(token);
      if (!range) {
        ranges.set(token, { start: partIndex, end: partIndex });
      } else {
        range.start = Math.min(range.start, partIndex);
        range.end = Math.max(range.end, partIndex);
      }
    }
  }

  let count = 0;
  for (const [token, range] of ranges.entries()) {
    const connectorType = mapGroupTokenToConnector(token);
    if (!connectorType) {
      continue;
    }

    const startPart = layouts[range.start]?.part.id;
    const endPart = layouts[range.end]?.part.id;
    if (!startPart || !endPart) {
      continue;
    }

    const startBoundary = boundaries.get(startPart);
    const endBoundary = boundaries.get(endPart);
    if (!startBoundary || !endBoundary) {
      continue;
    }

    drawConnector(startBoundary.topStave, endBoundary.bottomStave, connectorType, context);
    count += 1;
  }

  return count;
}

/** Count rendered text lines for multiline-aware header/layout calculations. */
export function countTextLines(text: string | undefined): number {
  if (!text) {
    return 0;
  }

  return Math.max(1, text.split('\n').filter((line) => line.length > 0).length);
}

/** Resolve label text for first and repeated system starts. */
function resolvePartLabel(
  definition: PartDefinition | undefined,
  isFirstSystem: boolean,
  config: RenderDrawingConfig
): string | undefined {
  if (!definition) {
    return undefined;
  }

  if (isFirstSystem && config.showPartNames) {
    return definition.name ?? definition.abbreviation ?? undefined;
  }

  if (!isFirstSystem && !config.repeatOnSystemBreak) {
    return undefined;
  }

  if (config.showPartAbbreviations) {
    return definition.abbreviation ?? definition.name ?? undefined;
  }

  if (config.showPartNames) {
    return definition.name ?? undefined;
  }

  return undefined;
}

/** Render one text label using deterministic font settings. */
function drawText(
  context: ReturnType<Renderer['getContext']>,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  weight: 'normal' | 'bold'
): void {
  if (text.length === 0) {
    return;
  }

  context.setFont('Times New Roman', fontSize, weight);
  const lineHeight = fontSize + 2;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    context.fillText(line, x, y + index * lineHeight);
  }
}

/** Approximate centered text X coordinate from simple width heuristics. */
function centerX(pageWidth: number, text: string, fontSize: number): number {
  return Math.max(0, (pageWidth - estimateTextWidth(text, fontSize)) / 2);
}

/** Estimate text width without relying on browser text metrics. */
export function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, Math.ceil(line.length * fontSize * TEXT_WIDTH_FACTOR));
  }
  return maxWidth;
}

/** Wrap label text to a fixed pixel width with a hard max line count. */
function wrapTextToWidth(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current.length > 0 ? `${current} ${token}` : token;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth || current.length === 0) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = token;
    if (lines.length >= maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines && current.length > 0) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const lastIndex = lines.length - 1;
  const last = lines[lastIndex];
  if (last && estimateTextWidth(last, fontSize) > maxWidth) {
    lines[lastIndex] = truncateTextToWidth(last, maxWidth, fontSize);
  }

  return lines.map((line) => truncateTextToWidth(line, maxWidth, fontSize));
}

/** Truncate one text line to fit a pixel width, appending ellipsis when needed. */
function truncateTextToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) {
    return text;
  }

  const ellipsis = '...';
  const chars = [...text];
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${chars.join('')}${ellipsis}`;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      return candidate;
    }
  }

  return ellipsis;
}

/** Draw a stave connector between top and bottom staves for a given style. */
export function drawConnector(
  topStave: Stave,
  bottomStave: Stave,
  type: StaveConnectorType,
  context: ReturnType<Renderer['getContext']>
): void {
  new StaveConnector(topStave, bottomStave).setType(type).setContext(context).draw();
}

/** Map serialized group-path tokens to VexFlow stave connector types. */
function mapGroupTokenToConnector(token: string): StaveConnectorType | undefined {
  const symbol = token.includes(':') ? token.slice(token.indexOf(':') + 1) : token;
  switch (symbol) {
    case 'brace':
      return 'brace';
    case 'line':
      return 'singleLeft';
    case 'none':
      return undefined;
    case 'bracket':
    default:
      return 'bracket';
  }
}

/** One source beam-group extraction outcome. */
interface SourceBeamGroupExtraction {
  groups: StaveNote[][];
  beamedNoteCount: number;
  groupedNoteCount: number;
  unsupported: boolean;
}

/**
 * Build beam groups from authored MusicXML beam markers (level 1 only).
 * Returns `undefined` when source markers are incomplete/unsupported so callers
 * can safely fall back to VexFlow auto-beaming.
 */
function collectSourceBeamGroups(
  measure: Measure,
  noteByEventKey: Map<string, StaveNote>,
  staffNumber: number
): StaveNote[][] | undefined {
  const extraction = extractSourceBeamGroups(measure, noteByEventKey, staffNumber);
  if (extraction.unsupported) {
    return undefined;
  }

  if (extraction.groups.length === 0 || extraction.groupedNoteCount !== extraction.beamedNoteCount) {
    return undefined;
  }

  return extraction.groups;
}

/** Extract source beam groups and coverage counters for fallback decisions. */
function extractSourceBeamGroups(
  measure: Measure,
  noteByEventKey: Map<string, StaveNote>,
  staffNumber: number
): SourceBeamGroupExtraction {
  const groups: StaveNote[][] = [];
  let beamedNoteCount = 0;
  let groupedNoteCount = 0;
  let unsupported = false;

  for (const voice of measure.voices) {
    let activeGroup: StaveNote[] = [];

    const flushActiveGroup = (): void => {
      if (activeGroup.length >= 2) {
        groups.push(activeGroup);
        groupedNoteCount += activeGroup.length;
      }
      activeGroup = [];
    };

    for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
      const event = voice.events[eventIndex];
      if (!event || event.kind !== 'note') {
        continue;
      }

      if ((event.staff ?? 1) !== staffNumber) {
        continue;
      }

      const note = noteByEventKey.get(buildVoiceEventKey(voice.id, eventIndex));
      if (!note) {
        continue;
      }

      const beam = event.beams?.find((candidate) => candidate.number === 1);
      if (!beam) {
        flushActiveGroup();
        continue;
      }

      beamedNoteCount += 1;

      switch (beam.value) {
        case 'begin': {
          flushActiveGroup();
          activeGroup = [note];
          break;
        }
        case 'continue': {
          if (activeGroup.length === 0) {
            activeGroup = [note];
          } else {
            activeGroup.push(note);
          }
          break;
        }
        case 'end': {
          if (activeGroup.length === 0) {
            activeGroup = [note];
          } else {
            activeGroup.push(note);
          }
          flushActiveGroup();
          break;
        }
        case 'forward hook':
        case 'backward hook': {
          // Single-note hook beams are not reconstructed yet; mark as unsupported
          // so the caller can use automatic beaming for this measure/staff.
          unsupported = true;
          flushActiveGroup();
          break;
        }
      }
    }

    if (activeGroup.length >= 2) {
      groups.push(activeGroup);
      groupedNoteCount += activeGroup.length;
    }
  }

  return {
    groups,
    beamedNoteCount,
    groupedNoteCount,
    unsupported
  };
}
