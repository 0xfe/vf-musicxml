import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Diagnostic } from '../core/diagnostics.js';
import { parseMusicXMLAsync } from '../public/api.js';
import { renderScoreToSVGPages } from '../vexflow/render.js';
import type { ConformanceFixtureRecord } from './conformance.js';
import { runConformanceCollisionAudit, type ConformanceCollisionAuditReport } from './conformance.js';

/** String-keyed histogram helper used by conformance aggregate summaries. */
export type ConformanceHistogram = Record<string, number>;

/** One fixture execution result captured for conformance triage and artifact reporting. */
export interface ConformanceFixtureExecutionResult {
  fixtureId: string;
  metaPath: string;
  scorePath: string;
  expected: 'pass' | 'fail';
  status: 'active' | 'skip';
  parseMode: 'strict' | 'lenient';
  parseDiagnostics: Diagnostic[];
  renderDiagnostics: Diagnostic[];
  collisionAudit?: ConformanceCollisionAuditReport;
  observed: 'pass' | 'fail';
  observedFailureReasons: string[];
  success: boolean;
  failureReasons: string[];
}

/** Aggregated execution report for all processed fixtures. */
export interface ConformanceExecutionReport {
  generatedAt: string;
  fixtureCount: number;
  passCount: number;
  failCount: number;
  parseDiagnosticCodeHistogram: ConformanceHistogram;
  renderDiagnosticCodeHistogram: ConformanceHistogram;
  diagnosticSeverityHistogram: ConformanceHistogram;
  categoryRollups: Record<string, ConformanceCategoryRollup>;
  results: ConformanceFixtureExecutionResult[];
}

/** Category-level aggregate for conformance triage slicing. */
export interface ConformanceCategoryRollup {
  fixtureCount: number;
  passCount: number;
  failCount: number;
  parseDiagnosticCodeHistogram: ConformanceHistogram;
  renderDiagnosticCodeHistogram: ConformanceHistogram;
  diagnosticSeverityHistogram: ConformanceHistogram;
}

/** Optional output paths produced when writing report artifacts to disk. */
export interface ConformanceExecutionArtifactPaths {
  jsonPath: string;
  markdownPath: string;
}

/** Resolve parser input format from fixture score path. */
export function inferConformanceInputFormat(scorePath: string): 'xml' | 'mxl' {
  return scorePath.toLowerCase().endsWith('.mxl') ? 'mxl' : 'xml';
}

/** Execute one fixture through parse/render/collision checks and compute pass/fail outcome. */
export async function executeConformanceFixture(
  fixture: ConformanceFixtureRecord
): Promise<ConformanceFixtureExecutionResult> {
  const bytes = await readFile(fixture.scorePath);
  const parseMode = fixture.meta.parse_mode ?? 'lenient';
  const parseResult = await parseMusicXMLAsync(
    {
      data: new Uint8Array(bytes),
      format: inferConformanceInputFormat(fixture.scorePath)
    },
    {
      sourceName: fixture.scorePath,
      mode: parseMode
    }
  );

  const parseDiagnostics = parseResult.diagnostics;
  const parseErrors = parseDiagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const observedFailureReasons: string[] = [];

  if (parseErrors.length > 0) {
    observedFailureReasons.push(`parse errors: ${parseErrors.map((diagnostic) => diagnostic.code).join(', ')}`);
  }
  if (!parseResult.score) {
    observedFailureReasons.push('parse produced no score');
  }

  let renderDiagnostics: Diagnostic[] = [];
  let collisionAudit: ConformanceCollisionAuditReport | undefined;

  if (parseResult.score) {
    const renderResult = renderScoreToSVGPages(parseResult.score);
    renderDiagnostics = renderResult.diagnostics;
    const renderErrors = renderDiagnostics.filter((diagnostic) => diagnostic.severity === 'error');

    if (renderErrors.length > 0) {
      observedFailureReasons.push(`render errors: ${renderErrors.map((diagnostic) => diagnostic.code).join(', ')}`);
    }

    const firstPage = renderResult.pages[0] ?? '';
    collisionAudit = runConformanceCollisionAudit(firstPage, fixture.meta);
    if (collisionAudit && !collisionAudit.pass) {
      observedFailureReasons.push(
        `collision audit exceeded threshold (${collisionAudit.overlapCount} overlaps)`
      );
    }
  }

  const observed: 'pass' | 'fail' = observedFailureReasons.length === 0 ? 'pass' : 'fail';
  const expectationMatched = fixture.meta.expected === observed;
  const failureReasons = expectationMatched
    ? []
    : [`expected '${fixture.meta.expected}' but observed '${observed}'`];

  return {
    fixtureId: fixture.meta.id,
    metaPath: fixture.metaPath,
    scorePath: fixture.scorePath,
    expected: fixture.meta.expected,
    status: fixture.meta.status,
    parseMode,
    parseDiagnostics,
    renderDiagnostics,
    collisionAudit,
    observed,
    observedFailureReasons,
    success: expectationMatched,
    failureReasons
  };
}

/** Execute all fixtures and collect a timestamped aggregate report. */
export async function executeConformanceFixtures(
  fixtures: ConformanceFixtureRecord[]
): Promise<ConformanceExecutionReport> {
  const results: ConformanceFixtureExecutionResult[] = [];
  for (const fixture of fixtures) {
    if (fixture.meta.status !== 'active') {
      continue;
    }
    results.push(await executeConformanceFixture(fixture));
  }

  const passCount = results.filter((result) => result.success).length;
  const failCount = results.length - passCount;
  const parseDiagnostics = results.flatMap((result) => result.parseDiagnostics);
  const renderDiagnostics = results.flatMap((result) => result.renderDiagnostics);
  const allDiagnostics = [...parseDiagnostics, ...renderDiagnostics];

  return {
    generatedAt: new Date().toISOString(),
    fixtureCount: results.length,
    passCount,
    failCount,
    parseDiagnosticCodeHistogram: buildCodeHistogram(parseDiagnostics),
    renderDiagnosticCodeHistogram: buildCodeHistogram(renderDiagnostics),
    diagnosticSeverityHistogram: buildSeverityHistogram(allDiagnostics),
    categoryRollups: buildCategoryRollups(results),
    results
  };
}

/** Format a compact markdown summary useful for quick run triage. */
export function formatConformanceReportMarkdown(report: ConformanceExecutionReport): string {
  const lines: string[] = [
    '# Conformance Execution Report',
    '',
    `Generated at: ${report.generatedAt}`,
    `Fixtures executed: ${report.fixtureCount}`,
    `Passed: ${report.passCount}`,
    `Failed: ${report.failCount}`,
    '',
    '| Fixture | Parse Mode | Expected | Observed | Match | Notes |',
    '|---|---|---|---|---|---|'
  ];

  for (const result of report.results) {
    const notesSource =
      result.failureReasons.length > 0 ? result.failureReasons : result.observedFailureReasons;
    const notes = notesSource.length > 0 ? notesSource.join('; ') : 'ok';
    lines.push(
      `| ${result.fixtureId} | ${result.parseMode} | ${result.expected} | ${result.observed} | ${
        result.success ? 'yes' : 'no'
      } | ${escapeMarkdownTable(notes)} |`
    );
  }

  lines.push('');
  lines.push('## Diagnostic Histograms');
  lines.push('');
  appendHistogramSection(lines, 'Parse Diagnostic Codes', report.parseDiagnosticCodeHistogram);
  lines.push('');
  appendHistogramSection(lines, 'Render Diagnostic Codes', report.renderDiagnosticCodeHistogram);
  lines.push('');
  appendHistogramSection(lines, 'Diagnostic Severities', report.diagnosticSeverityHistogram);
  lines.push('');
  lines.push('## Category Rollups');
  lines.push('');
  appendCategoryRollupSection(lines, report.categoryRollups);

  return `${lines.join('\n')}\n`;
}

/** Serialize report content to deterministic JSON text for artifacts. */
export function formatConformanceReportJson(report: ConformanceExecutionReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Write JSON and Markdown report artifacts to `outDir`. */
export async function writeConformanceReportArtifacts(
  report: ConformanceExecutionReport,
  outDir: string
): Promise<ConformanceExecutionArtifactPaths> {
  await mkdir(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'conformance-report.json');
  const markdownPath = path.join(outDir, 'conformance-report.md');

  await writeFile(jsonPath, formatConformanceReportJson(report), 'utf8');
  await writeFile(markdownPath, formatConformanceReportMarkdown(report), 'utf8');

  return { jsonPath, markdownPath };
}

/** Escape markdown table delimiters in free-form diagnostic text. */
function escapeMarkdownTable(value: string): string {
  return value.replaceAll('|', '\\|');
}

/** Build a diagnostic code histogram from a list of diagnostics. */
function buildCodeHistogram(diagnostics: Diagnostic[]): ConformanceHistogram {
  const histogram: ConformanceHistogram = {};
  for (const diagnostic of diagnostics) {
    histogram[diagnostic.code] = (histogram[diagnostic.code] ?? 0) + 1;
  }
  return histogram;
}

/** Build a severity histogram from a list of diagnostics. */
function buildSeverityHistogram(diagnostics: Diagnostic[]): ConformanceHistogram {
  const histogram: ConformanceHistogram = {};
  for (const diagnostic of diagnostics) {
    histogram[diagnostic.severity] = (histogram[diagnostic.severity] ?? 0) + 1;
  }
  return histogram;
}

/** Append a markdown histogram section sorted by descending count then key name. */
function appendHistogramSection(
  lines: string[],
  title: string,
  histogram: ConformanceHistogram
): void {
  lines.push(`### ${title}`);
  lines.push('');

  const entries = Object.entries(histogram).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });

  if (entries.length === 0) {
    lines.push('- none');
    return;
  }

  lines.push('| Key | Count |');
  lines.push('|---|---|');
  for (const [key, count] of entries) {
    lines.push(`| ${escapeMarkdownTable(key)} | ${count} |`);
  }
}

/** Build per-category pass/fail and diagnostic histogram aggregates. */
function buildCategoryRollups(
  results: ConformanceFixtureExecutionResult[]
): Record<string, ConformanceCategoryRollup> {
  const rollups: Record<string, ConformanceCategoryRollup> = {};

  for (const result of results) {
    const category = readCategoryFromMetaPath(result.metaPath);
    const rollup = (rollups[category] ??= {
      fixtureCount: 0,
      passCount: 0,
      failCount: 0,
      parseDiagnosticCodeHistogram: {},
      renderDiagnosticCodeHistogram: {},
      diagnosticSeverityHistogram: {}
    });

    rollup.fixtureCount += 1;
    if (result.success) {
      rollup.passCount += 1;
    } else {
      rollup.failCount += 1;
    }

    mergeHistogram(rollup.parseDiagnosticCodeHistogram, buildCodeHistogram(result.parseDiagnostics));
    mergeHistogram(rollup.renderDiagnosticCodeHistogram, buildCodeHistogram(result.renderDiagnostics));
    mergeHistogram(
      rollup.diagnosticSeverityHistogram,
      buildSeverityHistogram([...result.parseDiagnostics, ...result.renderDiagnostics])
    );
  }

  return rollups;
}

/** Extract fixture category from metadata path (`.../conformance/<category>/...`). */
function readCategoryFromMetaPath(metaPath: string): string {
  const normalized = metaPath.replaceAll('\\', '/');
  const marker = '/fixtures/conformance/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) {
    return 'unknown';
  }

  const rest = normalized.slice(markerIndex + marker.length);
  const [category] = rest.split('/');
  return category && category.length > 0 ? category : 'unknown';
}

/** Merge histogram counts from `source` into `target`. */
function mergeHistogram(target: ConformanceHistogram, source: ConformanceHistogram): void {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

/** Append markdown rollup rows sorted by category key. */
function appendCategoryRollupSection(
  lines: string[],
  categoryRollups: Record<string, ConformanceCategoryRollup>
): void {
  const entries = Object.entries(categoryRollups).sort((left, right) => left[0].localeCompare(right[0]));

  if (entries.length === 0) {
    lines.push('- none');
    return;
  }

  lines.push('| Category | Fixtures | Passed | Failed |');
  lines.push('|---|---|---|---|');
  for (const [category, rollup] of entries) {
    lines.push(`| ${escapeMarkdownTable(category)} | ${rollup.fixtureCount} | ${rollup.passCount} | ${rollup.failCount} |`);
  }
}
