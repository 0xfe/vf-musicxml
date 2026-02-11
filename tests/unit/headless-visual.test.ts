import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import {
  comparePngBuffers,
  cropPngBuffer,
  extractFirstSvgMarkup,
  flattenPngBufferToWhite,
  getPngDimensions,
  rasterizeSvg,
  resizePngBuffer,
  trimPngWhitespace
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

/** Same square translated right to validate centroid alignment in comparisons. */
const SHIFTED_RED_SQUARE = `
<svg width="80" height="40" viewBox="0 0 80 40" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="80" height="40" fill="white"/>
  <rect x="16" y="10" width="20" height="20" fill="red"/>
</svg>
`;

/** Transparent SVG used to validate alpha flattening behavior. */
const TRANSPARENT_NOTE = `
<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="20" height="20" fill="none"/>
  <circle cx="10" cy="10" r="4" fill="black"/>
</svg>
`;

/** SVG with significant white margins to exercise whitespace trimming. */
const BLACK_RECT_WITH_MARGIN = `
<svg width="100" height="80" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="100" height="80" fill="white"/>
  <rect x="40" y="30" width="20" height="10" fill="black"/>
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
    expect(changed.structuralMismatchPixels).toBeGreaterThan(0);
    expect(changed.structuralMismatchRatio).toBeGreaterThan(0);
    expect(changed.ssim).toBeLessThan(1);
    expect(changed.diffPng.byteLength).toBeGreaterThan(0);
  });

  it('optionally aligns images by ink centroid before diffing', () => {
    const red = rasterizeSvg(RED_SQUARE);
    const shifted = rasterizeSvg(SHIFTED_RED_SQUARE);

    const unaligned = comparePngBuffers(red.png, shifted.png);
    const aligned = comparePngBuffers(red.png, shifted.png, {
      alignByInkCentroid: true,
      maxAlignmentShift: 12,
      alignmentAxis: 'x'
    });

    expect(unaligned.mismatchPixels).toBeGreaterThan(0);
    expect(aligned.alignmentShiftX).not.toBe(0);
    expect(aligned.alignmentShiftY).toBe(0);
    expect(aligned.mismatchRatio).toBeLessThan(unaligned.mismatchRatio);
    expect(aligned.ssim).toBeGreaterThan(unaligned.ssim);
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

  it('trims white margins around non-white content', () => {
    const rendered = rasterizeSvg(BLACK_RECT_WITH_MARGIN);
    const trimmed = trimPngWhitespace(rendered.png);
    const dimensions = getPngDimensions(trimmed);

    expect(dimensions.width).toBe(20);
    expect(dimensions.height).toBe(10);
  });

  it('resizes png buffers in fit mode with deterministic dimensions', () => {
    const rendered = rasterizeSvg(RED_SQUARE);
    const resized = resizePngBuffer(rendered.png, {
      width: 120,
      height: 120,
      mode: 'fit'
    });
    const dimensions = getPngDimensions(resized);

    expect(dimensions.width).toBe(120);
    expect(dimensions.height).toBe(120);

    const decoded = PNG.sync.read(resized);
    const topLeft = 0;
    expect(decoded.data[topLeft]).toBe(255);
    expect(decoded.data[topLeft + 1]).toBe(255);
    expect(decoded.data[topLeft + 2]).toBe(255);
  });
});
