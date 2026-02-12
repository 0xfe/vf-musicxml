import type { Diagnostic } from '../core/diagnostics.js';
import type { ConformanceCollisionAuditReport } from './conformance.js';

/** String-keyed histogram helper used by conformance aggregate summaries. */
export type ConformanceHistogram = Record<string, number>;

/** Stable rubric dimension identifiers used in M7B quality scoring. */
export const CONFORMANCE_QUALITY_DIMENSIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'] as const;
/** Enum-like union for quality dimension identifiers. */
export type ConformanceQualityDimensionId = (typeof CONFORMANCE_QUALITY_DIMENSIONS)[number];

/** Per-fixture rubric dimension scores (`0..5`) computed by deterministic SVG diagnostics. */
export type ConformanceFixtureQualityDimensions = Record<ConformanceQualityDimensionId, number>;

/** Raw and normalized metric outputs used to explain fixture-level quality scores. */
export interface ConformanceFixtureQualityMetrics {
  noteheadCount: number;
  stemCount: number;
  beamCount: number;
  flagCount: number;
  flagBeamOverlapCount: number;
  tieCount: number;
  textCount: number;
  minimumNoteheadGap: number | null;
  crowdedGapRatio: number;
  minorCollisionCount: number;
  criticalCollisionCount: number;
  effectiveCriticalCollisionCount: number;
  textCollisionCount: number;
  textToNoteheadCollisionCount: number;
  noteheadBarlineIntrusionCount: number;
  layoutOverflowCount: number;
  textOverflowCount: number;
  minimumStaveGap: number | null;
  horizontalUsageRatio: number | null;
  verticalUsageRatio: number | null;
}

/** Full quality evaluation payload for one fixture. */
export interface ConformanceFixtureQualityReport {
  weightedScore: number;
  dimensions: ConformanceFixtureQualityDimensions;
  metrics: ConformanceFixtureQualityMetrics;
  criticalDimensionsBelowTwo: ConformanceQualityDimensionId[];
  catastrophicReadability: boolean;
  waivedCriticalCollision: boolean;
  waivedCatastrophicReadability: boolean;
  notes: string[];
}

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
  quality?: ConformanceFixtureQualityReport;
  observed: 'pass' | 'fail';
  observedFailureReasons: string[];
  success: boolean;
  failureReasons: string[];
}

/** Aggregate quality summary used for M7B conformance gates and trend tracking. */
export interface ConformanceQualitySummary {
  weights: Record<ConformanceQualityDimensionId, number>;
  criticalDimensions: ConformanceQualityDimensionId[];
  scoredFixtureCount: number;
  expectedPassScoredFixtureCount: number;
  weightedMean: number;
  expectedPassWeightedMean: number;
  dimensionAverages: Record<ConformanceQualityDimensionId, number>;
  expectedPassDimensionAverages: Record<ConformanceQualityDimensionId, number>;
  expectedPassCatastrophicFixtureIds: string[];
  expectedPassCriticalCollisionFixtureIds: string[];
  expectedPassCriticalCollisionCount: number;
  expectedPassFlagBeamOverlapFixtureIds: string[];
  expectedPassFlagBeamOverlapCount: number;
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
  qualitySummary: ConformanceQualitySummary;
  results: ConformanceFixtureExecutionResult[];
}

/** Optional output paths produced when writing report artifacts to disk. */
export interface ConformanceExecutionArtifactPaths {
  jsonPath: string;
  markdownPath: string;
}
