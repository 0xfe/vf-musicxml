import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import {
  comparePngBuffers,
  cropPngBuffer,
  extractFirstSvgMarkup,
  flattenPngBufferToWhite,
  rasterizeSvg
} from '../../src/testkit/headless-visual.js';

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

/** Transparent SVG used to validate alpha flattening behavior. */
const TRANSPARENT_NOTE = `
<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="20" height="20" fill="none"/>
  <circle cx="10" cy="10" r="4" fill="black"/>
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

  it('crops png data with ratio and pixel regions', () => {
    const rendered = rasterizeSvg(RED_SQUARE);

    const ratioCrop = cropPngBuffer(rendered.png, {
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
      unit: 'ratio'
    });
    const ratioDecoded = PNG.sync.read(ratioCrop);
    expect(ratioDecoded.width).toBe(40);
    expect(ratioDecoded.height).toBe(40);

    const pixelCrop = cropPngBuffer(rendered.png, {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      unit: 'pixels'
    });
    const pixelDecoded = PNG.sync.read(pixelCrop);
    expect(pixelDecoded.width).toBe(20);
    expect(pixelDecoded.height).toBe(20);
  });

  it('flattens transparent png data onto a white background', () => {
    const rendered = rasterizeSvg(TRANSPARENT_NOTE);
    const flattened = flattenPngBufferToWhite(rendered.png);
    const decoded = PNG.sync.read(flattened);

    const topLeftIndex = 0;
    expect(decoded.data[topLeftIndex]).toBe(255);
    expect(decoded.data[topLeftIndex + 1]).toBe(255);
    expect(decoded.data[topLeftIndex + 2]).toBe(255);
    expect(decoded.data[topLeftIndex + 3]).toBe(255);
  });
});
