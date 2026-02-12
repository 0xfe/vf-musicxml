import type { Diagnostic } from '../core/diagnostics.js';
import {
  CONFORMANCE_QUALITY_DIMENSIONS,
  type ConformanceCategoryRollup,
  type ConformanceExecutionReport,
  type ConformanceFixtureExecutionResult,
  type ConformanceHistogram,
  type ConformanceQualitySummary
} from './conformance-types.js';

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
    '| Fixture | Parse Mode | Expected | Observed | Match | Quality | Notes |',
    '|---|---|---|---|---|---|---|'
  ];

  for (const result of report.results) {
    const notesSource =
      result.failureReasons.length > 0 ? result.failureReasons : result.observedFailureReasons;
    const notes = notesSource.length > 0 ? notesSource.join('; ') : 'ok';
    lines.push(
      `| ${result.fixtureId} | ${result.parseMode} | ${result.expected} | ${result.observed} | ${
        result.success ? 'yes' : 'no'
      } | ${formatQualityScore(result.quality?.weightedScore)} | ${escapeMarkdownTable(notes)} |`
    );
  }

  lines.push('');
  lines.push('## Quality Summary');
  lines.push('');
  appendQualitySummary(lines, report.qualitySummary);
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

/** Build a diagnostic code histogram from a list of diagnostics. */
export function buildCodeHistogram(diagnostics: Diagnostic[]): ConformanceHistogram {
  const histogram: ConformanceHistogram = {};
  for (const diagnostic of diagnostics) {
    histogram[diagnostic.code] = (histogram[diagnostic.code] ?? 0) + 1;
  }
  return histogram;
}

/** Build a severity histogram from a list of diagnostics. */
export function buildSeverityHistogram(diagnostics: Diagnostic[]): ConformanceHistogram {
  const histogram: ConformanceHistogram = {};
  for (const diagnostic of diagnostics) {
    histogram[diagnostic.severity] = (histogram[diagnostic.severity] ?? 0) + 1;
  }
  return histogram;
}

/** Build per-category pass/fail and diagnostic histogram aggregates. */
export function buildCategoryRollups(
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

/** Escape markdown table delimiters in free-form diagnostic text. */
function escapeMarkdownTable(value: string): string {
  return value.replaceAll('|', '\\|');
}

/** Format a deterministic numeric quality value for markdown display. */
function formatQualityScore(score: number | undefined): string {
  if (score === undefined) {
    return 'n/a';
  }
  return score.toFixed(2);
}

/** Append a markdown quality summary section with aggregate M7B gate signals. */
function appendQualitySummary(lines: string[], summary: ConformanceQualitySummary): void {
  lines.push(`Scored fixtures: ${summary.scoredFixtureCount}`);
  lines.push(`Expected-pass scored fixtures: ${summary.expectedPassScoredFixtureCount}`);
  lines.push(`Weighted mean (all scored fixtures): ${summary.weightedMean.toFixed(4)} / 5`);
  lines.push(`Weighted mean (expected-pass fixtures): ${summary.expectedPassWeightedMean.toFixed(4)} / 5`);
  lines.push(
    `Expected-pass catastrophic readability fixtures: ${summary.expectedPassCatastrophicFixtureIds.length}`
  );
  lines.push(
    `Expected-pass critical collision count: ${summary.expectedPassCriticalCollisionCount}`
  );
  lines.push(
    `Expected-pass flag/beam overlap count: ${summary.expectedPassFlagBeamOverlapCount}`
  );

  lines.push('');
  lines.push('### Quality Dimension Averages (Expected-pass)');
  lines.push('');
  lines.push('| Dimension | Weight | Average |');
  lines.push('|---|---|---|');
  for (const id of CONFORMANCE_QUALITY_DIMENSIONS) {
    lines.push(
      `| ${id} | ${summary.weights[id]} | ${summary.expectedPassDimensionAverages[id].toFixed(4)} |`
    );
  }

  if (summary.expectedPassCatastrophicFixtureIds.length > 0) {
    lines.push('');
    lines.push('### Catastrophic Readability Fixtures');
    lines.push('');
    for (const fixtureId of summary.expectedPassCatastrophicFixtureIds) {
      lines.push(`- ${fixtureId}`);
    }
  }

  if (summary.expectedPassCriticalCollisionFixtureIds.length > 0) {
    lines.push('');
    lines.push('### Critical Collision Fixtures');
    lines.push('');
    for (const fixtureId of summary.expectedPassCriticalCollisionFixtureIds) {
      lines.push(`- ${fixtureId}`);
    }
  }

  if (summary.expectedPassFlagBeamOverlapFixtureIds.length > 0) {
    lines.push('');
    lines.push('### Flag/Beam Overlap Fixtures');
    lines.push('');
    for (const fixtureId of summary.expectedPassFlagBeamOverlapFixtureIds) {
      lines.push(`- ${fixtureId}`);
    }
  }
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
