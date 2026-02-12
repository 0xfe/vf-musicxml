import type { Diagnostic } from '../core/diagnostics.js';
import {
  CONFORMANCE_QUALITY_DIMENSIONS,
  type ConformanceFixtureQualityDimensions,
  type ConformanceQualityDimensionId
} from './conformance-types.js';
import type { SvgBounds } from './svg-collision.js';

/** Score Q1 (rhythm spacing quality) from notehead spacing and crowding signals. */
export function scoreRhythmSpacing(params: {
  minimumNoteheadGap: number | null;
  crowdedGapRatio: number;
  minorNoteheadCollisions: number;
}): number {
  let score = 5;

  if (params.minimumNoteheadGap !== null) {
    if (params.minimumNoteheadGap < 4) {
      score -= 0.25;
    }
    if (params.minimumNoteheadGap < 3) {
      score -= 0.35;
    }
    if (params.minimumNoteheadGap < 2) {
      score -= 0.5;
    }
  }

  score -= params.crowdedGapRatio * 0.8;
  score -= Math.min(1.2, params.minorNoteheadCollisions * 0.03);
  return clampScore(score);
}

/** Score Q2 (collision avoidance) from collision counters and collision-coded diagnostics. */
export function scoreCollisionAvoidance(params: {
  effectiveCriticalCollisionCount: number;
  minorCollisionCount: number;
  collisionDiagnostics: number;
}): number {
  let score = 5;
  score -= Math.min(3.0, params.effectiveCriticalCollisionCount * 1.2);
  score -= Math.min(1.0, params.minorCollisionCount * 0.02);
  score -= Math.min(0.9, params.collisionDiagnostics * 0.2);
  return clampScore(score);
}

/** Score Q3 (beams/stems/rest positioning) from stem geometry and diagnostics. */
export function scoreBeamStemRestQuality(params: {
  noteheadCount: number;
  stemCount: number;
  beamCount: number;
  flagBeamOverlapCount: number;
  stemBounds: SvgBounds[];
  stemBeamDiagnostics: number;
}): number {
  let score = 5;

  if (params.stemCount === 0 && params.noteheadCount >= 8) {
    score -= 0.6;
  }

  if (params.stemCount > 0) {
    const abnormalStemCount = params.stemBounds.filter(
      (bounds) => bounds.height < 7 || bounds.height > 95
    ).length;
    const abnormalStemRatio = abnormalStemCount / params.stemCount;
    score -= Math.min(1.8, abnormalStemRatio * 3.0);
  }

  if (params.beamCount > 0 && params.stemCount === 0) {
    score -= 1.6;
  }
  // Beamed notes should not also show flags in the same glyph region. This
  // catches the "beam rendered but flags still visible" regression class.
  score -= Math.min(2.4, params.flagBeamOverlapCount * 0.8);

  score -= Math.min(1.8, params.stemBeamDiagnostics * 0.35);
  return clampScore(score);
}

/** Score Q4 (spanner quality) from tie/beam geometry and spanner diagnostics. */
export function scoreSpannerQuality(params: {
  tieCount: number;
  beamCount: number;
  tieOverflowCount: number;
  spannerDiagnostics: number;
}): number {
  let score = 5;
  score -= Math.min(2.0, params.tieOverflowCount * 0.8);
  score -= Math.min(2.0, params.spannerDiagnostics * 0.4);

  // Non-empty spanner fixture with no diagnostics and no overflow should stay near top score.
  if (params.tieCount + params.beamCount > 0 && params.tieOverflowCount === 0 && params.spannerDiagnostics === 0) {
    score = Math.max(score, 4.8);
  }

  return clampScore(score);
}

/** Score Q5 (text quality) from text collisions/overflow and text-coded diagnostics. */
export function scoreTextQuality(params: {
  textCount: number;
  textCollisionCount: number;
  textToNoteheadCollisionCount: number;
  textOverflowCount: number;
  textDiagnostics: number;
}): number {
  if (params.textCount === 0) {
    return 5;
  }

  let score = 5;
  score -= Math.min(2.2, params.textCollisionCount * 0.35);
  score -= Math.min(2.2, params.textToNoteheadCollisionCount * 0.35);
  score -= Math.min(1.6, params.textOverflowCount * 0.4);
  score -= Math.min(1.2, params.textDiagnostics * 0.25);
  return clampScore(score);
}

/** Score Q6 (system/page layout quality) from overflow, usage pressure, and staff spacing. */
export function scoreSystemLayoutQuality(params: {
  layoutOverflowCount: number;
  noteheadBarlineIntrusionCount: number;
  minimumStaveGap: number | null;
  horizontalUsageRatio: number | null;
  verticalUsageRatio: number | null;
}): number {
  let score = 5;

  score -= Math.min(1.2, params.layoutOverflowCount * 0.05);
  // Notehead/barline intrusions are a high-signal regression indicator, but a
  // small amount of overlap can still appear in dense engraving. Penalize this
  // metric as a quality signal without making it a catastrophic gate by itself.
  score -= Math.min(1.0, params.noteheadBarlineIntrusionCount * 0.15);

  if (params.horizontalUsageRatio !== null) {
    if (params.horizontalUsageRatio > 0.99) {
      score -= 0.15;
    }
    if (params.horizontalUsageRatio > 1) {
      score -= 0.45;
    }
  }

  if (params.verticalUsageRatio !== null) {
    if (params.verticalUsageRatio > 0.99) {
      score -= 0.15;
    }
    if (params.verticalUsageRatio > 1) {
      score -= 0.45;
    }
  }

  if (params.minimumStaveGap !== null) {
    if (params.minimumStaveGap < 8) {
      score -= 0.8;
    }
    if (params.minimumStaveGap < 0) {
      score -= 1.2;
    }
  }

  return clampScore(score);
}

/** Score Q7 (symbol fidelity) from core glyph presence and unsupported/failure diagnostics. */
export function scoreSymbolFidelity(params: {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  noteheadCount: number;
  staveCount: number;
  symbolDiagnostics: number;
}): number {
  let score = 5;

  if (params.noteheadCount === 0) {
    score -= 2.2;
  }
  if (params.staveCount === 0) {
    score -= 2.2;
  }

  score -= Math.min(2.5, params.symbolDiagnostics * 0.45);
  score -= Math.min(1.2, params.warnings.length * 0.02);

  if (params.errors.length > 0) {
    score = Math.min(score, 1.0);
  }

  return clampScore(score);
}

/** Compute weighted rubric score (`0..5`) from dimension values and weight table. */
export function computeWeightedQualityScore(
  dimensions: ConformanceFixtureQualityDimensions,
  weights: Record<ConformanceQualityDimensionId, number>
): number {
  let weightedSum = 0;
  let weightSum = 0;

  for (const id of CONFORMANCE_QUALITY_DIMENSIONS) {
    const weight = weights[id];
    weightedSum += dimensions[id] * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) {
    return 0;
  }

  return Number((weightedSum / weightSum).toFixed(4));
}

/** Count diagnostics whose code or message matches a supplied regex. */
export function countDiagnosticsMatching(diagnostics: Diagnostic[], pattern: RegExp): number {
  return diagnostics.filter((diagnostic) => pattern.test(diagnostic.code) || pattern.test(diagnostic.message)).length;
}

/** Clamp floating scores to the expected rubric range (`0..5`) with stable precision. */
function clampScore(value: number): number {
  return Number(Math.min(5, Math.max(0, value)).toFixed(4));
}
