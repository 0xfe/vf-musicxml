import { JSDOM } from 'jsdom';

import { extractSvgElementBounds, type SvgElementBounds } from './svg-collision.js';

/** Lightweight geometry snapshot for notation-oriented SVG audits. */
export interface NotationGeometrySnapshot {
  noteheads: SvgElementBounds[];
  stems: SvgElementBounds[];
  beams: SvgElementBounds[];
  flags: SvgElementBounds[];
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
  minRightEdgePastBarline?: number;
}

/** Summary counters used by tests, reports, and triage automation. */
export interface NotationGeometrySummary {
  noteheadCount: number;
  stemCount: number;
  beamCount: number;
  flagCount: number;
  flagBeamOverlapCount: number;
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
  bandSummaries: MeasureSpacingBandSummary[];
  evaluatedBandCount: number;
  firstMeasureAverageGap: number | null;
  medianOtherMeasuresAverageGap: number | null;
  firstToMedianOtherGapRatio: number | null;
}

/** Per-staff-band spacing summary used for multi-system/multi-staff diagnostics. */
export interface MeasureSpacingBandSummary {
  bandIndex: number;
  barlineCount: number;
  noteheadCount: number;
  firstMeasureNoteheadCount: number | null;
  medianOtherMeasuresNoteheadCount: number | null;
  firstMeasureAverageGap: number | null;
  medianOtherMeasuresAverageGap: number | null;
  firstToMedianOtherGapRatio: number | null;
  firstToMedianOtherEstimatedWidthRatio: number | null;
}

/** Tuning knobs for spacing extraction stability across floating-point jitter. */
export interface MeasureSpacingSummaryOptions {
  barlineMergeTolerance?: number;
  noteheadMergeTolerance?: number;
  bandMergeTolerance?: number;
  noteheadBandMargin?: number;
  minNotesPerMeasureForGap?: number;
}

/** One vertically bounded system estimate derived from grouped barline bands. */
export interface SystemVerticalBounds {
  systemIndex: number;
  top: number;
  bottom: number;
  staffBandCount: number;
}

/** Options for estimating system bounds from staff-band geometry. */
export interface SystemVerticalBoundsOptions {
  barlineBandMergeTolerance?: number;
  startSystemIndex?: number;
  systemCount?: number;
}

/** Pixel crop region derived from rendered geometry for deterministic screenshot comparison. */
export interface GeometryCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: 'pixels';
}

/** Options for deriving a crop region from one or more detected systems. */
export interface SystemCropRegionOptions {
  stavesPerSystem: number;
  startSystemIndex?: number;
  systemCount?: number;
  includeFullWidth?: boolean;
  headerPadding?: number;
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}

/** One detected steep curve path that likely indicates unstable slur routing. */
export interface ExtremeCurvePath {
  pathIndex: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  deltaX: number;
  deltaY: number;
}

/** Thresholds for steep-curve detection used in headless quality checks. */
export interface ExtremeCurveDetectionOptions {
  minVerticalDelta?: number;
  minHorizontalSpan?: number;
  minSlopeRatio?: number;
}

/** Collect geometry for core notation primitives used by renderer-quality checks. */
export function collectNotationGeometry(svgMarkup: string): NotationGeometrySnapshot {
  return {
    noteheads: extractSvgElementBounds(svgMarkup, { selector: '.vf-notehead' }),
    stems: extractSvgElementBounds(svgMarkup, { selector: '.vf-stem' }),
    beams: extractSvgElementBounds(svgMarkup, { selector: '.vf-beam' }),
    flags: extractSvgElementBounds(svgMarkup, { selector: '.vf-flag' }),
    barlines: extractSvgElementBounds(svgMarkup, { selector: '.vf-stavebarline' })
  };
}

/**
 * Detect steep cubic-curve paths likely to be malformed slur routing.
 * The filter targets unfilled stroked paths with cubic commands so glyph shapes
 * and filled outlines do not pollute results.
 */
export function detectExtremeCurvePaths(
  svgMarkup: string,
  options: ExtremeCurveDetectionOptions = {}
): ExtremeCurvePath[] {
  const minVerticalDelta = options.minVerticalDelta ?? 80;
  const minHorizontalSpan = options.minHorizontalSpan ?? 60;
  const minSlopeRatio = options.minSlopeRatio ?? 0.5;
  const extremes: ExtremeCurvePath[] = [];
  const dom = new JSDOM(svgMarkup, { contentType: 'image/svg+xml' });
  const document = dom.window.document;
  const candidates = [...document.querySelectorAll('path[d]')];

  for (let pathIndex = 0; pathIndex < candidates.length; pathIndex += 1) {
    const candidate = candidates[pathIndex];
    if (!candidate) {
      continue;
    }

    const stroke = candidate.getAttribute('stroke');
    const fill = candidate.getAttribute('fill');
    if (stroke === null && fill !== 'none') {
      continue;
    }
    if (stroke === 'none' && fill !== 'none') {
      continue;
    }

    const d = candidate.getAttribute('d');
    if (!d || (!d.includes('C') && !d.includes('c'))) {
      continue;
    }

    const anchors = parseFirstCubicCurveAnchors(d);
    if (!anchors) {
      continue;
    }

    const deltaX = Math.abs(anchors.endX - anchors.startX);
    const deltaY = Math.abs(anchors.endY - anchors.startY);
    if (deltaY < minVerticalDelta || deltaX < minHorizontalSpan) {
      continue;
    }

    const slopeRatio = deltaY / Math.max(1, deltaX);
    if (slopeRatio < minSlopeRatio) {
      continue;
    }

    extremes.push({
      pathIndex,
      startX: anchors.startX,
      startY: anchors.startY,
      endX: anchors.endX,
      endY: anchors.endY,
      deltaX,
      deltaY
    });
  }

  dom.window.close();
  return extremes;
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
  const minRightEdgePastBarline = options.minRightEdgePastBarline ?? 1.25;
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

      // Filter near-touch cases where anti-aliased outlines overlap by ~1px but
      // the notehead does not materially extend past the barline center.
      const noteheadRightEdge = notehead.bounds.x + notehead.bounds.width;
      const barlineCenterX = barline.bounds.x + barline.bounds.width / 2;
      if (noteheadRightEdge - barlineCenterX < minRightEdgePastBarline) {
        continue;
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
  const flagBeamOverlapCount = detectFlagBeamOverlaps(geometry).length;

  return {
    noteheadCount: geometry.noteheads.length,
    stemCount: geometry.stems.length,
    beamCount: geometry.beams.length,
    flagCount: geometry.flags.length,
    flagBeamOverlapCount,
    barlineCount: geometry.barlines.length,
    noteheadBarlineIntrusionCount: intrusions.length
  };
}

/** One detected overlap where a flag occupies the same region as a beam. */
export interface FlagBeamOverlap {
  flag: SvgElementBounds;
  beam: SvgElementBounds;
  horizontalOverlap: number;
  verticalOverlap: number;
}

/** Detect beam/flag overlaps (usually a symptom of missed beam attachment timing). */
export function detectFlagBeamOverlaps(geometry: NotationGeometrySnapshot): FlagBeamOverlap[] {
  const overlaps: FlagBeamOverlap[] = [];

  for (const flag of geometry.flags) {
    for (const beam of geometry.beams) {
      const horizontalOverlap = overlapLength(
        flag.bounds.x,
        flag.bounds.x + flag.bounds.width,
        beam.bounds.x,
        beam.bounds.x + beam.bounds.width
      );
      if (horizontalOverlap <= 0) {
        continue;
      }

      const verticalOverlap = overlapLength(
        flag.bounds.y,
        flag.bounds.y + flag.bounds.height,
        beam.bounds.y,
        beam.bounds.y + beam.bounds.height
      );
      if (verticalOverlap <= 0) {
        continue;
      }

      overlaps.push({
        flag,
        beam,
        horizontalOverlap,
        verticalOverlap
      });
    }
  }

  return overlaps;
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
  const bandMergeTolerance = options.bandMergeTolerance ?? 18;
  const noteheadBandMargin = options.noteheadBandMargin ?? 12;
  const minNotesPerMeasureForGap = options.minNotesPerMeasureForGap ?? 2;
  const barlineBands = clusterElementsByVerticalCenter(geometry.barlines, bandMergeTolerance);

  const samples: MeasureSpacingSample[] = [];
  const bandSummaries: MeasureSpacingBandSummary[] = [];
  if (barlineBands.length === 0) {
    return {
      samples,
      bandSummaries,
      evaluatedBandCount: 0,
      firstMeasureAverageGap: null,
      medianOtherMeasuresAverageGap: null,
      firstToMedianOtherGapRatio: null
    };
  }

  for (let bandIndex = 0; bandIndex < barlineBands.length; bandIndex += 1) {
    const bandBarlines = barlineBands[bandIndex];
    if (!bandBarlines || bandBarlines.length === 0) {
      continue;
    }

    const barlineCenters = collapseCenters(
      bandBarlines.map((barline) => barline.bounds.x + barline.bounds.width / 2),
      barlineMergeTolerance
    );
    if (barlineCenters.length < 2) {
      continue;
    }

    const bandTop = Math.min(...bandBarlines.map((barline) => barline.bounds.y));
    const bandBottom = Math.max(
      ...bandBarlines.map((barline) => barline.bounds.y + barline.bounds.height)
    );
    const bandNoteCenters = collapseCenters(
      geometry.noteheads
        .filter((notehead) => {
          const centerY = notehead.bounds.y + notehead.bounds.height / 2;
          return centerY >= bandTop - noteheadBandMargin && centerY <= bandBottom + noteheadBandMargin;
        })
        .map((notehead) => notehead.bounds.x + notehead.bounds.width / 2),
      noteheadMergeTolerance
    );

    const bandSamples = buildMeasureSpacingSamples(barlineCenters, bandNoteCenters);
    samples.push(...bandSamples);

    const firstMeasureSample = bandSamples.find(
      (sample) => sample.noteheadCount >= minNotesPerMeasureForGap
    );
    const firstMeasureAverageGap = firstMeasureSample?.averageGap ?? null;
    const firstMeasureNoteheadCount = firstMeasureSample?.noteheadCount ?? null;
    const laterSamples = bandSamples
      .slice(1)
      .filter((sample) => sample.noteheadCount >= minNotesPerMeasureForGap);
    const medianOtherMeasuresAverageGap = median(
      laterSamples
        .map((sample) => sample.averageGap)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)
    );
    const medianOtherMeasuresNoteheadCount = median(
      laterSamples
        .map((sample) => sample.noteheadCount)
        .sort((left, right) => left - right)
    );
    const firstToMedianOtherGapRatio =
      firstMeasureAverageGap !== null &&
      medianOtherMeasuresAverageGap !== null &&
      medianOtherMeasuresAverageGap > 0
        ? Number((firstMeasureAverageGap / medianOtherMeasuresAverageGap).toFixed(4))
        : null;
    const firstToMedianOtherEstimatedWidthRatio =
      firstToMedianOtherGapRatio !== null &&
      firstMeasureNoteheadCount !== null &&
      medianOtherMeasuresNoteheadCount !== null &&
      firstMeasureNoteheadCount > 1 &&
      medianOtherMeasuresNoteheadCount > 1
        ? Number(
            (
              firstToMedianOtherGapRatio *
              // Only scale by note-count imbalance when the first measure is
              // denser than the comparison baseline. Sparse opening measures
              // can legitimately contain fewer noteheads without being width-
              // compressed, and full scaling would over-report false alarms.
              (firstMeasureNoteheadCount >= medianOtherMeasuresNoteheadCount
                ? (firstMeasureNoteheadCount - 1) / (medianOtherMeasuresNoteheadCount - 1)
                : 1)
            ).toFixed(4)
          )
        : null;

    bandSummaries.push({
      bandIndex,
      barlineCount: barlineCenters.length,
      noteheadCount: bandNoteCenters.length,
      firstMeasureNoteheadCount,
      medianOtherMeasuresNoteheadCount,
      firstMeasureAverageGap,
      medianOtherMeasuresAverageGap,
      firstToMedianOtherGapRatio,
      firstToMedianOtherEstimatedWidthRatio
    });
  }

  const firstMeasureAverageGap = median(
    bandSummaries
      .map((summary) => summary.firstMeasureAverageGap)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)
  );
  const medianOtherMeasuresAverageGap = median(
    bandSummaries
      .map((summary) => summary.medianOtherMeasuresAverageGap)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)
  );

  return {
    samples,
    bandSummaries,
    evaluatedBandCount: bandSummaries.length,
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

/**
 * Estimate per-system vertical bounds by grouping barlines into staff bands
 * and chunking them by `stavesPerSystem`.
 */
export function estimateSystemVerticalBounds(
  geometry: NotationGeometrySnapshot,
  stavesPerSystem: number,
  options: SystemVerticalBoundsOptions = {}
): SystemVerticalBounds[] {
  if (stavesPerSystem <= 0) {
    return [];
  }

  const barlineBandMergeTolerance = options.barlineBandMergeTolerance ?? 18;
  const bands = clusterElementsByVerticalCenter(geometry.barlines, barlineBandMergeTolerance);
  if (bands.length === 0) {
    return [];
  }

  const systems: SystemVerticalBounds[] = [];
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += stavesPerSystem) {
    const systemBands = bands.slice(bandIndex, bandIndex + stavesPerSystem);
    if (systemBands.length < stavesPerSystem) {
      break;
    }

    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const band of systemBands) {
      for (const barline of band) {
        top = Math.min(top, barline.bounds.y);
        bottom = Math.max(bottom, barline.bounds.y + barline.bounds.height);
      }
    }

    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      continue;
    }

    systems.push({
      systemIndex: systems.length,
      top,
      bottom,
      staffBandCount: systemBands.length
    });
  }

  const startSystemIndex = Math.max(0, options.startSystemIndex ?? 0);
  const systemCount =
    options.systemCount !== undefined ? Math.max(0, options.systemCount) : systems.length;
  return systems.slice(startSystemIndex, startSystemIndex + systemCount);
}

/**
 * Derive a deterministic pixel crop around one or more systems.
 * This is designed for headless visual comparison where ratio-based crops are
 * too fragile across page-size/layout changes.
 */
export function deriveSystemCropRegion(
  geometry: NotationGeometrySnapshot,
  imageWidth: number,
  imageHeight: number,
  options: SystemCropRegionOptions
): GeometryCropRegion | undefined {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    return undefined;
  }

  if (!Number.isFinite(options.stavesPerSystem) || options.stavesPerSystem <= 0) {
    return undefined;
  }

  const selectedSystems = estimateSystemVerticalBounds(geometry, options.stavesPerSystem, {
    startSystemIndex: options.startSystemIndex,
    systemCount: options.systemCount
  });
  if (selectedSystems.length === 0) {
    return undefined;
  }

  let top = Math.min(...selectedSystems.map((system) => system.top));
  const bottom = Math.max(...selectedSystems.map((system) => system.bottom));
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined;
  }

  // Optional title/header retention above the first system for proof-point crops.
  top -= Math.max(0, options.headerPadding ?? 0);

  let minX = 0;
  let maxX = imageWidth;
  if (options.includeFullWidth !== true) {
    const selectedBarlines = geometry.barlines.filter((barline) => {
      const barlineTop = barline.bounds.y;
      const barlineBottom = barline.bounds.y + barline.bounds.height;
      return overlapLength(barlineTop, barlineBottom, top, bottom) > 0;
    });
    if (selectedBarlines.length > 0) {
      minX = Math.min(...selectedBarlines.map((barline) => barline.bounds.x));
      maxX = Math.max(...selectedBarlines.map((barline) => barline.bounds.x + barline.bounds.width));
    }
  }

  const padding = Math.max(0, options.padding ?? 0);
  const paddingTop = Math.max(0, options.paddingTop ?? padding);
  const paddingRight = Math.max(0, options.paddingRight ?? padding);
  const paddingBottom = Math.max(0, options.paddingBottom ?? padding);
  const paddingLeft = Math.max(0, options.paddingLeft ?? padding);

  const x = Math.max(0, Math.floor(minX - paddingLeft));
  const y = Math.max(0, Math.floor(top - paddingTop));
  const right = Math.min(imageWidth, Math.ceil(maxX + paddingRight));
  const bottomClamped = Math.min(imageHeight, Math.ceil(bottom + paddingBottom));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottomClamped - y);

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  return {
    x,
    y,
    width,
    height,
    unit: 'pixels'
  };
}

/** Parse `M ... C ...` anchors from one path payload for steep-curve checks. */
function parseFirstCubicCurveAnchors(
  d: string
): { startX: number; startY: number; endX: number; endY: number } | undefined {
  const tokens = d.match(/[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }

  let command = '';
  let index = 0;
  let currentX = 0;
  let currentY = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      break;
    }

    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index += 1;
      continue;
    }

    if (command === 'M' || command === 'L') {
      const x = Number(tokens[index]);
      const y = Number(tokens[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return undefined;
      }
      currentX = x;
      currentY = y;
      index += 2;
      if (command === 'M') {
        command = 'L';
      }
      continue;
    }

    if (command === 'm' || command === 'l') {
      const dx = Number(tokens[index]);
      const dy = Number(tokens[index + 1]);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return undefined;
      }
      currentX += dx;
      currentY += dy;
      index += 2;
      if (command === 'm') {
        command = 'l';
      }
      continue;
    }

    if (command === 'C' || command === 'c') {
      const x3 = Number(tokens[index + 4]);
      const y3 = Number(tokens[index + 5]);
      if (!Number.isFinite(x3) || !Number.isFinite(y3)) {
        return undefined;
      }

      const startX = currentX;
      const startY = currentY;
      const endX = command === 'c' ? currentX + x3 : x3;
      const endY = command === 'c' ? currentY + y3 : y3;
      if (![startX, startY, endX, endY].every(Number.isFinite)) {
        return undefined;
      }

      return { startX, startY, endX, endY };
    }

    // Skip unsupported command payloads conservatively; we only need the first cubic.
    index += 1;
  }

  return undefined;
}

/**
 * Build spacing samples for one staff band.
 * This keeps measure partitioning deterministic and reusable across callers.
 */
function buildMeasureSpacingSamples(
  barlineCenters: number[],
  noteCenters: number[]
): MeasureSpacingSample[] {
  const samples: MeasureSpacingSample[] = [];

  for (let index = 0; index + 1 < barlineCenters.length; index += 1) {
    const leftBoundary = barlineCenters[index];
    const rightBoundary = barlineCenters[index + 1];
    if (leftBoundary === undefined || rightBoundary === undefined) {
      continue;
    }

    const centersInMeasure = noteCenters.filter(
      (center) => center >= leftBoundary && center < rightBoundary
    );
    const gaps = buildAdjacentGaps(centersInMeasure);

    samples.push({
      measureIndex: index,
      noteheadCount: centersInMeasure.length,
      averageGap: gaps.length > 0 ? average(gaps) : null,
      minimumGap: gaps.length > 0 ? Math.min(...gaps) : null,
      maximumGap: gaps.length > 0 ? Math.max(...gaps) : null
    });
  }

  return samples;
}

/**
 * Group elements by vertical center to keep spacing analysis system/staff aware.
 * Without this partitioning, multi-system pages can produce false spacing signals.
 */
function clusterElementsByVerticalCenter(
  elements: SvgElementBounds[],
  tolerance: number
): SvgElementBounds[][] {
  if (elements.length === 0) {
    return [];
  }

  const sorted = [...elements].sort((left, right) => {
    const leftCenter = left.bounds.y + left.bounds.height / 2;
    const rightCenter = right.bounds.y + right.bounds.height / 2;
    return leftCenter - rightCenter;
  });
  const groups: SvgElementBounds[][] = [];
  const groupCenters: number[] = [];

  for (const element of sorted) {
    const center = element.bounds.y + element.bounds.height / 2;
    const lastGroupCenter = groupCenters[groupCenters.length - 1];
    if (lastGroupCenter === undefined || Math.abs(center - lastGroupCenter) > tolerance) {
      groups.push([element]);
      groupCenters.push(center);
      continue;
    }

    const group = groups[groups.length - 1];
    if (!group) {
      continue;
    }

    group.push(element);
    groupCenters[groupCenters.length - 1] =
      (lastGroupCenter * (group.length - 1) + center) / group.length;
  }

  return groups;
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
