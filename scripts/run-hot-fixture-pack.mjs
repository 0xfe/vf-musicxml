#!/usr/bin/env node
/* global console, process */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseCsvArgument, runWithConcurrency } from '../dist/testkit/execution-loop.js';
import { loadConformanceFixtures } from '../dist/testkit/conformance.js';

/** Default output directory for combined fast-loop artifacts. */
const DEFAULT_OUT_DIR = path.resolve('artifacts/hot-fixture-pack');
/** Default worker count used for inspect sub-commands. */
const DEFAULT_INSPECT_CONCURRENCY = 4;
/** Golden manifest used to resolve per-fixture reference images for inspect diffs. */
const GOLDEN_MANIFEST_PATH = path.resolve('fixtures/golden/manifest.json');
/** Conformance fixture root used to resolve fixture IDs to source paths. */
const CONFORMANCE_ROOT = path.resolve('fixtures/conformance');
/** Sentinel manifest used to scope headless visual checks. */
const HEADLESS_SENTINEL_MANIFEST_PATH = path.resolve(
  'fixtures/evaluation/headless-visual-sentinels.json'
);

/** Parse CLI options for hot fixture pack runs. */
function parseArgs(argv) {
  const options = {
    fixtureIds: undefined,
    outDir: DEFAULT_OUT_DIR,
    inspectConcurrency: DEFAULT_INSPECT_CONCURRENCY,
    compareConcurrency: undefined,
    timingBudgetMs: undefined,
    strict: false
  };

  for (const arg of argv) {
    if (arg.startsWith('--fixtures=')) {
      options.fixtureIds = parseCsvArgument(arg.slice('--fixtures='.length).trim());
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      const value = arg.slice('--out-dir='.length).trim();
      if (value.length > 0) {
        options.outDir = path.resolve(value);
      }
      continue;
    }

    if (arg.startsWith('--inspect-concurrency=')) {
      const value = Number.parseInt(arg.slice('--inspect-concurrency='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.inspectConcurrency = value;
      }
      continue;
    }

    if (arg.startsWith('--compare-concurrency=')) {
      const value = Number.parseInt(arg.slice('--compare-concurrency='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.compareConcurrency = value;
      }
      continue;
    }

    if (arg.startsWith('--timing-budget-ms=')) {
      const value = Number.parseInt(arg.slice('--timing-budget-ms='.length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.timingBudgetMs = value;
      }
      continue;
    }

    if (arg === '--strict') {
      options.strict = true;
    }
  }

  if (!options.fixtureIds || options.fixtureIds.length === 0) {
    throw new Error('Missing required argument: --fixtures=id1,id2');
  }

  return options;
}

/** Run one node script command and return structured exit metadata. */
function runNodeScript(scriptPath, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

/** Load fixture-id -> reference-image map from golden manifest. */
async function loadGoldenReferenceMap() {
  const raw = await readFile(GOLDEN_MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const fixtures = Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];
  const map = new Map();
  for (const fixture of fixtures) {
    if (fixture?.id && fixture?.goldenImagePath) {
      map.set(String(fixture.id), path.resolve(String(fixture.goldenImagePath)));
    }
  }
  return map;
}

/** Build id -> fixture path map from conformance metadata. */
async function loadConformancePathMap() {
  const fixtures = await loadConformanceFixtures(CONFORMANCE_ROOT);
  const map = new Map();
  for (const fixture of fixtures) {
    map.set(fixture.meta.id, fixture.scorePath);
  }
  return map;
}

/** Load fixture ids that are eligible for headless visual sentinel comparisons. */
async function loadHeadlessSentinelIds() {
  const raw = await readFile(HEADLESS_SENTINEL_MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const fixtures = Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];
  const ids = new Set();
  for (const fixture of fixtures) {
    const id = typeof fixture?.id === 'string' ? fixture.id.trim() : '';
    if (id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

/** Compose one markdown summary row for a fixture triage line. */
function renderFixtureRow(fixtureId, golden, headless, inspect) {
  const goldenStatus = golden?.status ?? 'n/a';
  const headlessStatus = headless?.status ?? 'n/a';
  const intrusion = golden?.barlineIntrusionCount ?? headless?.barlineIntrusionCount ?? 'n/a';
  const mismatch = golden?.mismatchRatio ?? headless?.mismatchRatio ?? null;
  const ssim = golden?.ssim ?? headless?.ssim ?? null;
  const reason = golden?.reason ?? headless?.reason ?? '';
  const diagnostics = inspect
    ? `${(inspect.parseDiagnostics?.length ?? 0) + (inspect.renderDiagnostics?.length ?? 0)}`
    : 'n/a';

  return `| ${fixtureId} | ${goldenStatus} | ${headlessStatus} | ${intrusion} | ${
    mismatch === null || mismatch === undefined ? 'n/a' : Number(mismatch).toFixed(6)
  } | ${ssim === null || ssim === undefined ? 'n/a' : Number(ssim).toFixed(6)} | ${diagnostics} | ${escapeCell(
    reason
  )} |`;
}

/** Escape markdown table cells in free-form text. */
function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Entry point. */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = options.outDir;
  const goldenOutDir = path.join(outDir, 'golden');
  const inspectOutDir = path.join(outDir, 'inspect');
  const headlessOutDir = path.resolve('artifacts/visual-headless');

  await mkdir(outDir, { recursive: true });
  await mkdir(goldenOutDir, { recursive: true });
  await mkdir(inspectOutDir, { recursive: true });

  const sharedArgs = [];
  if (options.compareConcurrency) {
    sharedArgs.push(`--concurrency=${options.compareConcurrency}`);
  }
  if (options.timingBudgetMs) {
    sharedArgs.push(`--timing-budget-ms=${options.timingBudgetMs}`);
  }
  const fixtureArg = `--fixtures=${options.fixtureIds.join(',')}`;
  const headlessSentinelIds = await loadHeadlessSentinelIds();
  const headlessFixtureIds = options.fixtureIds.filter((fixtureId) => headlessSentinelIds.has(fixtureId));
  const headlessFixtureArg = `--fixtures=${headlessFixtureIds.join(',')}`;

  const goldenArgs = [fixtureArg, `--out-dir=${goldenOutDir}`, ...sharedArgs];
  if (!options.strict) {
    // Triage packs should still produce reports even when comparisons fail.
    goldenArgs.push('--allow-blocking-failures');
  }

  const goldenExecPromise = runNodeScript(
    path.resolve('scripts/run-golden-comparison.mjs'),
    goldenArgs,
    process.cwd()
  );
  const headlessExecPromise =
    headlessFixtureIds.length > 0
      ? runNodeScript(
          path.resolve('scripts/run-headless-visual-regression.mjs'),
          [headlessFixtureArg, ...sharedArgs],
          process.cwd()
        )
      : Promise.resolve({
          code: 0,
          stdout: '',
          stderr: '[info] Headless visual regression skipped (no selected fixtures in sentinel manifest).\n'
        });

  const [goldenExec, headlessExec] = await Promise.all([goldenExecPromise, headlessExecPromise]);

  const [conformancePathById, goldenReferenceById] = await Promise.all([
    loadConformancePathMap(),
    loadGoldenReferenceMap()
  ]);

  await runWithConcurrency(options.fixtureIds, options.inspectConcurrency, async (fixtureId) => {
    const fixturePath = conformancePathById.get(fixtureId);
    if (!fixturePath) {
      return;
    }
    const inspectArgs = [
      `--input=${fixturePath}`,
      `--id=${fixtureId}`,
      `--out-dir=${inspectOutDir}`
    ];
    const referenceImagePath = goldenReferenceById.get(fixtureId);
    if (referenceImagePath) {
      inspectArgs.push(`--reference-png=${referenceImagePath}`);
    }
    await runNodeScript(path.resolve('scripts/inspect-score-headless.mjs'), inspectArgs, process.cwd());
  });

  const goldenReportPath = path.join(goldenOutDir, 'report.json');
  const headlessReportPath = path.join(headlessOutDir, 'report.json');
  let goldenReport = { results: [] };
  let headlessReport = { results: [] };
  try {
    goldenReport = JSON.parse(await readFile(goldenReportPath, 'utf8'));
  } catch {
    // Keep defaults when golden command exits before writing report artifacts.
  }
  if (headlessFixtureIds.length > 0) {
    try {
      headlessReport = JSON.parse(await readFile(headlessReportPath, 'utf8'));
    } catch {
      // Keep defaults when headless command exits before writing report artifacts.
    }
  }

  const goldenById = new Map((goldenReport.results ?? []).map((result) => [result.id, result]));
  const headlessById = new Map((headlessReport.results ?? []).map((result) => [result.id, result]));

  const inspectReports = new Map();
  for (const fixtureId of options.fixtureIds) {
    const reportPath = path.join(inspectOutDir, `${fixtureId}.report.json`);
    try {
      inspectReports.set(fixtureId, JSON.parse(await readFile(reportPath, 'utf8')));
    } catch {
      // Missing inspect reports are left undefined and surfaced in markdown.
    }
  }

  const rows = options.fixtureIds
    .map((fixtureId) => renderFixtureRow(fixtureId, goldenById.get(fixtureId), headlessById.get(fixtureId), inspectReports.get(fixtureId)))
    .join('\n');
  const markdown = [
    '# Hot Fixture Pack Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Fixtures: ${options.fixtureIds.join(', ')}`,
    `Golden command exit: ${goldenExec.code}`,
    `Headless command exit: ${headlessExec.code}`,
    `Headless fixture subset: ${
      headlessFixtureIds.length > 0 ? headlessFixtureIds.join(', ') : '(none selected)'
    }`,
    '',
    '| Fixture | Golden | Headless | Intrusions | Mismatch Ratio | SSIM | Diagnostics | Notes |',
    '|---|---|---|---|---|---|---|---|',
    rows,
    '',
    `Golden artifacts: ${goldenOutDir}`,
    `Headless artifacts: ${headlessOutDir}`,
    `Inspect artifacts: ${inspectOutDir}`,
    ''
  ].join('\n');
  const reportPath = path.join(outDir, 'report.md');
  await writeFile(reportPath, `${markdown}\n`, 'utf8');
  console.log(`wrote ${reportPath}`);

  if (options.strict && (goldenExec.code !== 0 || headlessExec.code !== 0)) {
    process.exitCode = 1;
  }
}

await main();
