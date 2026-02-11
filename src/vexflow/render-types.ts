import type { Diagnostic } from '../core/diagnostics.js';

/** Supported high-level layout modes. */
export type RenderLayoutMode = 'paginated' | 'horizontal-continuous';

/** Margins used to define the printable area inside one rendered page. */
export interface RenderPageMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Page geometry options for paginated and continuous rendering modes. */
export interface RenderPageOptions {
  width?: number;
  height?: number;
  margins?: RenderPageMargins;
}

/** Controls for system breaking and vertical system packing. */
export interface RenderSystemOptions {
  targetMeasuresPerSystem?: number;
  minSystemGap?: number;
  justifyLastSystem?: boolean;
}

/** Controls for part/staff labels placed on the left of each system. */
export interface RenderLabelOptions {
  showPartNames?: boolean;
  showPartAbbreviations?: boolean;
  repeatOnSystemBreak?: boolean;
  labelWidth?: number;
}

/** Header/footer and page-level metadata text options. */
export interface RenderHeaderFooterOptions {
  showTitle?: boolean;
  showMovementTitle?: boolean;
  showPageNumber?: boolean;
  leftHeader?: string;
  rightHeader?: string;
  leftFooter?: string;
  rightFooter?: string;
}

/** Nested layout options used by the renderer planning pass. */
export interface RenderLayoutOptions {
  mode?: RenderLayoutMode;
  page?: RenderPageOptions;
  system?: RenderSystemOptions;
  labels?: RenderLabelOptions;
  headerFooter?: RenderHeaderFooterOptions;
}

/** Internal renderer options used by the public API adapter layer. */
export interface RenderOptionsLike {
  backend?: 'svg' | 'canvas';
  page?: { width: number; height: number };
  layout?: RenderLayoutOptions;
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

/** Legacy baseline page width used by early continuous renderer output. */
export const DEFAULT_PAGE_WIDTH = 900;
/** Legacy baseline page height used by early continuous renderer output. */
export const DEFAULT_PAGE_HEIGHT = 260;
/** Default page width for paginated mode. */
export const DEFAULT_PAGINATED_PAGE_WIDTH = 1200;
/** Default page height for paginated mode. */
export const DEFAULT_PAGINATED_PAGE_HEIGHT = 1600;
/** Horizontal content margin in SVG units. */
export const LEFT_MARGIN = 20;
/** Vertical stave anchor in SVG units. */
export const TOP_MARGIN = 40;
