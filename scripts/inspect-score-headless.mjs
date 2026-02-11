#!/usr/bin/env node
/* global console, process */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseMusicXMLAsync, renderToSVGPages } from '../dist/public/api.js';
import {
  comparePngBuffers,
  extractFirstSvgMarkup,
  rasterizeSvg
} from '../dist/testkit/headless-visual.js';
import {
  collectNotationGeometry,
  detectNoteheadBarlineIntrusions,
  summarizeMeasureSpacingByBarlines,
  summarizeNotationGeometry
} from '../dist/testkit/notation-geometry.js';

/** Default output root for one-score inspection artifacts. */
const DEFAULT_OUTPUT_ROOT = path.resolve('artifacts/score-inspection');
/** Default page index for multi-page rendering output. */
const DEFAULT_PAGE_INDEX = 0;

/** Parsed runtime options for one-score headless inspection. */
const options = parseCliArgs(process.argv.slice(2));
await runInspection(options);

/**
 * Parse supported CLI arguments.
 * Required:
 * - `--input=<path-to-musicxml-or-mxl>`
 * Optional:
 * - `--id=<artifact-id>`
 * - `--format=xml|mxl` (auto-detected from extension by default)
 * - `--page=<0-based-index>` (default `0`)
 * - `--out-dir=<directory>`
 * - `--reference-png=<png-path>` (optional baseline image for diff)
 */
function parseCliArgs(argv) {
  /** @type {string | undefined} */
  let inputPath;
  /** @type {string | undefined} */
  let id;
  /** @type {'xml' | 'mxl' | undefined} */
  let format;
  let pageIndex = DEFAULT_PAGE_INDEX;
  /** @type {string | undefined} */
  let outputDir;
  /** @type {string | undefined} */
  let referencePngPath;

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      inputPath = arg.slice('--input='.length).trim();
      continue;
    }

    if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length).trim();
      continue;
    }

    if (arg.startsWith('--format=')) {
      const rawFormat = arg.slice('--format='.length).trim();
      if (rawFormat === 'xml' || rawFormat === 'mxl') {
        format = rawFormat;
      }
      continue;
    }

    if (arg.startsWith('--page=')) {
      const parsed = Number.parseInt(arg.slice('--page='.length), 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        pageIndex = parsed;
      }
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      outputDir = arg.slice('--out-dir='.length).trim();
      continue;
    }

    if (arg.startsWith('--reference-png=')) {
      referencePngPath = arg.slice('--reference-png='.length).trim();
      continue;
    }
  }

  if (!inputPath) {
    throw new Error('Missing required argument: --input=<path>');
  }

  const absoluteInputPath = path.resolve(inputPath);
  const inferredId = idFromPath(absoluteInputPath);
  const resolvedId = sanitizeId(id && id.length > 0 ? id : inferredId);
  const resolvedFormat = format ?? inferFormatFromPath(absoluteInputPath);
  const resolvedOutputDir = outputDir
    ? path.resolve(outputDir)
    : path.join(DEFAULT_OUTPUT_ROOT, resolvedId);

  return {
    inputPath: absoluteInputPath,
    id: resolvedId,
    format: resolvedFormat,
    pageIndex,
    outputDir: resolvedOutputDir,
    referencePngPath: referencePngPath ? path.resolve(referencePngPath) : undefined
  };
}

/**
 * Execute one-score parse/render/raster/analysis and write deterministic artifacts.
 */
async function runInspection(options) {
  await mkdir(options.outputDir, { recursive: true });

  const sourceBytes = await readFile(options.inputPath);
  const parsed = await parseMusicXMLAsync(
    {
      data: new Uint8Array(sourceBytes),
      format: options.format
    },
    {
      sourceName: options.inputPath,
      mode: 'lenient'
    }
  );

  if (!parsed.score) {
    throw new Error(`Parse failed without score output for ${options.inputPath}.`);
  }

  const renderResult = renderToSVGPages(parsed.score);
  const selectedPage = renderResult.pages[options.pageIndex];
  if (!selectedPage) {
    throw new Error(
      `Rendered page index ${options.pageIndex} is out of range (pages=${renderResult.pages.length}).`
    );
  }

  const svgMarkup = extractFirstSvgMarkup(selectedPage);
  if (!svgMarkup) {
    throw new Error('Rendered output did not contain an <svg> root.');
  }

  const rasterized = rasterizeSvg(svgMarkup);
  const geometry = collectNotationGeometry(svgMarkup);
  const geometrySummary = summarizeNotationGeometry(geometry, {
    minHorizontalOverlap: 0.75,
    minVerticalOverlap: 3
  });
  const intrusions = detectNoteheadBarlineIntrusions(geometry, {
    minHorizontalOverlap: 0.75,
    minVerticalOverlap: 3
  });
  const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);

  const svgOutputPath = path.join(options.outputDir, `${options.id}.page-${options.pageIndex + 1}.svg`);
  const pngOutputPath = path.join(options.outputDir, `${options.id}.page-${options.pageIndex + 1}.png`);
  const reportOutputPath = path.join(options.outputDir, `${options.id}.report.json`);
  const diffOutputPath = path.join(options.outputDir, `${options.id}.diff.png`);

  await writeFile(svgOutputPath, `${svgMarkup}\n`, 'utf8');
  await writeFile(pngOutputPath, rasterized.png);

  /** @type {{ mismatchPixels: number; mismatchRatio: number; ssim: number; referencePngPath: string; diffPngPath: string; } | undefined} */
  let visualDiffSummary;
  if (options.referencePngPath) {
    const expectedPng = await readFile(options.referencePngPath);
    const diff = comparePngBuffers(rasterized.png, expectedPng);
    await writeFile(diffOutputPath, diff.diffPng);

    visualDiffSummary = {
      mismatchPixels: diff.mismatchPixels,
      mismatchRatio: diff.mismatchRatio,
      ssim: diff.ssim,
      referencePngPath: options.referencePngPath,
      diffPngPath: diffOutputPath
    };
  }

  const report = {
    id: options.id,
    inputPath: options.inputPath,
    format: options.format,
    pageIndex: options.pageIndex,
    pageCount: renderResult.pages.length,
    outputDir: options.outputDir,
    outputs: {
      svg: svgOutputPath,
      png: pngOutputPath,
      report: reportOutputPath
    },
    parseDiagnostics: parsed.diagnostics,
    renderDiagnostics: renderResult.diagnostics,
    geometrySummary,
    spacingSummary,
    intrusionCount: intrusions.length,
    visualDiff: visualDiffSummary
  };

  await writeFile(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  // Keep terminal output compact so this command is easy to use in rapid triage loops.
  console.log(`Inspected score: ${options.inputPath}`);
  console.log(`Output directory: ${options.outputDir}`);
  console.log(`SVG: ${svgOutputPath}`);
  console.log(`PNG: ${pngOutputPath}`);
  console.log(
    `Geometry summary: noteheads=${geometrySummary.noteheadCount}, beams=${geometrySummary.beamCount}, flags=${geometrySummary.flagCount}, flagBeamOverlaps=${geometrySummary.flagBeamOverlapCount}, barlineIntrusions=${geometrySummary.noteheadBarlineIntrusionCount}`
  );
  if (spacingSummary.firstToMedianOtherGapRatio !== null) {
    console.log(
      `Measure spacing ratio (first/median-other): ${spacingSummary.firstToMedianOtherGapRatio} (bands=${spacingSummary.evaluatedBandCount})`
    );
  }
  if (visualDiffSummary) {
    console.log(
      `Visual diff vs reference: mismatchRatio=${visualDiffSummary.mismatchRatio}, ssim=${visualDiffSummary.ssim}`
    );
  }
}

/**
 * Infer MusicXML source format from extension.
 * `.mxl` is treated as compressed container; everything else defaults to xml.
 */
function inferFormatFromPath(inputPath) {
  return path.extname(inputPath).toLowerCase() === '.mxl' ? 'mxl' : 'xml';
}

/** Build a human-readable identifier from a source filename. */
function idFromPath(inputPath) {
  return path.basename(inputPath).replace(/\.[^.]+$/, '');
}

/** Normalize CLI-provided identifiers into file-safe slugs. */
function sanitizeId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
