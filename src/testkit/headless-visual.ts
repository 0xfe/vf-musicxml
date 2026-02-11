import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ssim } from 'ssim.js';

/** One rendered PNG frame decoded into rgba bytes. */
interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Width/height envelope used when normalizing image dimensions for diffing. */
interface ImageEnvelope {
  width: number;
  height: number;
}

/** Binary-ink threshold used for structural comparison extraction. */
const STRUCTURAL_INK_THRESHOLD = 235;
/** Radius for tolerant nearby-ink matching across renderer/font differences. */
const STRUCTURAL_MATCH_RADIUS = 2;

/** Comparison summary emitted by headless visual regression checks. */
export interface HeadlessVisualDiff {
  width: number;
  height: number;
  mismatchPixels: number;
  mismatchRatio: number;
  structuralMismatchPixels: number;
  structuralMismatchRatio: number;
  ssim: number;
  alignmentShiftX: number;
  alignmentShiftY: number;
  diffPng: Buffer;
}

/** Optional image-alignment controls for `comparePngBuffers`. */
export interface ComparePngBuffersOptions {
  alignByInkCentroid?: boolean;
  maxAlignmentShift?: number;
  alignmentInkThreshold?: number;
  alignmentAxis?: 'both' | 'x' | 'y';
}

/** Raster output metadata for one SVG-to-PNG conversion. */
export interface RasterizedSvgResult {
  width: number;
  height: number;
  png: Buffer;
}

/** Unit mode used to interpret crop regions. */
export type HeadlessVisualCropUnit = 'pixels' | 'ratio';

/** Resize mode used when normalizing PNGs for cross-source comparison. */
export type HeadlessVisualResizeMode = 'fit' | 'stretch';

/** Caller-facing crop region used to isolate comparable score excerpts. */
export interface HeadlessVisualCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  unit?: HeadlessVisualCropUnit;
}

/** Options for whitespace trimming of already flattened PNG buffers. */
export interface TrimPngWhitespaceOptions {
  threshold?: number;
  padding?: number;
}

/** Options for deterministic PNG resizing without browser dependencies. */
export interface ResizePngBufferOptions {
  width: number;
  height: number;
  mode?: HeadlessVisualResizeMode;
  background?: [number, number, number, number];
}

/** Compact width/height tuple for decoded PNG buffers. */
export interface PngDimensions {
  width: number;
  height: number;
}

/**
 * Extract first `<svg>...</svg>` segment from render output that may include wrapper div nodes.
 * Returns `undefined` when no SVG tag can be found.
 */
export function extractFirstSvgMarkup(pageMarkup: string): string | undefined {
  const startIndex = pageMarkup.indexOf('<svg');
  const endIndex = pageMarkup.lastIndexOf('</svg>');
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return undefined;
  }

  return pageMarkup.slice(startIndex, endIndex + '</svg>'.length);
}

/**
 * Rasterize SVG into PNG bytes using `resvg` without requiring a browser runtime.
 * This is the portability path for server-side visual checks.
 */
export function rasterizeSvg(svgMarkup: string): RasterizedSvgResult {
  const resvg = new Resvg(ensureSvgNamespace(svgMarkup), {
    fitTo: { mode: 'original' },
    // We intentionally allow system fonts so text-bearing fixtures still render
    // on headless hosts without bundling local font assets.
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial'
    }
  });

  const rendered = resvg.render();
  const png = Buffer.from(rendered.asPng());

  return {
    width: rendered.width,
    height: rendered.height,
    png
  };
}

/** Ensure root SVG tag carries the XML namespace expected by strict rasterizers. */
function ensureSvgNamespace(svgMarkup: string): string {
  if (svgMarkup.includes('xmlns=')) {
    return svgMarkup;
  }

  return svgMarkup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
}

/**
 * Compare two PNG buffers by pixel mismatch plus SSIM (perceptual structural similarity).
 * Images are padded to a shared envelope so dimension drift is captured in diff output.
 */
export function comparePngBuffers(
  actualPng: Buffer,
  expectedPng: Buffer,
  options: ComparePngBuffersOptions = {}
): HeadlessVisualDiff {
  const actual = decodePng(actualPng);
  const expected = decodePng(expectedPng);
  const envelope = {
    width: Math.max(actual.width, expected.width),
    height: Math.max(actual.height, expected.height)
  };

  const normalizedActual = normalizeToEnvelope(actual, envelope);
  const normalizedExpected = normalizeToEnvelope(expected, envelope);
  let flattenedActual = flattenDecodedPng(normalizedActual);
  const flattenedExpected = flattenDecodedPng(normalizedExpected);
  let alignmentShiftX = 0;
  let alignmentShiftY = 0;

  if (options.alignByInkCentroid) {
    const alignmentInkThreshold = options.alignmentInkThreshold ?? STRUCTURAL_INK_THRESHOLD;
    const maxAlignmentShift = Math.max(0, Math.floor(options.maxAlignmentShift ?? 48));
    const alignmentAxis = options.alignmentAxis ?? 'both';
    const shift = estimateInkCentroidShift(
      flattenedActual,
      flattenedExpected,
      alignmentInkThreshold,
      maxAlignmentShift,
      alignmentAxis
    );
    alignmentShiftX = shift.shiftX;
    alignmentShiftY = shift.shiftY;
    if (alignmentShiftX !== 0 || alignmentShiftY !== 0) {
      flattenedActual = translateDecodedPng(flattenedActual, alignmentShiftX, alignmentShiftY);
    }
  }

  const diff = new PNG({ width: envelope.width, height: envelope.height });

  const mismatchPixels = pixelmatch(
    flattenedActual.data,
    flattenedExpected.data,
    diff.data,
    envelope.width,
    envelope.height,
    {
      threshold: 0.1
    }
  );
  const mismatchRatio = mismatchPixels / (envelope.width * envelope.height);
  const structural = compareStructuralInkMasks(flattenedActual, flattenedExpected);

  const ssimResult = ssim(
    {
      data: new Uint8ClampedArray(flattenedActual.data),
      width: envelope.width,
      height: envelope.height
    },
    {
      data: new Uint8ClampedArray(flattenedExpected.data),
      width: envelope.width,
      height: envelope.height
    }
  );

  return {
    width: envelope.width,
    height: envelope.height,
    mismatchPixels,
    mismatchRatio: Number(mismatchRatio.toFixed(6)),
    structuralMismatchPixels: structural.mismatchPixels,
    structuralMismatchRatio: structural.mismatchRatio,
    ssim: Number(ssimResult.mssim.toFixed(6)),
    alignmentShiftX,
    alignmentShiftY,
    diffPng: PNG.sync.write(diff)
  };
}

/** Summary payload for the structural-ink mismatch metric. */
interface StructuralMismatchSummary {
  mismatchPixels: number;
  mismatchRatio: number;
}

/** Binary ink-mask bundle used by the structural matcher. */
interface InkMaskSummary {
  mask: Uint8Array;
  inkCount: number;
}

/**
 * Compare images in a font/style-tolerant way.
 * We binarize dark "ink" and allow nearby matches within a small radius.
 */
function compareStructuralInkMasks(
  actual: DecodedPng,
  expected: DecodedPng
): StructuralMismatchSummary {
  const actualMask = buildInkMask(actual, STRUCTURAL_INK_THRESHOLD);
  const expectedMask = buildInkMask(expected, STRUCTURAL_INK_THRESHOLD);

  let unmatchedActual = 0;
  for (let index = 0; index < actualMask.mask.length; index += 1) {
    if (actualMask.mask[index] !== 1) {
      continue;
    }

    const x = index % actual.width;
    const y = Math.floor(index / actual.width);
    if (!hasNearbyInk(expectedMask.mask, expected.width, expected.height, x, y, STRUCTURAL_MATCH_RADIUS)) {
      unmatchedActual += 1;
    }
  }

  let unmatchedExpected = 0;
  for (let index = 0; index < expectedMask.mask.length; index += 1) {
    if (expectedMask.mask[index] !== 1) {
      continue;
    }

    const x = index % expected.width;
    const y = Math.floor(index / expected.width);
    if (!hasNearbyInk(actualMask.mask, actual.width, actual.height, x, y, STRUCTURAL_MATCH_RADIUS)) {
      unmatchedExpected += 1;
    }
  }

  const mismatchPixels = unmatchedActual + unmatchedExpected;
  const denominator = Math.max(1, actualMask.inkCount + expectedMask.inkCount);
  return {
    mismatchPixels,
    mismatchRatio: Number((mismatchPixels / denominator).toFixed(6))
  };
}

/** Build an ink mask where dark pixels are marked as notation strokes. */
function buildInkMask(image: DecodedPng, threshold: number): InkMaskSummary {
  const mask = new Uint8Array(image.width * image.height);
  let inkCount = 0;

  for (let index = 0; index < mask.length; index += 1) {
    const dataIndex = index * 4;
    const red = image.data[dataIndex] ?? 255;
    const green = image.data[dataIndex + 1] ?? 255;
    const blue = image.data[dataIndex + 2] ?? 255;
    const luminance = (red + green + blue) / 3;
    if (luminance >= threshold) {
      continue;
    }

    mask[index] = 1;
    inkCount += 1;
  }

  return {
    mask,
    inkCount
  };
}

/** Check whether any ink pixel exists near `(x,y)` within `radius`. */
function hasNearbyInk(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number
): boolean {
  const minX = Math.max(0, x - radius);
  const maxX = Math.min(width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(height - 1, y + radius);

  for (let row = minY; row <= maxY; row += 1) {
    for (let column = minX; column <= maxX; column += 1) {
      if (mask[row * width + column] === 1) {
        return true;
      }
    }
  }

  return false;
}

/** Clamp one numeric value to an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Ink centroid summary used for coarse translation alignment. */
interface InkCentroid {
  x: number;
  y: number;
  count: number;
}

/** One coarse translation estimate for aligning two notation images. */
interface InkCentroidShift {
  shiftX: number;
  shiftY: number;
}

/** Estimate global shift from ink-centroid delta, clamped for safety. */
function estimateInkCentroidShift(
  actual: DecodedPng,
  expected: DecodedPng,
  threshold: number,
  maxAlignmentShift: number,
  alignmentAxis: ComparePngBuffersOptions['alignmentAxis']
): InkCentroidShift {
  const actualCentroid = computeInkCentroid(actual, threshold);
  const expectedCentroid = computeInkCentroid(expected, threshold);
  if (!actualCentroid || !expectedCentroid) {
    return { shiftX: 0, shiftY: 0 };
  }

  const rawShiftX = Math.round(expectedCentroid.x - actualCentroid.x);
  const rawShiftY = Math.round(expectedCentroid.y - actualCentroid.y);

  const allowX = alignmentAxis !== 'y';
  const allowY = alignmentAxis !== 'x';
  return {
    shiftX: allowX ? clamp(rawShiftX, -maxAlignmentShift, maxAlignmentShift) : 0,
    shiftY: allowY ? clamp(rawShiftY, -maxAlignmentShift, maxAlignmentShift) : 0
  };
}

/** Compute notation-ink centroid for one flattened image. */
function computeInkCentroid(image: DecodedPng, threshold: number): InkCentroid | undefined {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const red = image.data[index] ?? 255;
      const green = image.data[index + 1] ?? 255;
      const blue = image.data[index + 2] ?? 255;
      const luminance = (red + green + blue) / 3;
      if (luminance >= threshold) {
        continue;
      }

      sumX += x;
      sumY += y;
      count += 1;
    }
  }

  if (count === 0) {
    return undefined;
  }

  return {
    x: sumX / count,
    y: sumY / count,
    count
  };
}

/** Translate one decoded image by integer pixels, filling exposed areas with white. */
function translateDecodedPng(image: DecodedPng, shiftX: number, shiftY: number): DecodedPng {
  if (shiftX === 0 && shiftY === 0) {
    return image;
  }

  const translated = new Uint8Array(image.width * image.height * 4);
  translated.fill(255);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const targetX = x + shiftX;
      const targetY = y + shiftY;
      if (targetX < 0 || targetX >= image.width || targetY < 0 || targetY >= image.height) {
        continue;
      }

      const sourceIndex = (y * image.width + x) * 4;
      const targetIndex = (targetY * image.width + targetX) * 4;
      translated[targetIndex] = image.data[sourceIndex] ?? 255;
      translated[targetIndex + 1] = image.data[sourceIndex + 1] ?? 255;
      translated[targetIndex + 2] = image.data[sourceIndex + 2] ?? 255;
      translated[targetIndex + 3] = image.data[sourceIndex + 3] ?? 255;
    }
  }

  return {
    width: image.width,
    height: image.height,
    data: translated
  };
}

/**
 * Crop PNG data to a requested region.
 * This is used by M8 golden comparisons when references represent excerpts
 * (for example, first N bars) instead of whole rendered pages.
 */
export function cropPngBuffer(png: Buffer, region: HeadlessVisualCropRegion): Buffer {
  const decoded = PNG.sync.read(png);
  const crop = resolveCropRegion(decoded.width, decoded.height, region);
  const cropped = new PNG({ width: crop.width, height: crop.height });

  PNG.bitblt(decoded, cropped, crop.x, crop.y, crop.width, crop.height, 0, 0);
  return PNG.sync.write(cropped);
}

/** Flatten alpha-channel PNG data onto an opaque white background. */
export function flattenPngBufferToWhite(png: Buffer): Buffer {
  const decoded = decodePng(png);
  const flattened = flattenDecodedPng(decoded);
  const image = new PNG({ width: flattened.width, height: flattened.height });
  image.data.set(flattened.data);
  return PNG.sync.write(image);
}

/**
 * Return PNG width/height without exposing decode internals to callers.
 * Used by golden/eval tooling when normalizing excerpt dimensions.
 */
export function getPngDimensions(png: Buffer): PngDimensions {
  const decoded = decodePng(png);
  return {
    width: decoded.width,
    height: decoded.height
  };
}

/**
 * Trim white margins from PNG data.
 * This reduces sensitivity to page-margin differences when comparing equivalent
 * score excerpts from different rendering engines.
 */
export function trimPngWhitespace(
  png: Buffer,
  options: TrimPngWhitespaceOptions = {}
): Buffer {
  const threshold = options.threshold ?? 250;
  const padding = Math.max(0, Math.floor(options.padding ?? 0));
  const flattened = flattenDecodedPng(decodePng(png));
  const { width, height, data } = flattened;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 255;
      const green = data[index + 1] ?? 255;
      const blue = data[index + 2] ?? 255;

      if (red >= threshold && green >= threshold && blue >= threshold) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return png;
  }

  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  const cropWidth = right - x + 1;
  const cropHeight = bottom - y + 1;

  const cropped = new PNG({ width: cropWidth, height: cropHeight });
  for (let row = 0; row < cropHeight; row += 1) {
    for (let column = 0; column < cropWidth; column += 1) {
      const sourceX = x + column;
      const sourceY = y + row;
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (row * cropWidth + column) * 4;
      cropped.data[targetIndex] = data[sourceIndex] ?? 255;
      cropped.data[targetIndex + 1] = data[sourceIndex + 1] ?? 255;
      cropped.data[targetIndex + 2] = data[sourceIndex + 2] ?? 255;
      cropped.data[targetIndex + 3] = data[sourceIndex + 3] ?? 255;
    }
  }

  return PNG.sync.write(cropped);
}

/**
 * Resize PNG data with deterministic nearest-neighbor sampling.
 * This path is intentionally simple and dependency-light for CI portability.
 */
export function resizePngBuffer(png: Buffer, options: ResizePngBufferOptions): Buffer {
  const targetWidth = clampToInt(options.width, 1, Number.MAX_SAFE_INTEGER);
  const targetHeight = clampToInt(options.height, 1, Number.MAX_SAFE_INTEGER);
  const mode = options.mode ?? 'fit';
  const background = options.background ?? [255, 255, 255, 255];
  const source = flattenDecodedPng(decodePng(png));

  if (source.width === targetWidth && source.height === targetHeight) {
    return png;
  }

  const destination = new PNG({
    width: targetWidth,
    height: targetHeight,
    fill: true
  });

  for (let index = 0; index < destination.data.length; index += 4) {
    destination.data[index] = background[0];
    destination.data[index + 1] = background[1];
    destination.data[index + 2] = background[2];
    destination.data[index + 3] = background[3];
  }

  if (mode === 'stretch') {
    blitNearestScaled(source, destination, 0, 0, targetWidth, targetHeight);
    return PNG.sync.write(destination);
  }

  const scale = Math.min(targetWidth / source.width, targetHeight / source.height);
  const scaledWidth = Math.max(1, Math.round(source.width * scale));
  const scaledHeight = Math.max(1, Math.round(source.height * scale));
  const offsetX = Math.floor((targetWidth - scaledWidth) / 2);
  const offsetY = Math.floor((targetHeight - scaledHeight) / 2);
  blitNearestScaled(source, destination, offsetX, offsetY, scaledWidth, scaledHeight);

  return PNG.sync.write(destination);
}

/** Decode one PNG buffer into width/height/rgba bytes. */
function decodePng(png: Buffer): DecodedPng {
  const decoded = PNG.sync.read(png);
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data
  };
}

/** Scale source image into one destination region via nearest-neighbor sampling. */
function blitNearestScaled(
  source: DecodedPng,
  destination: PNG,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number
): void {
  for (let y = 0; y < destHeight; y += 1) {
    const sourceY = Math.min(
      source.height - 1,
      Math.max(0, Math.floor(((y + 0.5) * source.height) / destHeight - 0.5))
    );
    for (let x = 0; x < destWidth; x += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.max(0, Math.floor(((x + 0.5) * source.width) / destWidth - 0.5))
      );

      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const destinationIndex = ((destY + y) * destination.width + (destX + x)) * 4;
      destination.data[destinationIndex] = source.data[sourceIndex] ?? 255;
      destination.data[destinationIndex + 1] = source.data[sourceIndex + 1] ?? 255;
      destination.data[destinationIndex + 2] = source.data[sourceIndex + 2] ?? 255;
      destination.data[destinationIndex + 3] = source.data[sourceIndex + 3] ?? 255;
    }
  }
}

/** Resolve crop coordinates into a clamped pixel-space box. */
function resolveCropRegion(
  imageWidth: number,
  imageHeight: number,
  region: HeadlessVisualCropRegion
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const unit = region.unit ?? 'pixels';
  const rawX = unit === 'ratio' ? region.x * imageWidth : region.x;
  const rawY = unit === 'ratio' ? region.y * imageHeight : region.y;
  const rawWidth = unit === 'ratio' ? region.width * imageWidth : region.width;
  const rawHeight = unit === 'ratio' ? region.height * imageHeight : region.height;

  const x = clampToInt(rawX, 0, Math.max(0, imageWidth - 1));
  const y = clampToInt(rawY, 0, Math.max(0, imageHeight - 1));
  const width = clampToInt(rawWidth, 1, Math.max(1, imageWidth - x));
  const height = clampToInt(rawHeight, 1, Math.max(1, imageHeight - y));

  return { x, y, width, height };
}

/** Clamp numeric crop values to deterministic integer coordinates. */
function clampToInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  const rounded = Math.round(value);
  return Math.max(minimum, Math.min(maximum, rounded));
}

/**
 * Pad image data onto a shared envelope with white background.
 * This keeps diff semantics stable when one rendering changes overall dimensions.
 */
function normalizeToEnvelope(image: DecodedPng, envelope: ImageEnvelope): DecodedPng {
  if (image.width === envelope.width && image.height === envelope.height) {
    return image;
  }

  const normalized = new PNG({
    width: envelope.width,
    height: envelope.height,
    fill: true
  });

  // Fill with opaque white for deterministic "empty space" semantics.
  for (let i = 0; i < normalized.data.length; i += 4) {
    normalized.data[i] = 255;
    normalized.data[i + 1] = 255;
    normalized.data[i + 2] = 255;
    normalized.data[i + 3] = 255;
  }

  PNG.bitblt(
    {
      width: image.width,
      height: image.height,
      data: image.data
    } as PNG,
    normalized,
    0,
    0,
    image.width,
    image.height,
    0,
    0
  );

  return {
    width: envelope.width,
    height: envelope.height,
    data: normalized.data
  };
}

/** Convert transparent PNG pixels into opaque white-composited pixels. */
function flattenDecodedPng(image: DecodedPng): DecodedPng {
  const flattened = new Uint8Array(image.data.length);

  for (let index = 0; index < image.data.length; index += 4) {
    const red = image.data[index] ?? 0;
    const green = image.data[index + 1] ?? 0;
    const blue = image.data[index + 2] ?? 0;
    const alpha = (image.data[index + 3] ?? 0) / 255;

    flattened[index] = Math.round(red * alpha + 255 * (1 - alpha));
    flattened[index + 1] = Math.round(green * alpha + 255 * (1 - alpha));
    flattened[index + 2] = Math.round(blue * alpha + 255 * (1 - alpha));
    flattened[index + 3] = 255;
  }

  return {
    width: image.width,
    height: image.height,
    data: flattened
  };
}
