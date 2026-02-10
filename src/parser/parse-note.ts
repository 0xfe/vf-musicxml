import type {
  ArticulationInfo,
  BarlineInfo,
  ClefInfo,
  DirectionEvent,
  EffectiveAttributes,
  NoteData,
  NoteEvent,
  Pitch,
  RestEvent,
  TimedEvent,
  TieEndpoint,
  Unpitched
} from '../core/score.js';
import { TICKS_PER_QUARTER } from './parse-constants.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalInt, textOf } from './xml-utils.js';

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

/** Label describing where a duration is being interpreted. */
export type DurationContextLabel = 'note' | 'backup' | 'forward';

/** Result payload when converting MusicXML duration units to ticks. */
export interface DurationTicksResult {
  ticks: number;
  warnedMissingDivisions: boolean;
}

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

/** Parse a direction node into words/tempo metadata anchored at an offset. */
export function parseDirection(directionNode: XmlNode, offsetTicks: number): DirectionEvent {
  const words = textOf(firstChild(firstChild(directionNode, 'direction-type'), 'words'));
  const soundNode = firstChild(directionNode, 'sound');
  const tempoRaw = soundNode ? attribute(soundNode, 'tempo') : undefined;
  const tempo = tempoRaw ? Number(tempoRaw) : undefined;

  return {
    offsetTicks,
    words,
    tempo: Number.isFinite(tempo) ? tempo : undefined
  };
}

/** Parse barline metadata while preserving only supported location tokens. */
export function parseBarline(barlineNode: XmlNode): BarlineInfo {
  const location = attribute(barlineNode, 'location');
  const style = textOf(firstChild(barlineNode, 'bar-style'));

  if (location === 'left' || location === 'right' || location === 'middle') {
    return {
      location,
      style
    };
  }

  return { style };
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

/** Parse pitch/notation fields from a note into canonical `NoteData`. */
export function parseNoteData(noteNode: XmlNode, ctx: ParseContext): NoteData {
  const pitchNode = firstChild(noteNode, 'pitch');
  const unpitchedNode = firstChild(noteNode, 'unpitched');

  if (!pitchNode && !unpitchedNode) {
    addDiagnostic(
      ctx,
      'NOTE_WITHOUT_PITCH',
      'warning',
      '<note> is missing <pitch> or <unpitched> data.',
      noteNode
    );
  }

  const pitch = pitchNode ? parsePitch(pitchNode, ctx) : undefined;
  const unpitched = unpitchedNode ? parseUnpitched(unpitchedNode) : undefined;
  const accidental = textOf(firstChild(noteNode, 'accidental'));
  const notehead = textOf(firstChild(noteNode, 'notehead'));
  const ties = parseTies(noteNode);
  const articulations = parseArticulations(noteNode);

  return {
    pitch,
    unpitched,
    accidental: accidental ? { value: accidental } : undefined,
    notehead: notehead ? { value: notehead } : undefined,
    ties,
    articulations
  };
}

/** Parse and validate `<pitch>` into a normalized pitch object. */
export function parsePitch(pitchNode: XmlNode, ctx: ParseContext): Pitch | undefined {
  const step = textOf(firstChild(pitchNode, 'step'));
  const octaveText = textOf(firstChild(pitchNode, 'octave'));

  if (!step || !octaveText) {
    addDiagnostic(ctx, 'PITCH_INCOMPLETE', 'warning', '<pitch> is missing <step> or <octave>.', pitchNode);
    return undefined;
  }

  if (!['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(step)) {
    addDiagnostic(ctx, 'PITCH_STEP_INVALID', 'warning', `Invalid pitch step '${step}'.`, pitchNode);
    return undefined;
  }

  const octave = parseOptionalInt(octaveText);
  if (octave === undefined) {
    addDiagnostic(ctx, 'PITCH_OCTAVE_INVALID', 'warning', `Invalid octave '${octaveText}'.`, pitchNode);
    return undefined;
  }

  const alter = parseOptionalInt(textOf(firstChild(pitchNode, 'alter')));

  return {
    step: step as Pitch['step'],
    alter,
    octave
  };
}

/** Parse unpitched display hints when present. */
export function parseUnpitched(unpitchedNode: XmlNode): Unpitched {
  const displayStep = textOf(firstChild(unpitchedNode, 'display-step'));
  const displayOctave = parseOptionalInt(textOf(firstChild(unpitchedNode, 'display-octave')));

  return {
    displayStep,
    displayOctave
  };
}

/** Parse tie endpoints attached to a note node. */
export function parseTies(noteNode: XmlNode): TieEndpoint[] | undefined {
  const ties = childrenOf(noteNode, 'tie')
    .map((node) => attribute(node, 'type'))
    .filter((type): type is 'start' | 'stop' => type === 'start' || type === 'stop')
    .map((type) => ({ type }));

  return ties.length > 0 ? ties : undefined;
}

/** Parse articulation tokens nested under `<notations><articulations>`. */
export function parseArticulations(noteNode: XmlNode): ArticulationInfo[] | undefined {
  const articulationsNode = firstChild(firstChild(noteNode, 'notations'), 'articulations');
  if (!articulationsNode) {
    return undefined;
  }

  const articulations = articulationsNode.children.map((node) => ({ type: node.name }));
  return articulations.length > 0 ? articulations : undefined;
}

/** Parse an `<attributes>` block into an incremental update record. */
export function parseAttributeUpdate(node: XmlNode, ctx: ParseContext): Partial<EffectiveAttributes> {
  const update: Partial<EffectiveAttributes> = {};

  const divisionsText = textOf(firstChild(node, 'divisions'));
  if (divisionsText !== undefined) {
    const divisions = parseOptionalInt(divisionsText);
    if (divisions && divisions > 0) {
      update.divisions = divisions;
    } else {
      addDiagnostic(
        ctx,
        'DIVISIONS_INVALID',
        'warning',
        `Invalid divisions value '${divisionsText}', expected positive integer.`,
        firstChild(node, 'divisions')
      );
    }
  }

  const stavesText = textOf(firstChild(node, 'staves'));
  if (stavesText !== undefined) {
    const staves = parseOptionalInt(stavesText);
    if (staves && staves > 0) {
      update.staves = staves;
    } else {
      addDiagnostic(ctx, 'STAVES_INVALID', 'warning', `Invalid staves value '${stavesText}'.`, firstChild(node, 'staves'));
    }
  }

  const keyNode = firstChild(node, 'key');
  if (keyNode) {
    const fifthsText = textOf(firstChild(keyNode, 'fifths'));
    if (fifthsText !== undefined) {
      const fifths = parseOptionalInt(fifthsText);
      if (fifths !== undefined) {
        update.keySignature = {
          fifths,
          mode: textOf(firstChild(keyNode, 'mode'))
        };
      }
    }
  }

  const timeNode = firstChild(node, 'time');
  if (timeNode) {
    const beats = parseOptionalInt(textOf(firstChild(timeNode, 'beats')));
    const beatType = parseOptionalInt(textOf(firstChild(timeNode, 'beat-type')));
    if (beats && beatType) {
      update.timeSignature = { beats, beatType };
    } else {
      addDiagnostic(
        ctx,
        'TIME_SIGNATURE_INVALID',
        'warning',
        'Invalid <time> signature; expected integer beats and beat-type.',
        timeNode
      );
    }
  }

  const clefNodes = childrenOf(node, 'clef');
  if (clefNodes.length > 0) {
    const clefs: ClefInfo[] = [];
    for (const clefNode of clefNodes) {
      const sign = textOf(firstChild(clefNode, 'sign'));
      if (!sign) {
        continue;
      }

      const staff = parseOptionalInt(textOf(firstChild(clefNode, 'number'))) ?? 1;
      const line = parseOptionalInt(textOf(firstChild(clefNode, 'line')));
      clefs.push({
        staff,
        sign,
        line
      });
    }

    if (clefs.length > 0) {
      update.clefs = clefs;
    }
  }

  return update;
}

/** Convert MusicXML duration units into canonical ticks with lenient fallbacks. */
export function parseDurationTicks(
  node: XmlNode,
  effectiveAttributes: EffectiveAttributes,
  warnedMissingDivisions: boolean,
  ctx: ParseContext,
  contextLabel: DurationContextLabel
): DurationTicksResult {
  const durationNode = firstChild(node, 'duration');
  if (!durationNode) {
    return {
      ticks: 0,
      warnedMissingDivisions
    };
  }

  const durationText = textOf(durationNode);
  const duration = parseOptionalInt(durationText);
  if (duration === undefined || duration < 0) {
    addDiagnostic(
      ctx,
      'DURATION_INVALID',
      'warning',
      `Invalid ${contextLabel} duration '${durationText ?? ''}'.`,
      durationNode
    );
    return {
      ticks: 0,
      warnedMissingDivisions
    };
  }

  let divisions = effectiveAttributes.divisions;
  let warned = warnedMissingDivisions;

  if (!divisions || divisions <= 0) {
    divisions = 1;
    if (!warnedMissingDivisions) {
      addDiagnostic(
        ctx,
        'MISSING_DIVISIONS',
        'warning',
        'Missing <divisions>; defaulting to 1 in lenient timing conversion.',
        node
      );
      warned = true;
    }
  }

  const ticks = Math.round((duration / divisions) * TICKS_PER_QUARTER);
  return {
    ticks,
    warnedMissingDivisions: warned
  };
}
