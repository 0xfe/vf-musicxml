import type { EventRef, NoteData, Part, SpannerRelation } from '../core/score.js';
import { addDiagnostic, type ParseContext } from './parse-context.js';

/** Build tie/slur/wedge spanner relations from parsed part content. */
export function buildSpanners(parts: Part[], ctx: ParseContext): SpannerRelation[] {
  const spanners: SpannerRelation[] = [];
  let serial = 0;

  const nextId = (type: SpannerRelation['type']): string => {
    serial += 1;
    return `${type}-${serial}`;
  };

  for (const part of parts) {
    spanners.push(...buildTieSpanners(part, ctx, nextId));
    spanners.push(...buildSlurSpanners(part, ctx, nextId));
    spanners.push(...buildWedgeSpanners(part, ctx, nextId));
  }

  return spanners;
}

/** Build tie spanners by matching per-voice note tie start/stop endpoints. */
function buildTieSpanners(
  part: Part,
  ctx: ParseContext,
  nextId: (type: SpannerRelation['type']) => string
): SpannerRelation[] {
  const spanners: SpannerRelation[] = [];
  const activeByKey = new Map<string, { id: string; start: EventRef; noteData: NoteData }>();

  for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex += 1) {
    const measure = part.measures[measureIndex];
    if (!measure) {
      continue;
    }

    for (const voice of measure.voices) {
      for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
        const event = voice.events[eventIndex];
        if (!event || event.kind !== 'note') {
          continue;
        }

        for (let noteIndex = 0; noteIndex < event.notes.length; noteIndex += 1) {
          const noteData = event.notes[noteIndex];
          if (!noteData?.ties || noteData.ties.length === 0) {
            continue;
          }

          const key = tieMatchKey(voice.id, event.staff, noteData, noteIndex);
          const eventRef: EventRef = {
            partId: part.id,
            measureIndex,
            voiceId: voice.id,
            eventIndex,
            noteIndex
          };

          const hasStop = noteData.ties.some((tie) => tie.type === 'stop');
          const hasStart = noteData.ties.some((tie) => tie.type === 'start');

          if (hasStop) {
            const active = activeByKey.get(key);
            if (!active) {
              addDiagnostic(
                ctx,
                'UNMATCHED_TIE_STOP',
                'warning',
                `Tie stop had no matching start in part '${part.id}', voice '${voice.id}'.`
              );
            } else {
              spanners.push({
                id: active.id,
                type: 'tie',
                start: active.start,
                end: eventRef
              });
              activeByKey.delete(key);
            }
          }

          if (hasStart) {
            activeByKey.set(key, {
              id: nextId('tie'),
              start: eventRef,
              noteData
            });
          }
        }
      }
    }
  }

  for (const active of activeByKey.values()) {
    addDiagnostic(
      ctx,
      'UNCLOSED_TIE_START',
      'warning',
      `Tie start '${active.id}' did not find a matching stop by score end.`
    );
  }

  return spanners;
}

/** Build slur spanners by matching `<notations><slur number=... type=...>`. */
function buildSlurSpanners(
  part: Part,
  ctx: ParseContext,
  nextId: (type: SpannerRelation['type']) => string
): SpannerRelation[] {
  const spanners: SpannerRelation[] = [];
  const activeByKey = new Map<string, { id: string; start: EventRef; placement?: string; lineType?: string }>();

  for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex += 1) {
    const measure = part.measures[measureIndex];
    if (!measure) {
      continue;
    }

    for (const voice of measure.voices) {
      for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
        const event = voice.events[eventIndex];
        if (!event || event.kind !== 'note') {
          continue;
        }

        for (let noteIndex = 0; noteIndex < event.notes.length; noteIndex += 1) {
          const noteData = event.notes[noteIndex];
          if (!noteData?.slurs || noteData.slurs.length === 0) {
            continue;
          }

          const eventRef: EventRef = {
            partId: part.id,
            measureIndex,
            voiceId: voice.id,
            eventIndex,
            noteIndex
          };

          for (const slur of noteData.slurs) {
            const number = slur.number ?? '1';
            const key = `${voice.id}|${number}`;
            if (slur.type === 'stop') {
              const active = activeByKey.get(key);
              if (!active) {
                addDiagnostic(
                  ctx,
                  'UNMATCHED_SLUR_STOP',
                  'warning',
                  `Slur stop had no matching start in part '${part.id}', voice '${voice.id}', number '${number}'.`
                );
              } else {
                spanners.push({
                  id: active.id,
                  type: 'slur',
                  start: active.start,
                  end: eventRef,
                  data: {
                    placement: active.placement ?? slur.placement,
                    lineType: active.lineType ?? slur.lineType
                  }
                });
                activeByKey.delete(key);
              }
            }

            if (slur.type === 'start') {
              activeByKey.set(key, {
                id: nextId('slur'),
                start: eventRef,
                placement: slur.placement,
                lineType: slur.lineType
              });
            }
          }
        }
      }
    }
  }

  for (const [key, active] of activeByKey.entries()) {
    addDiagnostic(
      ctx,
      'UNCLOSED_SLUR_START',
      'warning',
      `Slur start '${active.id}' (${key}) did not find a matching stop by score end.`
    );
  }

  return spanners;
}

/** Build wedge spanners from direction wedge start/stop tokens. */
function buildWedgeSpanners(
  part: Part,
  ctx: ParseContext,
  nextId: (type: SpannerRelation['type']) => string
): SpannerRelation[] {
  const spanners: SpannerRelation[] = [];
  const activeByNumber = new Map<string, { id: string; start: EventRef; kind: 'crescendo' | 'diminuendo'; spread?: number }>();

  for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex += 1) {
    const measure = part.measures[measureIndex];
    if (!measure) {
      continue;
    }

    const directions = [...measure.directions].sort((left, right) => left.offsetTicks - right.offsetTicks);
    for (const direction of directions) {
      const wedge = direction.wedge;
      if (!wedge) {
        continue;
      }

      const number = wedge.number ?? '1';
      const anchor = resolveDirectionAnchor(part, measureIndex, direction.offsetTicks);
      if (!anchor) {
        addDiagnostic(
          ctx,
          'WEDGE_ANCHOR_NOT_FOUND',
          'warning',
          `Wedge '${wedge.type}' in part '${part.id}' could not resolve an anchor event.`
        );
        continue;
      }

      if (wedge.type === 'crescendo' || wedge.type === 'diminuendo') {
        activeByNumber.set(number, {
          id: nextId('wedge'),
          start: anchor,
          kind: wedge.type,
          spread: wedge.spread
        });
        continue;
      }

      const active = activeByNumber.get(number);
      if (!active) {
        addDiagnostic(
          ctx,
          'UNMATCHED_WEDGE_STOP',
          'warning',
          `Wedge stop had no matching start in part '${part.id}' for number '${number}'.`
        );
        continue;
      }

      spanners.push({
        id: active.id,
        type: 'wedge',
        start: active.start,
        end: anchor,
        data: {
          kind: active.kind,
          spread: active.spread
        }
      });
      activeByNumber.delete(number);
    }
  }

  for (const [number, active] of activeByNumber.entries()) {
    addDiagnostic(
      ctx,
      'UNCLOSED_WEDGE_START',
      'warning',
      `Wedge start '${active.id}' (number '${number}') did not find a matching stop by score end.`
    );
  }

  return spanners;
}

/** Create a deterministic tie matching key from voice, staff, and note pitch identity. */
function tieMatchKey(voiceId: string, staff: number | undefined, noteData: NoteData, noteIndex: number): string {
  const staffKey = staff ?? 1;
  const pitchKey = notePitchKey(noteData) ?? `note-index-${noteIndex}`;
  return `${voiceId}|${staffKey}|${pitchKey}`;
}

/** Serialize note pitch identity for tie matching. */
function notePitchKey(noteData: NoteData): string | undefined {
  if (noteData.pitch) {
    const alter = noteData.pitch.alter ?? 0;
    return `${noteData.pitch.step}${alter}/${noteData.pitch.octave}`;
  }

  if (noteData.unpitched?.displayStep && noteData.unpitched.displayOctave !== undefined) {
    return `${noteData.unpitched.displayStep}/${noteData.unpitched.displayOctave}`;
  }

  return undefined;
}

/** Resolve a direction offset to the closest note event reference in the same measure. */
function resolveDirectionAnchor(part: Part, measureIndex: number, offsetTicks: number): EventRef | undefined {
  const measure = part.measures[measureIndex];
  if (!measure) {
    return undefined;
  }

  let best:
    | {
        ref: EventRef;
        distance: number;
      }
    | undefined;

  for (const voice of measure.voices) {
    for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
      const event = voice.events[eventIndex];
      if (!event || event.kind !== 'note') {
        continue;
      }

      const distance = Math.abs(event.offsetTicks - offsetTicks);
      if (!best || distance < best.distance) {
        best = {
          ref: {
            partId: part.id,
            measureIndex,
            voiceId: voice.id,
            eventIndex
          },
          distance
        };
      }
    }
  }

  return best?.ref;
}
