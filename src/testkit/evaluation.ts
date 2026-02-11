import type {
  ConformanceExecutionReport,
  ConformanceFixtureExecutionResult
} from './conformance-execution.js';

/** Dataset split names used by the M7C evaluation pipeline. */
export type EvaluationSplitName = 'smoke' | 'core' | 'extended' | 'nightly';

/** Inclusion policy for expected outcome filtering within one evaluation split. */
export type EvaluationExpectedFilter = 'pass' | 'fail' | 'all';

/** Split selector definition used to resolve fixture subsets from conformance reports. */
export interface EvaluationSplitDefinition {
  fixture_ids?: string[];
  categories?: string[];
  expected?: EvaluationExpectedFilter;
}

/** Full split configuration document loaded from `fixtures/evaluation/splits.json`. */
export interface EvaluationSplitConfig {
  version: string;
  splits: Record<string, EvaluationSplitDefinition>;
}

/** Deterministic threshold configuration for one evaluation split. */
export interface EvaluationDeterministicGateDefinition {
  expected_pass_rate_min: number;
  weighted_mean_min: number;
  max_catastrophic_expected_pass: number;
  max_critical_collisions_expected_pass: number;
}

/** Full deterministic gate configuration loaded from `fixtures/evaluation/gates.json`. */
export interface EvaluationDeterministicGateConfig {
  version: string;
  deterministic: Record<string, EvaluationDeterministicGateDefinition>;
}

/** Classifier bucket counts used for fast quality triage in the M7C report. */
export interface EvaluationFailFastClassifierCounts {
  layout_overflow: number;
  symbol_collision: number;
  text_legibility: number;
  spanner_quality: number;
  symbol_fidelity: number;
}

/** Deterministic evaluation summary for one split. */
export interface DeterministicSplitEvaluationResult {
  split: string;
  fixtureCount: number;
  expectedPassCount: number;
  expectedPassObservedPassCount: number;
  expectedPassRate: number;
  weightedMean: number;
  catastrophicExpectedPassCount: number;
  criticalCollisionExpectedPassCount: number;
  classifierCounts: EvaluationFailFastClassifierCounts;
  gates: EvaluationDeterministicGateDefinition;
  pass: boolean;
  failureReasons: string[];
}

/** Derive fixture category key from metadata path (`.../conformance/<category>/...`). */
export function readCategoryFromMetaPath(metaPath: string): string {
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

/** Resolve fixture rows for one split definition from the aggregate conformance report. */
export function resolveSplitResults(
  report: ConformanceExecutionReport,
  definition: EvaluationSplitDefinition
): ConformanceFixtureExecutionResult[] {
  const expectedFilter = definition.expected ?? 'all';
  const fixtureIdSet =
    definition.fixture_ids && definition.fixture_ids.length > 0
      ? new Set(definition.fixture_ids)
      : undefined;
  const categorySet =
    definition.categories && definition.categories.length > 0
      ? new Set(definition.categories)
      : undefined;
  const useWildcardCategories = categorySet?.has('*') ?? false;

  return report.results.filter((result) => {
    if (expectedFilter !== 'all' && result.expected !== expectedFilter) {
      return false;
    }

    if (fixtureIdSet && !fixtureIdSet.has(result.fixtureId)) {
      return false;
    }

    if (categorySet && !useWildcardCategories) {
      const category = readCategoryFromMetaPath(result.metaPath);
      if (!categorySet.has(category)) {
        return false;
      }
    }

    return true;
  });
}

/** Compute classifier counts used for fail-fast triage from one fixture result set. */
export function buildFailFastClassifierCounts(
  results: ConformanceFixtureExecutionResult[]
): EvaluationFailFastClassifierCounts {
  const counts: EvaluationFailFastClassifierCounts = {
    layout_overflow: 0,
    symbol_collision: 0,
    text_legibility: 0,
    spanner_quality: 0,
    symbol_fidelity: 0
  };

  for (const result of results) {
    const quality = result.quality;
    if (!quality) {
      continue;
    }

    if (quality.metrics.layoutOverflowCount > 0) {
      counts.layout_overflow += 1;
    }
    if (quality.metrics.effectiveCriticalCollisionCount > 0) {
      counts.symbol_collision += 1;
    }
    if (quality.metrics.textCollisionCount + quality.metrics.textToNoteheadCollisionCount > 0) {
      counts.text_legibility += 1;
    }
    if (quality.dimensions.Q4 < 4) {
      counts.spanner_quality += 1;
    }
    if (quality.dimensions.Q7 < 4) {
      counts.symbol_fidelity += 1;
    }
  }

  return counts;
}

/** Evaluate one split against deterministic M7C gates using conformance quality outputs. */
export function evaluateDeterministicSplit(
  split: string,
  results: ConformanceFixtureExecutionResult[],
  gates: EvaluationDeterministicGateDefinition
): DeterministicSplitEvaluationResult {
  const expectedPassResults = results.filter((result) => result.expected === 'pass');
  const expectedPassObservedPassCount = expectedPassResults.filter((result) => result.observed === 'pass').length;
  const expectedPassRate =
    expectedPassResults.length === 0 ? 0 : expectedPassObservedPassCount / expectedPassResults.length;

  const scoredExpectedPassResults = expectedPassResults.filter((result) => result.quality !== undefined);
  const weightedMean =
    scoredExpectedPassResults.length === 0
      ? 0
      : scoredExpectedPassResults.reduce(
          (sum, result) => sum + (result.quality?.weightedScore ?? 0),
          0
        ) / scoredExpectedPassResults.length;

  const catastrophicExpectedPassCount = scoredExpectedPassResults.filter(
    (result) => result.quality?.catastrophicReadability
  ).length;
  const criticalCollisionExpectedPassCount = scoredExpectedPassResults.reduce(
    (sum, result) => sum + (result.quality?.metrics.effectiveCriticalCollisionCount ?? 0),
    0
  );

  const failureReasons: string[] = [];
  if (expectedPassRate < gates.expected_pass_rate_min) {
    failureReasons.push(
      `expected-pass rate ${expectedPassRate.toFixed(4)} < ${gates.expected_pass_rate_min.toFixed(4)}`
    );
  }
  if (weightedMean < gates.weighted_mean_min) {
    failureReasons.push(`weighted mean ${weightedMean.toFixed(4)} < ${gates.weighted_mean_min.toFixed(4)}`);
  }
  if (catastrophicExpectedPassCount > gates.max_catastrophic_expected_pass) {
    failureReasons.push(
      `catastrophic expected-pass fixtures ${catastrophicExpectedPassCount} > ${gates.max_catastrophic_expected_pass}`
    );
  }
  if (criticalCollisionExpectedPassCount > gates.max_critical_collisions_expected_pass) {
    failureReasons.push(
      `critical expected-pass collisions ${criticalCollisionExpectedPassCount} > ${gates.max_critical_collisions_expected_pass}`
    );
  }

  return {
    split,
    fixtureCount: results.length,
    expectedPassCount: expectedPassResults.length,
    expectedPassObservedPassCount,
    expectedPassRate: Number(expectedPassRate.toFixed(4)),
    weightedMean: Number(weightedMean.toFixed(4)),
    catastrophicExpectedPassCount,
    criticalCollisionExpectedPassCount,
    classifierCounts: buildFailFastClassifierCounts(results),
    gates,
    pass: failureReasons.length === 0,
    failureReasons
  };
}
