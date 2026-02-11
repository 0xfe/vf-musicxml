import { extractSvgElementBounds, type SvgElementBounds } from './svg-collision.js';

/** Lightweight geometry snapshot for notation-oriented SVG audits. */
export interface NotationGeometrySnapshot {
  noteheads: SvgElementBounds[];
  stems: SvgElementBounds[];
  beams: SvgElementBounds[];
  barlines: SvgElementBounds[];
}

/** One detected notehead/barline intersection event. */
export interface NoteheadBarlineIntrusion {
  notehead: SvgElementBounds;
  barline: SvgElementBounds;
  horizontalOverlap: number;
  verticalOverlap: number;
}

/** Thresholds for identifying meaningful notehead/barline intrusions. */
export interface NoteheadBarlineIntrusionOptions {
  minHorizontalOverlap?: number;
  minVerticalOverlap?: number;
  requireCenterLeftOfBarline?: boolean;
}

/** Summary counters used by tests, reports, and triage automation. */
export interface NotationGeometrySummary {
  noteheadCount: number;
  stemCount: number;
  beamCount: number;
  barlineCount: number;
  noteheadBarlineIntrusionCount: number;
}

/** Collect geometry for core notation primitives used by renderer-quality checks. */
export function collectNotationGeometry(svgMarkup: string): NotationGeometrySnapshot {
  return {
    noteheads: extractSvgElementBounds(svgMarkup, { selector: '.vf-notehead' }),
    stems: extractSvgElementBounds(svgMarkup, { selector: '.vf-stem' }),
    beams: extractSvgElementBounds(svgMarkup, { selector: '.vf-beam' }),
    barlines: extractSvgElementBounds(svgMarkup, { selector: '.vf-stavebarline' })
  };
}

/**
 * Detect noteheads crossing barlines.
 * These intrusions are strong indicators of measure-width/formatting bugs.
 */
export function detectNoteheadBarlineIntrusions(
  geometry: NotationGeometrySnapshot,
  options: NoteheadBarlineIntrusionOptions = {}
): NoteheadBarlineIntrusion[] {
  const minHorizontalOverlap = options.minHorizontalOverlap ?? 0.5;
  const minVerticalOverlap = options.minVerticalOverlap ?? 2;
  const requireCenterLeftOfBarline = options.requireCenterLeftOfBarline ?? true;
  const intrusions: NoteheadBarlineIntrusion[] = [];

  for (const notehead of geometry.noteheads) {
    for (const barline of geometry.barlines) {
      const horizontalOverlap = overlapLength(
        notehead.bounds.x,
        notehead.bounds.x + notehead.bounds.width,
        barline.bounds.x,
        barline.bounds.x + barline.bounds.width
      );
      if (horizontalOverlap < minHorizontalOverlap) {
        continue;
      }

      const verticalOverlap = overlapLength(
        notehead.bounds.y,
        notehead.bounds.y + notehead.bounds.height,
        barline.bounds.y,
        barline.bounds.y + barline.bounds.height
      );
      if (verticalOverlap < minVerticalOverlap) {
        continue;
      }

      // We primarily care about right-edge bleed from the previous measure into
      // a right-side barline. Notes that begin a new measure often sit close to
      // the left barline and should not be counted as overflow.
      if (requireCenterLeftOfBarline) {
        const noteheadCenterX = notehead.bounds.x + notehead.bounds.width / 2;
        const barlineCenterX = barline.bounds.x + barline.bounds.width / 2;
        if (noteheadCenterX >= barlineCenterX) {
          continue;
        }
      }

      intrusions.push({
        notehead,
        barline,
        horizontalOverlap,
        verticalOverlap
      });
    }
  }

  return intrusions;
}

/** Build a compact metric summary from notation geometry and intrusion checks. */
export function summarizeNotationGeometry(
  geometry: NotationGeometrySnapshot,
  options: NoteheadBarlineIntrusionOptions = {}
): NotationGeometrySummary {
  const intrusions = detectNoteheadBarlineIntrusions(geometry, options);

  return {
    noteheadCount: geometry.noteheads.length,
    stemCount: geometry.stems.length,
    beamCount: geometry.beams.length,
    barlineCount: geometry.barlines.length,
    noteheadBarlineIntrusionCount: intrusions.length
  };
}

/** Compute 1D overlap between two closed intervals. */
function overlapLength(startA: number, endA: number, startB: number, endB: number): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}
