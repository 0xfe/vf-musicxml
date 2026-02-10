import type { Diagnostic, DiagnosticSeverity } from '../core/diagnostics.js';
import type { XmlLocation, XmlNode } from './xml-ast.js';

/** Supported parser strictness modes. */
export type ParserMode = 'strict' | 'lenient';

/** Mutable parser state shared by helper passes. */
export interface ParseContext {
  mode: ParserMode;
  sourceName?: string;
  diagnostics: Diagnostic[];
  validationFailure: boolean;
}

/** Create a parser context for one parse invocation. */
export function createParseContext(mode: ParserMode, sourceName?: string): ParseContext {
  return {
    mode,
    sourceName,
    diagnostics: [],
    validationFailure: false
  };
}

/**
 * Record a diagnostic entry, escalating warnings to errors in strict mode.
 * Keeping this centralized guarantees consistent behavior across parser stages.
 */
export function addDiagnostic(
  ctx: ParseContext,
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  node?: XmlNode,
  source?: XmlLocation
): void {
  let actualSeverity = severity;
  if (ctx.mode === 'strict' && severity === 'warning') {
    actualSeverity = 'error';
  }

  if (actualSeverity === 'error') {
    ctx.validationFailure = true;
  }

  ctx.diagnostics.push({
    code,
    severity: actualSeverity,
    message,
    source: source ?? node?.location,
    xmlPath: node?.path
  });
}
