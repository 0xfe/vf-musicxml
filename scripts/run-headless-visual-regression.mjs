#!/usr/bin/env node
/* global console, process */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
import { runWithConcurrency, summarizeDurations } from '../dist/testkit/execution-loop.js';
import { createFixtureRenderCache, DEFAULT_FIXTURE_RENDER_CACHE_DIR } from './lib/fixture-render-cache.mjs';

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
/** Default worker count for fixture loops. */
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)));

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
 *   durationMs: number;
 *   cacheHit: boolean;
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
const renderCache = createFixtureRenderCache({
  enabled: options.cacheEnabled,
  cacheDir: options.cacheDir
});

/** @type {HeadlessVisualResult[]} */
const results = await runWithConcurrency(selectedFixtures, options.concurrency, async (fixture) =>
  executeFixture(fixture, options, renderCache)
);
const timingSummary = summarizeDurations(
  results.map((result) => result.durationMs),
  options.timingBudgetMs
);

const summary = {
  generatedAt: new Date().toISOString(),
  updateMode: options.update,
  concurrency: options.concurrency,
  cacheEnabled: options.cacheEnabled,
  cacheDir: options.cacheDir,
  cacheHitCount: results.filter((result) => result.cacheHit).length,
  maxMismatchRatio: options.maxMismatchRatio,
  minSsim: options.minSsim,
  timingBudgetMs: options.timingBudgetMs ?? null,
  timing: timingSummary,
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
if (
  options.failOnBudgetExceeded &&
  timingSummary.budgetMs !== null &&
  timingSummary.budgetExceededCount > 0
) {
  throw new Error(
    `Headless visual regression exceeded timing budget on ${timingSummary.budgetExceededCount} fixture(s) (budget=${timingSummary.budgetMs}ms).`
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
 * - `--concurrency=4`
 * - `--timing-budget-ms=3000`
 * - `--fail-on-budget-exceeded`
 * - `--no-cache`
 * - `--cache-dir=<path>`
 */
function parseCliArgs(argv) {
  let update = false;
  /** @type {string[] | undefined} */
  let fixtureIds;
  let maxMismatchRatio = DEFAULT_MAX_MISMATCH_RATIO;
  let minSsim = DEFAULT_MIN_SSIM;
  let concurrency = DEFAULT_CONCURRENCY;
  /** @type {number | undefined} */
  let timingBudgetMs;
  let failOnBudgetExceeded = false;
  let cacheEnabled = true;
  let cacheDir = DEFAULT_FIXTURE_RENDER_CACHE_DIR;

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

    if (arg.startsWith('--concurrency=')) {
      const value = Number.parseInt(arg.slice('--concurrency='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        concurrency = value;
      }
      continue;
    }

    if (arg.startsWith('--timing-budget-ms=')) {
      const value = Number.parseInt(arg.slice('--timing-budget-ms='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        timingBudgetMs = value;
      }
      continue;
    }

    if (arg === '--fail-on-budget-exceeded') {
      failOnBudgetExceeded = true;
      continue;
    }

    if (arg === '--no-cache') {
      cacheEnabled = false;
      continue;
    }

    if (arg.startsWith('--cache-dir=')) {
      const value = arg.slice('--cache-dir='.length).trim();
      if (value.length > 0) {
        cacheDir = path.resolve(value);
      }
      continue;
    }
  }

  return {
    update,
    fixtureIds,
    maxMismatchRatio,
    minSsim,
    concurrency,
    timingBudgetMs,
    failOnBudgetExceeded,
    cacheEnabled,
    cacheDir
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
async function executeFixture(fixture, options, renderCache) {
  const fixtureAbsolutePath = path.resolve(fixture.fixturePath);
  const baselinePath = path.join(BASELINE_DIR, `${fixture.id}.png`);
  const actualPath = path.join(ARTIFACT_DIR, `${fixture.id}.actual.png`);
  const diffPath = path.join(ARTIFACT_DIR, `${fixture.id}.diff.png`);
  const startedAt = Date.now();

  try {
    const cached = await renderCache.read({
      id: fixture.id,
      fixturePath: fixtureAbsolutePath,
      format: fixture.format,
      pageIndex: 0
    });
    const cacheHit = Boolean(cached);
    let svgMarkup = cached?.svgMarkup;
    let rasterizedPng = cached?.png;
    let rasterizedWidth = cached?.width;
    let rasterizedHeight = cached?.height;

    if (!svgMarkup || !rasterizedPng || !rasterizedWidth || !rasterizedHeight) {
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
          durationMs: Date.now() - startedAt,
          cacheHit: false,
          status: 'error',
          reason: 'parse produced no score'
        };
      }

      const rendered = renderToSVGPages(parsed.score);
      svgMarkup = extractFirstSvgMarkup(rendered.pages[0] ?? '');
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
          durationMs: Date.now() - startedAt,
          cacheHit: false,
          status: 'error',
          reason: 'render produced no SVG markup'
        };
      }

      const rasterized = rasterizeSvg(svgMarkup);
      rasterizedPng = rasterized.png;
      rasterizedWidth = rasterized.width;
      rasterizedHeight = rasterized.height;
      await renderCache.write(
        {
          id: fixture.id,
          fixturePath: fixtureAbsolutePath,
          format: fixture.format,
          pageIndex: 0
        },
        {
          svgMarkup,
          png: rasterized.png,
          width: rasterized.width,
          height: rasterized.height,
          pageCount: rendered.pages.length,
          parseDiagnostics: parsed.diagnostics,
          renderDiagnostics: rendered.diagnostics
        }
      );
    }

    await writeFile(actualPath, rasterizedPng);
    const geometry = collectNotationGeometry(svgMarkup);
    const intrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });

    if (options.update) {
      await writeFile(baselinePath, rasterizedPng);
      return {
        id: fixture.id,
        fixturePath: fixture.fixturePath,
        baselinePath,
        actualPath,
        diffPath: null,
        renderedWidth: rasterizedWidth,
        renderedHeight: rasterizedHeight,
        noteheadCount: geometry.noteheads.length,
        beamCount: geometry.beams.length,
        barlineIntrusionCount: intrusions.length,
        mismatchPixels: null,
        mismatchRatio: null,
        ssim: null,
        durationMs: Date.now() - startedAt,
        cacheHit,
        status: 'updated'
      };
    }

    const baselinePng = await readFile(baselinePath);
    const comparison = comparePngBuffers(rasterizedPng, baselinePng);
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
      renderedWidth: rasterizedWidth,
      renderedHeight: rasterizedHeight,
      noteheadCount: geometry.noteheads.length,
      beamCount: geometry.beams.length,
      barlineIntrusionCount: intrusions.length,
      mismatchPixels: comparison.mismatchPixels,
      mismatchRatio: comparison.mismatchRatio,
      ssim: comparison.ssim,
      durationMs: Date.now() - startedAt,
      cacheHit,
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
      durationMs: Date.now() - startedAt,
      cacheHit: false,
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
    `Concurrency: ${summary.concurrency}`,
    `Cache: ${summary.cacheEnabled ? 'on' : 'off'} (hits=${summary.cacheHitCount})`,
    `Max mismatch ratio: ${summary.maxMismatchRatio}`,
    `Min SSIM: ${summary.minSsim}`,
    `Timing: avg=${summary.timing.averageMs.toFixed(1)}ms p95=${summary.timing.p95Ms.toFixed(
      1
    )}ms max=${summary.timing.maxMs.toFixed(1)}ms`,
    `Timing budget: ${
      summary.timingBudgetMs === null
        ? 'disabled'
        : `${summary.timingBudgetMs}ms (exceeded=${summary.timing.budgetExceededCount})`
    }`,
    '',
    '| Fixture | Status | Cache | Duration (ms) | Mismatch Ratio | SSIM | Beams | Intrusions | Notes |',
    '|---|---|---|---|---|---|---|---|---|'
  ];

  for (const result of summary.results) {
    lines.push(
      `| ${result.id} | ${result.status} | ${result.cacheHit ? 'hit' : 'miss'} | ${result.durationMs.toFixed(
        1
      )} | ${formatMetric(result.mismatchRatio)} | ${formatMetric(result.ssim)} | ${result.beamCount} | ${result.barlineIntrusionCount} | ${escapeCell(result.reason ?? '')} |`
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
