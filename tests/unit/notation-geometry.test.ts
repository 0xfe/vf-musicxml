import { describe, expect, it } from 'vitest';

import {
  collectNotationGeometry,
  detectExtremeCurvePaths,
  detectFlagBeamOverlaps,
  deriveSystemCropRegion,
  detectNoteheadBarlineIntrusions,
  estimateSystemVerticalBounds,
  summarizeMeasureSpacingByBarlines,
  summarizeNotationGeometry
} from '../../src/testkit/notation-geometry.js';

/** Minimal SVG snippet used to validate notation-geometry helpers deterministically. */
const SAMPLE_SVG = `
<svg width="200" height="120" viewBox="0 0 200 120">
  <g class="vf-stavebarline"><rect x="100" y="20" width="1" height="80" /></g>
  <g class="vf-notehead"><ellipse cx="100.3" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="60" cy="60" rx="5" ry="3" /></g>
  <g class="vf-stem"><rect x="59" y="30" width="1" height="30" /></g>
  <g class="vf-beam"><rect x="120" y="34" width="20" height="3" /></g>
  <g class="vf-flag"><path d="M 126 33 L 131 33 L 131 39 Z" /></g>
</svg>
`;

/** SVG fixture with two complete measures and deterministic notehead spacing. */
const SPACING_SVG = `
<svg width="240" height="120" viewBox="0 0 240 120">
  <g class="vf-stavebarline"><rect x="20" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="120" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="220" y="20" width="1" height="80" /></g>

  <g class="vf-notehead"><ellipse cx="40" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="60" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="80" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="100" cy="60" rx="5" ry="3" /></g>

  <g class="vf-notehead"><ellipse cx="150" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="170" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="190" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="210" cy="60" rx="5" ry="3" /></g>
</svg>
`;

/** Multi-band spacing fixture where two staves have different x-offsets. */
const MULTI_BAND_SPACING_SVG = `
<svg width="260" height="220" viewBox="0 0 260 220">
  <g class="vf-stavebarline"><rect x="10" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="110" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="210" y="20" width="1" height="80" /></g>

  <g class="vf-notehead"><ellipse cx="30" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="60" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="90" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="140" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="170" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="200" cy="60" rx="5" ry="3" /></g>

  <g class="vf-stavebarline"><rect x="20" y="130" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="120" y="130" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="220" y="130" width="1" height="80" /></g>

  <g class="vf-notehead"><ellipse cx="40" cy="170" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="70" cy="170" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="100" cy="170" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="150" cy="170" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="180" cy="170" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="210" cy="170" rx="5" ry="3" /></g>
</svg>
`;

/** Spacing fixture where the first measure is denser but not truly width-compressed. */
const DENSITY_AWARE_SPACING_SVG = `
<svg width="240" height="120" viewBox="0 0 240 120">
  <g class="vf-stavebarline"><rect x="20" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="120" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="220" y="20" width="1" height="80" /></g>

  <g class="vf-notehead"><ellipse cx="30" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="45" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="60" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="75" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="90" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="105" cy="60" rx="5" ry="3" /></g>

  <g class="vf-notehead"><ellipse cx="140" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="170" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="200" cy="60" rx="5" ry="3" /></g>
</svg>
`;

/** Spacing fixture where first measure is sparse and should not be flagged as compressed. */
const SPARSE_FIRST_MEASURE_SPACING_SVG = `
<svg width="240" height="120" viewBox="0 0 240 120">
  <g class="vf-stavebarline"><rect x="20" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="120" y="20" width="1" height="80" /></g>
  <g class="vf-stavebarline"><rect x="220" y="20" width="1" height="80" /></g>

  <g class="vf-notehead"><ellipse cx="50" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="80" cy="60" rx="5" ry="3" /></g>

  <g class="vf-notehead"><ellipse cx="140" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="170" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="200" cy="60" rx="5" ry="3" /></g>
  <g class="vf-notehead"><ellipse cx="230" cy="60" rx="5" ry="3" /></g>
</svg>
`;

/** Multi-system barline layout used to validate system crop-region extraction. */
const SYSTEM_BOUNDS_SVG = `
<svg width="240" height="260" viewBox="0 0 240 260">
  <g class="vf-stavebarline"><rect x="20" y="10" width="1" height="60" /></g>
  <g class="vf-stavebarline"><rect x="200" y="10" width="1" height="60" /></g>
  <g class="vf-stavebarline"><rect x="20" y="90" width="1" height="60" /></g>
  <g class="vf-stavebarline"><rect x="200" y="90" width="1" height="60" /></g>
  <g class="vf-stavebarline"><rect x="20" y="170" width="1" height="60" /></g>
  <g class="vf-stavebarline"><rect x="200" y="170" width="1" height="60" /></g>
</svg>
`;

/** Curve-path fixture for slur-shape anomaly detection checks. */
const EXTREME_CURVE_SVG = `
<svg width="300" height="200" viewBox="0 0 300 200">
  <path stroke-width="1" fill="none" d="M40 150C100 120,160 90,220 40" />
  <path stroke-width="1" fill="none" d="M40 80C90 75,140 75,190 80" />
  <path stroke-width="1" fill="black" d="M40 40C70 20,100 20,130 40" />
  <path stroke="#000" fill="none" d="M20 190c60 -20,120 -40,180 -120" />
</svg>
`;

describe('notation geometry testkit', () => {
  it('collects core notation classes and reports summary metrics', () => {
    const geometry = collectNotationGeometry(SAMPLE_SVG);
    const summary = summarizeNotationGeometry(geometry);

    expect(summary.noteheadCount).toBe(2);
    expect(summary.stemCount).toBe(1);
    expect(summary.beamCount).toBe(1);
    expect(summary.flagCount).toBe(1);
    expect(summary.flagBeamOverlapCount).toBe(1);
    expect(summary.barlineCount).toBe(1);
    expect(summary.noteheadBarlineIntrusionCount).toBe(1);
  });

  it('detects flag/beam overlaps for beam-suppression regressions', () => {
    const geometry = collectNotationGeometry(SAMPLE_SVG);
    const overlaps = detectFlagBeamOverlaps(geometry);

    expect(overlaps.length).toBe(1);
    expect(overlaps[0]?.horizontalOverlap).toBeGreaterThan(0);
    expect(overlaps[0]?.verticalOverlap).toBeGreaterThan(0);
  });

  it('supports caller thresholds for intrusion sensitivity', () => {
    const geometry = collectNotationGeometry(SAMPLE_SVG);
    const strictIntrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 2.5
    });

    expect(strictIntrusions.length).toBe(0);
  });

  it('summarizes measure spacing by barline-defined ranges', () => {
    const geometry = collectNotationGeometry(SPACING_SVG);
    const spacing = summarizeMeasureSpacingByBarlines(geometry);

    expect(spacing.evaluatedBandCount).toBe(1);
    expect(spacing.bandSummaries.length).toBe(1);
    expect(spacing.samples.length).toBe(2);
    expect(spacing.firstMeasureAverageGap).toBe(20);
    expect(spacing.medianOtherMeasuresAverageGap).toBe(20);
    expect(spacing.firstToMedianOtherGapRatio).toBe(1);
  });

  it('partitions spacing analysis by vertical staff bands', () => {
    const geometry = collectNotationGeometry(MULTI_BAND_SPACING_SVG);
    const spacing = summarizeMeasureSpacingByBarlines(geometry);

    expect(spacing.evaluatedBandCount).toBe(2);
    expect(spacing.bandSummaries.length).toBe(2);
    expect(spacing.samples.length).toBe(4);
    expect(spacing.firstMeasureAverageGap).toBe(30);
    expect(spacing.medianOtherMeasuresAverageGap).toBe(30);
    expect(spacing.firstToMedianOtherGapRatio).toBe(1);
  });

  it('reports density-aware width ratios for first-measure compression triage', () => {
    const geometry = collectNotationGeometry(DENSITY_AWARE_SPACING_SVG);
    const spacing = summarizeMeasureSpacingByBarlines(geometry);
    const summary = spacing.bandSummaries[0];

    expect(summary).toBeDefined();
    expect(summary?.firstToMedianOtherGapRatio).toBe(0.5);
    expect(summary?.firstMeasureNoteheadCount).toBe(6);
    expect(summary?.medianOtherMeasuresNoteheadCount).toBe(3);
    expect(summary?.firstToMedianOtherEstimatedWidthRatio).toBe(1.25);
  });

  it('does not over-report compression when opening measures are sparse', () => {
    const geometry = collectNotationGeometry(SPARSE_FIRST_MEASURE_SPACING_SVG);
    const spacing = summarizeMeasureSpacingByBarlines(geometry);
    const summary = spacing.bandSummaries[0];

    expect(summary).toBeDefined();
    expect(summary?.firstToMedianOtherGapRatio).toBe(1);
    expect(summary?.firstMeasureNoteheadCount).toBe(2);
    expect(summary?.medianOtherMeasuresNoteheadCount).toBe(3);
    expect(summary?.firstToMedianOtherEstimatedWidthRatio).toBe(1);
  });

  it('estimates system bounds from grouped staff bands', () => {
    const geometry = collectNotationGeometry(SYSTEM_BOUNDS_SVG);
    const systems = estimateSystemVerticalBounds(geometry, 2);

    expect(systems.length).toBe(1);
    expect(systems[0]?.top).toBe(10);
    expect(systems[0]?.bottom).toBe(150);
  });

  it('derives pixel crop regions from selected systems', () => {
    const geometry = collectNotationGeometry(SYSTEM_BOUNDS_SVG);
    const crop = deriveSystemCropRegion(geometry, 240, 260, {
      stavesPerSystem: 2,
      startSystemIndex: 0,
      systemCount: 1,
      includeFullWidth: true,
      headerPadding: 12,
      paddingTop: 8,
      paddingBottom: 10
    });

    expect(crop).toEqual({
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      unit: 'pixels'
    });
  });

  it('detects steep curve paths for slur-routing anomaly checks', () => {
    const extremes = detectExtremeCurvePaths(EXTREME_CURVE_SVG, {
      minVerticalDelta: 50,
      minHorizontalSpan: 80,
      minSlopeRatio: 0.5
    });

    expect(extremes.length).toBe(2);
    expect(extremes[0]?.deltaX).toBeGreaterThan(100);
    expect(extremes[0]?.deltaY).toBeGreaterThan(100);
  });
});
