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
  detectNoteheadBarlineIntrusions
} from '../dist/testkit/notation-geometry.js';

/** Path to the fixture manifest that defines headless visual sentinels. */
const SENTINEL_MANIFEST_PATH = path.resolve('fixtures/evaluation/headless-visual-sentinels.json');
/** Baseline snapshot directory used by headless visual checks. */
const BASELINE_DIR = path.resolve('tests/visual-headless/baselines');
/** Artifact directory used for runtime outputs and diff evidence. */
const ARTIFACT_DIR = path.resolve('artifacts/visual-headless');
/** JSON artifact path for machine-readable run summaries. */
const REPORT_JSON_PATH = path.join(ARTIFACT_DIR, 'report.json');
/** Markdown artifact path for quick human triage scans. */
const REPORT_MARKDOWN_PATH = path.join(ARTIFACT_DIR, 'report.md');

/** Default pixel mismatch ratio ceiling for pass/fail. */
const DEFAULT_MAX_MISMATCH_RATIO = 0.004;
/** Default minimum structural similarity (SSIM) floor for pass/fail. */
const DEFAULT_MIN_SSIM = 0.985;

/** Single sentinel fixture definition loaded from the manifest. */
/**
 * @typedef {{
 *   id: string;
 *   fixturePath: string;
 *   format: 'xml' | 'mxl';
 * }} HeadlessVisualFixture
 */

/** Per-fixture report row emitted after rendering and optional comparison. */
/**
 * @typedef {{
 *   id: string;
 *   fixturePath: string;
 *   baselinePath: string;
 *   actualPath: string;
 *   diffPath: string | null;
 *   renderedWidth: number;
 *   renderedHeight: number;
 *   noteheadCount: number;
 *   beamCount: number;
 *   barlineIntrusionCount: number;
 *   mismatchPixels: number | null;
 *   mismatchRatio: number | null;
 *   ssim: number | null;
 *   status: 'updated' | 'pass' | 'fail' | 'error';
 *   reason?: string;
 * }} HeadlessVisualResult
 */

/** Parsed command-line options for headless visual runs. */
const options = parseCliArgs(process.argv.slice(2));

await mkdir(BASELINE_DIR, { recursive: true });
await mkdir(ARTIFACT_DIR, { recursive: true });

const fixtures = await loadFixtureManifest(SENTINEL_MANIFEST_PATH);
const selectedFixtures = filterFixtures(fixtures, options.fixtureIds);
if (selectedFixtures.length === 0) {
  throw new Error('No fixtures selected for headless visual regression run.');
}

/** @type {HeadlessVisualResult[]} */
const results = [];
for (const fixture of selectedFixtures) {
  const result = await executeFixture(fixture, options);
  results.push(result);
}

const summary = {
  generatedAt: new Date().toISOString(),
  updateMode: options.update,
  maxMismatchRatio: options.maxMismatchRatio,
  minSsim: options.minSsim,
  fixtureCount: results.length,
  passCount: results.filter((result) => result.status === 'pass').length,
  failCount: results.filter((result) => result.status === 'fail').length,
  errorCount: results.filter((result) => result.status === 'error').length,
  updatedCount: results.filter((result) => result.status === 'updated').length,
  results
};

await writeFile(REPORT_JSON_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(REPORT_MARKDOWN_PATH, renderMarkdownSummary(summary), 'utf8');

const failures = results.filter((result) => result.status === 'fail' || result.status === 'error');
if (failures.length > 0 && !options.update) {
  const failureIds = failures.map((result) => result.id).join(', ');
  throw new Error(
    `Headless visual regression failed for ${failures.length} fixture(s): ${failureIds}. See ${REPORT_JSON_PATH}.`
  );
}

if (options.update) {
  console.log(`Updated ${summary.updatedCount} headless baseline image(s).`);
} else {
  console.log(
    `Headless visual regression passed for ${summary.passCount}/${summary.fixtureCount} fixture(s).`
  );
}

/**
 * Parse CLI args.
 * Supported flags:
 * - `--update`
 * - `--fixtures=id1,id2`
 * - `--max-mismatch-ratio=0.004`
 * - `--min-ssim=0.985`
 */
function parseCliArgs(argv) {
  let update = false;
  /** @type {string[] | undefined} */
  let fixtureIds;
  let maxMismatchRatio = DEFAULT_MAX_MISMATCH_RATIO;
  let minSsim = DEFAULT_MIN_SSIM;

  for (const arg of argv) {
    if (arg === '--update') {
      update = true;
      continue;
    }

    if (arg.startsWith('--fixtures=')) {
      const value = arg.slice('--fixtures='.length).trim();
      fixtureIds = value.length > 0 ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
      continue;
    }

    if (arg.startsWith('--max-mismatch-ratio=')) {
      const value = Number.parseFloat(arg.slice('--max-mismatch-ratio='.length));
      if (Number.isFinite(value) && value >= 0) {
        maxMismatchRatio = value;
      }
      continue;
    }

    if (arg.startsWith('--min-ssim=')) {
      const value = Number.parseFloat(arg.slice('--min-ssim='.length));
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        minSsim = value;
      }
      continue;
    }
  }

  return {
    update,
    fixtureIds,
    maxMismatchRatio,
    minSsim
  };
}

/** Load and validate sentinel fixture definitions. */
async function loadFixtureManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  const fixtures = parsed?.fixtures;
  if (!Array.isArray(fixtures)) {
    throw new Error(`Invalid fixture manifest at ${manifestPath}: expected 'fixtures' array.`);
  }

  return fixtures;
}

/** Filter fixture list by optional fixture-id selector. */
function filterFixtures(fixtures, fixtureIds) {
  if (!fixtureIds || fixtureIds.length === 0) {
    return fixtures;
  }

  const requested = new Set(fixtureIds);
  return fixtures.filter((fixture) => requested.has(fixture.id));
}

/** Run render/raster/compare flow for one fixture. */
async function executeFixture(fixture, options) {
  const fixtureAbsolutePath = path.resolve(fixture.fixturePath);
  const baselinePath = path.join(BASELINE_DIR, `${fixture.id}.png`);
  const actualPath = path.join(ARTIFACT_DIR, `${fixture.id}.actual.png`);
  const diffPath = path.join(ARTIFACT_DIR, `${fixture.id}.diff.png`);

  try {
    const sourceBytes = await readFile(fixtureAbsolutePath);
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
      return {
        id: fixture.id,
        fixturePath: fixture.fixturePath,
        baselinePath,
        actualPath,
        diffPath: null,
        renderedWidth: 0,
        renderedHeight: 0,
        noteheadCount: 0,
        beamCount: 0,
        barlineIntrusionCount: 0,
        mismatchPixels: null,
        mismatchRatio: null,
        ssim: null,
        status: 'error',
        reason: 'parse produced no score'
      };
    }

    const rendered = renderToSVGPages(parsed.score);
    const svgMarkup = extractFirstSvgMarkup(rendered.pages[0] ?? '');
    if (!svgMarkup) {
      return {
        id: fixture.id,
        fixturePath: fixture.fixturePath,
        baselinePath,
        actualPath,
        diffPath: null,
        renderedWidth: 0,
        renderedHeight: 0,
        noteheadCount: 0,
        beamCount: 0,
        barlineIntrusionCount: 0,
        mismatchPixels: null,
        mismatchRatio: null,
        ssim: null,
        status: 'error',
        reason: 'render produced no SVG markup'
      };
    }

    const rasterized = rasterizeSvg(svgMarkup);
    await writeFile(actualPath, rasterized.png);

    const geometry = collectNotationGeometry(svgMarkup);
    const intrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });

    if (options.update) {
      await writeFile(baselinePath, rasterized.png);
      return {
        id: fixture.id,
        fixturePath: fixture.fixturePath,
        baselinePath,
        actualPath,
        diffPath: null,
        renderedWidth: rasterized.width,
        renderedHeight: rasterized.height,
        noteheadCount: geometry.noteheads.length,
        beamCount: geometry.beams.length,
        barlineIntrusionCount: intrusions.length,
        mismatchPixels: null,
        mismatchRatio: null,
        ssim: null,
        status: 'updated'
      };
    }

    const baselinePng = await readFile(baselinePath);
    const comparison = comparePngBuffers(rasterized.png, baselinePng);
    const mismatchFail = comparison.mismatchRatio > options.maxMismatchRatio;
    const ssimFail = comparison.ssim < options.minSsim;
    const failed = mismatchFail || ssimFail;
    if (failed) {
      await writeFile(diffPath, comparison.diffPng);
    }

    return {
      id: fixture.id,
      fixturePath: fixture.fixturePath,
      baselinePath,
      actualPath,
      diffPath: failed ? diffPath : null,
      renderedWidth: rasterized.width,
      renderedHeight: rasterized.height,
      noteheadCount: geometry.noteheads.length,
      beamCount: geometry.beams.length,
      barlineIntrusionCount: intrusions.length,
      mismatchPixels: comparison.mismatchPixels,
      mismatchRatio: comparison.mismatchRatio,
      ssim: comparison.ssim,
      status: failed ? 'fail' : 'pass',
      reason: failed
        ? `mismatchRatio=${comparison.mismatchRatio.toFixed(6)} ssim=${comparison.ssim.toFixed(6)}`
        : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: fixture.id,
      fixturePath: fixture.fixturePath,
      baselinePath,
      actualPath,
      diffPath: null,
      renderedWidth: 0,
      renderedHeight: 0,
      noteheadCount: 0,
      beamCount: 0,
      barlineIntrusionCount: 0,
      mismatchPixels: null,
      mismatchRatio: null,
      ssim: null,
      status: 'error',
      reason: message
    };
  }
}

/** Render markdown report with enough detail for fast triage. */
function renderMarkdownSummary(summary) {
  const lines = [
    '# Headless Visual Regression Report',
    '',
    `Generated at: ${summary.generatedAt}`,
    `Update mode: ${summary.updateMode ? 'yes' : 'no'}`,
    `Fixtures: ${summary.fixtureCount}`,
    `Pass: ${summary.passCount}`,
    `Fail: ${summary.failCount}`,
    `Error: ${summary.errorCount}`,
    `Updated: ${summary.updatedCount}`,
    `Max mismatch ratio: ${summary.maxMismatchRatio}`,
    `Min SSIM: ${summary.minSsim}`,
    '',
    '| Fixture | Status | Mismatch Ratio | SSIM | Beams | Intrusions | Notes |',
    '|---|---|---|---|---|---|---|'
  ];

  for (const result of summary.results) {
    lines.push(
      `| ${result.id} | ${result.status} | ${formatMetric(result.mismatchRatio)} | ${formatMetric(result.ssim)} | ${result.beamCount} | ${result.barlineIntrusionCount} | ${escapeCell(result.reason ?? '')} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

/** Format optional numeric metrics for markdown report cells. */
function formatMetric(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return Number(value).toFixed(6);
}

/** Escape markdown table cell separators in freeform text. */
function escapeCell(value) {
  return value.replaceAll('|', '\\|');
}
