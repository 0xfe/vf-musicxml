import { describe, expect, it } from 'vitest';

import {
  collectNotationGeometry,
  detectNoteheadBarlineIntrusions,
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

describe('notation geometry testkit', () => {
  it('collects core notation classes and reports summary metrics', () => {
    const geometry = collectNotationGeometry(SAMPLE_SVG);
    const summary = summarizeNotationGeometry(geometry);

    expect(summary.noteheadCount).toBe(2);
    expect(summary.stemCount).toBe(1);
    expect(summary.beamCount).toBe(1);
    expect(summary.barlineCount).toBe(1);
    expect(summary.noteheadBarlineIntrusionCount).toBe(1);
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

    expect(spacing.samples.length).toBe(2);
    expect(spacing.firstMeasureAverageGap).toBe(20);
    expect(spacing.medianOtherMeasuresAverageGap).toBe(20);
    expect(spacing.firstToMedianOtherGapRatio).toBe(1);
  });
});
