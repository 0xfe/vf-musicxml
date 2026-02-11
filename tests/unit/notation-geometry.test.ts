import { describe, expect, it } from 'vitest';

import { collectNotationGeometry, detectNoteheadBarlineIntrusions, summarizeNotationGeometry } from '../../src/testkit/notation-geometry.js';

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
});
