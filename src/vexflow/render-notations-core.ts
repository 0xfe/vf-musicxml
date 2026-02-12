import type { EventRef } from '../core/score.js';
import type { BuildMeasureNotesResult } from './render-note-mapper.js';
import type { StaveNote } from 'vexflow';

/** Measure range currently rendered on one page (`endMeasure` is exclusive). */
export interface RenderMeasureWindow {
  startMeasure: number;
  endMeasure: number;
}

/** Flat event key used for tie/slur/wedge note lookup during rendering. */
export function buildEventRefLookupKey(ref: EventRef): string {
  return `${ref.partId}|${ref.measureIndex}|${ref.voiceId}|${ref.eventIndex}`;
}

/** Copy one measure's local note map into a score-level event map. */
export function registerMeasureEventNotes(
  target: Map<string, StaveNote>,
  partId: string,
  measureIndex: number,
  result: BuildMeasureNotesResult
): void {
  for (const [voiceEventKey, note] of result.noteByEventKey.entries()) {
    const [voiceId, eventIndexText] = voiceEventKey.split(':');
    if (!voiceId || !eventIndexText) {
      continue;
    }

    const eventIndex = Number.parseInt(eventIndexText, 10);
    if (!Number.isFinite(eventIndex)) {
      continue;
    }

    target.set(
      buildEventRefLookupKey({
        partId,
        measureIndex,
        voiceId,
        eventIndex
      }),
      note
    );
  }
}
