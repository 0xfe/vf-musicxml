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
  const diff = new PNG({ width: envelope.width, height: envelope.height });

  const mismatchPixels = pixelmatch(
    normalizedActual.data,
    normalizedExpected.data,
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
      data: new Uint8ClampedArray(normalizedActual.data),
      width: envelope.width,
      height: envelope.height
    },
    {
      data: new Uint8ClampedArray(normalizedExpected.data),
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

/** Decode one PNG buffer into width/height/rgba bytes. */
function decodePng(png: Buffer): DecodedPng {
  const decoded = PNG.sync.read(png);
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data
  };
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
