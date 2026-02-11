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

/** Comparison summary emitted by headless visual regression checks. */
export interface HeadlessVisualDiff {
  width: number;
  height: number;
  mismatchPixels: number;
  mismatchRatio: number;
  ssim: number;
  diffPng: Buffer;
}

/** Raster output metadata for one SVG-to-PNG conversion. */
export interface RasterizedSvgResult {
  width: number;
  height: number;
  png: Buffer;
}

/** Unit mode used to interpret crop regions. */
export type HeadlessVisualCropUnit = 'pixels' | 'ratio';

/** Caller-facing crop region used to isolate comparable score excerpts. */
export interface HeadlessVisualCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  unit?: HeadlessVisualCropUnit;
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
export function comparePngBuffers(actualPng: Buffer, expectedPng: Buffer): HeadlessVisualDiff {
  const actual = decodePng(actualPng);
  const expected = decodePng(expectedPng);
  const envelope = {
    width: Math.max(actual.width, expected.width),
    height: Math.max(actual.height, expected.height)
  };

  const normalizedActual = normalizeToEnvelope(actual, envelope);
  const normalizedExpected = normalizeToEnvelope(expected, envelope);
  const flattenedActual = flattenDecodedPng(normalizedActual);
  const flattenedExpected = flattenDecodedPng(normalizedExpected);
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
    ssim: Number(ssimResult.mssim.toFixed(6)),
    diffPng: PNG.sync.write(diff)
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

/** Decode one PNG buffer into width/height/rgba bytes. */
function decodePng(png: Buffer): DecodedPng {
  const decoded = PNG.sync.read(png);
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data
  };
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
