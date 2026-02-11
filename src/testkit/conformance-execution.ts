import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { JSDOM } from 'jsdom';

import type { Diagnostic } from '../core/diagnostics.js';
import { parseMusicXMLAsync } from '../public/api.js';
import { renderScoreToSVGPages } from '../vexflow/render.js';
import type { ConformanceFixtureRecord } from './conformance.js';
import { runConformanceCollisionAudit, type ConformanceCollisionAuditReport } from './conformance.js';
import {
  collectNotationGeometry,
  detectFlagBeamOverlaps,
  detectNoteheadBarlineIntrusions
} from './notation-geometry.js';
import { extractSvgElementBounds, type SvgBounds, type SvgElementBounds } from './svg-collision.js';

/** String-keyed histogram helper used by conformance aggregate summaries. */
export type ConformanceHistogram = Record<string, number>;

/** Stable rubric dimension identifiers used in M7B quality scoring. */
export const CONFORMANCE_QUALITY_DIMENSIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'] as const;
/** Enum-like union for quality dimension identifiers. */
export type ConformanceQualityDimensionId = (typeof CONFORMANCE_QUALITY_DIMENSIONS)[number];

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

/** Local overlap counter used when evaluating collision/tight-layout penalties. */
interface OverlapCounters {
  critical: number;
  minor: number;
}

/** Pre-extracted SVG geometry used by all dimension scorers to avoid repeated DOM scans. */
interface FixtureSvgAnalysis {
  svgMarkup: string;
  viewport: SvgBounds | null;
  noteheads: SvgElementBounds[];
  stems: SvgElementBounds[];
  beams: SvgElementBounds[];
  flags: SvgElementBounds[];
  ties: SvgElementBounds[];
  barlines: SvgElementBounds[];
  textElements: SvgElementBounds[];
  staveGroups: SvgElementBounds[];
  layoutElements: SvgElementBounds[];
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

/** Format a deterministic numeric quality value for markdown display. */
function formatQualityScore(score: number | undefined): string {
  if (score === undefined) {
    return 'n/a';
  }
  return score.toFixed(2);
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

/** Build quality summary aggregates across all scored fixtures and expected-pass subsets. */
function buildQualitySummary(results: ConformanceFixtureExecutionResult[]): ConformanceQualitySummary {
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

/** Evaluate fixture quality by projecting deterministic SVG metrics into rubric dimensions. */
function evaluateFixtureQuality(params: {
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
  const diagnosticBundle = [...params.parseDiagnostics, ...params.renderDiagnostics];
  const warnings = diagnosticBundle.filter((diagnostic) => diagnostic.severity === 'warning');
  const errors = diagnosticBundle.filter((diagnostic) => diagnostic.severity === 'error');

  // Noteheads in chords/voices intentionally sit close; treat notehead overlap as minor density signal only.
  const noteheadSelfOverlaps = countSelfOverlaps(analysis.noteheads, Number.POSITIVE_INFINITY, 10);
  // Text-vs-text overlap is common in dense lyrics/chord labels and is handled as a readability
  // quality signal (Q5), not a hard critical-collision gate signal.
  const textSelfOverlaps = countSelfOverlaps(analysis.textElements, Number.POSITIVE_INFINITY, 4);
  const textToNoteheadOverlaps = countCrossOverlaps(analysis.textElements, analysis.noteheads, 120, 16);
  const noteheadBarlineIntrusions = detectNoteheadBarlineIntrusions(
    {
      noteheads: analysis.noteheads,
      stems: analysis.stems,
      beams: analysis.beams,
      flags: analysis.flags,
      barlines: analysis.barlines
    },
    {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    }
  );
  const flagBeamOverlaps = detectFlagBeamOverlaps({
    noteheads: analysis.noteheads,
    stems: analysis.stems,
    beams: analysis.beams,
    flags: analysis.flags,
    barlines: analysis.barlines
  });
  const inferredSevereOverlapCount = textToNoteheadOverlaps.critical;
  const minorCollisionCount =
    noteheadSelfOverlaps.minor +
    textSelfOverlaps.minor +
    textToNoteheadOverlaps.minor +
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
      minorNoteheadCollisions: noteheadSelfOverlaps.minor
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
      flagBeamOverlapCount: flagBeamOverlaps.length,
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
      textCollisionCount: textSelfOverlaps.critical + textSelfOverlaps.minor,
      textToNoteheadCollisionCount: textToNoteheadOverlaps.critical + textToNoteheadOverlaps.minor,
      textOverflowCount,
      textDiagnostics: countDiagnosticsMatching(diagnosticBundle, /(TEXT|LYRIC|HARMONY|DIRECTION)/i)
    }),
    Q6: scoreSystemLayoutQuality({
      layoutOverflowCount,
      noteheadBarlineIntrusionCount: noteheadBarlineIntrusions.length,
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
  if (noteheadBarlineIntrusions.length > 0) {
    notes.push(`notehead/barline intrusions: ${noteheadBarlineIntrusions.length}`);
  }
  if (flagBeamOverlaps.length > 0) {
    notes.push(`flag/beam overlaps: ${flagBeamOverlaps.length}`);
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
      flagBeamOverlapCount: flagBeamOverlaps.length,
      tieCount: analysis.ties.length,
      textCount: analysis.textElements.length,
      minimumNoteheadGap,
      crowdedGapRatio: Number(crowdedGapRatio.toFixed(4)),
      minorCollisionCount,
      criticalCollisionCount,
      effectiveCriticalCollisionCount,
      textCollisionCount: textSelfOverlaps.critical + textSelfOverlaps.minor,
      textToNoteheadCollisionCount: textToNoteheadOverlaps.critical + textToNoteheadOverlaps.minor,
      noteheadBarlineIntrusionCount: noteheadBarlineIntrusions.length,
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

/** Analyze relevant SVG geometry once so each quality dimension can reuse the same data. */
function analyzeFixtureSvg(svgMarkup: string): FixtureSvgAnalysis {
  const notationGeometry = collectNotationGeometry(svgMarkup);

  return {
    svgMarkup,
    viewport: readSvgViewport(svgMarkup),
    noteheads: notationGeometry.noteheads,
    stems: notationGeometry.stems,
    beams: notationGeometry.beams,
    flags: notationGeometry.flags,
    ties: extractSvgElementBounds(svgMarkup, { selector: '.vf-stavetie' }),
    barlines: notationGeometry.barlines,
    textElements: extractSvgElementBounds(svgMarkup, { selector: 'text' }),
    staveGroups: extractSvgElementBounds(svgMarkup, { selector: '.vf-stave' }),
    layoutElements: extractSvgElementBounds(svgMarkup, {
      selector: '.vf-stave, .vf-stavenote, .vf-stavetie, .vf-beam, .vf-ornament, text'
    })
  };
}

/** Extract the `<svg>...</svg>` segment from renderer output that may include wrapper `<div>` nodes. */
function normalizePageToSvgMarkup(pageMarkup: string): string | undefined {
  const startIndex = pageMarkup.indexOf('<svg');
  const endIndex = pageMarkup.lastIndexOf('</svg>');

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return undefined;
  }

  return pageMarkup.slice(startIndex, endIndex + '</svg>'.length);
}

/** Read viewport bounds from the primary SVG element (`width/height` or `viewBox`). */
function readSvgViewport(svgMarkup: string): SvgBounds | null {
  const dom = new JSDOM(svgMarkup, { contentType: 'image/svg+xml' });
  try {
    const svg = dom.window.document.querySelector('svg');
    if (!svg) {
      return null;
    }

    const widthAttr = svg.getAttribute('width');
    const heightAttr = svg.getAttribute('height');
    const viewBox = svg.getAttribute('viewBox');

    const widthFromAttr = widthAttr ? parseFloat(widthAttr) : NaN;
    const heightFromAttr = heightAttr ? parseFloat(heightAttr) : NaN;

    if (Number.isFinite(widthFromAttr) && Number.isFinite(heightFromAttr)) {
      return { x: 0, y: 0, width: widthFromAttr, height: heightFromAttr };
    }

    if (viewBox) {
      const values = viewBox
        .trim()
        .split(/\s+/)
        .map((value) => Number.parseFloat(value));
      const x = values[0] ?? Number.NaN;
      const y = values[1] ?? Number.NaN;
      const width = values[2] ?? Number.NaN;
      const height = values[3] ?? Number.NaN;
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(width) &&
        Number.isFinite(height)
      ) {
        return { x, y, width, height };
      }
    }

    return null;
  } finally {
    dom.window.close();
  }
}

/** Score Q1 (rhythm spacing quality) from notehead spacing and crowding signals. */
function scoreRhythmSpacing(params: {
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
function scoreCollisionAvoidance(params: {
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
function scoreBeamStemRestQuality(params: {
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
function scoreSpannerQuality(params: {
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
function scoreTextQuality(params: {
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
function scoreSystemLayoutQuality(params: {
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
function scoreSymbolFidelity(params: {
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
function computeWeightedQualityScore(
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

/** Clamp floating scores to the expected rubric range (`0..5`) with stable precision. */
function clampScore(value: number): number {
  return Number(Math.min(5, Math.max(0, value)).toFixed(4));
}

/** Count diagnostics whose code or message matches a supplied regex. */
function countDiagnosticsMatching(diagnostics: Diagnostic[], pattern: RegExp): number {
  return diagnostics.filter((diagnostic) => pattern.test(diagnostic.code) || pattern.test(diagnostic.message)).length;
}

/** Collapse sorted center values so tiny floating-point jitters do not create fake spacing gaps. */
function collapseSortedCenters(values: number[], tolerance: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const collapsed: number[] = [];

  for (const value of sorted) {
    const last = collapsed[collapsed.length - 1];
    if (last === undefined || Math.abs(value - last) > tolerance) {
      collapsed.push(value);
    }
  }

  return collapsed;
}

/** Convert sorted center points into adjacent horizontal spacing gaps. */
function buildGaps(sortedValues: number[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < sortedValues.length; index += 1) {
    const current = sortedValues[index];
    const previous = sortedValues[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    gaps.push(current - previous);
  }
  return gaps;
}

/** Count overlaps within one element set and bucket them into critical/minor bins. */
function countSelfOverlaps(
  elements: SvgElementBounds[],
  criticalMinArea: number,
  minorMinArea: number
): OverlapCounters {
  const counters: OverlapCounters = { critical: 0, minor: 0 };
  for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
    const left = elements[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
      const right = elements[rightIndex];
      if (!right) {
        continue;
      }

      const area = computeIntersectionArea(left.bounds, right.bounds);
      if (area >= criticalMinArea) {
        counters.critical += 1;
      } else if (area >= minorMinArea) {
        counters.minor += 1;
      }
    }
  }
  return counters;
}

/** Count overlaps between two element sets and bucket them into critical/minor bins. */
function countCrossOverlaps(
  leftElements: SvgElementBounds[],
  rightElements: SvgElementBounds[],
  criticalMinArea: number,
  minorMinArea: number
): OverlapCounters {
  const counters: OverlapCounters = { critical: 0, minor: 0 };
  for (const left of leftElements) {
    for (const right of rightElements) {
      const area = computeIntersectionArea(left.bounds, right.bounds);
      if (area >= criticalMinArea) {
        counters.critical += 1;
      } else if (area >= minorMinArea) {
        counters.minor += 1;
      }
    }
  }
  return counters;
}

/** Compute intersection area between two axis-aligned bounds. */
function computeIntersectionArea(left: SvgBounds, right: SvgBounds): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }

  return (x2 - x1) * (y2 - y1);
}

/** Count elements that lie outside the nominal page viewport by more than a tolerance. */
function countOutOfViewport(elements: SvgElementBounds[], viewport: SvgBounds, tolerance: number): number {
  return elements.filter((element) => {
    const bounds = element.bounds;
    const minX = viewport.x - tolerance;
    const minY = viewport.y - tolerance;
    const maxX = viewport.x + viewport.width + tolerance;
    const maxY = viewport.y + viewport.height + tolerance;

    return (
      bounds.x < minX ||
      bounds.y < minY ||
      bounds.x + bounds.width > maxX ||
      bounds.y + bounds.height > maxY
    );
  }).length;
}

/** Compute a union bounds box for a list of bounds; returns `null` when input is empty. */
function unionBounds(boundsList: SvgBounds[]): SvgBounds | null {
  if (boundsList.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/** Compute minimum vertical gap between stave group bounds; null when fewer than two staves exist. */
function computeMinimumVerticalGap(staveGroups: SvgElementBounds[]): number | null {
  if (staveGroups.length < 2) {
    return null;
  }

  const sorted = [...staveGroups].sort((left, right) => left.bounds.y - right.bounds.y);
  const rowBands: SvgBounds[] = [];

  // Multiple staves are emitted per measure column; cluster by Y so same-row staves do not
  // look like negative vertical gaps.
  const rowTolerance = 12;
  for (const stave of sorted) {
    const bounds = stave.bounds;
    const band = rowBands.find((candidate) => Math.abs(candidate.y - bounds.y) <= rowTolerance);
    if (!band) {
      rowBands.push({ ...bounds });
      continue;
    }

    const bandBottom = Math.max(band.y + band.height, bounds.y + bounds.height);
    band.y = Math.min(band.y, bounds.y);
    band.height = bandBottom - band.y;
  }

  if (rowBands.length < 2) {
    return null;
  }

  rowBands.sort((left, right) => left.y - right.y);
  let minGap = Number.POSITIVE_INFINITY;

  for (let index = 1; index < rowBands.length; index += 1) {
    const previous = rowBands[index - 1];
    const current = rowBands[index];
    if (!previous || !current) {
      continue;
    }

    const gap = Math.max(0, current.y - (previous.y + previous.height));
    if (Number.isFinite(gap)) {
      minGap = Math.min(minGap, gap);
    }
  }

  return Number.isFinite(minGap) ? Number(minGap.toFixed(4)) : null;
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
