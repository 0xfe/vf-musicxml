import type { Diagnostic } from '../core/diagnostics.js';
import type {
  AttributeEvent,
  BarlineInfo,
  DirectionEvent,
  EffectiveAttributes,
  HarmonyEvent,
  Measure,
  MeasurePrint,
  NoteEvent,
  Part,
  PartDefinition,
  ScorePageMargins,
  Score,
  TimedEvent,
  VoiceTimeline
} from '../core/score.js';
import { TICKS_PER_QUARTER } from './parse-constants.js';
import { addDiagnostic, createParseContext, type ParseContext, type ParserMode } from './parse-context.js';
import { parseDefaults, parseMetadata, parsePartList } from './parse-header.js';
import {
  parseAttributeUpdate,
  parseBarline,
  parseDirection,
  parseDurationTicks,
  parseHarmony,
  parseNote
} from './parse-note.js';
import {
  applyAttributeUpdate,
  cloneAttributes,
  defaultAttributes,
  expectedMeasureDuration,
  hasAttributeUpdate,
  maxVoiceEnd,
  truncateEventsToMeasure
} from './parse-timing.js';
import { normalizeTimewiseToPartwise } from './parse-timewise.js';
import { buildSpanners } from './parse-spanners.js';
import { parseXmlToAst, XmlParseError, type XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalFloat, textOf } from './xml-utils.js';

/** Parser entry options for source naming and strictness mode. */
export interface ParserOptions {
  sourceName?: string;
  mode?: ParserMode;
}

/** Parser return envelope with canonical score and diagnostics. */
export interface ParserResult {
  score?: Score;
  diagnostics: Diagnostic[];
}

/**
 * Parse MusicXML `score-partwise` text into the canonical score model.
 * This function performs XML parsing, semantic normalization, and diagnostics.
 */
export function parseScorePartwise(xmlText: string, options: ParserOptions = {}): ParserResult {
  const ctx = createParseContext(options.mode ?? 'lenient', options.sourceName);

  const rootResult = parseRoot(xmlText, options.sourceName, ctx);
  if (!rootResult) {
    return { diagnostics: ctx.diagnostics };
  }

  const partList = parsePartList(firstChild(rootResult, 'part-list'), ctx);
  const partDefsById = new Map(partList.map((item) => [item.id, item]));

  const partNodes = childrenOf(rootResult, 'part');
  const parts = partNodes.map((partNode, index) => parsePart(partNode, partDefsById, ctx, index));
  const spanners = buildSpanners(parts, ctx);

  if (partNodes.length === 0) {
    addDiagnostic(ctx, 'MISSING_PARTS', 'error', 'score-partwise contains no <part> elements.', rootResult);
  }

  if (ctx.mode === 'strict' && ctx.validationFailure) {
    return { diagnostics: ctx.diagnostics };
  }

  const defaults = parseDefaults(rootResult);
  const score: Score = {
    id: options.sourceName ?? 'score-1',
    source: {
      name: options.sourceName,
      format: 'musicxml'
    },
    ticksPerQuarter: TICKS_PER_QUARTER,
    partList,
    parts,
    spanners,
    defaults,
    metadata: parseMetadata(rootResult, defaults)
  };

  return {
    score,
    diagnostics: ctx.diagnostics
  };
}

/** Parse XML root and validate support for `score-partwise` documents. */
function parseRoot(xmlText: string, sourceName: string | undefined, ctx: ParseContext): XmlNode | undefined {
  let root: XmlNode;
  try {
    root = parseXmlToAst(xmlText, sourceName);
  } catch (error) {
    if (error instanceof XmlParseError) {
      addDiagnostic(ctx, 'XML_NOT_WELL_FORMED', 'error', error.message, undefined, error.source);
      return undefined;
    }

    addDiagnostic(ctx, 'XML_PARSE_UNKNOWN_ERROR', 'error', 'Failed to parse XML document.');
    return undefined;
  }

  if (root.name === 'score-timewise') {
    root = normalizeTimewiseToPartwise(root, ctx);
  }

  if (root.name !== 'score-partwise') {
    addDiagnostic(
      ctx,
      'UNSUPPORTED_ROOT',
      'error',
      `Unsupported root element '${root.name}'. Expected 'score-partwise'.`,
      root
    );
    return undefined;
  }

  return root;
}

/** Parse one `<part>` element and all of its measures. */
function parsePart(
  partNode: XmlNode,
  partDefsById: Map<string, PartDefinition>,
  ctx: ParseContext,
  partIndex: number
): Part {
  const partId = attribute(partNode, 'id') ?? `P${partIndex + 1}`;
  if (!attribute(partNode, 'id')) {
    addDiagnostic(ctx, 'MISSING_PART_ID', 'warning', '<part> is missing required id attribute.', partNode);
  }

  if (partDefsById.size > 0 && !partDefsById.has(partId)) {
    addDiagnostic(
      ctx,
      'PART_NOT_IN_PART_LIST',
      'warning',
      `Part '${partId}' does not appear in <part-list>.`,
      partNode
    );
  }

  const measures: Measure[] = [];
  let inheritedAttributes = defaultAttributes();

  const measureNodes = childrenOf(partNode, 'measure');
  for (let index = 0; index < measureNodes.length; index += 1) {
    const measureNode = measureNodes[index];
    if (!measureNode) {
      continue;
    }

    const measure = parseMeasure(measureNode, index, inheritedAttributes, ctx);
    inheritedAttributes = cloneAttributes(measure.effectiveAttributes);
    measures.push(measure);
  }

  return {
    id: partId,
    measures
  };
}

/**
 * Parse and normalize one measure.
 * This consumes MusicXML stream cursor mechanics (`backup` / `forward`) into voice timelines.
 */
function parseMeasure(
  measureNode: XmlNode,
  index: number,
  inherited: EffectiveAttributes,
  ctx: ParseContext
): Measure {
  const attributeChanges: AttributeEvent[] = [];
  const directions: DirectionEvent[] = [];
  const harmonies: HarmonyEvent[] = [];
  const voices = new Map<string, TimedEvent[]>();
  const lastNoteByVoice = new Map<string, NoteEvent>();

  const effectiveAttributes = cloneAttributes(inherited);
  let streamCursorTicks = 0;
  let barline: BarlineInfo | undefined;
  let print: MeasurePrint | undefined;
  let warnedMissingDivisions = false;
  const barlines: BarlineInfo[] = [];
  const sourceWidthTenths = parseOptionalFloat(attribute(measureNode, 'width'));

  // Measure children are read in document order while we maintain
  // a single stream cursor that backup/forward can mutate.
  for (const child of measureNode.children) {
    switch (child.name) {
      case 'attributes': {
        const update = parseAttributeUpdate(child, ctx);
        if (streamCursorTicks > 0 && hasAttributeUpdate(update)) {
          attributeChanges.push({
            offsetTicks: streamCursorTicks,
            attributes: update
          });
        }
        applyAttributeUpdate(effectiveAttributes, update);
        break;
      }
      case 'note': {
        const result = parseNote(
          child,
          streamCursorTicks,
          effectiveAttributes,
          warnedMissingDivisions,
          ctx
        );
        warnedMissingDivisions = warnedMissingDivisions || result.warnedMissingDivisions;

        const voiceEvents = voices.get(result.voice) ?? [];
        if (!voices.has(result.voice)) {
          voices.set(result.voice, voiceEvents);
        }

        if (result.kind === 'chord') {
          // `<chord/>` means "same onset as previous note in this voice".
          // We merge into the previous `NoteEvent` instead of creating a new event.
          const base = lastNoteByVoice.get(result.voice);
          if (!base) {
            addDiagnostic(
              ctx,
              'CHORD_WITHOUT_BASE_NOTE',
              'warning',
              '<chord/> note has no base note in the same voice.',
              child
            );
            const fallbackEvent = result.event;
            voiceEvents.push(fallbackEvent);
            lastNoteByVoice.set(result.voice, fallbackEvent);
          } else {
            base.notes.push(...result.event.notes);
            if (result.event.durationTicks > base.durationTicks) {
              base.durationTicks = result.event.durationTicks;
            }
          }
        } else {
          voiceEvents.push(result.event);
          if (result.event.kind === 'note') {
            lastNoteByVoice.set(result.voice, result.event);
          } else {
            lastNoteByVoice.delete(result.voice);
          }
          // Only non-chord events advance the stream cursor.
          streamCursorTicks += result.event.durationTicks;
        }
        break;
      }
      case 'backup': {
        const durationTicks = parseDurationTicks(
          child,
          effectiveAttributes,
          warnedMissingDivisions,
          ctx,
          'backup'
        );
        warnedMissingDivisions = warnedMissingDivisions || durationTicks.warnedMissingDivisions;
        if (durationTicks.ticks > streamCursorTicks) {
          addDiagnostic(
            ctx,
            'BACKUP_BEFORE_MEASURE_START',
            'warning',
            `Backup duration ${durationTicks.ticks} exceeds current cursor ${streamCursorTicks}; clamping to measure start.`,
            child
          );
        }
        streamCursorTicks = Math.max(0, streamCursorTicks - durationTicks.ticks);
        break;
      }
      case 'forward': {
        const durationTicks = parseDurationTicks(
          child,
          effectiveAttributes,
          warnedMissingDivisions,
          ctx,
          'forward'
        );
        warnedMissingDivisions = warnedMissingDivisions || durationTicks.warnedMissingDivisions;
        streamCursorTicks += durationTicks.ticks;
        break;
      }
      case 'direction': {
        directions.push(parseDirection(child, streamCursorTicks));
        break;
      }
      case 'barline': {
        const parsedBarline = parseBarline(child);
        barlines.push(parsedBarline);
        barline = mergeBarlineInfo(barline, parsedBarline);
        break;
      }
      case 'print': {
        print = mergeMeasurePrint(print, parseMeasurePrint(child));
        break;
      }
      case 'harmony': {
        harmonies.push(parseHarmony(child, streamCursorTicks));
        break;
      }
      default:
        break;
    }
  }

  const voiceTimelines: VoiceTimeline[] = [...voices.entries()]
    .map(([id, events]) => ({ id, events }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const expectedDuration = expectedMeasureDuration(effectiveAttributes.timeSignature, TICKS_PER_QUARTER);
  if (expectedDuration > 0) {
    const actualDuration = maxVoiceEnd(voiceTimelines);
    if (streamCursorTicks > expectedDuration) {
      addDiagnostic(
        ctx,
        'MEASURE_CURSOR_OVERFLOW',
        'warning',
        `Measure cursor overflow: expected ${expectedDuration} ticks but cursor ended at ${streamCursorTicks} ticks.`,
        measureNode
      );
    }
    if (actualDuration > expectedDuration) {
      addDiagnostic(
        ctx,
        'DURATION_OVERFLOW',
        'warning',
        `Measure duration overflow: expected ${expectedDuration} ticks but found ${actualDuration} ticks.`,
        measureNode
      );
      if (ctx.mode === 'lenient') {
        // Lenient mode keeps the measure parseable by clipping overflow.
        for (const voice of voiceTimelines) {
          voice.events = truncateEventsToMeasure(voice.events, expectedDuration);
        }
      }
    }
  }

  return {
    index,
    numberLabel: attribute(measureNode, 'number'),
    sourceWidthTenths: Number.isFinite(sourceWidthTenths) ? sourceWidthTenths : undefined,
    print,
    effectiveAttributes,
    attributeChanges,
    voices: voiceTimelines,
    directions,
    harmonies,
    barlines: barlines.length > 0 ? barlines : undefined,
    barline
  };
}

/** Parse one `<print>` node into normalized measure-level break directives. */
function parseMeasurePrint(printNode: XmlNode): MeasurePrint {
  const pageLayoutNode = firstChild(printNode, 'page-layout');
  const pageWidth = parseOptionalFloat(textOf(firstChild(pageLayoutNode, 'page-width')));
  const pageHeight = parseOptionalFloat(textOf(firstChild(pageLayoutNode, 'page-height')));

  return {
    newSystem: attribute(printNode, 'new-system') === 'yes' || undefined,
    newPage: attribute(printNode, 'new-page') === 'yes' || undefined,
    pageWidth: Number.isFinite(pageWidth) ? pageWidth : undefined,
    pageHeight: Number.isFinite(pageHeight) ? pageHeight : undefined,
    pageMargins: parsePrintPageMargins(pageLayoutNode)
  };
}

/** Merge multiple `<print>` nodes within one measure into one summary payload. */
function mergeMeasurePrint(existing: MeasurePrint | undefined, incoming: MeasurePrint): MeasurePrint {
  if (!existing) {
    return incoming;
  }

  return {
    newSystem: existing.newSystem || incoming.newSystem || undefined,
    newPage: existing.newPage || incoming.newPage || undefined,
    pageWidth: incoming.pageWidth ?? existing.pageWidth,
    pageHeight: incoming.pageHeight ?? existing.pageHeight,
    pageMargins: incoming.pageMargins ?? existing.pageMargins
  };
}

/** Parse `<print><page-layout><page-margins>` values when present. */
function parsePrintPageMargins(pageLayoutNode: XmlNode | undefined): ScorePageMargins | undefined {
  if (!pageLayoutNode) {
    return undefined;
  }

  const marginNodes = childrenOf(pageLayoutNode, 'page-margins');
  if (marginNodes.length === 0) {
    return undefined;
  }

  const preferred =
    marginNodes.find((node) => (attribute(node, 'type') ?? '').toLowerCase() === 'both') ??
    marginNodes[0];
  if (!preferred) {
    return undefined;
  }

  const left = parseOptionalFloat(textOf(firstChild(preferred, 'left-margin')));
  const right = parseOptionalFloat(textOf(firstChild(preferred, 'right-margin')));
  const top = parseOptionalFloat(textOf(firstChild(preferred, 'top-margin')));
  const bottom = parseOptionalFloat(textOf(firstChild(preferred, 'bottom-margin')));
  if (left === undefined && right === undefined && top === undefined && bottom === undefined) {
    return undefined;
  }

  return {
    left,
    right,
    top,
    bottom
  };
}

/** Merge per-location barline fragments into one measure-level summary payload. */
function mergeBarlineInfo(existing: BarlineInfo | undefined, incoming: BarlineInfo): BarlineInfo {
  if (!existing) {
    return {
      ...incoming,
      repeats: incoming.repeats ? [...incoming.repeats] : undefined,
      endings: incoming.endings ? [...incoming.endings] : undefined
    };
  }

  const merged: BarlineInfo = {
    location: incoming.location ?? existing.location,
    style: incoming.style ?? existing.style
  };

  if (existing.repeats || incoming.repeats) {
    merged.repeats = [...(existing.repeats ?? []), ...(incoming.repeats ?? [])];
  }
  if (existing.endings || incoming.endings) {
    merged.endings = [...(existing.endings ?? []), ...(incoming.endings ?? [])];
  }

  return merged;
}
