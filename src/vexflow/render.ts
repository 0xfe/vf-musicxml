import { JSDOM } from 'jsdom';
import {
  BarlineType,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  type StaveConnectorType,
  type StaveNote,
  Voice,
  VoltaType
} from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { ClefInfo, Measure, Part, Score } from '../core/score.js';
import { ensureDomGlobals } from './render-dom.js';
import {
  buildMeasureNotes,
  mapClef,
  mapKeySignature,
  mapTimeSignature,
  parseTime
} from './render-note-mapper.js';
import {
  drawMeasureDirections,
  drawMeasureHarmonies,
  drawMeasureLyrics,
  drawMeasureTuplets,
  drawScoreSpanners,
  registerMeasureEventNotes
} from './render-notations.js';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  LEFT_MARGIN,
  TOP_MARGIN,
  type RenderOptionsLike,
  type RenderPagesResultLike,
  type RenderToElementResultLike
} from './render-types.js';

export type { RenderOptionsLike, RenderPagesResultLike, RenderToElementResultLike } from './render-types.js';

/** Vertical distance between staves in one rendered system row. */
const STAFF_ROW_HEIGHT = 110;
/** Extra vertical spacing between parts after staff rows are placed. */
const PART_GAP = 30;
/** Bottom margin applied after the final rendered row. */
const BOTTOM_MARGIN = 48;

/** Layout envelope for one rendered part block. */
interface PartLayout {
  part: Part;
  staffCount: number;
  topY: number;
}

/** First-column stave bounds for one rendered part, used by group connectors. */
interface PartBoundary {
  topStave: Stave;
  bottomStave: Stave;
}

/**
 * Render score content to SVG page strings.
 * This path is intentionally deterministic for headless snapshot/structure tests
 * and includes M4 notation plus M5 multi-part/multi-staff baseline layout passes.
 */
export function renderScoreToSVGPages(
  score: Score,
  options: RenderOptionsLike = {}
): RenderPagesResultLike {
  const diagnostics: Diagnostic[] = [];

  if (options.backend === 'canvas') {
    diagnostics.push({
      code: 'CANVAS_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: 'Canvas backend is not implemented in M2. Falling back to SVG.'
    });
  }

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const container = dom.window.document.getElementById('root');

  if (!container) {
    diagnostics.push({
      code: 'SVG_CONTAINER_ERROR',
      severity: 'error',
      message: 'Unable to initialize SVG rendering container.'
    });
    return {
      pages: [],
      diagnostics
    };
  }

  const pageCount = renderIntoContainer(score, container as unknown as HTMLElement, options, diagnostics);
  const page = container.innerHTML;
  dom.window.close();

  return {
    pages: pageCount > 0 ? [page] : [],
    diagnostics
  };
}

/**
 * Render score content into a caller-provided container.
 * Useful for browser use-cases that need live DOM nodes instead of raw strings.
 */
export function renderScoreToElement(
  score: Score,
  container: HTMLElement,
  options: RenderOptionsLike = {}
): RenderToElementResultLike {
  const diagnostics: Diagnostic[] = [];
  const pageCount = renderIntoContainer(score, container, options, diagnostics);

  return {
    pageCount,
    diagnostics,
    dispose: () => {
      container.innerHTML = '';
    }
  };
}

/** Shared render implementation used by both string and DOM entry points. */
function renderIntoContainer(
  score: Score,
  container: HTMLElement,
  options: RenderOptionsLike,
  diagnostics: Diagnostic[]
): number {
  const restoreDomGlobals = ensureDomGlobals(container.ownerDocument);
  container.innerHTML = '';

  if (options.paginate) {
    diagnostics.push({
      code: 'PAGINATION_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: 'Pagination is not implemented in M2. Rendering as a single page.'
    });
  }

  if (score.parts.length === 0) {
    diagnostics.push({
      code: 'EMPTY_SCORE',
      severity: 'error',
      message: 'Score does not contain any parts to render.'
    });
    return 0;
  }

  const measureCount = Math.max(0, ...score.parts.map((part) => part.measures.length));
  if (measureCount === 0) {
    diagnostics.push({
      code: 'EMPTY_PART',
      severity: 'error',
      message: 'Score parts contain no measures to render.'
    });
    return 0;
  }

  const partLayouts = buildPartLayouts(score.parts);
  const pageWidth = options.page?.width ?? DEFAULT_PAGE_WIDTH;
  const pageHeight = options.page?.height ?? DEFAULT_PAGE_HEIGHT;
  const measureWidth = Math.max(160, Math.floor((pageWidth - LEFT_MARGIN * 2) / measureCount));
  const requiredWidth = Math.max(pageWidth, LEFT_MARGIN * 2 + measureWidth * measureCount);
  const requiredHeight = Math.max(pageHeight, estimateRequiredHeight(partLayouts));

  const hostDiv = container.ownerDocument.createElement('div');
  container.appendChild(hostDiv);

  try {
    const renderer = new Renderer(hostDiv, Renderer.Backends.SVG);
    renderer.resize(requiredWidth, requiredHeight);
    const context = renderer.getContext();
    const eventNotesByPart = new Map<string, Map<string, StaveNote>>();
    const partBoundaries = new Map<string, PartBoundary>();

    let globalTopStave: Stave | undefined;
    let globalBottomStave: Stave | undefined;

    for (const layout of partLayouts) {
      const partEventNotes = new Map<string, StaveNote>();
      eventNotesByPart.set(layout.part.id, partEventNotes);

      for (let measureColumn = 0; measureColumn < measureCount; measureColumn += 1) {
        const x = LEFT_MARGIN + measureColumn * measureWidth;
        const measure = layout.part.measures[measureColumn];
        const staves: Stave[] = [];

        for (let staffNumber = 1; staffNumber <= layout.staffCount; staffNumber += 1) {
          const y = layout.topY + (staffNumber - 1) * STAFF_ROW_HEIGHT;
          const stave = new Stave(x, y, measureWidth);
          const clefInfo = resolveClefForStaff(measure, staffNumber);
          const clef = mapClef(clefInfo, diagnostics);
          const key = mapKeySignature(measure?.effectiveAttributes.keySignature);
          const time = mapTimeSignature(measure?.effectiveAttributes.timeSignature);

          if (measureColumn === 0) {
            stave.addClef(clef);
            if (staffNumber === 1) {
              if (key) {
                stave.addKeySignature(key);
              }
              if (time) {
                stave.addTimeSignature(time);
              }
            }
          }

          if (measure) {
            applyMeasureBarlineSemantics(stave, measure, staffNumber);
          }
          stave.setContext(context).draw();
          staves.push(stave);

          if (!measure) {
            continue;
          }

          const noteResult = buildMeasureNotes(measure, score.ticksPerQuarter, clef, diagnostics, staffNumber);
          if (noteResult.notes.length > 0) {
            registerMeasureEventNotes(partEventNotes, layout.part.id, measure.index, noteResult);

            const [numBeats, beatValue] = parseTime(measure.effectiveAttributes.timeSignature);
            const voice = new Voice({ num_beats: numBeats, beat_value: beatValue }).setMode(Voice.Mode.SOFT);
            voice.addTickables(noteResult.notes);

            new Formatter().joinVoices([voice]).format([voice], measureWidth - 30);
            voice.draw(context, stave);
            drawMeasureTuplets(noteResult.tuplets, diagnostics, context);
          }

          if (staffNumber === 1) {
            drawMeasureDirections(measure, stave, score.ticksPerQuarter, diagnostics);
          }
          drawMeasureHarmonies(
            measure,
            stave,
            score.ticksPerQuarter,
            staffNumber,
            noteResult.noteByEventKey,
            diagnostics
          );
          drawMeasureLyrics(measure, stave, staffNumber, noteResult.noteByEventKey, diagnostics);
        }

        if (staves.length > 1) {
          const topStave = staves[0];
          const bottomStave = staves[staves.length - 1];
          if (topStave && bottomStave) {
            drawConnector(topStave, bottomStave, 'singleLeft', context);
            if (measureColumn === 0) {
              drawConnector(topStave, bottomStave, 'brace', context);
            }
          }
        }

        if (measureColumn === 0 && staves.length > 0) {
          const topStave = staves[0];
          const bottomStave = staves[staves.length - 1];
          if (!topStave || !bottomStave) {
            continue;
          }

          partBoundaries.set(layout.part.id, {
            topStave,
            bottomStave
          });

          if (!globalTopStave) {
            globalTopStave = topStave;
          }
          globalBottomStave = bottomStave;
        }
      }
    }

    const groupConnectorCount = drawPartGroupConnectors(score, partLayouts, partBoundaries, context);
    if (groupConnectorCount === 0 && score.parts.length > 1 && globalTopStave && globalBottomStave) {
      drawConnector(globalTopStave, globalBottomStave, 'bracket', context);
    }

    for (const [partId, partEventNotes] of eventNotesByPart.entries()) {
      drawScoreSpanners(score, partId, partEventNotes, diagnostics, context);
    }
  } finally {
    restoreDomGlobals();
  }

  return 1;
}

/** Resolve one clef assignment for a staff, falling back to first-known clef. */
function resolveClefForStaff(measure: Measure | undefined, staffNumber: number): ClefInfo | undefined {
  if (!measure) {
    return undefined;
  }

  return (
    measure.effectiveAttributes.clefs.find((clef) => clef.staff === staffNumber) ??
    measure.effectiveAttributes.clefs[staffNumber - 1] ??
    measure.effectiveAttributes.clefs[0]
  );
}

/** Precompute vertical placement for each rendered part/staff block. */
function buildPartLayouts(parts: Part[]): PartLayout[] {
  const layouts: PartLayout[] = [];
  let cursorY = TOP_MARGIN;

  for (const part of parts) {
    const staffCount = Math.max(
      1,
      ...part.measures.map((measure) => Math.max(1, measure.effectiveAttributes.staves))
    );

    layouts.push({
      part,
      staffCount,
      topY: cursorY
    });

    cursorY += staffCount * STAFF_ROW_HEIGHT + PART_GAP;
  }

  return layouts;
}

/** Compute required page height from part layout rows. */
function estimateRequiredHeight(layouts: PartLayout[]): number {
  if (layouts.length === 0) {
    return DEFAULT_PAGE_HEIGHT;
  }

  const last = layouts[layouts.length - 1];
  if (!last) {
    return DEFAULT_PAGE_HEIGHT;
  }

  return last.topY + last.staffCount * STAFF_ROW_HEIGHT + BOTTOM_MARGIN;
}

/** Apply repeat-barline and volta metadata to a stave before drawing. */
function applyMeasureBarlineSemantics(stave: Stave, measure: Measure, staffNumber: number): void {
  const barlines = measure.barlines && measure.barlines.length > 0 ? measure.barlines : measure.barline ? [measure.barline] : [];
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

/** Draw a stave connector between top and bottom staves for a given style. */
function drawConnector(
  topStave: Stave,
  bottomStave: Stave,
  type: StaveConnectorType,
  context: ReturnType<Renderer['getContext']>
): void {
  new StaveConnector(topStave, bottomStave).setType(type).setContext(context).draw();
}

/** Draw part-group connectors derived from parsed part-list group metadata. */
function drawPartGroupConnectors(
  score: Score,
  layouts: PartLayout[],
  boundaries: Map<string, PartBoundary>,
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
