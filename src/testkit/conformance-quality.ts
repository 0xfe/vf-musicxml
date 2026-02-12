import type { Diagnostic } from '../core/diagnostics.js';
import type { ConformanceCollisionAuditReport } from './conformance.js';
import {
  buildGaps,
  collapseSortedCenters,
  analyzeFixtureSvg,
  collectQualityGeometryMetrics,
  computeMinimumVerticalGap,
  countOutOfViewport,
  normalizePageToSvgMarkup,
  unionBounds
} from './conformance-quality-geometry.js';
import {
  computeWeightedQualityScore,
  countDiagnosticsMatching,
  scoreBeamStemRestQuality,
  scoreCollisionAvoidance,
  scoreRhythmSpacing,
  scoreSpannerQuality,
  scoreSymbolFidelity,
  scoreSystemLayoutQuality,
  scoreTextQuality
} from './conformance-quality-scoring.js';
import {
  CONFORMANCE_QUALITY_DIMENSIONS,
  type ConformanceFixtureExecutionResult,
  type ConformanceFixtureQualityDimensions,
  type ConformanceFixtureQualityReport,
  type ConformanceQualityDimensionId,
  type ConformanceQualitySummary
} from './conformance-types.js';

/** Weighted quality rubric used by the deterministic M7B scoring pipeline. */
export const CONFORMANCE_QUALITY_WEIGHTS: Record<ConformanceQualityDimensionId, number> = {
  Q1: 0.2,
  Q2: 0.2,
  Q3: 0.15,
  Q4: 0.15,
  Q5: 0.1,
  Q6: 0.1,
  Q7: 0.1
};

/** Dimensions that contribute to catastrophic readability gates when they drop below `2`. */
export const CONFORMANCE_CRITICAL_QUALITY_DIMENSIONS: ReadonlyArray<ConformanceQualityDimensionId> = [
  'Q1',
  'Q2',
  'Q6'
];

/** Fixture waiver key that allows critical-collision gates to remain non-blocking temporarily. */
const QUALITY_WAIVER_CRITICAL_COLLISION = 'quality-critical-collision';
/** Fixture waiver key that allows catastrophic readability gates to remain non-blocking temporarily. */
const QUALITY_WAIVER_CATASTROPHIC_READABILITY = 'quality-catastrophic-readability';

/** Build quality summary aggregates across all scored fixtures and expected-pass subsets. */
export function buildQualitySummary(results: ConformanceFixtureExecutionResult[]): ConformanceQualitySummary {
  const scoredResults = results.filter((result) => result.quality !== undefined);
  const expectedPassScoredResults = scoredResults.filter(
    (result): result is ConformanceFixtureExecutionResult & { quality: ConformanceFixtureQualityReport } =>
      result.expected === 'pass' && result.quality !== undefined
  );

  const dimensionAverages = averageQualityDimensions(scoredResults);
  const expectedPassDimensionAverages = averageQualityDimensions(expectedPassScoredResults);
  const weightedMean = averageWeightedScore(scoredResults);
  const expectedPassWeightedMean = averageWeightedScore(expectedPassScoredResults);
  const expectedPassCatastrophicFixtureIds = expectedPassScoredResults
    .filter((result) => result.quality.catastrophicReadability)
    .map((result) => result.fixtureId)
    .sort((left, right) => left.localeCompare(right));
  const expectedPassCriticalCollisionFixtureIds = expectedPassScoredResults
    .filter((result) => result.quality.metrics.effectiveCriticalCollisionCount > 0)
    .map((result) => result.fixtureId)
    .sort((left, right) => left.localeCompare(right));

  const expectedPassCriticalCollisionCount = expectedPassScoredResults.reduce(
    (sum, result) => sum + result.quality.metrics.effectiveCriticalCollisionCount,
    0
  );
  const expectedPassFlagBeamOverlapFixtureIds = expectedPassScoredResults
    .filter((result) => result.quality.metrics.flagBeamOverlapCount > 0)
    .map((result) => result.fixtureId)
    .sort((left, right) => left.localeCompare(right));
  const expectedPassFlagBeamOverlapCount = expectedPassScoredResults.reduce(
    (sum, result) => sum + result.quality.metrics.flagBeamOverlapCount,
    0
  );

  return {
    weights: { ...CONFORMANCE_QUALITY_WEIGHTS },
    criticalDimensions: [...CONFORMANCE_CRITICAL_QUALITY_DIMENSIONS],
    scoredFixtureCount: scoredResults.length,
    expectedPassScoredFixtureCount: expectedPassScoredResults.length,
    weightedMean,
    expectedPassWeightedMean,
    dimensionAverages,
    expectedPassDimensionAverages,
    expectedPassCatastrophicFixtureIds,
    expectedPassCriticalCollisionFixtureIds,
    expectedPassCriticalCollisionCount,
    expectedPassFlagBeamOverlapFixtureIds,
    expectedPassFlagBeamOverlapCount
  };
}

/** Evaluate fixture quality by projecting deterministic SVG metrics into rubric dimensions. */
export function evaluateFixtureQuality(params: {
  pageMarkup: string;
  parseDiagnostics: Diagnostic[];
  renderDiagnostics: Diagnostic[];
  collisionAudit?: ConformanceCollisionAuditReport;
  waivers: string[];
}): ConformanceFixtureQualityReport {
  const svgMarkup = normalizePageToSvgMarkup(params.pageMarkup);
  if (!svgMarkup) {
    return {
      weightedScore: 0,
      dimensions: {
        Q1: 0,
        Q2: 0,
        Q3: 0,
        Q4: 0,
        Q5: 0,
        Q6: 0,
        Q7: 0
      },
      metrics: {
        noteheadCount: 0,
        stemCount: 0,
        beamCount: 0,
        flagCount: 0,
        flagBeamOverlapCount: 0,
        tieCount: 0,
        textCount: 0,
        minimumNoteheadGap: null,
        crowdedGapRatio: 1,
        minorCollisionCount: 0,
        criticalCollisionCount: 0,
        effectiveCriticalCollisionCount: 0,
        textCollisionCount: 0,
        textToNoteheadCollisionCount: 0,
        noteheadBarlineIntrusionCount: 0,
        layoutOverflowCount: 0,
        textOverflowCount: 0,
        minimumStaveGap: null,
        horizontalUsageRatio: null,
        verticalUsageRatio: null
      },
      criticalDimensionsBelowTwo: [...CONFORMANCE_CRITICAL_QUALITY_DIMENSIONS],
      catastrophicReadability: true,
      waivedCriticalCollision: false,
      waivedCatastrophicReadability: false,
      notes: ['fixture produced no SVG markup for quality analysis']
    };
  }

  const analysis = analyzeFixtureSvg(svgMarkup);
  const geometryMetrics = collectQualityGeometryMetrics(analysis);
  const diagnosticBundle = [...params.parseDiagnostics, ...params.renderDiagnostics];
  const warnings = diagnosticBundle.filter((diagnostic) => diagnostic.severity === 'warning');
  const errors = diagnosticBundle.filter((diagnostic) => diagnostic.severity === 'error');

  const inferredSevereOverlapCount = geometryMetrics.textToNoteheadOverlaps.critical;
  const minorCollisionCount =
    geometryMetrics.noteheadSelfOverlaps.minor +
    geometryMetrics.textSelfOverlaps.minor +
    geometryMetrics.textToNoteheadOverlaps.minor +
    inferredSevereOverlapCount;
  const collisionAuditCritical =
    params.collisionAudit && !params.collisionAudit.pass ? params.collisionAudit.overlapCount : 0;
  // "Critical collisions" are intentionally limited to fixture-declared collision audits so
  // M7B hard-gates only fail on curated, high-confidence overlap checks.
  const criticalCollisionCount = collisionAuditCritical;
  const waivedCriticalCollision =
    criticalCollisionCount > 0 && params.waivers.includes(QUALITY_WAIVER_CRITICAL_COLLISION);
  const effectiveCriticalCollisionCount = waivedCriticalCollision ? 0 : criticalCollisionCount;

  const noteheadCenters = collapseSortedCenters(
    analysis.noteheads.map((notehead) => notehead.bounds.x + notehead.bounds.width / 2),
    4
  );
  const gaps = buildGaps(noteheadCenters);
  const minimumNoteheadGap = gaps.length > 0 ? Math.min(...gaps) : null;
  const crowdedGapRatio = gaps.length > 0 ? gaps.filter((gap) => gap < 8).length / gaps.length : 0;

  const layoutOverflowCount = analysis.viewport
    ? countOutOfViewport(analysis.layoutElements, analysis.viewport, 1)
    : 0;
  const textOverflowCount = analysis.viewport
    ? countOutOfViewport(analysis.textElements, analysis.viewport, 1)
    : 0;
  const minimumStaveGap = computeMinimumVerticalGap(analysis.staveGroups);

  const contentBounds = unionBounds(analysis.layoutElements.map((element) => element.bounds));
  const horizontalUsageRatio =
    contentBounds && analysis.viewport && analysis.viewport.width > 0
      ? contentBounds.width / analysis.viewport.width
      : null;
  const verticalUsageRatio =
    contentBounds && analysis.viewport && analysis.viewport.height > 0
      ? contentBounds.height / analysis.viewport.height
      : null;

  const dimensions: ConformanceFixtureQualityDimensions = {
    Q1: scoreRhythmSpacing({
      minimumNoteheadGap,
      crowdedGapRatio,
      minorNoteheadCollisions: geometryMetrics.noteheadSelfOverlaps.minor
    }),
    Q2: scoreCollisionAvoidance({
      effectiveCriticalCollisionCount,
      minorCollisionCount,
      collisionDiagnostics: countDiagnosticsMatching(diagnosticBundle, /(COLLISION|OVERLAP)/i)
    }),
    Q3: scoreBeamStemRestQuality({
      noteheadCount: analysis.noteheads.length,
      stemCount: analysis.stems.length,
      beamCount: analysis.beams.length,
      flagBeamOverlapCount: geometryMetrics.flagBeamOverlaps.length,
      stemBounds: analysis.stems.map((stem) => stem.bounds),
      stemBeamDiagnostics: countDiagnosticsMatching(diagnosticBundle, /(STEM|BEAM|REST)/i)
    }),
    Q4: scoreSpannerQuality({
      tieCount: analysis.ties.length,
      beamCount: analysis.beams.length,
      tieOverflowCount: analysis.viewport ? countOutOfViewport(analysis.ties, analysis.viewport, 1) : 0,
      spannerDiagnostics: countDiagnosticsMatching(diagnosticBundle, /(TIE|SLUR|WEDGE|TUPLET|VOLTA)/i)
    }),
    Q5: scoreTextQuality({
      textCount: analysis.textElements.length,
      textCollisionCount: geometryMetrics.textSelfOverlaps.critical + geometryMetrics.textSelfOverlaps.minor,
      textToNoteheadCollisionCount:
        geometryMetrics.textToNoteheadOverlaps.critical + geometryMetrics.textToNoteheadOverlaps.minor,
      textOverflowCount,
      textDiagnostics: countDiagnosticsMatching(diagnosticBundle, /(TEXT|LYRIC|HARMONY|DIRECTION)/i)
    }),
    Q6: scoreSystemLayoutQuality({
      layoutOverflowCount,
      noteheadBarlineIntrusionCount: geometryMetrics.noteheadBarlineIntrusions.length,
      minimumStaveGap,
      horizontalUsageRatio,
      verticalUsageRatio
    }),
    Q7: scoreSymbolFidelity({
      errors,
      warnings,
      noteheadCount: analysis.noteheads.length,
      staveCount: analysis.staveGroups.length,
      symbolDiagnostics: countDiagnosticsMatching(
        diagnosticBundle,
        /(UNSUPPORTED|NOT_SUPPORTED|NOT_IMPLEMENTED|UNIMPLEMENTED|FAILED|MISSING)/i
      )
    })
  };

  const criticalDimensionsBelowTwo = CONFORMANCE_CRITICAL_QUALITY_DIMENSIONS.filter(
    (dimension) => dimensions[dimension] < 2
  );
  const waivedCatastrophicReadability =
    criticalDimensionsBelowTwo.length > 0 && params.waivers.includes(QUALITY_WAIVER_CATASTROPHIC_READABILITY);
  const catastrophicReadability =
    criticalDimensionsBelowTwo.length > 0 && !waivedCatastrophicReadability;
  const weightedScore = computeWeightedQualityScore(dimensions, CONFORMANCE_QUALITY_WEIGHTS);

  const notes: string[] = [];
  if (effectiveCriticalCollisionCount > 0) {
    notes.push(`critical collisions: ${effectiveCriticalCollisionCount}`);
  }
  if (waivedCriticalCollision) {
    notes.push(
      `critical collisions waived via '${QUALITY_WAIVER_CRITICAL_COLLISION}' (${criticalCollisionCount})`
    );
  }
  if (catastrophicReadability) {
    notes.push(`critical dimensions below threshold: ${criticalDimensionsBelowTwo.join(', ')}`);
  }
  if (geometryMetrics.noteheadBarlineIntrusions.length > 0) {
    notes.push(`notehead/barline intrusions: ${geometryMetrics.noteheadBarlineIntrusions.length}`);
  }
  if (geometryMetrics.flagBeamOverlaps.length > 0) {
    notes.push(`flag/beam overlaps: ${geometryMetrics.flagBeamOverlaps.length}`);
  }
  if (waivedCatastrophicReadability) {
    notes.push(
      `catastrophic readability waived via '${QUALITY_WAIVER_CATASTROPHIC_READABILITY}' (${criticalDimensionsBelowTwo.join(', ')})`
    );
  }

  return {
    weightedScore,
    dimensions,
    metrics: {
      noteheadCount: analysis.noteheads.length,
      stemCount: analysis.stems.length,
      beamCount: analysis.beams.length,
      flagCount: analysis.flags.length,
      flagBeamOverlapCount: geometryMetrics.flagBeamOverlaps.length,
      tieCount: analysis.ties.length,
      textCount: analysis.textElements.length,
      minimumNoteheadGap,
      crowdedGapRatio: Number(crowdedGapRatio.toFixed(4)),
      minorCollisionCount,
      criticalCollisionCount,
      effectiveCriticalCollisionCount,
      textCollisionCount: geometryMetrics.textSelfOverlaps.critical + geometryMetrics.textSelfOverlaps.minor,
      textToNoteheadCollisionCount:
        geometryMetrics.textToNoteheadOverlaps.critical + geometryMetrics.textToNoteheadOverlaps.minor,
      noteheadBarlineIntrusionCount: geometryMetrics.noteheadBarlineIntrusions.length,
      layoutOverflowCount,
      textOverflowCount,
      minimumStaveGap,
      horizontalUsageRatio: horizontalUsageRatio === null ? null : Number(horizontalUsageRatio.toFixed(4)),
      verticalUsageRatio: verticalUsageRatio === null ? null : Number(verticalUsageRatio.toFixed(4))
    },
    criticalDimensionsBelowTwo,
    catastrophicReadability,
    waivedCriticalCollision,
    waivedCatastrophicReadability,
    notes
  };
}

/** Average weighted quality score for a fixture result list. */
function averageWeightedScore(results: Array<ConformanceFixtureExecutionResult>): number {
  if (results.length === 0) {
    return 0;
  }

  const total = results.reduce((sum, result) => sum + (result.quality?.weightedScore ?? 0), 0);
  return Number((total / results.length).toFixed(4));
}

/** Average per-dimension scores for a fixture result list. */
function averageQualityDimensions(
  results: Array<ConformanceFixtureExecutionResult>
): Record<ConformanceQualityDimensionId, number> {
  const averages: Record<ConformanceQualityDimensionId, number> = {
    Q1: 0,
    Q2: 0,
    Q3: 0,
    Q4: 0,
    Q5: 0,
    Q6: 0,
    Q7: 0
  };

  if (results.length === 0) {
    return averages;
  }

  for (const id of CONFORMANCE_QUALITY_DIMENSIONS) {
    const total = results.reduce((sum, result) => sum + (result.quality?.dimensions[id] ?? 0), 0);
    averages[id] = Number((total / results.length).toFixed(4));
  }

  return averages;
}
