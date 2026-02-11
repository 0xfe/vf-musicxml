import { extractSvgElementBounds, type SvgElementBounds } from './svg-collision.js';

/** Lightweight geometry snapshot for notation-oriented SVG audits. */
export interface NotationGeometrySnapshot {
  noteheads: SvgElementBounds[];
  stems: SvgElementBounds[];
  beams: SvgElementBounds[];
  barlines: SvgElementBounds[];
}

/** One detected notehead/barline intersection event. */
export interface NoteheadBarlineIntrusion {
  notehead: SvgElementBounds;
  barline: SvgElementBounds;
  horizontalOverlap: number;
  verticalOverlap: number;
}

/** Thresholds for identifying meaningful notehead/barline intrusions. */
export interface NoteheadBarlineIntrusionOptions {
  minHorizontalOverlap?: number;
  minVerticalOverlap?: number;
  requireCenterLeftOfBarline?: boolean;
}

/** Summary counters used by tests, reports, and triage automation. */
export interface NotationGeometrySummary {
  noteheadCount: number;
  stemCount: number;
  beamCount: number;
  barlineCount: number;
  noteheadBarlineIntrusionCount: number;
}

/** Measure-level spacing metrics derived from notehead centers and barline partitions. */
export interface MeasureSpacingSample {
  measureIndex: number;
  noteheadCount: number;
  averageGap: number | null;
  minimumGap: number | null;
  maximumGap: number | null;
}

/** Aggregate summary used by spacing regression checks and quality reports. */
export interface MeasureSpacingSummary {
  samples: MeasureSpacingSample[];
  firstMeasureAverageGap: number | null;
  medianOtherMeasuresAverageGap: number | null;
  firstToMedianOtherGapRatio: number | null;
}

/** Tuning knobs for spacing extraction stability across floating-point jitter. */
export interface MeasureSpacingSummaryOptions {
  barlineMergeTolerance?: number;
  noteheadMergeTolerance?: number;
}

/** Collect geometry for core notation primitives used by renderer-quality checks. */
export function collectNotationGeometry(svgMarkup: string): NotationGeometrySnapshot {
  return {
    noteheads: extractSvgElementBounds(svgMarkup, { selector: '.vf-notehead' }),
    stems: extractSvgElementBounds(svgMarkup, { selector: '.vf-stem' }),
    beams: extractSvgElementBounds(svgMarkup, { selector: '.vf-beam' }),
    barlines: extractSvgElementBounds(svgMarkup, { selector: '.vf-stavebarline' })
  };
}

/**
 * Detect noteheads crossing barlines.
 * These intrusions are strong indicators of measure-width/formatting bugs.
 */
export function detectNoteheadBarlineIntrusions(
  geometry: NotationGeometrySnapshot,
  options: NoteheadBarlineIntrusionOptions = {}
): NoteheadBarlineIntrusion[] {
  const minHorizontalOverlap = options.minHorizontalOverlap ?? 0.5;
  const minVerticalOverlap = options.minVerticalOverlap ?? 2;
  const requireCenterLeftOfBarline = options.requireCenterLeftOfBarline ?? true;
  const intrusions: NoteheadBarlineIntrusion[] = [];

  for (const notehead of geometry.noteheads) {
    for (const barline of geometry.barlines) {
      const horizontalOverlap = overlapLength(
        notehead.bounds.x,
        notehead.bounds.x + notehead.bounds.width,
        barline.bounds.x,
        barline.bounds.x + barline.bounds.width
      );
      if (horizontalOverlap < minHorizontalOverlap) {
        continue;
      }

      const verticalOverlap = overlapLength(
        notehead.bounds.y,
        notehead.bounds.y + notehead.bounds.height,
        barline.bounds.y,
        barline.bounds.y + barline.bounds.height
      );
      if (verticalOverlap < minVerticalOverlap) {
        continue;
      }

      // We primarily care about right-edge bleed from the previous measure into
      // a right-side barline. Notes that begin a new measure often sit close to
      // the left barline and should not be counted as overflow.
      if (requireCenterLeftOfBarline) {
        const noteheadCenterX = notehead.bounds.x + notehead.bounds.width / 2;
        const barlineCenterX = barline.bounds.x + barline.bounds.width / 2;
        if (noteheadCenterX >= barlineCenterX) {
          continue;
        }
      }

      intrusions.push({
        notehead,
        barline,
        horizontalOverlap,
        verticalOverlap
      });
    }
  }

  return intrusions;
}

/** Build a compact metric summary from notation geometry and intrusion checks. */
export function summarizeNotationGeometry(
  geometry: NotationGeometrySnapshot,
  options: NoteheadBarlineIntrusionOptions = {}
): NotationGeometrySummary {
  const intrusions = detectNoteheadBarlineIntrusions(geometry, options);

  return {
    noteheadCount: geometry.noteheads.length,
    stemCount: geometry.stems.length,
    beamCount: geometry.beams.length,
    barlineCount: geometry.barlines.length,
    noteheadBarlineIntrusionCount: intrusions.length
  };
}

/**
 * Summarize per-measure notehead spacing by segmenting noteheads between
 * adjacent barline centers and measuring center-to-center gaps.
 */
export function summarizeMeasureSpacingByBarlines(
  geometry: NotationGeometrySnapshot,
  options: MeasureSpacingSummaryOptions = {}
): MeasureSpacingSummary {
  const barlineMergeTolerance = options.barlineMergeTolerance ?? 1.5;
  const noteheadMergeTolerance = options.noteheadMergeTolerance ?? 0.75;
  const barlineCenters = collapseCenters(
    geometry.barlines.map((barline) => barline.bounds.x + barline.bounds.width / 2),
    barlineMergeTolerance
  );

  const samples: MeasureSpacingSample[] = [];
  if (barlineCenters.length < 2) {
    return {
      samples,
      firstMeasureAverageGap: null,
      medianOtherMeasuresAverageGap: null,
      firstToMedianOtherGapRatio: null
    };
  }

  for (let index = 0; index + 1 < barlineCenters.length; index += 1) {
    const leftBoundary = barlineCenters[index];
    const rightBoundary = barlineCenters[index + 1];
    if (leftBoundary === undefined || rightBoundary === undefined) {
      continue;
    }

    const noteCenters = collapseCenters(
      geometry.noteheads
        .map((notehead) => notehead.bounds.x + notehead.bounds.width / 2)
        .filter((center) => center >= leftBoundary && center < rightBoundary),
      noteheadMergeTolerance
    );
    const gaps = buildAdjacentGaps(noteCenters);

    samples.push({
      measureIndex: index,
      noteheadCount: noteCenters.length,
      averageGap: gaps.length > 0 ? average(gaps) : null,
      minimumGap: gaps.length > 0 ? Math.min(...gaps) : null,
      maximumGap: gaps.length > 0 ? Math.max(...gaps) : null
    });
  }

  const firstMeasureAverageGap = samples[0]?.averageGap ?? null;
  const otherMeasureAverages = samples
    .slice(1)
    .map((sample) => sample.averageGap)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const medianOtherMeasuresAverageGap = median(otherMeasureAverages);

  return {
    samples,
    firstMeasureAverageGap,
    medianOtherMeasuresAverageGap,
    firstToMedianOtherGapRatio:
      firstMeasureAverageGap !== null &&
      medianOtherMeasuresAverageGap !== null &&
      medianOtherMeasuresAverageGap > 0
        ? Number((firstMeasureAverageGap / medianOtherMeasuresAverageGap).toFixed(4))
        : null
  };
}

/** Compute 1D overlap between two closed intervals. */
function overlapLength(startA: number, endA: number, startB: number, endB: number): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

/** Collapse sorted center values so tiny coordinate noise stays stable across runs. */
function collapseCenters(values: number[], tolerance: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const collapsed: number[] = [];

  for (const value of sorted) {
    const previous = collapsed[collapsed.length - 1];
    if (previous === undefined || Math.abs(value - previous) > tolerance) {
      collapsed.push(value);
    }
  }

  return collapsed;
}

/** Convert sorted center coordinates into positive adjacent spacing gaps. */
function buildAdjacentGaps(values: number[]): number[] {
  const gaps: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    gaps.push(current - previous);
  }

  return gaps;
}

/** Compute arithmetic mean with deterministic fixed precision for reports/tests. */
function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  return Number((sum / values.length).toFixed(4));
}

/** Compute median value from an already sorted numeric list. */
function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const middleIndex = Math.floor(values.length / 2);
  const middle = values[middleIndex];
  if (middle === undefined) {
    return null;
  }

  if (values.length % 2 === 1) {
    return Number(middle.toFixed(4));
  }

  const previous = values[middleIndex - 1];
  if (previous === undefined) {
    return Number(middle.toFixed(4));
  }

  return Number(((previous + middle) / 2).toFixed(4));
}
