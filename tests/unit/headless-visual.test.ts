import { describe, expect, it } from 'vitest';

import { comparePngBuffers, extractFirstSvgMarkup, rasterizeSvg } from '../../src/testkit/headless-visual.js';

/** Simple SVG used to validate deterministic rasterization and diff behavior. */
const RED_SQUARE = `
<svg width="80" height="40" viewBox="0 0 80 40" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="80" height="40" fill="white"/>
  <rect x="10" y="10" width="20" height="20" fill="red"/>
</svg>
`;

/** Alternate SVG with changed shape for mismatch assertions. */
const BLUE_SQUARE = `
<svg width="80" height="40" viewBox="0 0 80 40" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="80" height="40" fill="white"/>
  <rect x="50" y="10" width="20" height="20" fill="blue"/>
</svg>
`;

describe('headless visual helpers', () => {
  it('extracts first svg segment from wrapped html', () => {
    const markup = `<div class="surface"><svg width="10" height="10"></svg></div>`;
    const svg = extractFirstSvgMarkup(markup);

    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('rasterizes svg and computes stable mismatch/ssim metrics', () => {
    const red = rasterizeSvg(RED_SQUARE);
    const blue = rasterizeSvg(BLUE_SQUARE);
    const identical = comparePngBuffers(red.png, red.png);
    const changed = comparePngBuffers(red.png, blue.png);

    expect(red.width).toBe(80);
    expect(red.height).toBe(40);

    expect(identical.mismatchPixels).toBe(0);
    expect(identical.mismatchRatio).toBe(0);
    expect(identical.ssim).toBe(1);

    expect(changed.mismatchPixels).toBeGreaterThan(0);
    expect(changed.mismatchRatio).toBeGreaterThan(0);
    expect(changed.ssim).toBeLessThan(1);
    expect(changed.diffPng.byteLength).toBeGreaterThan(0);
  });
});
