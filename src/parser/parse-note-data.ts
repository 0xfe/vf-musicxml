import type {
  AccidentalInfo,
  NoteData,
  Pitch,
  TieEndpoint,
  Unpitched
} from '../core/score.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import {
  parseArticulations,
  parseLyrics,
  parseOrnaments,
  parseSlurs
} from './parse-note-notations.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalFloat, parseOptionalInt, textOf } from './xml-utils.js';

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
  const accidental = parseAccidental(noteNode);
  const notehead = textOf(firstChild(noteNode, 'notehead'));
  const ties = parseTies(noteNode);
  const slurs = parseSlurs(noteNode);
  const articulations = parseArticulations(noteNode);
  const ornaments = parseOrnaments(noteNode);
  const lyrics = parseLyrics(noteNode);

  return {
    pitch,
    unpitched,
    accidental,
    notehead: notehead ? { value: notehead } : undefined,
    ties,
    slurs,
    articulations,
    ornaments,
    lyrics
  };
}

/** Parse accidental token and cautionary/parenthesis attributes when present. */
function parseAccidental(noteNode: XmlNode): AccidentalInfo | undefined {
  const accidentalNode = firstChild(noteNode, 'accidental');
  const value = textOf(accidentalNode);
  if (!accidentalNode || !value) {
    return undefined;
  }

  const parentheses = parseYesNoAttribute(accidentalNode, 'parentheses');
  const bracket = parseYesNoAttribute(accidentalNode, 'bracket');
  const cautionary = parseYesNoAttribute(accidentalNode, 'cautionary');
  const editorial = parseYesNoAttribute(accidentalNode, 'editorial');

  return {
    value,
    parentheses: parentheses || undefined,
    bracket: bracket || undefined,
    cautionary: cautionary || editorial || undefined
  };
}

/** Parse MusicXML yes/no attributes into booleans. */
function parseYesNoAttribute(node: XmlNode, name: string): boolean {
  return attribute(node, name) === 'yes';
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

  // MusicXML allows fractional alters for microtonal notation (for example
  // `0.5` quarter-sharp). Keep this as float so render mapping can emit
  // microtonal accidental glyphs when explicit `<accidental>` tags are absent.
  const alter = parseOptionalFloat(textOf(firstChild(pitchNode, 'alter')));

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
