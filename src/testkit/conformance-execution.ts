import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Diagnostic } from '../core/diagnostics.js';
import { parseMusicXMLAsync } from '../public/api.js';
import { renderScoreToSVGPages } from '../vexflow/render.js';
import type { ConformanceFixtureRecord } from './conformance.js';
import { runConformanceCollisionAudit } from './conformance.js';
import type { ConformanceCollisionAuditReport } from './conformance.js';
import {
  buildCategoryRollups,
  buildCodeHistogram,
  buildSeverityHistogram,
  formatConformanceReportJson,
  formatConformanceReportMarkdown
} from './conformance-report.js';
import {
  buildQualitySummary,
  CONFORMANCE_CRITICAL_QUALITY_DIMENSIONS,
  CONFORMANCE_QUALITY_WEIGHTS,
  evaluateFixtureQuality
} from './conformance-quality.js';
import type {
  ConformanceExecutionArtifactPaths,
  ConformanceExecutionReport,
  ConformanceFixtureExecutionResult,
  ConformanceFixtureQualityReport
} from './conformance-types.js';
import { CONFORMANCE_QUALITY_DIMENSIONS } from './conformance-types.js';

export {
  CONFORMANCE_CRITICAL_QUALITY_DIMENSIONS,
  CONFORMANCE_QUALITY_DIMENSIONS,
  CONFORMANCE_QUALITY_WEIGHTS,
  formatConformanceReportJson,
  formatConformanceReportMarkdown
};
export type {
  ConformanceCategoryRollup,
  ConformanceExecutionArtifactPaths,
  ConformanceExecutionReport,
  ConformanceFixtureExecutionResult,
  ConformanceFixtureQualityDimensions,
  ConformanceFixtureQualityMetrics,
  ConformanceFixtureQualityReport,
  ConformanceHistogram,
  ConformanceQualityDimensionId,
  ConformanceQualitySummary
} from './conformance-types.js';

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
  let quality: ConformanceFixtureQualityReport | undefined;

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

    quality = evaluateFixtureQuality({
      pageMarkup: firstPage,
      parseDiagnostics,
      renderDiagnostics,
      collisionAudit,
      waivers: fixture.meta.waivers ?? []
    });
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
    quality,
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
    qualitySummary: buildQualitySummary(results),
    results
  };
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
