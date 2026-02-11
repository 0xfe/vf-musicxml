import { describe, expect, it } from 'vitest';

import type { ConformanceExecutionReport, ConformanceFixtureExecutionResult } from '../../src/testkit/conformance-execution.js';
import {
  buildFailFastClassifierCounts,
  evaluateDeterministicSplit,
  resolveSplitResults
} from '../../src/testkit/evaluation.js';

/** Build a minimal fixture result record for deterministic evaluation tests. */
function makeResult(params: {
  fixtureId: string;
  category: string;
  expected: 'pass' | 'fail';
  observed: 'pass' | 'fail';
  weightedScore: number;
  catastrophic?: boolean;
  criticalCollisions?: number;
}): ConformanceFixtureExecutionResult {
  return {
    fixtureId: params.fixtureId,
    metaPath: `/Users/mo/git/musicxml/fixtures/conformance/${params.category}/${params.fixtureId}.meta.yaml`,
    scorePath: `/Users/mo/git/musicxml/fixtures/conformance/${params.category}/${params.fixtureId}.musicxml`,
    expected: params.expected,
    status: 'active',
    parseMode: 'lenient',
    parseDiagnostics: [],
    renderDiagnostics: [],
    observed: params.observed,
    observedFailureReasons: [],
    success: params.expected === params.observed,
    failureReasons: [],
    quality: {
      weightedScore: params.weightedScore,
      dimensions: { Q1: 5, Q2: 5, Q3: 5, Q4: 5, Q5: 5, Q6: 5, Q7: 5 },
      metrics: {
        noteheadCount: 10,
        stemCount: 10,
        beamCount: 0,
        flagCount: 0,
        flagBeamOverlapCount: 0,
        tieCount: 0,
        textCount: 0,
        minimumNoteheadGap: 8,
        crowdedGapRatio: 0,
        minorCollisionCount: 0,
        criticalCollisionCount: params.criticalCollisions ?? 0,
        effectiveCriticalCollisionCount: params.criticalCollisions ?? 0,
        textCollisionCount: 0,
        textToNoteheadCollisionCount: 0,
        noteheadBarlineIntrusionCount: 0,
        layoutOverflowCount: 0,
        textOverflowCount: 0,
        minimumStaveGap: 20,
        horizontalUsageRatio: 0.8,
        verticalUsageRatio: 0.5
      },
      criticalDimensionsBelowTwo: params.catastrophic ? ['Q2'] : [],
      catastrophicReadability: params.catastrophic ?? false,
      waivedCriticalCollision: false,
      waivedCatastrophicReadability: false,
      notes: []
    }
  };
}

describe('evaluation deterministic split utilities', () => {
  it('resolves split fixture sets using fixture IDs, categories, and expected filters', () => {
    const report = {
      generatedAt: new Date().toISOString(),
      fixtureCount: 3,
      passCount: 3,
      failCount: 0,
      parseDiagnosticCodeHistogram: {},
      renderDiagnosticCodeHistogram: {},
      diagnosticSeverityHistogram: {},
      categoryRollups: {},
      qualitySummary: {
        weights: { Q1: 0.2, Q2: 0.2, Q3: 0.15, Q4: 0.15, Q5: 0.1, Q6: 0.1, Q7: 0.1 },
        criticalDimensions: ['Q1', 'Q2', 'Q6'],
        scoredFixtureCount: 3,
        expectedPassScoredFixtureCount: 2,
        weightedMean: 4.2,
        expectedPassWeightedMean: 4.4,
        dimensionAverages: { Q1: 4, Q2: 4, Q3: 4, Q4: 4, Q5: 4, Q6: 4, Q7: 4 },
        expectedPassDimensionAverages: { Q1: 4, Q2: 4, Q3: 4, Q4: 4, Q5: 4, Q6: 4, Q7: 4 },
        expectedPassCatastrophicFixtureIds: [],
        expectedPassCriticalCollisionFixtureIds: [],
        expectedPassCriticalCollisionCount: 0,
        expectedPassFlagBeamOverlapFixtureIds: [],
        expectedPassFlagBeamOverlapCount: 0
      },
      results: [
        makeResult({ fixtureId: 'a', category: 'smoke', expected: 'pass', observed: 'pass', weightedScore: 4.8 }),
        makeResult({ fixtureId: 'b', category: 'lilypond', expected: 'pass', observed: 'pass', weightedScore: 4.4 }),
        makeResult({ fixtureId: 'c', category: 'parser', expected: 'fail', observed: 'fail', weightedScore: 0.5 })
      ]
    } as ConformanceExecutionReport;

    const smokeResults = resolveSplitResults(report, { categories: ['smoke'], expected: 'pass' });
    expect(smokeResults).toHaveLength(1);
    expect(smokeResults[0]?.fixtureId).toBe('a');

    const explicitResults = resolveSplitResults(report, { fixture_ids: ['b', 'c'], expected: 'all' });
    expect(explicitResults.map((result) => result.fixtureId)).toEqual(['b', 'c']);

    const nightlyResults = resolveSplitResults(report, { categories: ['*'], expected: 'all' });
    expect(nightlyResults).toHaveLength(3);
  });

  it('evaluates deterministic gate pass/fail and classifier summaries', () => {
    const results: ConformanceFixtureExecutionResult[] = [
      makeResult({ fixtureId: 'good-1', category: 'smoke', expected: 'pass', observed: 'pass', weightedScore: 4.9 }),
      makeResult({
        fixtureId: 'needs-work',
        category: 'lilypond',
        expected: 'pass',
        observed: 'pass',
        weightedScore: 3.6,
        catastrophic: true,
        criticalCollisions: 2
      })
    ];

    const classifierCounts = buildFailFastClassifierCounts(results);
    expect(classifierCounts.symbol_collision).toBe(1);

    const evaluation = evaluateDeterministicSplit('extended', results, {
      expected_pass_rate_min: 1,
      weighted_mean_min: 4.2,
      max_catastrophic_expected_pass: 0,
      max_critical_collisions_expected_pass: 0
    });

    expect(evaluation.pass).toBe(false);
    expect(evaluation.failureReasons.length).toBeGreaterThanOrEqual(2);
    expect(evaluation.catastrophicExpectedPassCount).toBe(1);
    expect(evaluation.criticalCollisionExpectedPassCount).toBe(2);
  });
});
