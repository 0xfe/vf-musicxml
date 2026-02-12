import type {
  AccidentalInfo,
  ArticulationInfo,
  BarlineEndingInfo,
  BarlineInfo,
  BarlineRepeatInfo,
  BeamInfo,
  BeamValue,
  ClefInfo,
  DirectionEvent,
  EffectiveAttributes,
  HarmonyEvent,
  LyricInfo,
  NoteData,
  NoteEvent,
  OrnamentInfo,
  Pitch,
  RestEvent,
  SlurEndpoint,
  TimedEvent,
  TimeSignatureSymbol,
  TieEndpoint,
  TupletEndpoint,
  TupletTimeModification,
  Unpitched
} from '../core/score.js';
import { TICKS_PER_QUARTER } from './parse-constants.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
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

/** Parse a direction node into words/tempo metadata anchored at an offset. */
export function parseDirection(directionNode: XmlNode, offsetTicks: number): DirectionEvent {
  const directionTypeNodes = childrenOf(directionNode, 'direction-type');
  const words = parseDirectionWords(directionTypeNodes);
  const soundNode = firstChild(directionNode, 'sound');
  const tempoRaw = soundNode ? attribute(soundNode, 'tempo') : undefined;
  const tempo = tempoRaw ? Number(tempoRaw) : undefined;
  const dynamics = parseDirectionDynamics(directionTypeNodes);
  const wedge = parseDirectionWedge(directionTypeNodes);

  const direction: DirectionEvent = {
    offsetTicks,
    words,
    tempo: Number.isFinite(tempo) ? tempo : undefined
  };

  if (dynamics.length > 0) {
    direction.dynamics = dynamics;
  }
  if (wedge) {
    direction.wedge = wedge;
  }

  return direction;
}

/** Parse barline metadata while preserving only supported location tokens. */
export function parseBarline(barlineNode: XmlNode): BarlineInfo {
  const location = attribute(barlineNode, 'location');
  const style = textOf(firstChild(barlineNode, 'bar-style'));
  const resolvedLocation = location === 'left' || location === 'right' || location === 'middle' ? location : 'right';
  const repeatDirection = attribute(firstChild(barlineNode, 'repeat'), 'direction');
  const endingNode = firstChild(barlineNode, 'ending');

  const parsed: BarlineInfo = {
    location: resolvedLocation,
    style
  };

  if (repeatDirection === 'forward' || repeatDirection === 'backward') {
    const repeats: BarlineRepeatInfo[] = [
      {
        location: resolvedLocation,
        direction: repeatDirection
      }
    ];
    parsed.repeats = repeats;
  }

  if (endingNode) {
    const endingType = attribute(endingNode, 'type');
    if (
      endingType === 'start' ||
      endingType === 'stop' ||
      endingType === 'discontinue' ||
      endingType === 'continue'
    ) {
      const endings: BarlineEndingInfo[] = [
        {
          location: resolvedLocation,
          type: endingType,
          number: attribute(endingNode, 'number') ?? undefined,
          text: textOf(endingNode) ?? undefined
        }
      ];
      parsed.endings = endings;
    }
  }

  return parsed;
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

/** Parse articulation tokens nested under `<notations><articulations>`. */
export function parseArticulations(noteNode: XmlNode): ArticulationInfo[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const articulations: ArticulationInfo[] = [];
  for (const notationsNode of notationsNodes) {
    for (const articulationsNode of childrenOf(notationsNode, 'articulations')) {
      for (const articulationNode of articulationsNode.children) {
        articulations.push({ type: articulationNode.name });
      }
    }

    // MusicXML allows fermatas as direct `<notations>` children.
    // We normalize fermata variants into articulation-like tokens so the renderer
    // can route them through VexFlow Articulation glyphs.
    for (const fermataNode of childrenOf(notationsNode, 'fermata')) {
      const fermataType = attribute(fermataNode, 'type');
      const fermataShape = textOf(fermataNode);
      if (fermataType === 'inverted') {
        articulations.push({ type: 'fermata-inverted' });
        continue;
      }

      if (fermataShape === 'angled') {
        articulations.push({ type: 'fermata-angled' });
        continue;
      }
      if (fermataShape === 'square') {
        articulations.push({ type: 'fermata-square' });
        continue;
      }

      articulations.push({ type: 'fermata' });
    }

    // Technical markings frequently live under category-32 fixtures and map to
    // articulation-style symbols (up/down bow, snap pizzicato, harmonics, etc.).
    for (const technicalNode of childrenOf(notationsNode, 'technical')) {
      for (const technicalChild of technicalNode.children) {
        const technicalText = textOf(technicalChild);
        if (
          technicalText &&
          (technicalChild.name === 'fingering' ||
            technicalChild.name === 'pluck' ||
            technicalChild.name === 'fret' ||
            technicalChild.name === 'string' ||
            technicalChild.name === 'tap')
        ) {
          articulations.push({ type: `${technicalChild.name}:${technicalText}` });
          continue;
        }
        articulations.push({ type: technicalChild.name });
      }
    }
  }

  return articulations.length > 0 ? articulations : undefined;
}

/** Parse ornament tokens nested under `<notations><ornaments>`. */
export function parseOrnaments(noteNode: XmlNode): OrnamentInfo[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const ornaments: OrnamentInfo[] = [];

  for (const notationsNode of notationsNodes) {
    for (const ornamentsNode of childrenOf(notationsNode, 'ornaments')) {
      for (const ornamentNode of ornamentsNode.children) {
        if (ornamentNode.name === 'wavy-line') {
          const wavyLineType = attribute(ornamentNode, 'type');
          ornaments.push({
            type: wavyLineType ? `wavy-line-${wavyLineType}` : 'wavy-line'
          });
          continue;
        }
        if (ornamentNode.name === 'accidental-mark') {
          const accidentalText = textOf(ornamentNode);
          ornaments.push({
            type: accidentalText ? `accidental-mark:${accidentalText}` : 'accidental-mark'
          });
          continue;
        }
        if (ornamentNode.name === 'tremolo') {
          const tremoloMarks = textOf(ornamentNode);
          ornaments.push({
            type: tremoloMarks ? `tremolo:${tremoloMarks}` : 'tremolo'
          });
          continue;
        }
        ornaments.push({ type: ornamentNode.name });
      }
    }

    // Arpeggiation markings are siblings of `<ornaments>` under `<notations>`.
    // We keep them in the ornament token channel so the renderer can attach
    // stroke/vibrato modifiers without widening core score types.
    for (const arpeggiateNode of childrenOf(notationsNode, 'arpeggiate')) {
      const direction = attribute(arpeggiateNode, 'direction');
      if (direction === 'up') {
        ornaments.push({ type: 'arpeggiate-up' });
        continue;
      }
      if (direction === 'down') {
        ornaments.push({ type: 'arpeggiate-down' });
        continue;
      }
      ornaments.push({ type: 'arpeggiate' });
    }

    for (const nonArpeggiateNode of childrenOf(notationsNode, 'non-arpeggiate')) {
      const type = attribute(nonArpeggiateNode, 'type');
      ornaments.push({
        type: type ? `non-arpeggiate-${type}` : 'non-arpeggiate'
      });
    }
  }

  return ornaments.length > 0 ? ornaments : undefined;
}

/** Parse slur endpoints nested under `<notations><slur>`. */
export function parseSlurs(noteNode: XmlNode): SlurEndpoint[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const slurs: SlurEndpoint[] = [];
  for (const notationsNode of notationsNodes) {
    for (const slurNode of childrenOf(notationsNode, 'slur')) {
      const type = attribute(slurNode, 'type');
      if (type !== 'start' && type !== 'stop') {
        continue;
      }

      const slur: SlurEndpoint = {
        type
      };

      const number = attribute(slurNode, 'number');
      if (number) {
        slur.number = number;
      }

      const placement = attribute(slurNode, 'placement');
      if (placement) {
        slur.placement = placement;
      }

      const lineType = attribute(slurNode, 'line-type');
      if (lineType) {
        slur.lineType = lineType;
      }

      slurs.push(slur);
    }
  }

  return slurs.length > 0 ? slurs : undefined;
}

/** Parse lyric payloads nested under `<note><lyric>`. */
export function parseLyrics(noteNode: XmlNode): LyricInfo[] | undefined {
  const lyrics: LyricInfo[] = [];
  for (const lyricNode of childrenOf(noteNode, 'lyric')) {
    const lyric: LyricInfo = {
      number: attribute(lyricNode, 'number') ?? undefined,
      syllabic: textOf(firstChild(lyricNode, 'syllabic')) ?? undefined,
      text: textOf(firstChild(lyricNode, 'text')) ?? undefined,
      extend: !!firstChild(lyricNode, 'extend')
    };

    if (!lyric.text && !lyric.extend) {
      continue;
    }

    lyrics.push(lyric);
  }

  return lyrics.length > 0 ? lyrics : undefined;
}

/** Parse tuplet endpoint records from `<notations><tuplet ...>`. */
export function parseTuplets(noteNode: XmlNode): TupletEndpoint[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const tuplets: TupletEndpoint[] = [];
  for (const notationsNode of notationsNodes) {
    for (const tupletNode of childrenOf(notationsNode, 'tuplet')) {
      const type = attribute(tupletNode, 'type');
      if (type !== 'start' && type !== 'stop') {
        continue;
      }

      tuplets.push({
        type,
        number: attribute(tupletNode, 'number') ?? undefined,
        bracket: parseYesNo(attribute(tupletNode, 'bracket')),
        showNumber: attribute(tupletNode, 'show-number') ?? undefined,
        placement: attribute(tupletNode, 'placement') ?? undefined
      });
    }
  }

  return tuplets.length > 0 ? tuplets : undefined;
}

/** Parse tuplet ratio metadata from `<time-modification>`. */
export function parseTimeModification(noteNode: XmlNode): TupletTimeModification | undefined {
  const modificationNode = firstChild(noteNode, 'time-modification');
  if (!modificationNode) {
    return undefined;
  }

  const actualNotes = parseOptionalInt(textOf(firstChild(modificationNode, 'actual-notes')));
  const normalNotes = parseOptionalInt(textOf(firstChild(modificationNode, 'normal-notes')));
  if (!actualNotes || !normalNotes) {
    return undefined;
  }

  return {
    actualNotes,
    normalNotes,
    actualType: textOf(firstChild(modificationNode, 'actual-type')) ?? undefined,
    normalType: textOf(firstChild(modificationNode, 'normal-type')) ?? undefined
  };
}

/** Parse `<direction-type><dynamics>` tokens into ordered dynamic markers. */
function parseDirectionDynamics(directionTypeNodes: XmlNode[]): string[] {
  const dynamics: string[] = [];
  for (const directionTypeNode of directionTypeNodes) {
    for (const dynamicsNode of childrenOf(directionTypeNode, 'dynamics')) {
      for (const dynamicNode of dynamicsNode.children) {
        if (dynamicNode.name === 'other-dynamics') {
          const value = textOf(dynamicNode);
          if (value) {
            dynamics.push(value);
          }
          continue;
        }
        dynamics.push(dynamicNode.name);
      }
    }
  }

  return dynamics;
}

/** Parse MusicXML yes/no attributes into boolean values. */
function parseYesNo(value: string | undefined): boolean | undefined {
  if (value === 'yes') {
    return true;
  }
  if (value === 'no') {
    return false;
  }
  return undefined;
}

/** Parse `<direction-type><wedge>` attributes into a normalized wedge event token. */
function parseDirectionWedge(directionTypeNodes: XmlNode[]): DirectionEvent['wedge'] {
  for (const directionTypeNode of directionTypeNodes) {
    const wedgeNode = firstChild(directionTypeNode, 'wedge');
    if (!wedgeNode) {
      continue;
    }

    const type = attribute(wedgeNode, 'type');
    if (type !== 'crescendo' && type !== 'diminuendo' && type !== 'stop') {
      continue;
    }

    const spreadText = attribute(wedgeNode, 'spread');
    const spread = spreadText ? Number.parseFloat(spreadText) : undefined;

    return {
      type,
      number: attribute(wedgeNode, 'number') ?? undefined,
      spread: Number.isFinite(spread) ? spread : undefined
    };
  }

  return undefined;
}

/**
 * Parse all displayable direction words from one `<direction>` node.
 * This flattens compound direction-type entries into one string so renderers
 * can preserve authored ordering without widening score-core types.
 */
function parseDirectionWords(directionTypeNodes: XmlNode[]): string | undefined {
  const chunks: string[] = [];
  for (const directionTypeNode of directionTypeNodes) {
    const word = textOf(firstChild(directionTypeNode, 'words'));
    if (word) {
      chunks.push(word);
    }

    const metronomeNode = firstChild(directionTypeNode, 'metronome');
    if (metronomeNode) {
      const metronomeText = formatMetronomeDirection(metronomeNode);
      if (metronomeText) {
        chunks.push(metronomeText);
      }
    }

    if (firstChild(directionTypeNode, 'segno')) {
      chunks.push('segno');
    }
    if (firstChild(directionTypeNode, 'coda')) {
      chunks.push('coda');
    }
    if (firstChild(directionTypeNode, 'damp')) {
      chunks.push('damp');
    }
    if (firstChild(directionTypeNode, 'damp-all')) {
      chunks.push('damp all');
    }
    if (firstChild(directionTypeNode, 'eyeglasses')) {
      chunks.push('eyeglasses');
    }

    const stringMuteNode = firstChild(directionTypeNode, 'string-mute');
    if (stringMuteNode) {
      const muteType = attribute(stringMuteNode, 'type');
      if (muteType === 'on') {
        chunks.push('con sord.');
      } else if (muteType === 'off') {
        chunks.push('senza sord.');
      } else {
        chunks.push('string mute');
      }
    }

    if (firstChild(directionTypeNode, 'pedal')) {
      chunks.push('ped.');
    }
    if (firstChild(directionTypeNode, 'octave-shift')) {
      chunks.push('8va');
    }
  }

  return chunks.length > 0 ? chunks.join(' ') : undefined;
}

/** Convert one metronome direction node into compact readable words. */
function formatMetronomeDirection(metronomeNode: XmlNode): string | undefined {
  const beatUnit = textOf(firstChild(metronomeNode, 'beat-unit'));
  const beatUnitDotCount = childrenOf(metronomeNode, 'beat-unit-dot').length;
  const perMinute = textOf(firstChild(metronomeNode, 'per-minute'));
  const relation = textOf(firstChild(metronomeNode, 'metronome-relation'));

  if (beatUnit && perMinute) {
    const dotted = beatUnitDotCount > 0 ? '.'.repeat(beatUnitDotCount) : '';
    return `${beatUnit}${dotted}=${perMinute}`;
  }
  if (beatUnit && relation) {
    return `${beatUnit} ${relation}`;
  }
  if (perMinute) {
    return `q=${perMinute}`;
  }

  return undefined;
}

/** Parse one `<harmony>` node into an anchored harmony token. */
export function parseHarmony(harmonyNode: XmlNode, offsetTicks: number): HarmonyEvent {
  const rootNode = firstChild(harmonyNode, 'root');
  const rootStep = textOf(firstChild(rootNode, 'root-step')) ?? undefined;
  const rootAlterText = textOf(firstChild(rootNode, 'root-alter'));
  const rootAlter = rootAlterText ? Number.parseFloat(rootAlterText) : undefined;
  const kindNode = firstChild(harmonyNode, 'kind');
  const kind = textOf(kindNode) ?? undefined;
  const staff = parseOptionalInt(textOf(firstChild(harmonyNode, 'staff')));

  return {
    offsetTicks,
    rootStep,
    rootAlter: Number.isFinite(rootAlter) ? rootAlter : undefined,
    kind,
    text: kindNode ? attribute(kindNode, 'text') ?? undefined : undefined,
    staff
  };
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
    const symbol = normalizeTimeSignatureSymbol(attribute(timeNode, 'symbol'));
    if (beats && beatType) {
      update.timeSignature = { beats, beatType, symbol };
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
    for (let clefIndex = 0; clefIndex < clefNodes.length; clefIndex += 1) {
      const clefNode = clefNodes[clefIndex];
      if (!clefNode) {
        continue;
      }
      const sign = textOf(firstChild(clefNode, 'sign'));
      if (!sign) {
        continue;
      }

      // MusicXML encodes clef staff assignment as `<clef number="N">`.
      // Some real-world scores serialize clefs out of staff order; using the
      // attribute (instead of a non-existent `<number>` child) preserves the
      // authored staff mapping and avoids clef/register swaps.
      // When `number` is omitted and multiple clefs are present, we map by
      // source order (`1..N`) to avoid collapsing all clefs onto staff 1.
      const fallbackStaff = clefNodes.length > 1 ? clefIndex + 1 : 1;
      const staff = parseOptionalInt(attribute(clefNode, 'number')) ?? fallbackStaff;
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

/** Normalize MusicXML `<time symbol>` tokens into score-model enum values. */
function normalizeTimeSignatureSymbol(value: string | undefined): TimeSignatureSymbol | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'normal' ||
    normalized === 'common' ||
    normalized === 'cut' ||
    normalized === 'single-number' ||
    normalized === 'note'
  ) {
    return normalized;
  }

  return undefined;
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
