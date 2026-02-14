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

/** Inclusive/exclusive measure window used for partial-score rendering. */
export interface RenderMeasureWindowOptions {
  /** Inclusive zero-based measure index to start rendering from. */
  startMeasure?: number;
  /** Exclusive zero-based measure index where rendering stops. */
  endMeasure?: number;
}

/** Measure-number overlay controls used for page-level debugging/readability. */
export interface RenderMeasureNumberOptions {
  enabled?: boolean;
  /** Display one label every `interval` measures (default: `4`). */
  interval?: number;
  /** When true, force measure `1`/window-start labels even if interval does not align. */
  showFirst?: boolean;
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
  /** Global render scale applied to notation/text drawing (`1` = current size). */
  scale?: number;
  /** Optional partial-score window rendered within the full score timeline. */
  window?: RenderMeasureWindowOptions;
  page?: RenderPageOptions;
  system?: RenderSystemOptions;
  labels?: RenderLabelOptions;
  headerFooter?: RenderHeaderFooterOptions;
  measureNumbers?: RenderMeasureNumberOptions;
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
  pageMetrics: RenderPageMetricsLike[];
  diagnostics: Diagnostic[];
}

/** Render output when drawing into an existing DOM element. */
export interface RenderToElementResultLike {
  pageCount: number;
  pageMetrics: RenderPageMetricsLike[];
  diagnostics: Diagnostic[];
  dispose(): void;
}

/** One numeric bounds rectangle used in layout telemetry output. */
export interface RenderBoundsLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Per-edge overflow booleans and magnitudes for host fit/reflow decisions. */
export interface RenderOverflowTelemetryLike {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  leftAmount: number;
  rightAmount: number;
  topAmount: number;
  bottomAmount: number;
}

/** Per-page telemetry emitted alongside rendered SVG strings. */
export interface RenderPageMetricsLike {
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  measureWindow?: {
    startMeasure: number;
    endMeasure: number;
  };
  contentBounds: RenderBoundsLike;
  viewportBounds: RenderBoundsLike;
  overflow: RenderOverflowTelemetryLike;
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
