import { JSDOM } from 'jsdom';
import {
  Renderer,
  Stave,
  type StaveNote,
  Voice,
} from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { ClefInfo, Measure, Part, PartDefinition, Score } from '../core/score.js';
import { ensureDomGlobals } from './render-dom.js';
import {
  applyMeasureBarlineSemantics,
  countTextLines,
  drawPageHeaderFooter,
  drawPartGroupConnectors,
  drawPartLabel,
  drawPreparedBeams,
  drawConnector,
  formatVoiceToStave,
  estimateTextWidth,
  prepareMeasureBeams,
  type ConnectorPartBoundary
} from './render-drawing.js';
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
  drawMeasureNonArpeggiates,
  drawMeasureTuplets,
  drawScoreSpanners,
  registerMeasureEventNotes,
  type DirectionTextLaneState,
  type HarmonyTextLaneState,
  type LyricTextLaneState,
  type RenderMeasureWindow
} from './render-notations.js';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGINATED_PAGE_HEIGHT,
  DEFAULT_PAGINATED_PAGE_WIDTH,
  LEFT_MARGIN,
  TOP_MARGIN,
  type RenderPageMetricsLike,
  type RenderLayoutMode,
  type RenderOptionsLike,
  type RenderPagesResultLike,
  type RenderToElementResultLike
} from './render-types.js';

export type { RenderOptionsLike, RenderPagesResultLike, RenderToElementResultLike } from './render-types.js';

/** Vertical distance between staves in one rendered system row. */
const STAFF_ROW_HEIGHT = 110;
/** Extra vertical spacing between parts after staff rows are placed. */
const PART_GAP = 40;
/** Minimum measure width used by formatter planning for readability. */
const MINIMUM_MEASURE_WIDTH = 160;
/** Minimum measure width used when forced to fit many measures in one system. */
const MINIMUM_FITTED_MEASURE_WIDTH = 82;
/** Default gap between systems when not explicitly configured. */
const DEFAULT_SYSTEM_GAP = 40;
/** Upper bound for auto-expanded inter-system gaps under heavy text pressure. */
const MAX_AUTO_SYSTEM_GAP = 132;
/** Default label column width for part/staff names. */
const DEFAULT_LABEL_WIDTH = 86;
/** Hard cap for auto label width so it cannot consume too much system width. */
const MAX_LABEL_WIDTH = 180;
/** Minimum label column width when labels are enabled. */
const MIN_LABEL_WIDTH = 64;
/** Default global rendering scale factor (80% of previous size). */
const DEFAULT_RENDER_SCALE = 0.8;
/** Extra per-measure width reserved for very dense rhythmic writing. */
const MAX_DENSITY_WIDTH_BOOST = 124;
/** Upper bound for density-driven minimum fitted measure widths. */
const MAX_MINIMUM_FITTED_MEASURE_WIDTH = 280;
/** Note-type set considered rhythmically dense for horizontal spacing planning. */
const DENSE_NOTE_TYPE_SET = new Set(['16th', '32nd', '64th', '128th', '256th', '512th', '1024th']);
/** Damping factor used when compensating first-column width for system-start modifiers. */
const FIRST_COLUMN_EXTRA_WIDTH_DAMPING = 0.78;
/** Ignore small first-column shifts that do not materially hurt readability. */
const FIRST_COLUMN_EXTRA_IGNORE_RATIO = 0.08;
/** Clamp first-column compensation so opening measures are not over-expanded. */
const FIRST_COLUMN_EXTRA_WIDTH_CAP_RATIO = 0.48;
/** Retain partial first-column compensation even when source-width hints are strongly biased. */
const FIRST_COLUMN_STRONG_BIAS_EXTRA_DAMPING = 0.55;
/** Baseline first-column floor ratio against median width of later columns. */
const FIRST_COLUMN_FLOOR_RATIO = 0.5;
/** Higher floor ratio used when source-width hints strongly underweight system starts. */
const FIRST_COLUMN_STRONG_BIAS_FLOOR_RATIO = 0.58;
/** Additional first-column floor ratio contributed by first-measure density pressure. */
const FIRST_COLUMN_DENSITY_FLOOR_BOOST = 0.2;
/** Upper bound for density-added first-column floor ratio. */
const FIRST_COLUMN_DENSITY_FLOOR_BOOST_CAP = 0.3;
/** Maximum first-column floor ratio in normal source-width conditions. */
const FIRST_COLUMN_FLOOR_RATIO_CAP = 0.76;
/** Maximum first-column floor ratio under strong source-width bias. */
const FIRST_COLUMN_STRONG_BIAS_FLOOR_RATIO_CAP = 0.82;
/** Hard cap for first-column floor width as fraction of the system's available width. */
const FIRST_COLUMN_FLOOR_MAX_AVAILABLE_RATIO = 0.4;
/** Baseline density-aligned ratio floor used when first measure is denser than later columns. */
const FIRST_COLUMN_DENSITY_ALIGNED_RATIO_BASE = 0.62;
/** Additional ratio floor applied per unit of first-vs-later density imbalance. */
const FIRST_COLUMN_DENSITY_ALIGNED_RATIO_BOOST = 0.16;
/** Maximum density-aligned ratio floor so authored width intent can still dominate. */
const FIRST_COLUMN_DENSITY_ALIGNED_RATIO_CAP = 0.75;
/** Minimum first-column ratio used for dense two-measure systems. */
const FIRST_COLUMN_TWO_MEASURE_DENSE_RATIO_FLOOR = 0.74;
/** Extra first-column width per density unit beyond baseline hint 1. */
const FIRST_COLUMN_DENSITY_EXTRA_WIDTH_FACTOR = 22;
/** Maximum density-driven width addend applied to first system columns. */
const FIRST_COLUMN_DENSITY_EXTRA_WIDTH_CAP = 44;
/** Dense-measure threshold used to reduce measures-per-system locally. */
const LOCAL_DENSE_MEASURE_HINT_THRESHOLD = 1.85;
/** Extreme dense-measure threshold used for stronger local system splitting. */
const LOCAL_EXTREME_DENSE_MEASURE_HINT_THRESHOLD = 2.25;
/** Sparse-window threshold used to recover one extra measure per system locally. */
const LOCAL_SPARSE_MEASURE_HINT_THRESHOLD = 1.35;
/** Minimum measures-per-system allowed by local dense-measure adaptation. */
const MIN_ADAPTIVE_MEASURES_PER_SYSTEM = 2;
/** Maximum number of measures local adaptation may add beyond base planning. */
const MAX_ADAPTIVE_MEASURE_EXPANSION = 1;
/** Source-width compression risk threshold for first columns in local system windows. */
const LOCAL_FIRST_COLUMN_COMPRESSION_RISK_THRESHOLD = 0.52;
/** Additional system split reduction applied when first-column risk is high. */
const LOCAL_FIRST_COLUMN_COMPRESSION_REDUCTION = 2;
/** Density threshold where system justification compaction begins. */
const SPARSE_SYSTEM_DENSITY_THRESHOLD = 1.38;
/** Strong sparse threshold used for 1-2 measure systems. */
const VERY_SPARSE_SYSTEM_DENSITY_THRESHOLD = 1.18;
/** Maximum sparse-system width reduction ratio against available width. */
const MAX_SPARSE_SYSTEM_WIDTH_REDUCTION_RATIO = 0.24;
/** Minimum width ratio retained even for aggressively compact sparse systems. */
const MIN_SPARSE_SYSTEM_TARGET_WIDTH_RATIO = 0.72;
/** Measure-number CSS class used for deterministic integration checks. */
const MEASURE_NUMBER_CLASS = 'mx-measure-number';
/** Default measure-number interval when the overlay is enabled. */
const DEFAULT_MEASURE_NUMBER_INTERVAL = 4;
/** Vertical offset above top staff where measure-number overlays are drawn. */
const DEFAULT_MEASURE_NUMBER_Y_OFFSET = 8;

/** Resolved measure-number behavior used while drawing one render pass. */
interface ResolvedMeasureNumberConfig {
  enabled: boolean;
  interval: number;
  showFirst: boolean;
}

/** Stable layout metadata for one score part across all systems/pages. */
interface PartLayout {
  part: Part;
  staffCount: number;
  /**
   * Relative notation density/complexity score in [0, 1].
   * Used to adapt vertical spacing between adjacent parts.
  */
  complexity: number;
  /**
   * Text-annotation pressure in [0, 1].
   * Captures how aggressively directions/harmonies/lyrics compete for space.
   */
  textAnnotationPressure: number;
  /**
   * Vertical spread pressure in [0, 1].
   * Tracks how often note pitch content leaves comfortable staff ranges.
   */
  verticalSpread: number;
  /**
   * Additional vertical gap inserted between adjacent staves inside this part.
   * Used to reduce grand-staff collisions in dense or center-register writing.
   */
  intraStaffGap: number;
}

/** Horizontal layout information for one system's measure columns. */
interface MeasureColumnLayout {
  columnX: number[];
  columnWidths: number[];
  totalWidth: number;
}

/** One measure-range system generated by the page planner. */
interface SystemRange {
  index: number;
  startMeasure: number;
  endMeasure: number;
  forcePageBreakBefore?: boolean;
}

/** One placed system row on a rendered page. */
interface PageSystemPlacement extends SystemRange {
  topY: number;
}

/** One rendered page with packed systems and explicit page number. */
interface PagePlan {
  pageNumber: number;
  systems: PageSystemPlacement[];
}

/** Resolved and normalized page margins used by all layout modes. */
interface ResolvedMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Normalized layout options that the renderer uses during planning/drawing. */
interface LayoutPlanConfig {
  mode: RenderLayoutMode;
  pageWidth: number;
  pageHeight: number;
  margins: ResolvedMargins;
  contentStartX: number;
  contentWidth: number;
  measuresPerSystem: number;
  systemGap: number;
  topSystemOffset: number;
  staffRowHeight: number;
  partGap: number;
  justifyLastSystem: boolean;
  showPartNames: boolean;
  showPartAbbreviations: boolean;
  repeatOnSystemBreak: boolean;
  labelWidth: number;
  showTitle: boolean;
  showMovementTitle: boolean;
  showPageNumber: boolean;
  leftHeader?: string;
  rightHeader?: string;
  leftFooter?: string;
  rightFooter?: string;
  renderScale: number;
  measureNumbers: ResolvedMeasureNumberConfig;
}

/** Forced line/page break starts collected from parsed MusicXML `<print>` directives. */
interface ForcedMeasureBreaks {
  systemStarts: Set<number>;
  pageStarts: Set<number>;
}

/** Earliest print-level page layout hints used as global pagination defaults. */
interface InitialPrintPageLayout {
  pageWidth?: number;
  pageHeight?: number;
  margins?: ResolvedMargins;
}

/** Runtime render metrics for one page after system layouts are resolved. */
interface PageRenderEnvelope {
  width: number;
  height: number;
  contentBounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  viewportBounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

/** CSS class used to identify deterministic page background rects in SVG output. */
const PAGE_BACKGROUND_CLASS = 'mx-page-background';
/** Fixed page background color to avoid transparent/black viewer output differences. */
const PAGE_BACKGROUND_FILL = '#ffffff';

/**
 * Render score content to SVG page strings.
 * This path is deterministic for headless tests and now defaults to paginated
 * rendering while preserving a horizontal continuous mode.
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
      pageMetrics: [],
      diagnostics
    };
  }

  const renderResult = renderIntoContainer(score, container as unknown as HTMLElement, options, diagnostics);
  const svgPages = [...container.querySelectorAll('svg')].map((svgElement) => svgElement.outerHTML);
  dom.window.close();

  return {
    pages: renderResult.pageCount > 0 ? svgPages : [],
    pageMetrics: renderResult.pageMetrics,
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
  const renderResult = renderIntoContainer(score, container, options, diagnostics);

  return {
    pageCount: renderResult.pageCount,
    pageMetrics: renderResult.pageMetrics,
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
): { pageCount: number; pageMetrics: RenderPageMetricsLike[] } {
  const restoreDomGlobals = ensureDomGlobals(container.ownerDocument);
  container.innerHTML = '';

  if (score.parts.length === 0) {
    diagnostics.push({
      code: 'EMPTY_SCORE',
      severity: 'error',
      message: 'Score does not contain any parts to render.'
    });
    return { pageCount: 0, pageMetrics: [] };
  }

  const totalMeasureCount = Math.max(0, ...score.parts.map((part) => part.measures.length));
  if (totalMeasureCount === 0) {
    diagnostics.push({
      code: 'EMPTY_PART',
      severity: 'error',
      message: 'Score parts contain no measures to render.'
    });
    return { pageCount: 0, pageMetrics: [] };
  }
  const measureSlots = resolveMeasureSlots(totalMeasureCount, options, diagnostics);
  if (measureSlots.length === 0) {
    diagnostics.push({
      code: 'EMPTY_RENDER_WINDOW',
      severity: 'error',
      message: 'Resolved measure window does not include any measures to render.'
    });
    return { pageCount: 0, pageMetrics: [] };
  }

  const partLayouts = buildPartLayouts(score.parts);
  const config = resolveLayoutPlanConfig(score, options, partLayouts, measureSlots.length);
  const forcedBreaks = collectForcedMeasureBreaks(partLayouts, measureSlots);
  const systemRanges = buildSystemRanges(measureSlots.length, config, forcedBreaks, partLayouts, measureSlots);
  const systemHeight = estimateSystemHeight(partLayouts, config);
  const pagePlans = buildPagePlans(score, systemRanges, systemHeight, config);
  const pageMetrics: RenderPageMetricsLike[] = [];

  const partDefinitionsById = new Map(score.partList.map((definition) => [definition.id, definition]));

  try {
    for (const pagePlan of pagePlans) {
      const hostDiv = container.ownerDocument.createElement('div');
      container.appendChild(hostDiv);

      const systemColumnLayouts = new Map<number, MeasureColumnLayout>();
      let pageMaxContentRight = config.contentStartX;
      for (const system of pagePlan.systems) {
        const columnLayout = buildMeasureColumnLayoutForSystem(
          score,
          partLayouts,
          system,
          measureSlots,
          config.contentStartX,
          config.contentWidth,
          config.mode === 'paginated',
          system.endMeasure < measureSlots.length || config.justifyLastSystem,
          diagnostics
        );
        systemColumnLayouts.set(system.index, columnLayout);
        pageMaxContentRight = Math.max(pageMaxContentRight, config.contentStartX + columnLayout.totalWidth);
      }

      const envelope = resolvePageRenderEnvelope(score, pagePlan, pageMaxContentRight, systemHeight, config);
      const renderer = new Renderer(hostDiv, Renderer.Backends.SVG);
      renderer.resize(envelope.width, envelope.height);
      const context = renderer.getContext();
      applyRenderScale(context, config);
      ensurePageBackgroundRect(hostDiv, envelope);

      drawPageHeaderFooter(context, score, pagePlan.pageNumber, pagePlans.length, envelope.width, envelope.height, config);

      const eventNotesByPart = new Map<string, Map<string, StaveNote>>();

      for (const system of pagePlan.systems) {
        const partBoundaries = new Map<string, ConnectorPartBoundary>();
        let globalTopStave: Stave | undefined;
        let globalBottomStave: Stave | undefined;
        let partCursorY = system.topY;
        const columnLayout = systemColumnLayouts.get(system.index);
        if (!columnLayout) {
          continue;
        }

        for (let partLayoutIndex = 0; partLayoutIndex < partLayouts.length; partLayoutIndex += 1) {
          const partLayout = partLayouts[partLayoutIndex];
          if (!partLayout) {
            continue;
          }
          // Keep text lane state stable across all measures in the same system so
          // adjacent-measure labels (directions/harmonies) cannot be packed into
          // conflicting rows at measure boundaries.
          const directionLaneStateByStaff = new Map<number, DirectionTextLaneState>();
          const harmonyLaneStateByStaff = new Map<number, HarmonyTextLaneState>();
          const lyricLaneStateByStaff = new Map<number, LyricTextLaneState>();
          const partEventNotes = eventNotesByPart.get(partLayout.part.id) ?? new Map<string, StaveNote>();
          eventNotesByPart.set(partLayout.part.id, partEventNotes);

          for (let measureColumn = system.startMeasure; measureColumn < system.endMeasure; measureColumn += 1) {
            const absoluteMeasureIndex = measureSlots[measureColumn] ?? measureColumn;
            const localColumnIndex = measureColumn - system.startMeasure;
            const x = columnLayout.columnX[localColumnIndex] ?? config.contentStartX;
            const columnWidth = columnLayout.columnWidths[localColumnIndex] ?? MINIMUM_MEASURE_WIDTH;
            const measure = partLayout.part.measures[absoluteMeasureIndex];
            const staves: Stave[] = [];
            const isSystemStartColumn = measureColumn === system.startMeasure;

            for (let staffNumber = 1; staffNumber <= partLayout.staffCount; staffNumber += 1) {
              const directionLaneState =
                directionLaneStateByStaff.get(staffNumber) ??
                createDirectionTextLaneState(directionLaneStateByStaff, staffNumber);
              const harmonyLaneState =
                harmonyLaneStateByStaff.get(staffNumber) ??
                createHarmonyTextLaneState(harmonyLaneStateByStaff, staffNumber);
              const lyricLaneState =
                lyricLaneStateByStaff.get(staffNumber) ??
                createLyricTextLaneState(lyricLaneStateByStaff, staffNumber);
              const y =
                partCursorY + (staffNumber - 1) * (config.staffRowHeight + partLayout.intraStaffGap);
              const stave = new Stave(x, y, columnWidth);
              const clefInfo = resolveClefForStaff(measure, staffNumber);
              const clef = mapClef(clefInfo, diagnostics);
              const key = mapKeySignature(measure?.effectiveAttributes.keySignature);
              const time = mapTimeSignature(measure?.effectiveAttributes.timeSignature);

              if (isSystemStartColumn) {
                stave.addClef(clef);
                if (staffNumber === 1) {
                  if (key) {
                    stave.addKeySignature(key);
                  }
                  if (time) {
                    stave.addTimeSignature(time);
                  }
                }
              } else if (measure && measureColumn > 0) {
                const previousAbsoluteMeasureIndex = measureSlots[measureColumn - 1] ?? measureColumn - 1;
                const previousMeasure = partLayout.part.measures[previousAbsoluteMeasureIndex];
                const previousClef = resolveClefForStaff(previousMeasure, staffNumber);
                if (hasClefChanged(previousClef, clefInfo)) {
                  // Mid-system clef changes use small glyphs at measure starts.
                  stave.addClef(clef, 'small');
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
                registerMeasureEventNotes(partEventNotes, partLayout.part.id, measure.index, noteResult);

                const [numBeats, beatValue] = parseTime(measure.effectiveAttributes.timeSignature);
                const voice = new Voice({ num_beats: numBeats, beat_value: beatValue }).setMode(Voice.Mode.SOFT);
                voice.addTickables(noteResult.notes);

                formatVoiceToStave(voice, stave, diagnostics, measure.index, staffNumber);
                const beams = prepareMeasureBeams(
                  measure,
                  noteResult.notes,
                  noteResult.noteByEventKey,
                  diagnostics,
                  measure.index,
                  staffNumber
                );
                voice.draw(context, stave);
                drawPreparedBeams(beams, context, diagnostics, measure.index, staffNumber);
                drawMeasureTuplets(noteResult.tuplets, diagnostics, context);
                drawMeasureNonArpeggiates(measure, staffNumber, noteResult.noteByEventKey, context);
              }

              if (
                staffNumber === 1 &&
                config.measureNumbers.enabled &&
                shouldDrawMeasureNumberOverlay(measure, absoluteMeasureIndex, measureSlots, config.measureNumbers)
              ) {
                drawMeasureNumberOverlay(context, measure, absoluteMeasureIndex, stave);
              }

              drawMeasureDirections(
                measure,
                stave,
                score.ticksPerQuarter,
                staffNumber,
                partLayout.staffCount,
                diagnostics,
                directionLaneState
              );

              drawMeasureHarmonies(
                measure,
                stave,
                score.ticksPerQuarter,
                staffNumber,
                noteResult.noteByEventKey,
                diagnostics,
                harmonyLaneState
              );
              drawMeasureLyrics(
                measure,
                stave,
                staffNumber,
                noteResult.noteByEventKey,
                diagnostics,
                lyricLaneState
              );
            }

            if (staves.length > 1) {
              const topStave = staves[0];
              const bottomStave = staves[staves.length - 1];
              if (topStave && bottomStave) {
                drawConnector(topStave, bottomStave, 'singleLeft', context);
                if (isSystemStartColumn) {
                  drawConnector(topStave, bottomStave, 'brace', context);
                }
              }
            }

            if (isSystemStartColumn && staves.length > 0) {
              const topStave = staves[0];
              const bottomStave = staves[staves.length - 1];
              if (!topStave || !bottomStave) {
                continue;
              }

              partBoundaries.set(partLayout.part.id, {
                topStave,
                bottomStave
              });

              if (!globalTopStave) {
                globalTopStave = topStave;
              }
              globalBottomStave = bottomStave;
            }
          }

          const boundary = partBoundaries.get(partLayout.part.id);
          if (boundary) {
            drawPartLabel(
              context,
              partDefinitionsById.get(partLayout.part.id),
              system.index,
              boundary.topStave.getY() + 18,
              config
            );
          }

          const nextPartLayout = partLayouts[partLayoutIndex + 1];
          partCursorY += partLayout.staffCount * config.staffRowHeight;
          partCursorY += Math.max(0, partLayout.staffCount - 1) * partLayout.intraStaffGap;
          if (nextPartLayout) {
            partCursorY += resolveInterPartGap(partLayout, nextPartLayout, config);
          }
        }

        const groupConnectorCount = drawPartGroupConnectors(score, partLayouts, partBoundaries, context);
        if (groupConnectorCount === 0 && score.parts.length > 1 && globalTopStave && globalBottomStave) {
          drawConnector(globalTopStave, globalBottomStave, 'bracket', context);
        }
      }

      const renderWindow = resolvePageMeasureWindow(pagePlan, measureSlots);
      for (const [partId, partEventNotes] of eventNotesByPart.entries()) {
        drawScoreSpanners(score, partId, partEventNotes, diagnostics, context, renderWindow);
      }

      pageMetrics.push(
        buildPageMetrics(pagePlan, pagePlans.length, envelope, renderWindow)
      );
    }
  } finally {
    restoreDomGlobals();
  }

  return {
    pageCount: pagePlans.length,
    pageMetrics
  };
}

/** Create and memoize per-staff direction text lanes for one rendered system. */
function createDirectionTextLaneState(
  laneStateByStaff: Map<number, DirectionTextLaneState>,
  staffNumber: number
): DirectionTextLaneState {
  const laneState: DirectionTextLaneState = {
    aboveRowSpans: new Map<number, Array<{ left: number; right: number }>>(),
    belowRowSpans: new Map<number, Array<{ left: number; right: number }>>()
  };
  laneStateByStaff.set(staffNumber, laneState);
  return laneState;
}

/** Create and memoize per-staff harmony text lanes for one rendered system. */
function createHarmonyTextLaneState(
  laneStateByStaff: Map<number, HarmonyTextLaneState>,
  staffNumber: number
): HarmonyTextLaneState {
  const laneState: HarmonyTextLaneState = {
    rowSpans: new Map<number, Array<{ left: number; right: number }>>()
  };
  laneStateByStaff.set(staffNumber, laneState);
  return laneState;
}

/** Create and memoize per-staff lyric text lanes for one rendered system. */
function createLyricTextLaneState(
  laneStateByStaff: Map<number, LyricTextLaneState>,
  staffNumber: number
): LyricTextLaneState {
  const laneState: LyricTextLaneState = {
    lineSpans: new Map<number, Array<{ left: number; right: number }>>()
  };
  laneStateByStaff.set(staffNumber, laneState);
  return laneState;
}

/** True when a measure-start clef changed relative to the previous measure on a staff. */
function hasClefChanged(previous: ClefInfo | undefined, current: ClefInfo | undefined): boolean {
  if (!previous || !current) {
    return false;
  }

  return previous.sign !== current.sign || previous.line !== current.line;
}

/** Resolve one inclusive absolute measure window for all systems on one page. */
function resolvePageMeasureWindow(pagePlan: PagePlan, measureSlots: number[]): RenderMeasureWindow | undefined {
  if (pagePlan.systems.length === 0) {
    return undefined;
  }

  let startMeasure = Number.POSITIVE_INFINITY;
  let endMeasure = Number.NEGATIVE_INFINITY;
  for (const system of pagePlan.systems) {
    const absoluteStart = measureSlots[system.startMeasure] ?? system.startMeasure;
    const endSlot = Math.max(system.startMeasure, system.endMeasure - 1);
    const absoluteEndExclusive = (measureSlots[endSlot] ?? endSlot) + 1;
    startMeasure = Math.min(startMeasure, absoluteStart);
    endMeasure = Math.max(endMeasure, absoluteEndExclusive);
  }

  if (!Number.isFinite(startMeasure) || !Number.isFinite(endMeasure)) {
    return undefined;
  }

  return {
    startMeasure,
    endMeasure
  };
}

/** Build one page-level metrics envelope for public API telemetry output. */
function buildPageMetrics(
  pagePlan: PagePlan,
  pageCount: number,
  envelope: PageRenderEnvelope,
  measureWindow: RenderMeasureWindow | undefined
): RenderPageMetricsLike {
  const leftAmount = Math.max(0, envelope.viewportBounds.left - envelope.contentBounds.left);
  const rightAmount = Math.max(0, envelope.contentBounds.right - envelope.viewportBounds.right);
  const topAmount = Math.max(0, envelope.viewportBounds.top - envelope.contentBounds.top);
  const bottomAmount = Math.max(0, envelope.contentBounds.bottom - envelope.viewportBounds.bottom);

  return {
    pageIndex: pagePlan.pageNumber - 1,
    pageNumber: pagePlan.pageNumber,
    pageCount,
    measureWindow,
    contentBounds: toRenderBounds(envelope.contentBounds),
    viewportBounds: toRenderBounds(envelope.viewportBounds),
    overflow: {
      left: leftAmount > 0,
      right: rightAmount > 0,
      top: topAmount > 0,
      bottom: bottomAmount > 0,
      leftAmount: Math.round(leftAmount),
      rightAmount: Math.round(rightAmount),
      topAmount: Math.round(topAmount),
      bottomAmount: Math.round(bottomAmount)
    }
  };
}

/** Convert raw bounds into the public telemetry shape with width/height. */
function toRenderBounds(bounds: { left: number; right: number; top: number; bottom: number }): RenderPageMetricsLike['contentBounds'] {
  return {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    right: Math.round(bounds.right),
    bottom: Math.round(bounds.bottom),
    width: Math.round(Math.max(0, bounds.right - bounds.left)),
    height: Math.round(Math.max(0, bounds.bottom - bounds.top))
  };
}

/** True when one measure-number overlay should be drawn at this measure start. */
function shouldDrawMeasureNumberOverlay(
  measure: Measure,
  absoluteMeasureIndex: number,
  measureSlots: number[],
  config: ResolvedMeasureNumberConfig
): boolean {
  if (!config.enabled) {
    return false;
  }

  const absoluteStartMeasure = measureSlots[0] ?? 0;
  const normalizedLabel = measure.numberLabel?.trim();
  const parsedLabel = normalizedLabel ? Number.parseInt(normalizedLabel, 10) : Number.NaN;
  const displayIndex = Number.isFinite(parsedLabel) ? parsedLabel : absoluteMeasureIndex + 1;
  const normalizedIndex = Math.max(0, displayIndex - 1);

  if (config.showFirst && absoluteMeasureIndex === absoluteStartMeasure) {
    return true;
  }

  return normalizedIndex % config.interval === 0;
}

/** Draw one small measure-number label above the current measure-start barline. */
function drawMeasureNumberOverlay(
  context: ReturnType<Renderer['getContext']>,
  measure: Measure,
  absoluteMeasureIndex: number,
  stave: Stave
): void {
  const label = measure.numberLabel?.trim() || String(absoluteMeasureIndex + 1);
  if (!label) {
    return;
  }

  const svgContext = context as ReturnType<Renderer['getContext']> & {
    openGroup?: (cls?: string) => unknown;
    closeGroup?: () => unknown;
  };
  svgContext.openGroup?.(MEASURE_NUMBER_CLASS);
  context.setFont('Times New Roman', 9, 'normal');
  context.fillText(label, stave.getX() + 2, stave.getY() - DEFAULT_MEASURE_NUMBER_Y_OFFSET);
  svgContext.closeGroup?.();
}

/**
 * Inject an explicit white page background into the generated SVG.
 * Many viewers render transparent backgrounds as dark/black; this keeps screenshots
 * and visual comparisons stable across tooling and platforms.
 */
function ensurePageBackgroundRect(hostDiv: HTMLElement, envelope: PageRenderEnvelope): void {
  const svg = hostDiv.querySelector('svg');
  if (!svg) {
    return;
  }

  const rect = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', PAGE_BACKGROUND_CLASS);
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', String(Math.ceil(envelope.width)));
  rect.setAttribute('height', String(Math.ceil(envelope.height)));
  rect.setAttribute('fill', PAGE_BACKGROUND_FILL);
  rect.setAttribute('stroke', 'none');

  svg.insertBefore(rect, svg.firstChild);
}

/** Resolve one clef assignment for a staff, falling back to first-known clef. */
function resolveClefForStaff(measure: Measure | undefined, staffNumber: number): ClefInfo | undefined {
  if (!measure) {
    return undefined;
  }

  const clefs = measure.effectiveAttributes.clefs;
  const exact = clefs.find((clef) => clef.staff === staffNumber);
  if (exact) {
    return exact;
  }

  // Avoid cross-staff leakage: if we have explicit clef assignments and none
  // match this staff, do not borrow another staff's clef. This prevents a
  // staff-2 clef from being rendered on staff-1 during sparse updates.
  if (clefs.length > 0 && measure.effectiveAttributes.staves > 1) {
    return undefined;
  }

  return clefs[0];
}

/** Precompute staff-count envelopes per part for page/system planning. */
function buildPartLayouts(parts: Part[]): PartLayout[] {
  return parts.map((part) => {
    const staffCount = Math.max(1, ...part.measures.map((measure) => Math.max(1, measure.effectiveAttributes.staves)));
    const complexity = estimatePartComplexity(part);
    const textAnnotationPressure = estimatePartTextAnnotationPressure(part);
    const verticalSpread = estimatePartVerticalSpread(part);
    return {
      part,
      staffCount,
      complexity,
      textAnnotationPressure,
      verticalSpread,
      intraStaffGap: estimateIntraStaffGap(part, staffCount, complexity, textAnnotationPressure)
    };
  });
}

/** Resolve one normalized measure-slot list from optional API render window options. */
function resolveMeasureSlots(
  totalMeasureCount: number,
  options: RenderOptionsLike,
  diagnostics: Diagnostic[]
): number[] {
  const requestedStart = options.layout?.window?.startMeasure ?? 0;
  const requestedEnd = options.layout?.window?.endMeasure ?? totalMeasureCount;
  const start = clampInt(requestedStart, 0, totalMeasureCount);
  const end = clampInt(requestedEnd, 0, totalMeasureCount);

  if (requestedEnd < requestedStart) {
    diagnostics.push({
      code: 'RENDER_WINDOW_INVALID',
      severity: 'warning',
      message: `Render window endMeasure (${requestedEnd}) is less than startMeasure (${requestedStart}); window resolves empty.`
    });
  }

  if (end <= start) {
    return [];
  }

  return Array.from({ length: end - start }, (_, index) => start + index);
}

/** Collect forced system/page starts from parsed measure print directives across parts. */
function collectForcedMeasureBreaks(partLayouts: PartLayout[], measureSlots: number[]): ForcedMeasureBreaks {
  const systemStarts = new Set<number>();
  const pageStarts = new Set<number>();

  for (let measureSlot = 0; measureSlot < measureSlots.length; measureSlot += 1) {
    const absoluteMeasureIndex = measureSlots[measureSlot] ?? measureSlot;
    let forceSystem = false;
    let forcePage = false;

    for (const layout of partLayouts) {
      const measure = layout.part.measures[absoluteMeasureIndex];
      if (!measure?.print) {
        continue;
      }

      forceSystem ||= Boolean(measure.print.newSystem || measure.print.newPage);
      forcePage ||= Boolean(measure.print.newPage);
    }

    if (measureSlot > 0 && forceSystem) {
      systemStarts.add(measureSlot);
    }
    if (measureSlot > 0 && forcePage) {
      pageStarts.add(measureSlot);
    }
  }

  return {
    systemStarts,
    pageStarts
  };
}

/** Resolve earliest `<print><page-layout>` hints as fallback pagination geometry. */
function resolveInitialPrintPageLayout(partLayouts: PartLayout[]): InitialPrintPageLayout | undefined {
  let earliest: {
    measureIndex: number;
    pageWidth?: number;
    pageHeight?: number;
    margins?: ResolvedMargins;
  } | undefined;

  for (const layout of partLayouts) {
    for (const measure of layout.part.measures) {
      if (!measure?.print) {
        continue;
      }

      const hasLayout =
        measure.print.pageWidth !== undefined ||
        measure.print.pageHeight !== undefined ||
        measure.print.pageMargins !== undefined;
      if (!hasLayout) {
        continue;
      }

      if (!earliest || measure.index < earliest.measureIndex) {
        earliest = {
          measureIndex: measure.index,
          pageWidth: measure.print.pageWidth,
          pageHeight: measure.print.pageHeight,
          margins: measure.print.pageMargins
            ? {
                top: measure.print.pageMargins.top ?? TOP_MARGIN,
                right: measure.print.pageMargins.right ?? LEFT_MARGIN,
                bottom: measure.print.pageMargins.bottom ?? 52,
                left: measure.print.pageMargins.left ?? LEFT_MARGIN
              }
            : undefined
        };
      }
    }
  }

  if (!earliest) {
    return undefined;
  }

  return {
    pageWidth: earliest.pageWidth,
    pageHeight: earliest.pageHeight,
    margins: earliest.margins
  };
}

/** Build normalized render configuration from API options and legacy flags. */
function resolveLayoutPlanConfig(
  score: Score,
  options: RenderOptionsLike,
  partLayouts: PartLayout[],
  measureCount: number
): LayoutPlanConfig {
  const explicitMode = options.layout?.mode;
  const mode: RenderLayoutMode =
    explicitMode ?? (options.paginate === false ? 'horizontal-continuous' : 'paginated');
  const initialPrintLayout = resolveInitialPrintPageLayout(partLayouts);
  const defaultPageWidth = score.defaults?.pageWidth;
  const defaultPageHeight = score.defaults?.pageHeight;
  const defaultMargins = score.defaults?.pageMargins;
  const defaultSystemMargins = score.defaults?.systemMargins;
  const defaultSystemDistance = score.defaults?.systemDistance;
  const defaultTopSystemDistance = score.defaults?.topSystemDistance;
  const defaultStaffDistance = score.defaults?.staffDistance;
  const pageWidth =
    options.layout?.page?.width ??
    options.page?.width ??
    initialPrintLayout?.pageWidth ??
    defaultPageWidth ??
    (mode === 'paginated' ? DEFAULT_PAGINATED_PAGE_WIDTH : DEFAULT_PAGE_WIDTH);
  const pageHeight =
    options.layout?.page?.height ??
    options.page?.height ??
    initialPrintLayout?.pageHeight ??
    defaultPageHeight ??
    (mode === 'paginated' ? DEFAULT_PAGINATED_PAGE_HEIGHT : DEFAULT_PAGE_HEIGHT);

  const margins: ResolvedMargins = {
    top:
      options.layout?.page?.margins?.top ??
      initialPrintLayout?.margins?.top ??
      defaultMargins?.top ??
      TOP_MARGIN,
    right:
      options.layout?.page?.margins?.right ??
      initialPrintLayout?.margins?.right ??
      defaultMargins?.right ??
      LEFT_MARGIN,
    bottom:
      options.layout?.page?.margins?.bottom ??
      initialPrintLayout?.margins?.bottom ??
      defaultMargins?.bottom ??
      52,
    left:
      options.layout?.page?.margins?.left ??
      initialPrintLayout?.margins?.left ??
      defaultMargins?.left ??
      LEFT_MARGIN
  };

  const showPartNames = options.layout?.labels?.showPartNames ?? true;
  const showPartAbbreviations = options.layout?.labels?.showPartAbbreviations ?? true;
  const repeatOnSystemBreak = options.layout?.labels?.repeatOnSystemBreak ?? true;
  const measureNumbers: ResolvedMeasureNumberConfig = {
    enabled: options.layout?.measureNumbers?.enabled ?? false,
    interval: clampInt(options.layout?.measureNumbers?.interval ?? DEFAULT_MEASURE_NUMBER_INTERVAL, 1, 999),
    showFirst: options.layout?.measureNumbers?.showFirst ?? true
  };
  const labelsEnabled = partLayouts.length > 0 && (showPartNames || showPartAbbreviations);
  const labelWidth = labelsEnabled
    ? clampInt(
        Math.round(
          options.layout?.labels?.labelWidth ?? estimateLabelWidth(score.partList, showPartNames, showPartAbbreviations)
        ),
        MIN_LABEL_WIDTH,
        MAX_LABEL_WIDTH
      )
    : 0;
  const hasSourceSystemMargins =
    Number.isFinite(defaultSystemMargins?.left) || Number.isFinite(defaultSystemMargins?.right);
  const systemLeftMargin = defaultSystemMargins?.left ?? 0;
  const systemRightMargin = defaultSystemMargins?.right ?? 0;
  // Source-authored system margins define the notation lane. In that case we
  // keep notation width intact and rely on wrapped/truncated labels to avoid
  // left-edge clipping.
  const reserveLabelColumn = !hasSourceSystemMargins ? labelWidth : 0;
  const contentStartX = margins.left + systemLeftMargin + reserveLabelColumn;
  const contentRightEdge = pageWidth - margins.right - systemRightMargin;
  const contentWidth = Math.max(MINIMUM_MEASURE_WIDTH, contentRightEdge - contentStartX);
  const densityPressure = estimateDensityPressure(partLayouts);
  const denseRhythmPressure = estimateDenseRhythmPressure(partLayouts);
  const peakDenseMeasurePressure = estimatePeakDenseMeasurePressure(partLayouts);
  const grandStaffPressure = estimateGrandStaffPressure(partLayouts);
  const accidentalPressure = estimateAccidentalPressure(partLayouts);
  const systemTextPressure = estimateSystemTextPressure(partLayouts);
  const systemLaneCollisionPressure = estimateSystemLaneCollisionPressure(partLayouts);
  const targetMinimumMeasureWidth = clampInt(
    MINIMUM_MEASURE_WIDTH +
      densityPressure * 28 +
      denseRhythmPressure * 44 +
      peakDenseMeasurePressure * 72 +
      grandStaffPressure * 56 +
      accidentalPressure * 32,
    MINIMUM_MEASURE_WIDTH,
    320
  );
  const userTargetMeasures = options.layout?.system?.targetMeasuresPerSystem;
  const autoMeasuresPerSystem = Math.max(1, Math.floor(contentWidth / targetMinimumMeasureWidth));
  const measuresPerSystem =
    mode === 'horizontal-continuous'
      ? measureCount
      : clampInt(userTargetMeasures ?? autoMeasuresPerSystem, 1, measureCount);

  const hasAnyPageText =
    Boolean(options.layout?.headerFooter?.leftHeader) ||
    Boolean(options.layout?.headerFooter?.rightHeader) ||
    Boolean(options.layout?.headerFooter?.leftFooter) ||
    Boolean(options.layout?.headerFooter?.rightFooter) ||
    Boolean(score.metadata?.headerLeft) ||
    Boolean(score.metadata?.headerRight) ||
    Boolean(score.metadata?.workTitle) ||
    Boolean(score.metadata?.movementTitle);

  const hasDefaultStaffDistance = Number.isFinite(defaultStaffDistance) && (defaultStaffDistance ?? 0) > 0;
  const baseStaffRowHeight = hasDefaultStaffDistance
    ? clampInt(Math.round((defaultStaffDistance ?? STAFF_ROW_HEIGHT) * 1.15), 60, 160)
    : STAFF_ROW_HEIGHT;
  const staffRowHeight = clampInt(Math.round(baseStaffRowHeight + densityPressure * 14), 60, 170);
  const basePartGap = hasDefaultStaffDistance ? Math.max(18, Math.round(staffRowHeight * 0.24)) : PART_GAP;
  const partGap = clampInt(Math.round(basePartGap + densityPressure * 10), 18, 72);
  const renderScale = clampScale(options.layout?.scale ?? DEFAULT_RENDER_SCALE);
  const explicitSystemGap = options.layout?.system?.minSystemGap;
  const baseSystemGap = explicitSystemGap ?? defaultSystemDistance ?? DEFAULT_SYSTEM_GAP;
  const autoSystemGapExpansion =
    systemLaneCollisionPressure * 34 +
    Math.max(0, systemTextPressure - systemLaneCollisionPressure) * 14 +
    densityPressure * 6;
  // Only apply automatic text-aware expansion when callers did not explicitly
  // pin system gap. Dense direction/harmony/lyric fixtures otherwise suffer
  // cross-system lane collisions (for example category-31/71 text proof points).
  const systemGap =
    explicitSystemGap !== undefined
      ? explicitSystemGap
      : clampInt(
          Math.round(baseSystemGap + autoSystemGapExpansion),
          Math.max(18, Math.round(baseSystemGap)),
          MAX_AUTO_SYSTEM_GAP
        );

  return {
    mode,
    pageWidth,
    pageHeight,
    margins,
    contentStartX,
    contentWidth,
    measuresPerSystem,
    systemGap,
    topSystemOffset: defaultTopSystemDistance ?? 0,
    staffRowHeight,
    partGap,
    justifyLastSystem: options.layout?.system?.justifyLastSystem ?? true,
    showPartNames,
    showPartAbbreviations,
    repeatOnSystemBreak,
    labelWidth,
    showTitle: options.layout?.headerFooter?.showTitle ?? hasAnyPageText,
    showMovementTitle: options.layout?.headerFooter?.showMovementTitle ?? hasAnyPageText,
    showPageNumber: options.layout?.headerFooter?.showPageNumber ?? hasAnyPageText,
    leftHeader: options.layout?.headerFooter?.leftHeader ?? score.metadata?.headerLeft,
    rightHeader: options.layout?.headerFooter?.rightHeader ?? score.metadata?.headerRight,
    leftFooter: options.layout?.headerFooter?.leftFooter,
    rightFooter: options.layout?.headerFooter?.rightFooter,
    renderScale,
    measureNumbers
  };
}

/** Build contiguous measure ranges to be drawn as individual systems. */
function buildSystemRanges(
  measureCount: number,
  config: LayoutPlanConfig,
  forcedBreaks: ForcedMeasureBreaks,
  partLayouts: PartLayout[],
  measureSlots: number[]
): SystemRange[] {
  if (config.mode === 'horizontal-continuous') {
    return [
      {
        index: 0,
        startMeasure: 0,
        endMeasure: measureCount
      }
    ];
  }

  const ranges: SystemRange[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < measureCount) {
    const adaptiveMeasuresPerSystem = resolveAdaptiveMeasuresPerSystem(
      cursor,
      measureCount,
      config.measuresPerSystem,
      partLayouts,
      measureSlots
    );
    const next = resolveSystemEndMeasure(
      cursor,
      measureCount,
      adaptiveMeasuresPerSystem,
      forcedBreaks.systemStarts
    );
    ranges.push({
      index,
      startMeasure: cursor,
      endMeasure: next,
      forcePageBreakBefore: cursor > 0 && forcedBreaks.pageStarts.has(cursor)
    });
    cursor = next;
    index += 1;
  }

  return ranges;
}

/**
 * Adapt measures-per-system for the next system window using local measure density.
 * This prevents dense opening bars from being squeezed into the left edge of a
 * wide system while preserving baseline pagination for ordinary material.
 */
function resolveAdaptiveMeasuresPerSystem(
  startMeasure: number,
  measureCount: number,
  baseMeasuresPerSystem: number,
  partLayouts: PartLayout[],
  measureSlots: number[]
): number {
  const remainingMeasures = Math.max(1, measureCount - startMeasure);
  if (baseMeasuresPerSystem <= 1 || remainingMeasures <= 1) {
    return 1;
  }

  const windowEnd = Math.min(measureCount, startMeasure + baseMeasuresPerSystem);
  let peakDensityHint = 1;
  for (let measureSlot = startMeasure; measureSlot < windowEnd; measureSlot += 1) {
    const absoluteMeasureIndex = measureSlots[measureSlot] ?? measureSlot;
    peakDensityHint = Math.max(peakDensityHint, estimateMeasureDensityHintForIndex(partLayouts, absoluteMeasureIndex));
  }

  let reduction = 0;
  if (peakDensityHint >= LOCAL_EXTREME_DENSE_MEASURE_HINT_THRESHOLD) {
    reduction = 2;
  } else if (peakDensityHint >= LOCAL_DENSE_MEASURE_HINT_THRESHOLD) {
    reduction = 1;
  }
  const hasStructuredSourceWidthHints = hasStructuredSourceWidthHintsInWindow(
    partLayouts,
    measureSlots,
    startMeasure,
    baseMeasuresPerSystem
  );
  const firstColumnCompressionRisk = estimateFirstColumnCompressionRisk(
    partLayouts,
    measureSlots,
    startMeasure,
    baseMeasuresPerSystem
  );
  if (!hasStructuredSourceWidthHints && firstColumnCompressionRisk >= LOCAL_FIRST_COLUMN_COMPRESSION_RISK_THRESHOLD) {
    reduction += LOCAL_FIRST_COLUMN_COMPRESSION_REDUCTION;
  }

  const sparseExpansion =
    peakDensityHint <= LOCAL_SPARSE_MEASURE_HINT_THRESHOLD ? MAX_ADAPTIVE_MEASURE_EXPANSION : 0;
  const upperBound = Math.min(remainingMeasures, baseMeasuresPerSystem + sparseExpansion);
  const minimumMeasuresPerSystem =
    firstColumnCompressionRisk >= LOCAL_FIRST_COLUMN_COMPRESSION_RISK_THRESHOLD ? 1 : MIN_ADAPTIVE_MEASURES_PER_SYSTEM;
  const lowerBound = Math.min(minimumMeasuresPerSystem, upperBound);
  const adapted = baseMeasuresPerSystem - reduction + sparseExpansion;
  return clampInt(adapted, lowerBound, upperBound);
}

/** True when a local window has at least two authored source-width columns. */
function hasStructuredSourceWidthHintsInWindow(
  partLayouts: PartLayout[],
  measureSlots: number[],
  startMeasure: number,
  baseMeasuresPerSystem: number
): boolean {
  const windowEnd = Math.min(measureSlots.length, startMeasure + baseMeasuresPerSystem);
  let hintedColumns = 0;
  for (let measureSlot = startMeasure; measureSlot < windowEnd; measureSlot += 1) {
    const absoluteMeasureIndex = measureSlots[measureSlot] ?? measureSlot;
    let hasHint = false;
    for (const layout of partLayouts) {
      const hint = layout.part.measures[absoluteMeasureIndex]?.sourceWidthTenths;
      if (Number.isFinite(hint) && (hint ?? 0) > 0) {
        hasHint = true;
        break;
      }
    }
    if (hasHint) {
      hintedColumns += 1;
    }
  }
  return hintedColumns >= 2;
}

/**
 * Estimate first-column compression risk in one local system window from source
 * width hints. Narrow first columns relative to later measures need fewer
 * measures-per-system to avoid severe opening-bar squeeze.
 */
function estimateFirstColumnCompressionRisk(
  partLayouts: PartLayout[],
  measureSlots: number[],
  startMeasure: number,
  baseMeasuresPerSystem: number
): number {
  const absoluteStartMeasure = measureSlots[startMeasure] ?? startMeasure;
  const firstColumnHints = partLayouts
    .map((layout) => layout.part.measures[absoluteStartMeasure]?.sourceWidthTenths)
    .filter((hint): hint is number => Number.isFinite(hint) && (hint ?? 0) > 0);
  if (firstColumnHints.length === 0) {
    return 0;
  }

  const firstHint = medianNumber(firstColumnHints);
  const laterHints: number[] = [];
  const windowEnd = Math.min(measureSlots.length, startMeasure + baseMeasuresPerSystem);
  for (let measureSlot = startMeasure + 1; measureSlot < windowEnd; measureSlot += 1) {
    const absoluteMeasureIndex = measureSlots[measureSlot] ?? measureSlot;
    for (const layout of partLayouts) {
      const hint = layout.part.measures[absoluteMeasureIndex]?.sourceWidthTenths;
      if (Number.isFinite(hint) && (hint ?? 0) > 0) {
        laterHints.push(hint ?? 0);
      }
    }
  }

  if (laterHints.length === 0) {
    return 0;
  }

  const medianLaterHint = medianNumber(laterHints);
  if (!Number.isFinite(medianLaterHint) || medianLaterHint <= 0) {
    return 0;
  }

  const ratio = firstHint / medianLaterHint;
  return clamp(1 - ratio, 0, 1);
}

/** Resolve one system end, clamping to forced new-system/new-page starts. */
function resolveSystemEndMeasure(
  startMeasure: number,
  measureCount: number,
  measuresPerSystem: number,
  forcedSystemStarts: Set<number>
): number {
  const tentativeEnd = Math.min(measureCount, startMeasure + measuresPerSystem);
  let forcedEnd = tentativeEnd;

  for (const forcedStart of forcedSystemStarts) {
    if (forcedStart > startMeasure && forcedStart <= forcedEnd) {
      forcedEnd = Math.min(forcedEnd, forcedStart);
    }
  }

  if (forcedEnd <= startMeasure) {
    return Math.min(measureCount, startMeasure + 1);
  }

  return forcedEnd;
}

/** Estimate one system height from part/staff envelopes. */
function estimateSystemHeight(partLayouts: PartLayout[], config: LayoutPlanConfig): number {
  if (partLayouts.length === 0) {
    return 0;
  }

  let height = 0;
  for (let index = 0; index < partLayouts.length; index += 1) {
    const layout = partLayouts[index];
    if (!layout) {
      continue;
    }
    height += layout.staffCount * config.staffRowHeight;
    height += Math.max(0, layout.staffCount - 1) * layout.intraStaffGap;
    const nextLayout = partLayouts[index + 1];
    if (nextLayout) {
      height += resolveInterPartGap(layout, nextLayout, config);
    }
  }

  return height;
}

/** Pack systems into pages according to available page vertical space. */
function buildPagePlans(
  score: Score,
  systemRanges: SystemRange[],
  systemHeight: number,
  config: LayoutPlanConfig
): PagePlan[] {
  const pages: PagePlan[] = [];
  let currentPageNumber = 1;
  let currentPage: PagePlan = { pageNumber: currentPageNumber, systems: [] };
  let currentY =
    config.margins.top + estimateHeaderHeight(score, config, currentPageNumber) + config.topSystemOffset;
  let usableBottom = config.pageHeight - config.margins.bottom - estimateFooterHeight(config);

  for (const range of systemRanges) {
    if (range.forcePageBreakBefore && currentPage.systems.length > 0) {
      pages.push(currentPage);
      currentPageNumber += 1;
      currentPage = { pageNumber: currentPageNumber, systems: [] };
      currentY =
        config.margins.top + estimateHeaderHeight(score, config, currentPageNumber) + config.topSystemOffset;
      usableBottom = config.pageHeight - config.margins.bottom - estimateFooterHeight(config);
    }

    const requiredBottom = currentY + systemHeight;
    const hasExistingSystems = currentPage.systems.length > 0;
    if (requiredBottom > usableBottom && hasExistingSystems) {
      pages.push(currentPage);
      currentPageNumber += 1;
      currentPage = { pageNumber: currentPageNumber, systems: [] };
      currentY =
        config.margins.top + estimateHeaderHeight(score, config, currentPageNumber) + config.topSystemOffset;
      usableBottom = config.pageHeight - config.margins.bottom - estimateFooterHeight(config);
    }

    currentPage.systems.push({
      ...range,
      topY: currentY
    });

    currentY += systemHeight + config.systemGap;
  }

  if (currentPage.systems.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/** Resolve actual renderer width/height needed for one page plan. */
function resolvePageRenderEnvelope(
  score: Score,
  pagePlan: PagePlan,
  maxContentRight: number,
  systemHeight: number,
  config: LayoutPlanConfig
): PageRenderEnvelope {
  const headerHeight = estimateHeaderHeight(score, config, pagePlan.pageNumber);
  const footerHeight = estimateFooterHeight(config);
  const systemTop =
    pagePlan.systems.length > 0
      ? pagePlan.systems[0]!.topY
      : config.margins.top + headerHeight + config.topSystemOffset;
  const systemBottom =
    pagePlan.systems.length > 0
      ? pagePlan.systems[pagePlan.systems.length - 1]!.topY + systemHeight
      : config.margins.top + headerHeight;
  const viewportTop = config.margins.top + headerHeight + config.topSystemOffset;
  const viewportBottom = config.pageHeight - config.margins.bottom - footerHeight;
  const viewportLeft = config.contentStartX;
  const viewportRight = config.contentStartX + config.contentWidth;
  const contentBounds = {
    left: config.contentStartX,
    right: maxContentRight,
    top: systemTop,
    bottom: systemBottom
  };
  const viewportBounds = {
    left: viewportLeft,
    right: viewportRight,
    top: viewportTop,
    bottom: viewportBottom
  };

  const minimumHeight = Math.ceil(systemBottom + footerHeight + config.margins.bottom);
  const height = Math.max(config.pageHeight, minimumHeight);

  if (config.mode === 'horizontal-continuous') {
    return {
      width: Math.max(config.pageWidth, Math.ceil(maxContentRight + config.margins.right)),
      height,
      contentBounds,
      viewportBounds
    };
  }

  return {
    width: config.pageWidth,
    height,
    contentBounds,
    viewportBounds
  };
}

/** Estimate top header block height from enabled title/header fields. */
function estimateHeaderHeight(score: Score, config: LayoutPlanConfig, pageNumber: number): number {
  let height = 0;
  const headerLineCount = Math.max(countTextLines(config.leftHeader), countTextLines(config.rightHeader));
  const hasTitle = pageNumber === 1 && config.showTitle && Boolean(score.metadata?.workTitle);
  const hasMovement = pageNumber === 1 && config.showMovementTitle && Boolean(score.metadata?.movementTitle);

  if (headerLineCount > 0) {
    height += headerLineCount * 12 + 4;
  }
  if (hasTitle) {
    height += 28;
  }
  if (hasMovement) {
    height += 18;
  }

  return height > 0 ? height + 8 : 0;
}

/** Estimate footer block height from footer text and page-number settings. */
function estimateFooterHeight(config: LayoutPlanConfig): number {
  const hasFooterText =
    Boolean(config.leftFooter) || Boolean(config.rightFooter) || config.showPageNumber;
  return hasFooterText ? 20 : 0;
}

/**
 * Build per-measure column widths for one system.
 * In paginated mode we fit columns to content width; in continuous mode we
 * preserve a long horizontal layout with baseline widths.
 */
function buildMeasureColumnLayoutForSystem(
  score: Score,
  partLayouts: PartLayout[],
  system: SystemRange,
  measureSlots: number[],
  contentStartX: number,
  availableWidth: number,
  fitToWidth: boolean,
  justifySystem: boolean,
  diagnostics: Diagnostic[]
): MeasureColumnLayout {
  const measureCount = Math.max(1, system.endMeasure - system.startMeasure);
  const sourceWidthHints = resolveSystemMeasureWidthHints(partLayouts, system, measureSlots);
  const densityHints = resolveSystemMeasureDensityHints(partLayouts, system, measureSlots);
  const minimumWidths = resolveMinimumColumnWidths(densityHints, fitToWidth);
  const sourceHintCount = sourceWidthHints.filter(
    (hint): hint is number => Number.isFinite(hint) && (hint ?? 0) > 0
  ).length;
  const hasStructuredSourceWidthHints = sourceHintCount >= 2;
  const columnWidths = initializeSystemColumnWidths(
    measureCount,
    availableWidth,
    fitToWidth,
    sourceWidthHints,
    densityHints,
    minimumWidths
  );
  const defaultFirstWidth = fitToWidth
    ? Math.max(minimumWidths[0] ?? MINIMUM_FITTED_MEASURE_WIDTH, Math.floor(availableWidth / measureCount))
    : MINIMUM_MEASURE_WIDTH;
  // When authored source widths are available, preserve their first-column
  // signal instead of forcing an even-split baseline. This keeps explicit
  // narrow/wide measure intent intact while collision guards still apply later.
  const firstBaseWidth = hasStructuredSourceWidthHints
    ? Math.max(minimumWidths[0] ?? MINIMUM_FITTED_MEASURE_WIDTH, columnWidths[0] ?? defaultFirstWidth)
    : Math.max(defaultFirstWidth, columnWidths[0] ?? defaultFirstWidth);
  let firstExtra = estimateSystemStartExtraWidth(score, partLayouts, system.startMeasure, firstBaseWidth, diagnostics);
  const firstDensityHint = Number.isFinite(densityHints[0]) ? Math.max(1, densityHints[0] ?? 1) : 1;
  const firstDensityExtra = Math.round(
    Math.min(
      FIRST_COLUMN_DENSITY_EXTRA_WIDTH_CAP,
      Math.max(0, firstDensityHint - 1) * FIRST_COLUMN_DENSITY_EXTRA_WIDTH_FACTOR
    )
  );
  firstExtra += firstDensityExtra;
  const strongSourceWidthBias = hasStrongSourceWidthBias(sourceWidthHints);
  // When source width hints strongly prefer wider later measures, keep first-
  // column compensation bounded (instead of disabling it) so authored
  // proportional widths still dominate without collapsing opening readability.
  if (strongSourceWidthBias) {
    firstExtra = Math.ceil(firstExtra * FIRST_COLUMN_STRONG_BIAS_EXTRA_DAMPING);
  }
  const firstReadabilityFloor = resolveFirstColumnReadabilityFloor(
    columnWidths,
    densityHints,
    availableWidth,
    strongSourceWidthBias,
    hasStructuredSourceWidthHints
  );
  const firstTargetWidth = Math.max(
    firstBaseWidth + firstExtra,
    firstReadabilityFloor ?? 0
  );
  columnWidths[0] = firstTargetWidth;
  // Preserve explicit system-start reservation (clef/key/time modifiers) when
  // we later shrink non-final systems to fit. Without this floor, dense or
  // multi-digit signatures can regress into first-column note collisions.
  minimumWidths[0] = Math.max(
    minimumWidths[0] ?? MINIMUM_FITTED_MEASURE_WIDTH,
    firstTargetWidth
  );

  if (fitToWidth) {
    if (justifySystem) {
      const targetWidth = resolveSparseSystemTargetWidth(
        columnWidths,
        densityHints,
        availableWidth,
        minimumWidths,
        hasStructuredSourceWidthHints
      );
      const evenSplitWidth = Math.max(MINIMUM_FITTED_MEASURE_WIDTH, Math.floor(targetWidth / measureCount));
      const firstJustificationFloor = clampInt(
        minimumWidths[0] ?? MINIMUM_FITTED_MEASURE_WIDTH,
        MINIMUM_FITTED_MEASURE_WIDTH,
        evenSplitWidth + 64
      );
      const justificationMinimumWidths = columnWidths.map((_, columnIndex) =>
        columnIndex === 0
          ? firstJustificationFloor
          : MINIMUM_FITTED_MEASURE_WIDTH
      );
      expandColumnWidthsToFit(columnWidths, targetWidth, justificationMinimumWidths);
    } else {
      shrinkColumnWidthsToFit(columnWidths, availableWidth, minimumWidths);
    }
  }

  const columnX: number[] = [];
  let cursor = contentStartX;
  for (const width of columnWidths) {
    columnX.push(cursor);
    cursor += width;
  }

  return {
    columnX,
    columnWidths,
    totalWidth: cursor - contentStartX
  };
}

/**
 * Compute a lower bound for the first system column using relative-width and
 * density signals. This protects opening measures from source-hint collapse in
 * complex systems while still preserving authored proportion intent.
 */
function resolveFirstColumnReadabilityFloor(
  columnWidths: number[],
  densityHints: number[],
  availableWidth: number,
  strongSourceWidthBias: boolean,
  hasStructuredSourceWidthHints: boolean
): number | undefined {
  if (columnWidths.length < 2) {
    return undefined;
  }

  const laterWidths = columnWidths
    .slice(1)
    .filter((width): width is number => Number.isFinite(width) && (width ?? 0) > 0);
  if (laterWidths.length === 0) {
    return undefined;
  }

  const medianLaterWidth = medianNumber(laterWidths);
  if (!Number.isFinite(medianLaterWidth) || medianLaterWidth <= 0) {
    return undefined;
  }

  const firstDensity = Number.isFinite(densityHints[0]) ? Math.max(1, densityHints[0] ?? 1) : 1;
  const medianLaterDensity = medianNumber(
    densityHints
      .slice(1)
      .filter((hint): hint is number => Number.isFinite(hint) && (hint ?? 0) > 0)
  );
  const baseRatio = hasStructuredSourceWidthHints
    ? Math.min(FIRST_COLUMN_FLOOR_RATIO, 0.5)
    : strongSourceWidthBias
      ? FIRST_COLUMN_STRONG_BIAS_FLOOR_RATIO
      : FIRST_COLUMN_FLOOR_RATIO;
  const ratioCap = strongSourceWidthBias ? FIRST_COLUMN_STRONG_BIAS_FLOOR_RATIO_CAP : FIRST_COLUMN_FLOOR_RATIO_CAP;
  const densityBoost = Math.min(
    FIRST_COLUMN_DENSITY_FLOOR_BOOST_CAP,
    Math.max(0, firstDensity - 1) * FIRST_COLUMN_DENSITY_FLOOR_BOOST
  );
  const floorRatio = clamp(baseRatio + densityBoost, baseRatio, ratioCap);
  let uncappedFloorWidth = Math.round(medianLaterWidth * floorRatio);

  // When first-measure notation density is materially higher than the rest of
  // the system, enforce an additional ratio floor so opening bars are not
  // squeezed by structured source-width hints.
  if (Number.isFinite(medianLaterDensity) && (medianLaterDensity ?? 0) > 0) {
    const relativeDensity = firstDensity / (medianLaterDensity ?? 1);
    if (relativeDensity > 1) {
      const densityAlignedRatio = clamp(
        FIRST_COLUMN_DENSITY_ALIGNED_RATIO_BASE +
          (relativeDensity - 1) * FIRST_COLUMN_DENSITY_ALIGNED_RATIO_BOOST,
        FIRST_COLUMN_DENSITY_ALIGNED_RATIO_BASE,
        FIRST_COLUMN_DENSITY_ALIGNED_RATIO_CAP
      );
      uncappedFloorWidth = Math.max(uncappedFloorWidth, Math.round(medianLaterWidth * densityAlignedRatio));
    }
  }
  if (columnWidths.length <= 2 && !hasStructuredSourceWidthHints) {
    const denseTwoMeasureFloor = Math.round(medianLaterWidth * FIRST_COLUMN_TWO_MEASURE_DENSE_RATIO_FLOOR);
    uncappedFloorWidth = Math.max(uncappedFloorWidth, denseTwoMeasureFloor);
  }

  // Keep the floor bounded so one oversized opening measure cannot starve
  // later columns in systems that must tightly fit within page width.
  const evenSplitWidth = Math.floor(availableWidth / columnWidths.length);
  const maxFloorWidth = Math.max(
    MINIMUM_FITTED_MEASURE_WIDTH,
    Math.floor(availableWidth * FIRST_COLUMN_FLOOR_MAX_AVAILABLE_RATIO),
    evenSplitWidth + 72
  );
  return clampInt(uncappedFloorWidth, MINIMUM_FITTED_MEASURE_WIDTH, maxFloorWidth);
}

/** True when system width hints strongly bias later columns over the first one. */
function hasStrongSourceWidthBias(sourceWidthHints: Array<number | undefined>): boolean {
  const first = sourceWidthHints[0];
  if (!Number.isFinite(first) || (first ?? 0) <= 0) {
    return false;
  }

  const remaining = sourceWidthHints
    .slice(1)
    .filter((hint): hint is number => Number.isFinite(hint) && (hint ?? 0) > 0);
  if (remaining.length === 0) {
    return false;
  }

  return medianNumber(remaining) >= (first ?? 0) * 1.4;
}

/**
 * Resolve one source-width hint per system column from MusicXML `measure@width`.
 * We use median-of-parts to avoid one-part outliers dominating column allocation.
 */
function resolveSystemMeasureWidthHints(
  partLayouts: PartLayout[],
  system: SystemRange,
  measureSlots: number[]
): Array<number | undefined> {
  const widthHints: Array<number | undefined> = [];

  for (let measureSlot = system.startMeasure; measureSlot < system.endMeasure; measureSlot += 1) {
    const absoluteMeasureIndex = measureSlots[measureSlot] ?? measureSlot;
    const perPartWidths: number[] = [];
    for (const layout of partLayouts) {
      const widthTenths = layout.part.measures[absoluteMeasureIndex]?.sourceWidthTenths;
      if (Number.isFinite(widthTenths) && (widthTenths ?? 0) > 0) {
        perPartWidths.push(widthTenths ?? 0);
      }
    }

    if (perPartWidths.length === 0) {
      widthHints.push(undefined);
      continue;
    }

    widthHints.push(medianNumber(perPartWidths));
  }

  return widthHints;
}

/**
 * Estimate one density hint per system column from rendered-event complexity.
 * Dense rhythm columns (short values, tuplets, many tickables on a staff) get
 * higher hints so column allocation preserves readability.
 */
function resolveSystemMeasureDensityHints(
  partLayouts: PartLayout[],
  system: SystemRange,
  measureSlots: number[]
): number[] {
  const hints: number[] = [];

  for (let measureSlot = system.startMeasure; measureSlot < system.endMeasure; measureSlot += 1) {
    const absoluteMeasureIndex = measureSlots[measureSlot] ?? measureSlot;
    hints.push(estimateMeasureDensityHintForIndex(partLayouts, absoluteMeasureIndex));
  }

  return hints;
}

/** Estimate one density hint for a single measure index across all parts/staves. */
function estimateMeasureDensityHintForIndex(partLayouts: PartLayout[], measureIndex: number): number {
  let maxTickablesPerStaff = 1;
  let denseRhythmCount = 0;
  let chordCount = 0;
  let accidentalCount = 0;
  let tupletCount = 0;

  for (const layout of partLayouts) {
    const measure = layout.part.measures[measureIndex];
    if (!measure) {
      continue;
    }

    const staffTickables = new Map<number, number>();
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (event.kind !== 'note' && event.kind !== 'rest') {
          continue;
        }

        const staffNumber = event.staff ?? 1;
        staffTickables.set(staffNumber, (staffTickables.get(staffNumber) ?? 0) + 1);

        if (event.kind !== 'note') {
          continue;
        }

        if (isDenseNoteType(event.noteType)) {
          denseRhythmCount += 1;
        }
        if (event.notes.length > 1) {
          chordCount += 1;
        }
        if (event.tuplets && event.tuplets.length > 0) {
          tupletCount += 1;
        }
        for (const note of event.notes) {
          if (note.accidental?.value || (Number.isFinite(note.pitch?.alter) && Math.abs(note.pitch?.alter ?? 0) > 0)) {
            accidentalCount += 1;
          }
        }
      }
    }

    for (const tickableCount of staffTickables.values()) {
      maxTickablesPerStaff = Math.max(maxTickablesPerStaff, tickableCount);
    }
  }

  const tickableBoost = Math.max(0, maxTickablesPerStaff - 1) * 0.24;
  const denseRhythmBoost = denseRhythmCount * 0.08;
  const chordBoost = chordCount * 0.04;
  const accidentalBoost = accidentalCount * 0.02;
  const tupletBoost = tupletCount * 0.05;
  return 1 + Math.min(2.2, tickableBoost + denseRhythmBoost + chordBoost + accidentalBoost + tupletBoost);
}

/** Resolve per-column minimum widths from density hints for shrink-safe layouts. */
function resolveMinimumColumnWidths(densityHints: number[], fitToWidth: boolean): number[] {
  if (!fitToWidth) {
    return densityHints.map(() => MINIMUM_MEASURE_WIDTH);
  }

  return densityHints.map((hint) => {
    const normalizedHint = Number.isFinite(hint) ? hint : 1;
    const boost = Math.max(0, normalizedHint - 1) * MAX_DENSITY_WIDTH_BOOST;
    return clampInt(MINIMUM_FITTED_MEASURE_WIDTH + boost, MINIMUM_FITTED_MEASURE_WIDTH, MAX_MINIMUM_FITTED_MEASURE_WIDTH);
  });
}

/** True when note type is short enough to require denser horizontal packing safeguards. */
function isDenseNoteType(noteType: string | undefined): boolean {
  if (!noteType) {
    return false;
  }
  return DENSE_NOTE_TYPE_SET.has(noteType.toLowerCase());
}

/**
 * Build initial system column widths.
 * When source width hints exist, we preserve their relative proportions and then
 * normalize to available width; otherwise we fall back to uniform widths.
 */
function initializeSystemColumnWidths(
  measureCount: number,
  availableWidth: number,
  fitToWidth: boolean,
  sourceWidthHints: Array<number | undefined>,
  densityHints: number[],
  minimumWidths: number[]
): number[] {
  if (!fitToWidth) {
    return Array.from({ length: measureCount }, () => MINIMUM_MEASURE_WIDTH);
  }

  const uniformWidth = Math.max(MINIMUM_FITTED_MEASURE_WIDTH, Math.floor(availableWidth / measureCount));
  const normalizedDensityHints = densityHints.map((hint) => (Number.isFinite(hint) && hint > 0 ? hint : 1));
  const validHints = sourceWidthHints.filter(
    (hint): hint is number => typeof hint === 'number' && Number.isFinite(hint) && hint > 0
  );
  if (validHints.length < 2) {
    return normalizedDensityHints.map((densityHint, index) =>
      Math.max(
        minimumWidths[index] ?? MINIMUM_FITTED_MEASURE_WIDTH,
        Math.round(uniformWidth * Math.max(1, densityHint * 0.9))
      )
    );
  }

  const fallbackHint = medianNumber(validHints);
  const normalizedHints = sourceWidthHints.map((hint) =>
    Number.isFinite(hint) && (hint ?? 0) > 0 ? (hint ?? fallbackHint) : fallbackHint
  );
  // Preserve authored source widths as the primary signal, but blend in a
  // bounded density factor so extremely dense columns are not starved when
  // source width hints are overly optimistic for modern engraving readability.
  const weightedHints = normalizedHints.map((hint, index) => {
    const densityHint = normalizedDensityHints[index] ?? 1;
    const densityBoost = Math.min(0.45, Math.max(0, densityHint - 1) * 0.2);
    return hint * (1 + densityBoost);
  });
  const hintSum = weightedHints.reduce((sum, hint) => sum + hint, 0);
  if (!Number.isFinite(hintSum) || hintSum <= 0) {
    return normalizedDensityHints.map((densityHint, index) =>
      Math.max(
        minimumWidths[index] ?? MINIMUM_FITTED_MEASURE_WIDTH,
        Math.round(uniformWidth * Math.max(1, densityHint * 0.9))
      )
    );
  }

  return weightedHints.map((hint, index) =>
    Math.max(minimumWidths[index] ?? MINIMUM_FITTED_MEASURE_WIDTH, Math.round((availableWidth * hint) / hintSum))
  );
}

/** Estimate system-start modifier overhead for clef/key/time signature reservation. */
function estimateSystemStartExtraWidth(
  score: Score,
  layouts: PartLayout[],
  startMeasure: number,
  baseMeasureWidth: number,
  diagnostics: Diagnostic[]
): number {
  const plainShift = noteStartShiftForStave(baseMeasureWidth, undefined, undefined, undefined);
  let maxExtraShift = 0;

  for (const layout of layouts) {
    const measure = layout.part.measures[startMeasure];
    if (!measure) {
      continue;
    }

    for (let staffNumber = 1; staffNumber <= layout.staffCount; staffNumber += 1) {
      const clefInfo = resolveClefForStaff(measure, staffNumber);
      const clef = mapClef(clefInfo, diagnostics);
      const key = staffNumber === 1 ? mapKeySignature(measure.effectiveAttributes.keySignature) : undefined;
      const time = staffNumber === 1 ? mapTimeSignature(measure.effectiveAttributes.timeSignature) : undefined;
      const shiftedStart = noteStartShiftForStave(baseMeasureWidth, clef, key, time);
      const extraShift = Math.max(0, shiftedStart - plainShift);
      maxExtraShift = Math.max(maxExtraShift, extraShift);
    }
  }

  if (!Number.isFinite(maxExtraShift)) {
    return 0;
  }

  // Raw shift-to-extra mapping tends to over-expand opening measures in dense
  // multi-part systems. We damp, ignore a small baseline shift, and cap relative
  // to the measure width so this remains readable across both simple and complex
  // fixtures without hard-coding case-specific behavior.
  const rawExtra = Math.ceil(maxExtraShift);
  const dampedExtra = Math.ceil(rawExtra * FIRST_COLUMN_EXTRA_WIDTH_DAMPING);
  const ignoredBaseline = Math.floor(baseMeasureWidth * FIRST_COLUMN_EXTRA_IGNORE_RATIO);
  const cap = Math.floor(baseMeasureWidth * FIRST_COLUMN_EXTRA_WIDTH_CAP_RATIO);
  const adjustedExtra = Math.max(0, dampedExtra - ignoredBaseline);

  return Math.min(adjustedExtra, Math.max(0, cap));
}

/**
 * Resolve a target justified system width for sparse content.
 * Dense windows still consume full available width; sparse windows compact
 * proportionally to avoid over-stretched notation on low-occupancy systems.
 */
function resolveSparseSystemTargetWidth(
  widths: number[],
  densityHints: number[],
  availableWidth: number,
  minimumWidths: number[],
  hasStructuredSourceWidthHints: boolean
): number {
  if (hasStructuredSourceWidthHints) {
    return availableWidth;
  }
  const minimumRequiredWidth = minimumWidths.reduce((sum, width) => sum + width, 0);
  if (minimumRequiredWidth >= availableWidth || widths.length === 0) {
    return availableWidth;
  }

  const normalizedHints = densityHints
    .filter((hint): hint is number => Number.isFinite(hint) && (hint ?? 0) > 0);
  const meanDensity =
    normalizedHints.length > 0
      ? normalizedHints.reduce((sum, hint) => sum + hint, 0) / normalizedHints.length
      : 1;
  const peakDensity = normalizedHints.length > 0 ? Math.max(...normalizedHints) : 1;
  if (peakDensity >= SPARSE_SYSTEM_DENSITY_THRESHOLD) {
    return availableWidth;
  }

  const sparseDensitySignal = clamp(
    (SPARSE_SYSTEM_DENSITY_THRESHOLD - meanDensity) /
      Math.max(0.01, SPARSE_SYSTEM_DENSITY_THRESHOLD - VERY_SPARSE_SYSTEM_DENSITY_THRESHOLD),
    0,
    1
  );
  const peakSignal = clamp((SPARSE_SYSTEM_DENSITY_THRESHOLD - peakDensity) / 0.6, 0, 1);
  const columnFactor = widths.length <= 2 ? 1 : widths.length <= 3 ? 0.9 : widths.length <= 4 ? 0.75 : 0.6;
  const reductionRatio = clamp(
    (sparseDensitySignal * 0.7 + peakSignal * 0.3) * MAX_SPARSE_SYSTEM_WIDTH_REDUCTION_RATIO * columnFactor,
    0,
    MAX_SPARSE_SYSTEM_WIDTH_REDUCTION_RATIO
  );

  const unclampedTarget = Math.round(availableWidth * (1 - reductionRatio));
  const minimumTarget = Math.max(
    minimumRequiredWidth,
    Math.round(availableWidth * MIN_SPARSE_SYSTEM_TARGET_WIDTH_RATIO)
  );
  return clampInt(unclampedTarget, minimumTarget, availableWidth);
}

/**
 * Expand measure widths to consume available system width.
 * This improves justification consistency for non-final systems.
 */
function expandColumnWidthsToFit(widths: number[], targetWidth: number, minimumWidths?: number[]): void {
  if (widths.length === 0) {
    return;
  }

  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total >= targetWidth) {
    shrinkColumnWidthsToFit(widths, targetWidth, minimumWidths);
    return;
  }

  let remaining = targetWidth - total;
  let cursor = 0;
  while (remaining > 0) {
    widths[cursor % widths.length] = (widths[cursor % widths.length] ?? 0) + 1;
    remaining -= 1;
    cursor += 1;
  }
}

/** Shrink measure widths when system content exceeds available width. */
function shrinkColumnWidthsToFit(widths: number[], targetWidth: number, minimumWidths?: number[]): void {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= targetWidth) {
    return;
  }

  let overflow = total - targetWidth;
  let cursor = widths.length - 1;
  while (overflow > 0) {
    const width = widths[cursor];
    const minimumWidth = minimumWidths?.[cursor] ?? MINIMUM_FITTED_MEASURE_WIDTH;
    if (width !== undefined && width > minimumWidth) {
      widths[cursor] = width - 1;
      overflow -= 1;
    }

    cursor -= 1;
    if (cursor < 0) {
      cursor = widths.length - 1;
      const cannotShrinkFurther = widths.every((value, index) => value <= (minimumWidths?.[index] ?? MINIMUM_FITTED_MEASURE_WIDTH));
      if (cannotShrinkFurther) {
        break;
      }
    }
  }
}

/** Compute a numeric median for stable width-hint aggregation. */
function medianNumber(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) {
    return 0;
  }

  if (sorted.length % 2 === 1) {
    return middleValue;
  }

  const previous = sorted[middle - 1];
  if (previous === undefined) {
    return middleValue;
  }

  return (previous + middleValue) / 2;
}

/**
 * Compute how far note entry begins from stave `x` for a given modifier set.
 * This helper intentionally does not draw; it only inspects deterministic
 * VexFlow stave spacing internals.
 */
function noteStartShiftForStave(
  width: number,
  clef: string | undefined,
  key: string | undefined,
  time: string | undefined
): number {
  const probe = new Stave(0, 0, width);
  if (clef) {
    probe.addClef(clef);
  }
  if (key) {
    probe.addKeySignature(key);
  }
  if (time) {
    probe.addTimeSignature(time);
  }

  return probe.getNoteStartX() - probe.getX();
}

/** Estimate label column width from part names/abbreviations when no explicit width is supplied. */
function estimateLabelWidth(
  definitions: PartDefinition[],
  showPartNames: boolean,
  showPartAbbreviations: boolean
): number {
  const candidates: string[] = [];
  for (const definition of definitions) {
    if (showPartNames && definition.name) {
      candidates.push(definition.name);
    }
    if (showPartAbbreviations && definition.abbreviation) {
      candidates.push(definition.abbreviation);
    }
  }

  const widest = candidates.reduce((max, text) => Math.max(max, estimateTextWidth(text, 12)), 0);
  if (widest <= 0) {
    return DEFAULT_LABEL_WIDTH;
  }

  return Math.ceil(widest + 12);
}

/**
 * Estimate per-part notation complexity for adaptive vertical spacing.
 * Dense rhythmic content and frequent curved relations need more breathing room.
 */
function estimatePartComplexity(part: Part): number {
  let noteCount = 0;
  let beamCount = 0;
  let curvedRelationCount = 0;
  let chordCount = 0;
  let denseRhythmCount = 0;

  for (const measure of part.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (event.kind !== 'note') {
          continue;
        }

        noteCount += 1;
        if (event.beams && event.beams.length > 0) {
          beamCount += 1;
        }
        if (event.notes.length > 1) {
          chordCount += 1;
        }
        if (isDenseNoteType(event.noteType)) {
          denseRhythmCount += 1;
        }
        if (event.notes.some((note) => (note.slurs?.length ?? 0) > 0 || (note.ties?.length ?? 0) > 0)) {
          curvedRelationCount += 1;
        }
      }
    }
  }

  if (noteCount === 0) {
    return 0;
  }

  const beamRatio = beamCount / noteCount;
  const curvedRatio = curvedRelationCount / noteCount;
  const chordRatio = chordCount / noteCount;
  const denseRatio = denseRhythmCount / noteCount;

  return clamp(0.35 * beamRatio + 0.3 * curvedRatio + 0.2 * chordRatio + 0.15 * denseRatio, 0, 1);
}

/**
 * Estimate additional spacing between adjacent staves inside one part.
 * The intent is to reduce treble/bass collisions in grand-staff writing where
 * both staves frequently approach the center register with ties/slurs.
 * Text-heavy parts also get extra breathing room so direction/dynamics lanes
 * do not collide with lyric lanes on neighboring staves.
 */
function estimateIntraStaffGap(
  part: Part,
  staffCount: number,
  complexity: number,
  textAnnotationPressure: number
): number {
  if (staffCount < 2) {
    return 0;
  }

  let noteCount = 0;
  let centerRegisterRisk = 0;
  let curvedCenterRisk = 0;
  let denseRhythmRisk = 0;
  let peakMeasureRisk = 0;
  let crossStaffProximityRisk = 0;
  let crossStaffComparisons = 0;

  for (const measure of part.measures) {
    let measureNoteCount = 0;
    let measureCenterRisk = 0;
    let measureCurvedRisk = 0;
    const measureCrossStaffBuckets = new Map<
      number,
      { upper: Array<{ octave: number; curved: boolean }>; lower: Array<{ octave: number; curved: boolean }> }
    >();
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (event.kind !== 'note') {
          continue;
        }

        const staffNumber = event.staff ?? 1;
        const hasCurvedRelation = event.notes.some((note) => (note.slurs?.length ?? 0) > 0 || (note.ties?.length ?? 0) > 0);
        if (isDenseNoteType(event.noteType)) {
          denseRhythmRisk += 1;
        }
        if (staffNumber === 1 || staffNumber === 2) {
          const pitchedNotes = event.notes.filter(
            (note): note is typeof note & { pitch: { octave: number } } => Boolean(note.pitch)
          );
          if (pitchedNotes.length > 0) {
            const averageOctave =
              pitchedNotes.reduce((sum, note) => sum + note.pitch.octave, 0) / pitchedNotes.length;
            const bucket = measureCrossStaffBuckets.get(event.offsetTicks) ?? { upper: [], lower: [] };
            if (staffNumber === 1) {
              bucket.upper.push({ octave: averageOctave, curved: hasCurvedRelation });
            } else {
              bucket.lower.push({ octave: averageOctave, curved: hasCurvedRelation });
            }
            measureCrossStaffBuckets.set(event.offsetTicks, bucket);
          }
        }

        for (const note of event.notes) {
          if (!note.pitch) {
            continue;
          }

          noteCount += 1;
          measureNoteCount += 1;
          const octave = note.pitch.octave;
          const nearCenterFromUpper = staffNumber === 1 && octave <= 4;
          const nearCenterFromLower = staffNumber === 2 && octave >= 3;
          if (!nearCenterFromUpper && !nearCenterFromLower) {
            continue;
          }

          centerRegisterRisk += 1;
          measureCenterRisk += 1;
          if (hasCurvedRelation) {
            curvedCenterRisk += 1;
            measureCurvedRisk += 1;
          }
        }
      }
    }

    let measureCrossStaffRisk = 0;
    let measureCrossStaffComparisons = 0;
    for (const bucket of measureCrossStaffBuckets.values()) {
      if (bucket.upper.length === 0 || bucket.lower.length === 0) {
        continue;
      }

      for (const upper of bucket.upper) {
        for (const lower of bucket.lower) {
          const octaveDistance = Math.abs(upper.octave - lower.octave);
          let proximity = 0;
          if (octaveDistance <= 0.75) {
            proximity = 1;
          } else if (octaveDistance <= 1.5) {
            proximity = 0.62;
          } else if (octaveDistance <= 2.25) {
            proximity = 0.28;
          }
          if (proximity > 0 && (upper.curved || lower.curved)) {
            proximity = Math.min(1, proximity + 0.2);
          }

          measureCrossStaffRisk += proximity;
          measureCrossStaffComparisons += 1;
        }
      }
    }

    if (measureCrossStaffComparisons > 0) {
      crossStaffProximityRisk += measureCrossStaffRisk;
      crossStaffComparisons += measureCrossStaffComparisons;
    }

    if (measureNoteCount > 0) {
      const measureCenterRatio = measureCenterRisk / measureNoteCount;
      const measureCurvedRatio = measureCurvedRisk / measureNoteCount;
      const measureCrossStaffRatio =
        measureCrossStaffComparisons > 0 ? measureCrossStaffRisk / measureCrossStaffComparisons : 0;
      const measureRisk = clamp(
        measureCenterRatio * 0.65 + measureCurvedRatio * 0.85 + measureCrossStaffRatio * 0.75,
        0,
        1
      );
      peakMeasureRisk = Math.max(peakMeasureRisk, measureRisk);
    }
  }

  if (noteCount === 0) {
    return 22;
  }

  const centerRatio = centerRegisterRisk / noteCount;
  const curvedRatio = curvedCenterRisk / noteCount;
  const denseRatio = denseRhythmRisk / noteCount;
  const crossStaffRatio =
    crossStaffComparisons > 0 ? clamp(crossStaffProximityRisk / crossStaffComparisons, 0, 1) : 0;
  const baseGap = 22 + complexity * 14 + textAnnotationPressure * 18;
  const riskBoost = centerRatio * 26 + curvedRatio * 24 + denseRatio * 14 + crossStaffRatio * 20;
  const peakBoost = peakMeasureRisk * 16;
  const rawGap = clampInt(baseGap + riskBoost + peakBoost, 24, 96);
  const lowRiskSignal = clamp(
    1 -
      (centerRatio * 0.5 +
        curvedRatio * 0.7 +
        crossStaffRatio * 0.72 +
        denseRatio * 0.45 +
        textAnnotationPressure * 0.55),
    0,
    1
  );
  const compactionCredit = Math.round(lowRiskSignal * 18);
  return clampInt(rawGap - compactionCredit, 22, 96);
}

/**
 * Resolve vertical gap between adjacent parts.
 * We keep a stable base gap, then expand for dense neighboring parts.
 */
function resolveInterPartGap(current: PartLayout, next: PartLayout, config: LayoutPlanConfig): number {
  const adjacentComplexity = (current.complexity + next.complexity) / 2;
  const complexityBoost = Math.round(adjacentComplexity * 14);
  const annotationBoost = Math.round(((current.textAnnotationPressure + next.textAnnotationPressure) / 2) * 24);
  // Give pitch-spread pressure slightly more authority than generic complexity.
  // Extreme register writing (ledger-heavy top/bottom notes) is a common source
  // of adjacent-staff visual crowding even when rhythms are simple.
  const verticalSpreadBoost = Math.round(((current.verticalSpread + next.verticalSpread) / 2) * 30);
  const rawGap = config.partGap + complexityBoost + annotationBoost + verticalSpreadBoost;
  const lowRiskSignal = clamp(
    1 - (adjacentComplexity * 0.55 + ((current.verticalSpread + next.verticalSpread) / 2) * 0.8),
    0,
    1
  );
  const compactionCredit = Math.round(lowRiskSignal * 16);
  return clampInt(rawGap - compactionCredit, 20, 104);
}

/** Resolve one clef sign for pitch-range heuristics on a staff at a given measure index. */
function resolveClefSignForEvent(part: Part, measureIndex: number, staffNumber: number): string {
  const measure = part.measures[measureIndex];
  const clefs = measure?.effectiveAttributes.clefs ?? [];
  const exact = clefs.find((clef) => clef.staff === staffNumber);
  if (exact?.sign) {
    return exact.sign.toUpperCase();
  }

  const fallback = clefs[0]?.sign;
  return fallback ? fallback.toUpperCase() : 'G';
}

/**
 * Estimate how often note content exceeds comfortable staff ranges.
 * This is intentionally coarse and exists only to drive extra vertical breathing
 * room between adjacent parts where ledger-heavy writing is common.
 */
function estimatePartVerticalSpread(part: Part): number {
  let noteCount = 0;
  let spreadPressure = 0;
  let peakPressure = 0;
  let elevatedPressureCount = 0;

  for (const measure of part.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (event.kind !== 'note') {
          continue;
        }

        const staffNumber = event.staff ?? 1;
        const clefSign = resolveClefSignForEvent(part, measure.index, staffNumber);
        for (const note of event.notes) {
          if (!note.pitch) {
            continue;
          }

          const penalty = estimatePitchSpreadPenalty(clefSign, note.pitch.octave);
          noteCount += 1;
          spreadPressure += penalty;
          peakPressure = Math.max(peakPressure, penalty);
          if (penalty >= 0.6) {
            elevatedPressureCount += 1;
          }
        }
      }
    }
  }

  if (noteCount === 0) {
    return 0;
  }

  // Average pressure captures broad ledger usage, while peak/elevated pressure
  // keeps sparse-but-extreme outliers from being diluted away in long measures.
  const averagePressure = spreadPressure / noteCount;
  const elevatedPressureRatio = elevatedPressureCount / noteCount;
  const blendedPressure = averagePressure * 0.55 + peakPressure * 0.3 + elevatedPressureRatio * 0.35;
  return clamp(blendedPressure, 0, 1);
}

/**
 * Estimate how text-heavy one part is across directions, harmonies, and lyrics.
 * This allows inter-part spacing to reserve vertical room before text lanes from
 * neighboring staves collide (for example category-31 direction+dynamics tests).
 */
function estimatePartTextAnnotationPressure(part: Part): number {
  let noteEventCount = 0;
  let directionEventCount = 0;
  let dynamicsEventCount = 0;
  let harmonyCount = 0;
  let lyricTokenCount = 0;

  for (const measure of part.measures) {
    harmonyCount += measure.harmonies?.length ?? 0;
    directionEventCount += measure.directions.length;
    for (const direction of measure.directions) {
      const hasDynamics = Boolean(direction.dynamics && direction.dynamics.length > 0);
      if (hasDynamics) {
        dynamicsEventCount += 1;
      }
    }

    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (event.kind !== 'note') {
          continue;
        }

        noteEventCount += 1;
        for (const noteData of event.notes) {
          if (!noteData.lyrics || noteData.lyrics.length === 0) {
            continue;
          }
          lyricTokenCount += noteData.lyrics.length;
        }
      }
    }
  }

  if (noteEventCount === 0) {
    return 0;
  }

  const directionRatio = directionEventCount / noteEventCount;
  const dynamicsRatio = dynamicsEventCount / noteEventCount;
  const harmonyRatio = harmonyCount / noteEventCount;
  const lyricRatio = lyricTokenCount / noteEventCount;
  const pressure =
    directionRatio * 0.38 +
    dynamicsRatio * 0.34 +
    harmonyRatio * 0.18 +
    lyricRatio * 0.28;
  return clamp(pressure, 0, 1);
}

/** Estimate one pitch spread penalty against a clef's comfortable octave lane. */
function estimatePitchSpreadPenalty(clefSign: string, octave: number): number {
  let min = 4;
  let max = 5;

  if (clefSign === 'F') {
    min = 2;
    max = 3;
  } else if (clefSign === 'C') {
    min = 3;
    max = 4;
  }

  if (octave >= min && octave <= max) {
    return 0;
  }

  const distance = octave < min ? min - octave : octave - max;
  return clamp(distance * 0.45, 0, 1);
}

/** Estimate score density to tune adaptive vertical spacing heuristics. */
function estimateDensityPressure(partLayouts: PartLayout[]): number {
  let noteCount = 0;
  let pressure = 0;

  for (const layout of partLayouts) {
    for (const measure of layout.part.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.kind !== 'note') {
            continue;
          }

          noteCount += 1;
          let eventPressure = 0;
          if (event.notes.length > 1) {
            eventPressure += 0.35;
          }
          if (event.grace) {
            eventPressure += 0.15;
          }
          if (event.beams && event.beams.length > 0) {
            eventPressure += 0.2;
          }
          if (event.tuplets && event.tuplets.length > 0) {
            eventPressure += 0.25;
          }
          if (event.notes.some((note) => (note.slurs?.length ?? 0) > 0 || (note.ties?.length ?? 0) > 0)) {
            eventPressure += 0.2;
          }
          if (isDenseNoteType(event.noteType)) {
            eventPressure += 0.25;
          }
          pressure += eventPressure;
        }
      }
    }
  }

  if (noteCount === 0) {
    return 0;
  }

  return Math.min(1, pressure / (noteCount * 0.75));
}

/** Estimate global dense-rhythm pressure used for target measures-per-system planning. */
function estimateDenseRhythmPressure(partLayouts: PartLayout[]): number {
  let noteCount = 0;
  let denseCount = 0;

  for (const layout of partLayouts) {
    for (const measure of layout.part.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.kind !== 'note') {
            continue;
          }
          noteCount += 1;
          if (isDenseNoteType(event.noteType)) {
            denseCount += 1;
          }
        }
      }
    }
  }

  if (noteCount === 0) {
    return 0;
  }

  return clamp(denseCount / noteCount, 0, 1);
}

/**
 * Estimate peak local dense-rhythm pressure for one score.
 * Average dense-rhythm ratio can hide isolated "spike" measures (for example
 * `lilypond-03a-rhythm-durations`) that need extra horizontal room to avoid
 * barline over-compression. This peak metric is intentionally local and only
 * influences auto wrapping (measures-per-system), not per-column source hints.
 */
function estimatePeakDenseMeasurePressure(partLayouts: PartLayout[]): number {
  const measureCount = Math.max(0, ...partLayouts.map((layout) => layout.part.measures.length));
  if (measureCount === 0) {
    return 0;
  }

  let peakPressure = 0;
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    let noteCount = 0;
    let denseCount = 0;
    let tupletCount = 0;
    let beamedCount = 0;

    for (const layout of partLayouts) {
      const measure = layout.part.measures[measureIndex];
      if (!measure) {
        continue;
      }

      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.kind !== 'note') {
            continue;
          }

          noteCount += 1;
          if (isDenseNoteType(event.noteType)) {
            denseCount += 1;
          }
          if (event.tuplets && event.tuplets.length > 0) {
            tupletCount += 1;
          }
          if (event.beams && event.beams.length > 0) {
            beamedCount += 1;
          }
        }
      }
    }

    if (noteCount === 0) {
      continue;
    }

    const denseRatio = denseCount / noteCount;
    const tupletRatio = tupletCount / noteCount;
    const beamedRatio = beamedCount / noteCount;
    const eventDensityScale = clamp(noteCount / 26, 0.35, 1);
    const measurePressure = clamp(
      (denseRatio * 0.72 + tupletRatio * 0.18 + beamedRatio * 0.1) * (0.55 + eventDensityScale * 0.45),
      0,
      1
    );
    peakPressure = Math.max(peakPressure, measurePressure);
  }

  return peakPressure;
}

/**
 * Estimate grand-staff collision pressure across multi-staff parts.
 * This captures center-register interactions that are common in piano writing
 * where treble and bass staves can visually compete for vertical space.
 * The score-level signal feeds horizontal wrapping so dense grand-staff systems
 * get fewer measures per row before we resort to aggressive local compression.
 */
function estimateGrandStaffPressure(partLayouts: PartLayout[]): number {
  let noteCount = 0;
  let centerRegisterRisk = 0;
  let curvedCenterRisk = 0;
  let chordRisk = 0;

  for (const layout of partLayouts) {
    if (layout.staffCount < 2) {
      continue;
    }

    for (const measure of layout.part.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.kind !== 'note') {
            continue;
          }

          const staffNumber = event.staff ?? 1;
          const hasCurvedRelation = event.notes.some((note) => (note.slurs?.length ?? 0) > 0 || (note.ties?.length ?? 0) > 0);
          if (event.notes.length > 1) {
            chordRisk += 1;
          }

          for (const note of event.notes) {
            if (!note.pitch) {
              continue;
            }

            noteCount += 1;
            const octave = note.pitch.octave;
            const nearCenterFromUpper = staffNumber === 1 && octave <= 4;
            const nearCenterFromLower = staffNumber === 2 && octave >= 3;
            if (!nearCenterFromUpper && !nearCenterFromLower) {
              continue;
            }

            centerRegisterRisk += 1;
            if (hasCurvedRelation) {
              curvedCenterRisk += 1;
            }
          }
        }
      }
    }
  }

  if (noteCount === 0) {
    return 0;
  }

  const centerRatio = centerRegisterRisk / noteCount;
  const curvedRatio = curvedCenterRisk / noteCount;
  const chordRatio = chordRisk / noteCount;
  return clamp(centerRatio * 0.5 + curvedRatio * 0.35 + chordRatio * 0.15, 0, 1);
}

/** Estimate fraction of pitched notes that carry explicit accidental intent. */
function estimateAccidentalPressure(partLayouts: PartLayout[]): number {
  let noteCount = 0;
  let accidentalCount = 0;

  for (const layout of partLayouts) {
    for (const measure of layout.part.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.kind !== 'note') {
            continue;
          }
          for (const note of event.notes) {
            if (!note.pitch) {
              continue;
            }
            noteCount += 1;
            if (note.accidental?.value || (Number.isFinite(note.pitch.alter) && Math.abs(note.pitch.alter ?? 0) > 0)) {
              accidentalCount += 1;
            }
          }
        }
      }
    }
  }

  if (noteCount === 0) {
    return 0;
  }

  return clamp(accidentalCount / noteCount, 0, 1);
}

/**
 * Estimate score-level text pressure for inter-system spacing.
 * This protects against cross-system collisions where dense lyric/harmony/
 * direction lanes from one system overlap text lanes in the next system.
 */
function estimateSystemTextPressure(partLayouts: PartLayout[]): number {
  if (partLayouts.length === 0) {
    return 0;
  }

  const maxPressure = Math.max(...partLayouts.map((layout) => layout.textAnnotationPressure));
  const averagePressure =
    partLayouts.reduce((sum, layout) => sum + layout.textAnnotationPressure, 0) / partLayouts.length;
  return clamp(maxPressure * 0.65 + averagePressure * 0.35, 0, 1);
}

/**
 * Estimate inter-system lane pressure from text that materially competes for
 * vertical space between systems (lyrics, harmony symbols, and direction words).
 *
 * We intentionally discount dynamics-only directions here. Dynamics glyph runs
 * are compact and usually stay close to staff lines, while lyric/harmony/word
 * labels are the primary source of cross-system text collisions.
 */
function estimateSystemLaneCollisionPressure(partLayouts: PartLayout[]): number {
  let noteEventCount = 0;
  let directionWordCount = 0;
  let harmonyCount = 0;
  let lyricTokenCount = 0;

  for (const layout of partLayouts) {
    for (const measure of layout.part.measures) {
      harmonyCount += measure.harmonies?.length ?? 0;
      for (const direction of measure.directions) {
        const hasWords = Boolean(direction.words && direction.words.trim().length > 0);
        const hasTempo = Number.isFinite(direction.tempo);
        if (hasWords || hasTempo) {
          directionWordCount += 1;
        }
      }

      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (event.kind !== 'note') {
            continue;
          }

          noteEventCount += 1;
          for (const note of event.notes) {
            if (!note.lyrics || note.lyrics.length === 0) {
              continue;
            }
            lyricTokenCount += note.lyrics.length;
          }
        }
      }
    }
  }

  if (noteEventCount === 0) {
    return 0;
  }

  const directionWordRatio = directionWordCount / noteEventCount;
  const harmonyRatio = harmonyCount / noteEventCount;
  const lyricRatio = lyricTokenCount / noteEventCount;
  return clamp(directionWordRatio * 0.28 + harmonyRatio * 0.34 + lyricRatio * 0.38, 0, 1);
}

/** Clamp render scale into a safe range for layout and text rendering. */
function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return DEFAULT_RENDER_SCALE;
  }
  return Math.max(0.4, Math.min(1.5, scale));
}

/** Clamp numeric values into a bounded range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Apply global render scaling while preserving a stable top-left margin anchor. */
function applyRenderScale(context: ReturnType<Renderer['getContext']>, config: LayoutPlanConfig): void {
  if (config.renderScale === 1) {
    return;
  }

  context.scale(config.renderScale, config.renderScale);
}

/** Clamp nullable/numeric values to deterministic integer bounds. */
function clampInt(value: number, minimum: number, maximum: number): number {
  const rounded = Math.round(value);
  return Math.max(minimum, Math.min(maximum, rounded));
}
