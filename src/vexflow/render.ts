import { JSDOM } from 'jsdom';
import { Formatter, Renderer, Stave, Voice } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { Score } from '../core/score.js';
import { ensureDomGlobals } from './render-dom.js';
import {
  buildMeasureNotes,
  mapClef,
  mapKeySignature,
  mapTimeSignature,
  parseTime
} from './render-note-mapper.js';
import {
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  LEFT_MARGIN,
  TOP_MARGIN,
  type RenderOptionsLike,
  type RenderPagesResultLike,
  type RenderToElementResultLike
} from './render-types.js';

export type { RenderOptionsLike, RenderPagesResultLike, RenderToElementResultLike } from './render-types.js';

/**
 * Render score content to SVG page strings.
 * This path is intentionally deterministic for headless snapshot/structure tests.
 */
export function renderScoreToSVGPages(
  score: Score,
  options: RenderOptionsLike = {}
): RenderPagesResultLike {
  const diagnostics: Diagnostic[] = [];

  if (options.backend === 'canvas') {
    diagnostics.push({
      code: 'CANVAS_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: 'Canvas backend is not implemented in M2. Falling back to SVG.'
    });
  }

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const container = dom.window.document.getElementById('root');

  if (!container) {
    diagnostics.push({
      code: 'SVG_CONTAINER_ERROR',
      severity: 'error',
      message: 'Unable to initialize SVG rendering container.'
    });
    return {
      pages: [],
      diagnostics
    };
  }

  const pageCount = renderIntoContainer(score, container as unknown as HTMLElement, options, diagnostics);
  const page = container.innerHTML;
  dom.window.close();

  return {
    pages: pageCount > 0 ? [page] : [],
    diagnostics
  };
}

/**
 * Render score content into a caller-provided container.
 * Useful for browser use-cases that need live DOM nodes instead of raw strings.
 */
export function renderScoreToElement(
  score: Score,
  container: HTMLElement,
  options: RenderOptionsLike = {}
): RenderToElementResultLike {
  const diagnostics: Diagnostic[] = [];
  const pageCount = renderIntoContainer(score, container, options, diagnostics);

  return {
    pageCount,
    diagnostics,
    dispose: () => {
      container.innerHTML = '';
    }
  };
}

/** Shared render implementation used by both string and DOM entry points. */
function renderIntoContainer(
  score: Score,
  container: HTMLElement,
  options: RenderOptionsLike,
  diagnostics: Diagnostic[]
): number {
  const restoreDomGlobals = ensureDomGlobals(container.ownerDocument);
  container.innerHTML = '';

  if (options.paginate) {
    diagnostics.push({
      code: 'PAGINATION_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: 'Pagination is not implemented in M2. Rendering as a single page.'
    });
  }

  if (score.parts.length === 0) {
    diagnostics.push({
      code: 'EMPTY_SCORE',
      severity: 'error',
      message: 'Score does not contain any parts to render.'
    });
    return 0;
  }

  if (score.parts.length > 1) {
    diagnostics.push({
      code: 'MULTI_PART_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: 'Only the first part is rendered in M2.'
    });
  }

  const part = score.parts[0];
  if (!part || part.measures.length === 0) {
    diagnostics.push({
      code: 'EMPTY_PART',
      severity: 'error',
      message: 'Selected part contains no measures.'
    });
    return 0;
  }

  const pageWidth = options.page?.width ?? DEFAULT_PAGE_WIDTH;
  const pageHeight = options.page?.height ?? DEFAULT_PAGE_HEIGHT;
  // M2 uses one stave per measure on a single horizontal row.
  const measureWidth = Math.max(160, Math.floor((pageWidth - LEFT_MARGIN * 2) / part.measures.length));
  const requiredWidth = Math.max(pageWidth, LEFT_MARGIN * 2 + measureWidth * part.measures.length);

  const hostDiv = container.ownerDocument.createElement('div');
  container.appendChild(hostDiv);

  try {
    const renderer = new Renderer(hostDiv, Renderer.Backends.SVG);
    renderer.resize(requiredWidth, pageHeight);
    const context = renderer.getContext();

    for (let index = 0; index < part.measures.length; index += 1) {
      const measure = part.measures[index];
      if (!measure) {
        continue;
      }

      const x = LEFT_MARGIN + index * measureWidth;
      const stave = new Stave(x, TOP_MARGIN, measureWidth);

      const clef = mapClef(measure.effectiveAttributes.clefs[0], diagnostics);
      const key = mapKeySignature(measure.effectiveAttributes.keySignature);
      const time = mapTimeSignature(measure.effectiveAttributes.timeSignature);

      if (index === 0) {
        // Header modifiers are only drawn on the first rendered stave in M2.
        stave.addClef(clef);
        if (key) {
          stave.addKeySignature(key);
        }
        if (time) {
          stave.addTimeSignature(time);
        }
      }

      stave.setContext(context).draw();

      const notes = buildMeasureNotes(measure, score.ticksPerQuarter, clef, diagnostics);
      if (notes.length > 0) {
        const [numBeats, beatValue] = parseTime(measure.effectiveAttributes.timeSignature);
        const voice = new Voice({ num_beats: numBeats, beat_value: beatValue }).setMode(Voice.Mode.SOFT);
        voice.addTickables(notes);

        new Formatter().joinVoices([voice]).format([voice], measureWidth - 30);
        voice.draw(context, stave);
      }
    }
  } finally {
    restoreDomGlobals();
  }

  return 1;
}
