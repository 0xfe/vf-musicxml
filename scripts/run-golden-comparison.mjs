#!/usr/bin/env node
/* global console, process */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseMusicXMLAsync, renderToSVGPages } from '../dist/public/api.js';
import {
  comparePngBuffers,
  cropPngBuffer,
  extractFirstSvgMarkup,
  flattenPngBufferToWhite,
  getPngDimensions,
  resizePngBuffer,
  trimPngWhitespace,
  rasterizeSvg
} from '../dist/testkit/headless-visual.js';
import {
  collectNotationGeometry,
  deriveSystemCropRegion,
  detectNoteheadBarlineIntrusions,
  summarizeNotationGeometry,
  summarizeMeasureSpacingByBarlines
} from '../dist/testkit/notation-geometry.js';

/** Golden manifest generated from LilyPond collated-suite references. */
const DEFAULT_GOLDEN_MANIFEST_PATH = path.resolve('fixtures/golden/manifest.json');
/** Additional proof-point fixtures with custom references/crops. */
const DEFAULT_PROOFPOINTS_PATH = path.resolve('fixtures/evaluation/golden-proofpoints.json');
/** Default artifact directory for M8C golden-comparison runs. */
const DEFAULT_ARTIFACT_DIR = path.resolve('artifacts/golden-comparison');
/** Default mismatch threshold for fixtures that do not override it. */
const DEFAULT_MAX_MISMATCH_RATIO = 0.02;
/** Default SSIM floor for fixtures that do not override it. */
const DEFAULT_MIN_SSIM = 0.94;

/** Parsed command-line options. */
const options = parseCliArgs(process.argv.slice(2));
await mkdir(options.outDir, { recursive: true });

const lilypondFixtures = options.includeLilypond
  ? await loadLilypondGoldenFixtures(options.goldenManifestPath)
  : [];
const proofpointFixtures = options.includeProofpoints
  ? await loadProofpointFixtures(options.proofpointsPath)
  : [];
const fixtures = selectFixtures(mergeFixtures(lilypondFixtures, proofpointFixtures), options.fixtureIds);

if (fixtures.length === 0) {
  throw new Error('No fixtures selected for golden comparison run.');
}

/** @type {GoldenComparisonResult[]} */
const results = [];
for (const fixture of fixtures) {
  const result = await executeFixtureComparison(fixture, options);
  results.push(result);
}

const summary = buildSummary(results, options);
await writeReportArtifacts(summary, options.outDir);

const blockingFailures = summary.results.filter(
  (result) => (result.status === 'fail' || result.status === 'error') && result.blocking
);
const advisoryFailures = summary.results.filter(
  (result) => (result.status === 'fail' || result.status === 'error') && !result.blocking
);

if (blockingFailures.length > 0) {
  const ids = blockingFailures.map((result) => result.id).join(', ');
  throw new Error(`Golden comparison blocking failures (${blockingFailures.length}): ${ids}`);
}

if (options.failOnAdvisory && advisoryFailures.length > 0) {
  const ids = advisoryFailures.map((result) => result.id).join(', ');
  throw new Error(`Golden comparison advisory failures elevated by --fail-on-advisory (${advisoryFailures.length}): ${ids}`);
}

console.log(
  `Golden comparison completed: fixtures=${summary.fixtureCount} pass=${summary.passCount} fail=${summary.failCount} error=${summary.errorCount} advisoryFail=${summary.advisoryFailCount}`
);

/**
 * Parse CLI args for the golden-comparison runner.
 * Supported flags:
 * - `--fixtures=id1,id2`
 * - `--out-dir=<path>`
 * - `--golden-manifest=<path>`
 * - `--proofpoints=<path>`
 * - `--lilypond-only`
 * - `--proofpoints-only`
 * - `--max-mismatch-ratio=<number>`
 * - `--min-ssim=<number>`
 * - `--fail-on-advisory`
 */
function parseCliArgs(argv) {
  /** @type {string[] | undefined} */
  let fixtureIds;
  let outDir = DEFAULT_ARTIFACT_DIR;
  let goldenManifestPath = DEFAULT_GOLDEN_MANIFEST_PATH;
  let proofpointsPath = DEFAULT_PROOFPOINTS_PATH;
  let includeLilypond = true;
  let includeProofpoints = true;
  let maxMismatchRatio = DEFAULT_MAX_MISMATCH_RATIO;
  let minSsim = DEFAULT_MIN_SSIM;
  let failOnAdvisory = false;

  for (const arg of argv) {
    if (arg.startsWith('--fixtures=')) {
      const value = arg.slice('--fixtures='.length).trim();
      fixtureIds = value.length > 0 ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      outDir = path.resolve(arg.slice('--out-dir='.length).trim());
      continue;
    }

    if (arg.startsWith('--golden-manifest=')) {
      goldenManifestPath = path.resolve(arg.slice('--golden-manifest='.length).trim());
      continue;
    }

    if (arg.startsWith('--proofpoints=')) {
      proofpointsPath = path.resolve(arg.slice('--proofpoints='.length).trim());
      continue;
    }

    if (arg === '--lilypond-only') {
      includeLilypond = true;
      includeProofpoints = false;
      continue;
    }

    if (arg === '--proofpoints-only') {
      includeLilypond = false;
      includeProofpoints = true;
      continue;
    }

    if (arg.startsWith('--max-mismatch-ratio=')) {
      const parsed = Number.parseFloat(arg.slice('--max-mismatch-ratio='.length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        maxMismatchRatio = parsed;
      }
      continue;
    }

    if (arg.startsWith('--min-ssim=')) {
      const parsed = Number.parseFloat(arg.slice('--min-ssim='.length));
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        minSsim = parsed;
      }
      continue;
    }

    if (arg === '--fail-on-advisory') {
      failOnAdvisory = true;
    }
  }

  return {
    fixtureIds,
    outDir,
    goldenManifestPath,
    proofpointsPath,
    includeLilypond,
    includeProofpoints,
    maxMismatchRatio,
    minSsim,
    failOnAdvisory
  };
}

/**
 * @typedef {'xml' | 'mxl'} FixtureFormat
 */

/**
 * @typedef {'pixels' | 'ratio'} CropUnit
 */

/**
 * @typedef {{
 *   x: number;
 *   y: number;
 *   width: number;
 *   height: number;
 *   unit?: CropUnit;
 * }} CropRegion
 */

/**
 * @typedef {{
 *   maxMismatchRatio?: number;
 *   minSsim?: number;
 *   maxStructuralMismatchRatio?: number;
 * }} FixtureThresholdOverrides
 */

/**
 * @typedef {{
 *   trimWhitespace?: boolean;
 *   trimThreshold?: number;
 *   trimPadding?: number;
 *   resizeActualToReference?: boolean;
 *   resizeMode?: 'fit' | 'stretch';
 *   alignByInkCentroid?: boolean;
 *   maxAlignmentShift?: number;
 *   alignmentInkThreshold?: number;
 *   alignmentAxis?: 'both' | 'x' | 'y';
 * }} FixtureNormalizationOptions
 */

/**
 * @typedef {{
 *   stavesPerSystem: number;
 *   startSystemIndex?: number;
 *   systemCount?: number;
 *   includeFullWidth?: boolean;
 *   headerPadding?: number;
 *   padding?: number;
 *   paddingTop?: number;
 *   paddingRight?: number;
 *   paddingBottom?: number;
 *   paddingLeft?: number;
 * }} FixtureAutoCropSystemsOptions
 */

/**
 * @typedef {{
 *   systems?: FixtureAutoCropSystemsOptions;
 * }} FixtureAutoCropOptions
 */

/**
 * @typedef {{
 *   id: string;
 *   fixturePath: string;
 *   format: FixtureFormat;
 *   referenceImagePath: string;
 *   referenceKind: string;
 *   blocking: boolean;
 *   notes?: string;
 *   cropActual?: CropRegion;
 *   cropReference?: CropRegion;
 *   autoCropActual?: FixtureAutoCropOptions;
 *   thresholds?: FixtureThresholdOverrides;
 *   normalization?: FixtureNormalizationOptions;
 * }} GoldenFixtureSpec
 */

/**
 * @typedef {{
 *   id: string;
 *   status: 'pass' | 'fail' | 'error';
 *   blocking: boolean;
 *   fixturePath: string;
 *   referenceImagePath: string;
 *   referenceKind: string;
 *   parsedFormat: FixtureFormat;
 *   renderDiagnostics: import('../dist/core/diagnostics.js').Diagnostic[];
 *   parseDiagnostics: import('../dist/core/diagnostics.js').Diagnostic[];
 *   renderedWidth: number;
 *   renderedHeight: number;
 *   comparedWidth: number | null;
 *   comparedHeight: number | null;
 *   mismatchPixels: number | null;
 *   mismatchRatio: number | null;
 *   structuralMismatchPixels: number | null;
 *   structuralMismatchRatio: number | null;
 *   ssim: number | null;
 *   alignmentShiftX: number | null;
 *   alignmentShiftY: number | null;
 *   thresholdMaxMismatchRatio: number;
 *   thresholdMinSsim: number;
 *   thresholdMaxStructuralMismatchRatio: number | null;
 *   noteheadCount: number;
 *   beamCount: number;
 *   flagCount: number;
 *   flagBeamOverlapCount: number;
 *   barlineIntrusionCount: number;
 *   firstToMedianOtherGapRatio: number | null;
 *   outputs: {
 *     svg: string;
 *     actual: string;
 *     expected: string;
 *     diff: string | null;
 *   };
 *   notes?: string;
 *   reason?: string;
 * }} GoldenComparisonResult
 */

/**
 * Load active LilyPond fixture references from the generated golden manifest.
 * Each imported row is treated as blocking by default.
 */
async function loadLilypondGoldenFixtures(goldenManifestPath) {
  const raw = await readFile(goldenManifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  const fixtures = Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];

  return fixtures
    .filter((fixture) => fixture?.status === 'active' && fixture?.expected === 'pass')
    .map((fixture) => ({
      id: String(fixture.id),
      fixturePath: path.resolve(String(fixture.localFixturePath)),
      format: inferFormatFromPath(String(fixture.localFixturePath)),
      referenceImagePath: path.resolve(String(fixture.goldenImagePath)),
      referenceKind: String(fixture.referenceKind ?? 'lilypond-golden'),
      blocking: true
    }));
}

/**
 * Load custom proof-point entries.
 * These are often advisory while pagination/layout parity is still in progress.
 */
async function loadProofpointFixtures(proofpointsPath) {
  const raw = await readFile(proofpointsPath, 'utf8');
  const parsed = JSON.parse(raw);
  const fixtures = Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];

  return fixtures.map((fixture) => ({
    id: String(fixture.id),
    fixturePath: path.resolve(String(fixture.fixturePath)),
    format: fixture.format === 'mxl' ? 'mxl' : inferFormatFromPath(String(fixture.fixturePath)),
    referenceImagePath: path.resolve(String(fixture.referenceImagePath)),
    referenceKind: String(fixture.referenceKind ?? 'proofpoint'),
    blocking: Boolean(fixture.blocking ?? false),
    notes: fixture.notes ? String(fixture.notes) : undefined,
    cropActual: parseCropRegion(fixture.cropActual),
    cropReference: parseCropRegion(fixture.cropReference),
    autoCropActual: parseAutoCropOptions(fixture.autoCropActual),
    thresholds: fixture.thresholds
      ? {
          maxMismatchRatio:
            Number.isFinite(fixture.thresholds.maxMismatchRatio) ? fixture.thresholds.maxMismatchRatio : undefined,
          minSsim: Number.isFinite(fixture.thresholds.minSsim) ? fixture.thresholds.minSsim : undefined,
          maxStructuralMismatchRatio: Number.isFinite(fixture.thresholds.maxStructuralMismatchRatio)
            ? fixture.thresholds.maxStructuralMismatchRatio
            : undefined
        }
      : undefined,
    normalization: parseNormalizationOptions(fixture.normalization)
  }));
}

/** Convert unknown crop payload into a validated crop region object. */
function parseCropRegion(rawRegion) {
  if (!rawRegion || typeof rawRegion !== 'object') {
    return undefined;
  }

  const x = Number(rawRegion.x);
  const y = Number(rawRegion.y);
  const width = Number(rawRegion.width);
  const height = Number(rawRegion.height);
  const unit = rawRegion.unit === 'ratio' ? 'ratio' : 'pixels';

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  return { x, y, width, height, unit };
}

/** Convert unknown auto-crop payload into validated geometry-crop options. */
function parseAutoCropOptions(rawAutoCrop) {
  if (!rawAutoCrop || typeof rawAutoCrop !== 'object') {
    return undefined;
  }

  const systems = parseAutoCropSystemsOptions(rawAutoCrop.systems);
  if (!systems) {
    return undefined;
  }

  return { systems };
}

/** Validate `autoCropActual.systems` payload and coerce numeric fields. */
function parseAutoCropSystemsOptions(rawSystems) {
  if (!rawSystems || typeof rawSystems !== 'object') {
    return undefined;
  }

  const stavesPerSystem = Number(rawSystems.stavesPerSystem);
  if (!Number.isFinite(stavesPerSystem) || stavesPerSystem <= 0) {
    return undefined;
  }

  const startSystemIndex = Number(rawSystems.startSystemIndex);
  const systemCount = Number(rawSystems.systemCount);

  return {
    stavesPerSystem,
    startSystemIndex: Number.isFinite(startSystemIndex) ? startSystemIndex : undefined,
    systemCount: Number.isFinite(systemCount) ? systemCount : undefined,
    includeFullWidth: rawSystems.includeFullWidth !== undefined ? Boolean(rawSystems.includeFullWidth) : undefined,
    headerPadding: Number.isFinite(rawSystems.headerPadding) ? Number(rawSystems.headerPadding) : undefined,
    padding: Number.isFinite(rawSystems.padding) ? Number(rawSystems.padding) : undefined,
    paddingTop: Number.isFinite(rawSystems.paddingTop) ? Number(rawSystems.paddingTop) : undefined,
    paddingRight: Number.isFinite(rawSystems.paddingRight) ? Number(rawSystems.paddingRight) : undefined,
    paddingBottom: Number.isFinite(rawSystems.paddingBottom) ? Number(rawSystems.paddingBottom) : undefined,
    paddingLeft: Number.isFinite(rawSystems.paddingLeft) ? Number(rawSystems.paddingLeft) : undefined
  };
}

/** Convert unknown normalization payload into validated runner options. */
function parseNormalizationOptions(rawNormalization) {
  if (!rawNormalization || typeof rawNormalization !== 'object') {
    return undefined;
  }

  const resizeMode =
    rawNormalization.resizeMode === 'stretch' || rawNormalization.resizeMode === 'fit'
      ? rawNormalization.resizeMode
      : undefined;

  return {
    trimWhitespace: Boolean(rawNormalization.trimWhitespace),
    trimThreshold: Number.isFinite(rawNormalization.trimThreshold)
      ? Number(rawNormalization.trimThreshold)
      : undefined,
    trimPadding: Number.isFinite(rawNormalization.trimPadding)
      ? Number(rawNormalization.trimPadding)
      : undefined,
    resizeActualToReference: Boolean(rawNormalization.resizeActualToReference),
    resizeMode,
    alignByInkCentroid: Boolean(rawNormalization.alignByInkCentroid),
    maxAlignmentShift: Number.isFinite(rawNormalization.maxAlignmentShift)
      ? Number(rawNormalization.maxAlignmentShift)
      : undefined,
    alignmentInkThreshold: Number.isFinite(rawNormalization.alignmentInkThreshold)
      ? Number(rawNormalization.alignmentInkThreshold)
      : undefined,
    alignmentAxis:
      rawNormalization.alignmentAxis === 'x' ||
      rawNormalization.alignmentAxis === 'y' ||
      rawNormalization.alignmentAxis === 'both'
        ? rawNormalization.alignmentAxis
        : undefined
  };
}

/** Merge fixtures by id where proof-points override LilyPond defaults. */
function mergeFixtures(lilypondFixtures, proofpointFixtures) {
  /** @type {Map<string, GoldenFixtureSpec>} */
  const merged = new Map();

  for (const fixture of lilypondFixtures) {
    merged.set(fixture.id, fixture);
  }
  for (const fixture of proofpointFixtures) {
    merged.set(fixture.id, fixture);
  }

  return [...merged.values()];
}

/** Apply optional fixture-id filtering. */
function selectFixtures(fixtures, fixtureIds) {
  if (!fixtureIds || fixtureIds.length === 0) {
    return fixtures;
  }

  const requested = new Set(fixtureIds);
  return fixtures.filter((fixture) => requested.has(fixture.id));
}

/** Execute parse/render/raster/compare flow for one fixture. */
async function executeFixtureComparison(fixture, options) {
  const outPrefix = path.join(options.outDir, fixture.id);
  const svgPath = `${outPrefix}.svg`;
  const actualPath = `${outPrefix}.actual.png`;
  const expectedPath = `${outPrefix}.expected.png`;
  const diffPath = `${outPrefix}.diff.png`;

  const maxMismatchRatio = fixture.thresholds?.maxMismatchRatio ?? options.maxMismatchRatio;
  const minSsim = fixture.thresholds?.minSsim ?? options.minSsim;
  const maxStructuralMismatchRatio = fixture.thresholds?.maxStructuralMismatchRatio;

  try {
    const sourceBytes = await readFile(fixture.fixturePath);
    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(sourceBytes),
        format: fixture.format
      },
      {
        sourceName: fixture.fixturePath,
        mode: 'lenient'
      }
    );

    if (!parsed.score) {
      return failureResult(fixture, svgPath, actualPath, expectedPath, {
        status: 'error',
        parseDiagnostics: parsed.diagnostics,
        renderDiagnostics: [],
        maxMismatchRatio,
        minSsim,
        maxStructuralMismatchRatio,
        reason: 'parse produced no score output'
      });
    }

    const rendered = renderToSVGPages(parsed.score);
    const svgMarkup = extractFirstSvgMarkup(rendered.pages[0] ?? '');
    if (!svgMarkup) {
      return failureResult(fixture, svgPath, actualPath, expectedPath, {
        status: 'error',
        parseDiagnostics: parsed.diagnostics,
        renderDiagnostics: rendered.diagnostics,
        maxMismatchRatio,
        minSsim,
        maxStructuralMismatchRatio,
        reason: 'render produced no SVG payload'
      });
    }

    await writeFile(svgPath, `${svgMarkup}\n`, 'utf8');
    const renderedPng = rasterizeSvg(svgMarkup);
    const geometry = collectNotationGeometry(svgMarkup);
    const intrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });
    const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);

    let renderedComparable = renderedPng.png;
    if (fixture.autoCropActual?.systems) {
      const autoCropRegion = deriveSystemCropRegion(
        geometry,
        renderedPng.width,
        renderedPng.height,
        fixture.autoCropActual.systems
      );
      if (autoCropRegion) {
        renderedComparable = cropPngBuffer(renderedComparable, autoCropRegion);
      }
    }
    if (fixture.cropActual) {
      renderedComparable = cropPngBuffer(renderedComparable, fixture.cropActual);
    }

    const referencePng = await readFile(fixture.referenceImagePath);
    const referenceComparable = fixture.cropReference
      ? cropPngBuffer(referencePng, fixture.cropReference)
      : referencePng;

    let renderedComparableFlat = flattenPngBufferToWhite(renderedComparable);
    let referenceComparableFlat = flattenPngBufferToWhite(referenceComparable);

    if (fixture.normalization?.trimWhitespace) {
      renderedComparableFlat = trimPngWhitespace(renderedComparableFlat, {
        threshold: fixture.normalization.trimThreshold,
        padding: fixture.normalization.trimPadding
      });
      referenceComparableFlat = trimPngWhitespace(referenceComparableFlat, {
        threshold: fixture.normalization.trimThreshold,
        padding: fixture.normalization.trimPadding
      });
    }

    if (fixture.normalization?.resizeActualToReference) {
      const referenceDimensions = getPngDimensions(referenceComparableFlat);
      renderedComparableFlat = resizePngBuffer(renderedComparableFlat, {
        width: referenceDimensions.width,
        height: referenceDimensions.height,
        mode: fixture.normalization.resizeMode ?? 'fit'
      });
    }

    await writeFile(actualPath, renderedComparableFlat);
    await writeFile(expectedPath, referenceComparableFlat);

    const comparison = comparePngBuffers(renderedComparableFlat, referenceComparableFlat, {
      alignByInkCentroid: fixture.normalization?.alignByInkCentroid,
      maxAlignmentShift: fixture.normalization?.maxAlignmentShift,
      alignmentInkThreshold: fixture.normalization?.alignmentInkThreshold,
      alignmentAxis: fixture.normalization?.alignmentAxis
    });
    const mismatchFail = comparison.mismatchRatio > maxMismatchRatio;
    const ssimFail = comparison.ssim < minSsim;
    const structuralFail =
      maxStructuralMismatchRatio !== undefined &&
      comparison.structuralMismatchRatio > maxStructuralMismatchRatio;
    const failed = mismatchFail || ssimFail || structuralFail;

    if (failed) {
      await writeFile(diffPath, comparison.diffPng);
    }

    return {
      id: fixture.id,
      status: failed ? 'fail' : 'pass',
      blocking: fixture.blocking,
      fixturePath: fixture.fixturePath,
      referenceImagePath: fixture.referenceImagePath,
      referenceKind: fixture.referenceKind,
      parsedFormat: fixture.format,
      parseDiagnostics: parsed.diagnostics,
      renderDiagnostics: rendered.diagnostics,
      renderedWidth: renderedPng.width,
      renderedHeight: renderedPng.height,
      comparedWidth: comparison.width,
      comparedHeight: comparison.height,
      mismatchPixels: comparison.mismatchPixels,
      mismatchRatio: comparison.mismatchRatio,
      structuralMismatchPixels: comparison.structuralMismatchPixels,
      structuralMismatchRatio: comparison.structuralMismatchRatio,
      ssim: comparison.ssim,
      alignmentShiftX: comparison.alignmentShiftX,
      alignmentShiftY: comparison.alignmentShiftY,
      thresholdMaxMismatchRatio: maxMismatchRatio,
      thresholdMinSsim: minSsim,
      thresholdMaxStructuralMismatchRatio: maxStructuralMismatchRatio ?? null,
      noteheadCount: geometry.noteheads.length,
      beamCount: geometry.beams.length,
      flagCount: geometry.flags.length,
      flagBeamOverlapCount: summarizeNotationGeometry(geometry).flagBeamOverlapCount,
      barlineIntrusionCount: intrusions.length,
      firstToMedianOtherGapRatio: spacingSummary.firstToMedianOtherGapRatio,
      outputs: {
        svg: svgPath,
        actual: actualPath,
        expected: expectedPath,
        diff: failed ? diffPath : null
      },
      notes: fixture.notes,
      reason: failed
        ? `mismatchRatio=${comparison.mismatchRatio.toFixed(6)} structuralMismatchRatio=${comparison.structuralMismatchRatio.toFixed(6)} ssim=${comparison.ssim.toFixed(6)}`
        : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failureResult(fixture, svgPath, actualPath, expectedPath, {
      status: 'error',
      parseDiagnostics: [],
      renderDiagnostics: [],
      maxMismatchRatio,
      minSsim,
      maxStructuralMismatchRatio,
      reason: message
    });
  }
}

/** Build a standard failure/error result record for reporting. */
function failureResult(
  fixture,
  svgPath,
  actualPath,
  expectedPath,
  params
) {
  return {
    id: fixture.id,
    status: params.status,
    blocking: fixture.blocking,
    fixturePath: fixture.fixturePath,
    referenceImagePath: fixture.referenceImagePath,
    referenceKind: fixture.referenceKind,
    parsedFormat: fixture.format,
    parseDiagnostics: params.parseDiagnostics,
    renderDiagnostics: params.renderDiagnostics,
    renderedWidth: 0,
    renderedHeight: 0,
    comparedWidth: null,
    comparedHeight: null,
    mismatchPixels: null,
    mismatchRatio: null,
    structuralMismatchPixels: null,
    structuralMismatchRatio: null,
    ssim: null,
    alignmentShiftX: null,
    alignmentShiftY: null,
    thresholdMaxMismatchRatio: params.maxMismatchRatio,
    thresholdMinSsim: params.minSsim,
    thresholdMaxStructuralMismatchRatio: params.maxStructuralMismatchRatio ?? null,
    noteheadCount: 0,
    beamCount: 0,
    flagCount: 0,
    flagBeamOverlapCount: 0,
    barlineIntrusionCount: 0,
    firstToMedianOtherGapRatio: null,
    outputs: {
      svg: svgPath,
      actual: actualPath,
      expected: expectedPath,
      diff: null
    },
    notes: fixture.notes,
    reason: params.reason
  };
}

/** Infer score format from path extension. */
function inferFormatFromPath(filePath) {
  return path.extname(filePath).toLowerCase() === '.mxl' ? 'mxl' : 'xml';
}

/** Aggregate report counters and result list. */
function buildSummary(results, options) {
  const passCount = results.filter((result) => result.status === 'pass').length;
  const failCount = results.filter((result) => result.status === 'fail').length;
  const errorCount = results.filter((result) => result.status === 'error').length;
  const blockingFailCount = results.filter(
    (result) => (result.status === 'fail' || result.status === 'error') && result.blocking
  ).length;
  const advisoryFailCount = results.filter(
    (result) => (result.status === 'fail' || result.status === 'error') && !result.blocking
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    options: {
      maxMismatchRatio: options.maxMismatchRatio,
      minSsim: options.minSsim,
      includeLilypond: options.includeLilypond,
      includeProofpoints: options.includeProofpoints,
      failOnAdvisory: options.failOnAdvisory
    },
    fixtureCount: results.length,
    passCount,
    failCount,
    errorCount,
    blockingFailCount,
    advisoryFailCount,
    results
  };
}

/** Write JSON + markdown summary artifacts for the completed run. */
async function writeReportArtifacts(summary, outDir) {
  const jsonPath = path.join(outDir, 'report.json');
  const markdownPath = path.join(outDir, 'report.md');

  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdownSummary(summary), 'utf8');
}

/** Render a compact markdown report for fast triage. */
function renderMarkdownSummary(summary) {
  const lines = [
    '# Golden Comparison Report',
    '',
    `Generated at: ${summary.generatedAt}`,
    `Fixtures: ${summary.fixtureCount}`,
    `Pass: ${summary.passCount}`,
    `Fail: ${summary.failCount}`,
    `Error: ${summary.errorCount}`,
    `Blocking failures: ${summary.blockingFailCount}`,
    `Advisory failures: ${summary.advisoryFailCount}`,
    '',
    '| Fixture | Status | Blocking | Mismatch Ratio | Structural Mismatch | SSIM | Intrusions | Flags | Flag/Beam Overlaps | Gap Ratio | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|'
  ];

  for (const result of summary.results) {
    lines.push(
      `| ${result.id} | ${result.status} | ${result.blocking ? 'yes' : 'no'} | ${formatMetric(result.mismatchRatio)} | ${formatMetric(result.structuralMismatchRatio)} | ${formatMetric(result.ssim)} | ${result.barlineIntrusionCount} | ${result.flagCount} | ${result.flagBeamOverlapCount} | ${formatMetric(result.firstToMedianOtherGapRatio)} | ${escapeCell(result.reason ?? result.notes ?? '')} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

/** Format optional numeric metrics for markdown cells. */
function formatMetric(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  return Number(value).toFixed(6);
}

/** Escape markdown table separators in freeform notes/reasons. */
function escapeCell(value) {
  return value.replaceAll('|', '\\|');
}
