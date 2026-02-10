/** Severity classes used by parser and renderer diagnostics. */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** Optional source location attached to a diagnostic record. */
export interface DiagnosticSource {
  name?: string;
  line: number;
  column: number;
}

/** Canonical diagnostic object emitted by all public API operations. */
export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  source?: DiagnosticSource;
  xmlPath?: string;
}
