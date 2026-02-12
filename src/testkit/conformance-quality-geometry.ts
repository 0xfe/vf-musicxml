import { JSDOM } from 'jsdom';

import {
  collectNotationGeometry,
  detectFlagBeamOverlaps,
  detectNoteheadBarlineIntrusions
} from './notation-geometry.js';
import { extractSvgElementBounds, type SvgBounds, type SvgElementBounds } from './svg-collision.js';

/** Local overlap counter used when evaluating collision/tight-layout penalties. */
export interface OverlapCounters {
  critical: number;
  minor: number;
}

/** Pre-extracted SVG geometry used by all dimension scorers to avoid repeated DOM scans. */
export interface FixtureSvgAnalysis {
  viewport: SvgBounds | null;
  noteheads: SvgElementBounds[];
  stems: SvgElementBounds[];
  beams: SvgElementBounds[];
  flags: SvgElementBounds[];
  ties: SvgElementBounds[];
  barlines: SvgElementBounds[];
  textElements: SvgElementBounds[];
  staveGroups: SvgElementBounds[];
  layoutElements: SvgElementBounds[];
}

/** Analyze relevant SVG geometry once so each quality dimension can reuse the same data. */
export function analyzeFixtureSvg(svgMarkup: string): FixtureSvgAnalysis {
  const notationGeometry = collectNotationGeometry(svgMarkup);

  return {
    viewport: readSvgViewport(svgMarkup),
    noteheads: notationGeometry.noteheads,
    stems: notationGeometry.stems,
    beams: notationGeometry.beams,
    flags: notationGeometry.flags,
    ties: extractSvgElementBounds(svgMarkup, { selector: '.vf-stavetie' }),
    barlines: notationGeometry.barlines,
    textElements: extractSvgElementBounds(svgMarkup, { selector: 'text' }),
    staveGroups: extractSvgElementBounds(svgMarkup, { selector: '.vf-stave' }),
    layoutElements: extractSvgElementBounds(svgMarkup, {
      selector: '.vf-stave, .vf-stavenote, .vf-stavetie, .vf-beam, .vf-ornament, text'
    })
  };
}

/** Collect deterministic overlap/collision metrics from one SVG geometry payload. */
export function collectQualityGeometryMetrics(analysis: FixtureSvgAnalysis): {
  noteheadSelfOverlaps: OverlapCounters;
  textSelfOverlaps: OverlapCounters;
  textToNoteheadOverlaps: OverlapCounters;
  noteheadBarlineIntrusions: ReturnType<typeof detectNoteheadBarlineIntrusions>;
  flagBeamOverlaps: ReturnType<typeof detectFlagBeamOverlaps>;
} {
  // Noteheads in chords/voices intentionally sit close; treat notehead overlap as minor density signal only.
  const noteheadSelfOverlaps = countSelfOverlaps(analysis.noteheads, Number.POSITIVE_INFINITY, 10);
  // Text-vs-text overlap is common in dense lyrics/chord labels and is handled as a readability
  // quality signal (Q5), not a hard critical-collision gate signal.
  const textSelfOverlaps = countSelfOverlaps(analysis.textElements, Number.POSITIVE_INFINITY, 4);
  const textToNoteheadOverlaps = countCrossOverlaps(analysis.textElements, analysis.noteheads, 120, 16);
  const noteheadBarlineIntrusions = detectNoteheadBarlineIntrusions(
    {
      noteheads: analysis.noteheads,
      stems: analysis.stems,
      beams: analysis.beams,
      flags: analysis.flags,
      barlines: analysis.barlines
    },
    {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    }
  );
  const flagBeamOverlaps = detectFlagBeamOverlaps({
    noteheads: analysis.noteheads,
    stems: analysis.stems,
    beams: analysis.beams,
    flags: analysis.flags,
    barlines: analysis.barlines
  });

  return {
    noteheadSelfOverlaps,
    textSelfOverlaps,
    textToNoteheadOverlaps,
    noteheadBarlineIntrusions,
    flagBeamOverlaps
  };
}

/** Extract the `<svg>...</svg>` segment from renderer output that may include wrapper `<div>` nodes. */
export function normalizePageToSvgMarkup(pageMarkup: string): string | undefined {
  const startIndex = pageMarkup.indexOf('<svg');
  const endIndex = pageMarkup.lastIndexOf('</svg>');

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return undefined;
  }

  return pageMarkup.slice(startIndex, endIndex + '</svg>'.length);
}

/** Collapse sorted center values so tiny floating-point jitters do not create fake spacing gaps. */
export function collapseSortedCenters(values: number[], tolerance: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const collapsed: number[] = [];

  for (const value of sorted) {
    const last = collapsed[collapsed.length - 1];
    if (last === undefined || Math.abs(value - last) > tolerance) {
      collapsed.push(value);
    }
  }

  return collapsed;
}

/** Convert sorted center points into adjacent horizontal spacing gaps. */
export function buildGaps(sortedValues: number[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < sortedValues.length; index += 1) {
    const current = sortedValues[index];
    const previous = sortedValues[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    gaps.push(current - previous);
  }
  return gaps;
}

/** Count overlaps within one element set and bucket them into critical/minor bins. */
export function countSelfOverlaps(
  elements: SvgElementBounds[],
  criticalMinArea: number,
  minorMinArea: number
): OverlapCounters {
  const counters: OverlapCounters = { critical: 0, minor: 0 };
  for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
    const left = elements[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
      const right = elements[rightIndex];
      if (!right) {
        continue;
      }

      const area = computeIntersectionArea(left.bounds, right.bounds);
      if (area >= criticalMinArea) {
        counters.critical += 1;
      } else if (area >= minorMinArea) {
        counters.minor += 1;
      }
    }
  }
  return counters;
}

/** Count overlaps between two element sets and bucket them into critical/minor bins. */
export function countCrossOverlaps(
  leftElements: SvgElementBounds[],
  rightElements: SvgElementBounds[],
  criticalMinArea: number,
  minorMinArea: number
): OverlapCounters {
  const counters: OverlapCounters = { critical: 0, minor: 0 };
  for (const left of leftElements) {
    for (const right of rightElements) {
      const area = computeIntersectionArea(left.bounds, right.bounds);
      if (area >= criticalMinArea) {
        counters.critical += 1;
      } else if (area >= minorMinArea) {
        counters.minor += 1;
      }
    }
  }
  return counters;
}

/** Count elements that lie outside the nominal page viewport by more than a tolerance. */
export function countOutOfViewport(elements: SvgElementBounds[], viewport: SvgBounds, tolerance: number): number {
  return elements.filter((element) => {
    const bounds = element.bounds;
    const minX = viewport.x - tolerance;
    const minY = viewport.y - tolerance;
    const maxX = viewport.x + viewport.width + tolerance;
    const maxY = viewport.y + viewport.height + tolerance;

    return (
      bounds.x < minX ||
      bounds.y < minY ||
      bounds.x + bounds.width > maxX ||
      bounds.y + bounds.height > maxY
    );
  }).length;
}

/** Compute a union bounds box for a list of bounds; returns `null` when input is empty. */
export function unionBounds(boundsList: SvgBounds[]): SvgBounds | null {
  if (boundsList.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/** Compute minimum vertical gap between stave group bounds; null when fewer than two staves exist. */
export function computeMinimumVerticalGap(staveGroups: SvgElementBounds[]): number | null {
  if (staveGroups.length < 2) {
    return null;
  }

  const sorted = [...staveGroups].sort((left, right) => left.bounds.y - right.bounds.y);
  const rowBands: SvgBounds[] = [];

  // Multiple staves are emitted per measure column; cluster by Y so same-row staves do not
  // look like negative vertical gaps.
  const rowTolerance = 12;
  for (const stave of sorted) {
    const bounds = stave.bounds;
    const band = rowBands.find((candidate) => Math.abs(candidate.y - bounds.y) <= rowTolerance);
    if (!band) {
      rowBands.push({ ...bounds });
      continue;
    }

    const bandBottom = Math.max(band.y + band.height, bounds.y + bounds.height);
    band.y = Math.min(band.y, bounds.y);
    band.height = bandBottom - band.y;
  }

  if (rowBands.length < 2) {
    return null;
  }

  rowBands.sort((left, right) => left.y - right.y);
  let minGap = Number.POSITIVE_INFINITY;

  for (let index = 1; index < rowBands.length; index += 1) {
    const previous = rowBands[index - 1];
    const current = rowBands[index];
    if (!previous || !current) {
      continue;
    }

    const gap = Math.max(0, current.y - (previous.y + previous.height));
    if (Number.isFinite(gap)) {
      minGap = Math.min(minGap, gap);
    }
  }

  return Number.isFinite(minGap) ? Number(minGap.toFixed(4)) : null;
}

/** Read viewport bounds from the primary SVG element (`width/height` or `viewBox`). */
function readSvgViewport(svgMarkup: string): SvgBounds | null {
  const dom = new JSDOM(svgMarkup, { contentType: 'image/svg+xml' });
  try {
    const svg = dom.window.document.querySelector('svg');
    if (!svg) {
      return null;
    }

    const widthAttr = svg.getAttribute('width');
    const heightAttr = svg.getAttribute('height');
    const viewBox = svg.getAttribute('viewBox');

    const widthFromAttr = widthAttr ? parseFloat(widthAttr) : NaN;
    const heightFromAttr = heightAttr ? parseFloat(heightAttr) : NaN;

    if (Number.isFinite(widthFromAttr) && Number.isFinite(heightFromAttr)) {
      return { x: 0, y: 0, width: widthFromAttr, height: heightFromAttr };
    }

    if (viewBox) {
      const values = viewBox
        .trim()
        .split(/\s+/)
        .map((value) => Number.parseFloat(value));
      const x = values[0] ?? Number.NaN;
      const y = values[1] ?? Number.NaN;
      const width = values[2] ?? Number.NaN;
      const height = values[3] ?? Number.NaN;
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(width) &&
        Number.isFinite(height)
      ) {
        return { x, y, width, height };
      }
    }

    return null;
  } finally {
    dom.window.close();
  }
}

/** Compute intersection area between two axis-aligned bounds. */
function computeIntersectionArea(left: SvgBounds, right: SvgBounds): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }

  return (x2 - x1) * (y2 - y1);
}
