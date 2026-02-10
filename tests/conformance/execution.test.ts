import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConformanceFixtures } from '../../src/testkit/conformance.js';
import {
  executeConformanceFixtures,
  formatConformanceReportMarkdown,
  writeConformanceReportArtifacts
} from '../../src/testkit/conformance-execution.js';

describe('conformance execution baseline', () => {
  it('runs active fixtures through parse/render/collision workflow and supports report artifacts', async () => {
    const fixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance'));
    const report = await executeConformanceFixtures(fixtures);

    expect(report.fixtureCount).toBeGreaterThanOrEqual(8);
    expect(report.failCount).toBe(0);
    expect(report.results.every((result) => result.success)).toBe(true);
    expect((report.parseDiagnosticCodeHistogram.XML_NOT_WELL_FORMED ?? 0) > 0).toBe(true);
    expect((report.diagnosticSeverityHistogram.error ?? 0) > 0).toBe(true);
    expect(report.categoryRollups.smoke?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.timewise?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.rhythm?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.parser?.fixtureCount).toBeGreaterThanOrEqual(2);
    expect(report.categoryRollups.mxl?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.notation?.fixtureCount).toBeGreaterThanOrEqual(2);

    const expectedFailFixture = report.results.find((result) => result.fixtureId === 'parser-malformed-xml');
    expect(expectedFailFixture).toBeDefined();
    expect(expectedFailFixture?.expected).toBe('fail');
    expect(expectedFailFixture?.observed).toBe('fail');
    expect(expectedFailFixture?.success).toBe(true);
    expect((expectedFailFixture?.observedFailureReasons.length ?? 0) > 0).toBe(true);

    const unsupportedRootFixture = report.results.find(
      (result) => result.fixtureId === 'parser-unsupported-root-opus'
    );
    expect(unsupportedRootFixture).toBeDefined();
    expect(unsupportedRootFixture?.expected).toBe('fail');
    expect(unsupportedRootFixture?.observed).toBe('fail');
    expect(unsupportedRootFixture?.success).toBe(true);
    expect((unsupportedRootFixture?.observedFailureReasons.length ?? 0) > 0).toBe(true);

    const invalidMxlFixture = report.results.find((result) => result.fixtureId === 'mxl-invalid-container');
    expect(invalidMxlFixture).toBeDefined();
    expect(invalidMxlFixture?.expected).toBe('fail');
    expect(invalidMxlFixture?.observed).toBe('fail');
    expect(invalidMxlFixture?.success).toBe(true);
    expect((invalidMxlFixture?.observedFailureReasons.length ?? 0) > 0).toBe(true);

    const strictNotationFixture = report.results.find(
      (result) => result.fixtureId === 'notation-invalid-pitch-step-strict'
    );
    expect(strictNotationFixture).toBeDefined();
    expect(strictNotationFixture?.parseMode).toBe('strict');
    expect(strictNotationFixture?.expected).toBe('fail');
    expect(strictNotationFixture?.observed).toBe('fail');
    expect(strictNotationFixture?.success).toBe(true);
    expect((strictNotationFixture?.observedFailureReasons.length ?? 0) > 0).toBe(true);

    const lenientNotationFixture = report.results.find(
      (result) => result.fixtureId === 'notation-invalid-pitch-step-lenient'
    );
    expect(lenientNotationFixture).toBeDefined();
    expect(lenientNotationFixture?.parseMode).toBe('lenient');
    expect(lenientNotationFixture?.expected).toBe('pass');
    expect(lenientNotationFixture?.observed).toBe('pass');
    expect(lenientNotationFixture?.success).toBe(true);

    const markdownSummary = formatConformanceReportMarkdown(report);
    expect(markdownSummary).toContain('# Conformance Execution Report');
    expect(markdownSummary).toContain('smoke-minimal-partwise');
    expect(markdownSummary).toContain('parser-malformed-xml');
    expect(markdownSummary).toContain('parser-unsupported-root-opus');
    expect(markdownSummary).toContain('mxl-invalid-container');
    expect(markdownSummary).toContain('notation-invalid-pitch-step-strict');
    expect(markdownSummary).toContain('notation-invalid-pitch-step-lenient');
    expect(markdownSummary).toContain('## Diagnostic Histograms');
    expect(markdownSummary).toContain('### Parse Diagnostic Codes');
    expect(markdownSummary).toContain('## Category Rollups');

    const outDir = process.env.CONFORMANCE_REPORT_OUT_DIR;
    if (outDir) {
      const paths = await writeConformanceReportArtifacts(report, outDir);
      expect(paths.jsonPath.endsWith('conformance-report.json')).toBe(true);
      expect(paths.markdownPath.endsWith('conformance-report.md')).toBe(true);
    }
  });
});
