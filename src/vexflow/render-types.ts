import type { Diagnostic } from '../core/diagnostics.js';

/** Internal renderer options used by the public API adapter layer. */
export interface RenderOptionsLike {
  backend?: 'svg' | 'canvas';
  page?: { width: number; height: number };
  paginate?: boolean;
}

/** Render output when generating standalone SVG page markup. */
export interface RenderPagesResultLike {
  pages: string[];
  diagnostics: Diagnostic[];
}

/** Render output when drawing into an existing DOM element. */
export interface RenderToElementResultLike {
  pageCount: number;
  diagnostics: Diagnostic[];
  dispose(): void;
}

/** Baseline page width used by M2 renderer output. */
export const DEFAULT_PAGE_WIDTH = 900;
/** Baseline page height used by M2 renderer output. */
export const DEFAULT_PAGE_HEIGHT = 260;
/** Horizontal content margin in SVG units. */
export const LEFT_MARGIN = 20;
/** Vertical stave anchor in SVG units. */
export const TOP_MARGIN = 40;
