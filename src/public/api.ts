import type { Diagnostic } from '../core/diagnostics.js';
import type { Score } from '../core/score.js';
import { extractMusicXmlFromMxl } from '../parser/mxl.js';
import { parseScorePartwise } from '../parser/parse.js';
import type { RenderLayoutOptions } from '../vexflow/render-types.js';
import { renderScoreToElement, renderScoreToSVGPages } from '../vexflow/render.js';

/** Parser configuration shared by sync and async entry points. */
export interface ParseOptions {
  sourceName?: string;
  mode?: 'strict' | 'lenient';
}

/** Standard parser return envelope with diagnostics-first reporting. */
export interface ParseResult {
  score?: Score;
  diagnostics: Diagnostic[];
}

/** Async parse input supporting text and binary payloads. */
export interface ParseAsyncInput {
  data: string | Uint8Array;
  format?: 'auto' | 'xml' | 'mxl';
}

/** High-level render options exposed through the public API surface. */
export interface RenderOptions {
  backend?: 'svg' | 'canvas';
  page?: { width: number; height: number };
  layout?: RenderLayoutOptions;
  paginate?: boolean;
}

/** Page-oriented rendering output used by string/SVG workflows. */
export interface RenderPagesResult {
  pages: string[];
  diagnostics: Diagnostic[];
}

/** DOM rendering output that includes lifecycle cleanup. */
export interface RenderToElementResult {
  pageCount: number;
  diagnostics: Diagnostic[];
  dispose(): void;
}

/** Parse `score-partwise` MusicXML text into the canonical score model. */
export function parseMusicXML(xmlText: string, options: ParseOptions = {}): ParseResult {
  return parseScorePartwise(xmlText, options);
}

/** Async parser entry supporting XML text/bytes and `.mxl` containers. */
export async function parseMusicXMLAsync(
  input: ParseAsyncInput,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const format = input.format ?? 'auto';
  const isLikelyMxl = isMxlArchive(input.data);

  if (format === 'mxl' || (format === 'auto' && isLikelyMxl)) {
    if (typeof input.data === 'string') {
      return {
        diagnostics: [
          {
            code: 'MXL_INVALID_ARCHIVE',
            severity: 'error',
            message: 'MXL parsing requires binary ZIP data, not plain text.'
          }
        ]
      };
    }

    const extraction = extractMusicXmlFromMxl(input.data, options.sourceName);
    const extractionDiagnostics = normalizeDiagnosticsForMode(extraction.diagnostics, options.mode ?? 'lenient');
    if (extractionDiagnostics.some((diagnostic) => diagnostic.severity === 'error') || !extraction.xmlText) {
      return { diagnostics: extractionDiagnostics };
    }

    const parsed = parseMusicXML(extraction.xmlText, options);
    return {
      score: parsed.score,
      diagnostics: [...extractionDiagnostics, ...parsed.diagnostics]
    };
  }

  const xmlText = typeof input.data === 'string' ? input.data : new TextDecoder().decode(input.data);
  return parseMusicXML(xmlText, options);
}

/** Render the score to SVG page markup (M4/M5 baselines plus M6 advanced notation support). */
export function renderToSVGPages(score: Score, options: RenderOptions = {}): RenderPagesResult {
  return renderScoreToSVGPages(score, options);
}

/** Cheap ZIP signature detection used by async auto-format inference. */
function isMxlArchive(data: string | Uint8Array): boolean {
  if (typeof data === 'string') {
    return false;
  }

  return data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b;
}

/** Align async path diagnostics with strict/lenient parse semantics. */
function normalizeDiagnosticsForMode(
  diagnostics: Diagnostic[],
  mode: 'strict' | 'lenient'
): Diagnostic[] {
  if (mode !== 'strict') {
    return diagnostics;
  }

  return diagnostics.map((diagnostic) =>
    diagnostic.severity === 'warning'
      ? {
          ...diagnostic,
          severity: 'error' as const
        }
      : diagnostic
  );
}

/** Render into a caller-owned container and return a disposal handle. */
export function renderToElement(
  score: Score,
  container: HTMLElement,
  options: RenderOptions = {}
): RenderToElementResult {
  return renderScoreToElement(score, container, options);
}
