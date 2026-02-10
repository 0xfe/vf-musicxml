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

    expect(report.fixtureCount).toBeGreaterThanOrEqual(10);
    expect(report.failCount).toBe(0);
    expect(report.results.every((result) => result.success)).toBe(true);
    expect((report.parseDiagnosticCodeHistogram.XML_NOT_WELL_FORMED ?? 0) > 0).toBe(true);
    expect((report.diagnosticSeverityHistogram.error ?? 0) > 0).toBe(true);
    expect(report.categoryRollups.smoke?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.timewise?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.rhythm?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.parser?.fixtureCount).toBeGreaterThanOrEqual(2);
    expect(report.categoryRollups.mxl?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.notation?.fixtureCount).toBeGreaterThanOrEqual(3);
    expect(report.categoryRollups.layout?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.text?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.advanced?.fixtureCount).toBeGreaterThanOrEqual(1);
    expect(report.categoryRollups.lilypond?.fixtureCount).toBeGreaterThanOrEqual(20);
    expect(report.categoryRollups.realworld?.fixtureCount).toBeGreaterThanOrEqual(8);

    // M7A execution gates:
    // - expected-pass parse/render success >= 97%
    // - unexpected failure rate <= 1%
    // - every active LilyPond category has >= 90% expected-pass success
    const expectedPassResults = report.results.filter((result) => result.expected === 'pass');
    const expectedPassSuccesses = expectedPassResults.filter((result) => result.observed === 'pass');
    const expectedPassRate = expectedPassSuccesses.length / Math.max(1, expectedPassResults.length);
    expect(expectedPassRate).toBeGreaterThanOrEqual(0.97);

    const unexpectedFailures = report.results.filter((result) => !result.success);
    const unexpectedFailureRate = unexpectedFailures.length / Math.max(1, report.results.length);
    expect(unexpectedFailureRate).toBeLessThanOrEqual(0.01);

    const lilyPondCategoryResults = new Map<string, typeof report.results>();
    for (const result of report.results) {
      const fixtureCategoryMatch = /^lilypond-(\d{2})/i.exec(result.fixtureId);
      if (!fixtureCategoryMatch) {
        continue;
      }
      const fixtureCategory = `lilypond-${fixtureCategoryMatch[1]}`;

      const rows = lilyPondCategoryResults.get(fixtureCategory) ?? [];
      rows.push(result);
      lilyPondCategoryResults.set(fixtureCategory, rows);
    }

    for (const [category, rows] of lilyPondCategoryResults.entries()) {
      const categoryExpectedPass = rows.filter((row) => row.expected === 'pass');
      if (categoryExpectedPass.length === 0) {
        continue;
      }

      const categoryExpectedPassObservedPass = categoryExpectedPass.filter((row) => row.observed === 'pass');
      const categoryPassRate = categoryExpectedPassObservedPass.length / categoryExpectedPass.length;
      expect(categoryPassRate, `${category} should satisfy M7A category floor`).toBeGreaterThanOrEqual(0.9);
    }

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

    const m4NotationFixture = report.results.find((result) => result.fixtureId === 'notation-m4-baseline');
    expect(m4NotationFixture).toBeDefined();
    expect(m4NotationFixture?.parseMode).toBe('lenient');
    expect(m4NotationFixture?.expected).toBe('pass');
    expect(m4NotationFixture?.observed).toBe('pass');
    expect(m4NotationFixture?.success).toBe(true);

    const m5LayoutFixture = report.results.find((result) => result.fixtureId === 'layout-m5-multipart-baseline');
    expect(m5LayoutFixture).toBeDefined();
    expect(m5LayoutFixture?.parseMode).toBe('lenient');
    expect(m5LayoutFixture?.expected).toBe('pass');
    expect(m5LayoutFixture?.observed).toBe('pass');
    expect(m5LayoutFixture?.success).toBe(true);

    const m5TextFixture = report.results.find((result) => result.fixtureId === 'text-m5-lyrics-harmony-baseline');
    expect(m5TextFixture).toBeDefined();
    expect(m5TextFixture?.parseMode).toBe('lenient');
    expect(m5TextFixture?.expected).toBe('pass');
    expect(m5TextFixture?.observed).toBe('pass');
    expect(m5TextFixture?.success).toBe(true);

    const m6AdvancedFixture = report.results.find((result) => result.fixtureId === 'advanced-m6-notation-baseline');
    expect(m6AdvancedFixture).toBeDefined();
    expect(m6AdvancedFixture?.parseMode).toBe('lenient');
    expect(m6AdvancedFixture?.expected).toBe('pass');
    expect(m6AdvancedFixture?.observed).toBe('pass');
    expect(m6AdvancedFixture?.success).toBe(true);

    const markdownSummary = formatConformanceReportMarkdown(report);
    expect(markdownSummary).toContain('# Conformance Execution Report');
    expect(markdownSummary).toContain('smoke-minimal-partwise');
    expect(markdownSummary).toContain('parser-malformed-xml');
    expect(markdownSummary).toContain('parser-unsupported-root-opus');
    expect(markdownSummary).toContain('mxl-invalid-container');
    expect(markdownSummary).toContain('notation-invalid-pitch-step-strict');
    expect(markdownSummary).toContain('notation-invalid-pitch-step-lenient');
    expect(markdownSummary).toContain('notation-m4-baseline');
    expect(markdownSummary).toContain('layout-m5-multipart-baseline');
    expect(markdownSummary).toContain('text-m5-lyrics-harmony-baseline');
    expect(markdownSummary).toContain('advanced-m6-notation-baseline');
    expect(markdownSummary).toContain('## Diagnostic Histograms');
    expect(markdownSummary).toContain('### Parse Diagnostic Codes');
    expect(markdownSummary).toContain('## Category Rollups');

    const outDir = process.env.CONFORMANCE_REPORT_OUT_DIR;
    if (outDir) {
      const paths = await writeConformanceReportArtifacts(report, outDir);
      expect(paths.jsonPath.endsWith('conformance-report.json')).toBe(true);
      expect(paths.markdownPath.endsWith('conformance-report.md')).toBe(true);
    }
  }, 15000);
});
