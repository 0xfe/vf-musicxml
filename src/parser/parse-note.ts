import type {
  BeamInfo,
  BeamValue,
  EffectiveAttributes,
  NoteEvent,
  RestEvent,
  TimedEvent
} from '../core/score.js';
import type { ParseContext } from './parse-context.js';
import {
  parseAttributeUpdate,
  parseBarline,
  parseDurationTicks,
  parseHarmony,
  type DurationContextLabel,
  type DurationTicksResult
} from './parse-measure-events.js';
import { parseNoteData, parsePitch, parseTies, parseUnpitched } from './parse-note-data.js';
import {
  parseArticulations,
  parseLyrics,
  parseOrnaments,
  parseSlurs,
  parseTimeModification,
  parseTuplets
} from './parse-note-notations.js';
import { parseDirection } from './parse-direction-events.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalFloat, parseOptionalInt, textOf } from './xml-utils.js';

/**
 * Internal note parse representation.
 * Chord continuations are represented as `kind: 'chord'` to merge into prior note events.
 */
export type NoteParseResult =
  | {
      kind: 'chord';
      voice: string;
      event: NoteEvent;
      warnedMissingDivisions: boolean;
    }
  | {
      kind: 'single';
      voice: string;
      event: TimedEvent;
      warnedMissingDivisions: boolean;
    };

/** Parse a note/rest node and convert duration units into canonical ticks. */
export function parseNote(
  noteNode: XmlNode,
  streamCursorTicks: number,
  effectiveAttributes: EffectiveAttributes,
  warnedMissingDivisions: boolean,
  ctx: ParseContext
): NoteParseResult {
  const voice = textOf(firstChild(noteNode, 'voice')) ?? '1';
  const staff = parseOptionalInt(textOf(firstChild(noteNode, 'staff')));
  const isChord = !!firstChild(noteNode, 'chord');
  const isRest = !!firstChild(noteNode, 'rest');
  const graceNode = firstChild(noteNode, 'grace');
  const isGrace = !!graceNode;
  const isCue = !!firstChild(noteNode, 'cue');
  const stemDirection = parseStemDirection(noteNode);
  const beams = parseBeams(noteNode);
  const sourceDefaultXTenths = parseOptionalFloat(attribute(noteNode, 'default-x'));

  const duration = parseDurationTicks(noteNode, effectiveAttributes, warnedMissingDivisions, ctx, 'note');

  if (isRest) {
    const restEvent: RestEvent = {
      kind: 'rest',
      voice,
      staff,
      offsetTicks: streamCursorTicks,
      durationTicks: duration.ticks,
      display: parseRestDisplay(firstChild(noteNode, 'rest'))
    };

    return {
      kind: 'single',
      voice,
      event: restEvent,
      warnedMissingDivisions: duration.warnedMissingDivisions
    };
  }

  const noteData = parseNoteData(noteNode, ctx);
  const noteEvent: NoteEvent = {
    kind: 'note',
    voice,
    staff,
    sourceDefaultXTenths,
    stemDirection,
    beams: beams.length > 0 ? beams : undefined,
    cue: isCue,
    grace: isGrace,
    graceSlash: isGrace && attribute(graceNode, 'slash') === 'yes',
    noteType: textOf(firstChild(noteNode, 'type')) ?? undefined,
    dotCount: childrenOf(noteNode, 'dot').length || undefined,
    timeModification: parseTimeModification(noteNode),
    tuplets: parseTuplets(noteNode),
    offsetTicks: streamCursorTicks,
    durationTicks: duration.ticks,
    notes: [noteData]
  };

  if (isChord) {
    return {
      kind: 'chord',
      voice,
      event: noteEvent,
      warnedMissingDivisions: duration.warnedMissingDivisions
    };
  }

  return {
    kind: 'single',
    voice,
    event: noteEvent,
    warnedMissingDivisions: duration.warnedMissingDivisions
  };
}

/** Parse supported stem-direction tokens from `<stem>` for renderer parity. */
function parseStemDirection(noteNode: XmlNode): NoteEvent['stemDirection'] {
  const stem = textOf(firstChild(noteNode, 'stem'));
  if (stem === 'up' || stem === 'down') {
    return stem;
  }
  return undefined;
}

/** Parse supported `<beam number="...">token</beam>` markers. */
function parseBeams(noteNode: XmlNode): BeamInfo[] {
  const parsed: BeamInfo[] = [];
  for (const beamNode of childrenOf(noteNode, 'beam')) {
    const number = parseOptionalInt(attribute(beamNode, 'number')) ?? 1;
    const value = parseBeamValue(textOf(beamNode));
    if (!value) {
      continue;
    }

    parsed.push({
      number,
      value
    });
  }

  return parsed;
}

/** Normalize beam text tokens to the supported beam-value union. */
function parseBeamValue(raw: string | undefined): BeamValue | undefined {
  if (!raw) {
    return undefined;
  }

  switch (raw) {
    case 'begin':
    case 'continue':
    case 'end':
    case 'forward hook':
    case 'backward hook':
      return raw;
    default:
      return undefined;
  }
}

/** Parse optional rest display hints (`display-step`, `display-octave`). */
export function parseRestDisplay(restNode: XmlNode | undefined): RestEvent['display'] {
  if (!restNode) {
    return undefined;
  }

  const step = textOf(firstChild(restNode, 'display-step'));
  const octave = parseOptionalInt(textOf(firstChild(restNode, 'display-octave')));
  if (!step && octave === undefined) {
    return undefined;
  }

  return {
    step,
    octave
  };
}

export {
  parseAttributeUpdate,
  parseArticulations,
  parseBarline,
  parseDirection,
  parseDurationTicks,
  parseHarmony,
  parseLyrics,
  parseNoteData,
  parsePitch,
  parseOrnaments,
  parseSlurs,
  parseTies,
  parseTimeModification,
  parseTuplets,
  parseUnpitched,
  type DurationContextLabel,
  type DurationTicksResult
};
