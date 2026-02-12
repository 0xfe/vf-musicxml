import { describe, expect, it } from 'vitest';

import { buildCodeHistogram } from '../../src/testkit/conformance-report.js';
import {
  computeWeightedQualityScore,
  scoreBeamStemRestQuality
} from '../../src/testkit/conformance-quality-scoring.js';
import { normalizePageToSvgMarkup } from '../../src/testkit/conformance-quality-geometry.js';

describe('conformance refactor modules', () => {
  it('builds deterministic histograms from diagnostics', () => {
    const histogram = buildCodeHistogram([
      { code: 'A', severity: 'warning', message: 'first' },
      { code: 'A', severity: 'warning', message: 'second' },
      { code: 'B', severity: 'error', message: 'third' }
    ]);

    expect(histogram).toEqual({ A: 2, B: 1 });
  });

  it('keeps weighted-score and flag/beam scoring behavior deterministic', () => {
    const weighted = computeWeightedQualityScore(
      { Q1: 4, Q2: 4, Q3: 4, Q4: 4, Q5: 4, Q6: 4, Q7: 4 },
      { Q1: 0.2, Q2: 0.2, Q3: 0.15, Q4: 0.15, Q5: 0.1, Q6: 0.1, Q7: 0.1 }
    );
    expect(weighted).toBe(4);

    const q3 = scoreBeamStemRestQuality({
      noteheadCount: 12,
      stemCount: 12,
      beamCount: 3,
      flagBeamOverlapCount: 2,
      stemBounds: new Array(12).fill({ x: 0, y: 0, width: 1, height: 30 }),
      stemBeamDiagnostics: 0
    });
    expect(q3).toBeLessThan(4);
  });

  it('extracts svg payload from wrapped markup', () => {
    const markup = '<div class="wrapper"><svg width="10" height="10"></svg></div>';
    expect(normalizePageToSvgMarkup(markup)).toBe('<svg width="10" height="10"></svg>');
    expect(normalizePageToSvgMarkup('<div>no svg</div>')).toBeUndefined();
  });
});
