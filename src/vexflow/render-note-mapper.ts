import {
  Accidental,
  Annotation,
  Articulation,
  Dot,
  FretHandFinger,
  GraceNote,
  GraceNoteGroup,
  Ornament,
  StaveNote,
  Stroke,
  Tremolo,
  Tuplet,
  Vibrato,
  type StaveNoteStruct
} from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type {
  ClefInfo,
  KeySignatureInfo,
  Measure,
  NoteData,
  NoteEvent,
  TupletTimeModification,
  TimeSignatureInfo,
  TimedEvent
} from '../core/score.js';

/** Tuplet draw payload emitted by the note-mapper and consumed by render orchestration. */
export interface RenderedTupletSpec {
  notes: StaveNote[];
  numNotes: number;
  notesOccupied: number;
  bracketed?: boolean;
  ratioed?: boolean;
  location: number;
}

/** Active tuplet state while scanning one voice's events in score order. */
interface ActiveTupletState {
  notes: StaveNote[];
  numNotes: number;
  notesOccupied: number;
  bracketed?: boolean;
  ratioed?: boolean;
  location: number;
}

/** Rendered note list plus event-to-note mapping used by tie/slur/hairpin passes. */
export interface BuildMeasureNotesResult {
  notes: StaveNote[];
  noteByEventKey: Map<string, StaveNote>;
  tuplets: RenderedTupletSpec[];
}

/** Build renderable notes for one target staff (single-voice-per-staff baseline retained in M5). */
export function buildMeasureNotes(
  measure: Measure,
  ticksPerQuarter: number,
  clef: string,
  diagnostics: Diagnostic[],
  staffNumber = 1
): BuildMeasureNotesResult {
  if (measure.voices.length === 0) {
    return {
      notes: [],
      noteByEventKey: new Map(),
      tuplets: []
    };
  }

  const voicesForStaff = measure.voices.filter((voice) => voice.events.some((event) => belongsToStaff(event, staffNumber)));
  if (voicesForStaff.length > 1) {
    diagnostics.push({
      code: 'MULTI_VOICE_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: `Measure ${measure.index + 1}, staff ${staffNumber} has multiple voices. Rendering only voice ${voicesForStaff[0]?.id ?? '1'}.`
    });
  }

  const voice = voicesForStaff[0];
  if (!voice) {
    return {
      notes: [],
      noteByEventKey: new Map(),
      tuplets: []
    };
  }

  const notes: StaveNote[] = [];
  const noteByEventKey = new Map<string, StaveNote>();
  const tuplets: RenderedTupletSpec[] = [];
  const pendingGraceEvents: NoteEvent[] = [];
  const activeTuplets = new Map<string, ActiveTupletState>();

  for (let eventIndex = 0; eventIndex < voice.events.length; eventIndex += 1) {
    const event = voice.events[eventIndex];
    if (!event) {
      continue;
    }
    if (!belongsToStaff(event, staffNumber)) {
      continue;
    }

    if (event.kind === 'note' && event.grace) {
      pendingGraceEvents.push(event);
      continue;
    }

    const note = toStaveNote(event, ticksPerQuarter, clef, diagnostics);
    if (!note) {
      continue;
    }

    if (event.kind === 'rest' && pendingGraceEvents.length > 0) {
      diagnostics.push({
        code: 'GRACE_NOTES_WITHOUT_ANCHOR',
        severity: 'warning',
        message: `Measure ${measure.index + 1}, staff ${staffNumber} had grace notes before a rest; dropping unattached grace notes.`
      });
      pendingGraceEvents.length = 0;
    }

    if (event.kind === 'note' && pendingGraceEvents.length > 0) {
      attachGraceGroup(note, pendingGraceEvents, clef, diagnostics);
      pendingGraceEvents.length = 0;
    }

    notes.push(note);
    noteByEventKey.set(buildVoiceEventKey(voice.id, eventIndex), note);

    if (event.kind === 'note') {
      // Existing tuplets consume this note before start/stop markers are processed.
      for (const activeTuplet of activeTuplets.values()) {
        activeTuplet.notes.push(note);
      }
      processTupletBoundaries(event, note, activeTuplets, tuplets, diagnostics);
    }
  }

  if (pendingGraceEvents.length > 0) {
    diagnostics.push({
      code: 'GRACE_NOTES_WITHOUT_ANCHOR',
      severity: 'warning',
      message: `Measure ${measure.index + 1}, staff ${staffNumber} ended with unattached grace notes.`
    });
  }

  if (activeTuplets.size > 0) {
    diagnostics.push({
      code: 'UNCLOSED_TUPLET_START',
      severity: 'warning',
      message: `Measure ${measure.index + 1}, staff ${staffNumber} contains unclosed tuplet start markers.`
    });
  }

  return {
    notes,
    noteByEventKey,
    tuplets
  };
}

/** Route timed events to a target staff; events without explicit staff default to staff 1. */
function belongsToStaff(event: TimedEvent, staffNumber: number): boolean {
  if (event.kind === 'note' || event.kind === 'rest') {
    return (event.staff ?? 1) === staffNumber;
  }

  return staffNumber === 1;
}

/** Map one timed event into a VexFlow `StaveNote` when supported. */
function toStaveNote(
  event: TimedEvent,
  ticksPerQuarter: number,
  clef: string,
  diagnostics: Diagnostic[]
): StaveNote | undefined {
  const duration = mapDuration(event, ticksPerQuarter, diagnostics);
  if (!duration) {
    return undefined;
  }

  if (event.kind === 'rest') {
    return createRestNote(clef, duration.duration, duration.dots);
  }

  if (event.kind === 'note') {
    return createPitchNote(event, clef, duration.duration, duration.dots, diagnostics);
  }

  diagnostics.push({
    code: 'UNSUPPORTED_TIMED_EVENT',
    severity: 'warning',
    message: `Timed event '${event.kind}' is not rendered in M2.`
  });
  return undefined;
}

/** Create a rest note using VexFlow's rest duration syntax (`qr`, `hr`, etc). */
function createRestNote(clef: string, duration: string, dots: number): StaveNote {
  const note = new StaveNote({
    clef,
    keys: ['b/4'],
    duration: `${duration}r`
  });

  for (let index = 0; index < dots; index += 1) {
    Dot.buildAndAttach([note], { all: true });
  }

  return note;
}

/** Create a pitched note or chord from normalized note data. */
function createPitchNote(
  event: NoteEvent,
  clef: string,
  duration: string,
  dots: number,
  diagnostics: Diagnostic[]
): StaveNote {
  const keys: string[] = [];

  for (const noteData of event.notes) {
    const key = noteDataToKey(noteData, diagnostics);
    if (key) {
      keys.push(key);
    }
  }

  if (keys.length === 0) {
    diagnostics.push({
      code: 'MISSING_NOTE_KEYS',
      severity: 'warning',
      message: 'Note event without renderable pitch; using fallback C/4.'
    });
    keys.push('c/4');
  }

  const staveNoteData: StaveNoteStruct = {
    clef,
    keys,
    duration,
    stem_direction: mapStemDirection(event.stemDirection),
    glyph_font_scale: event.cue ? 30 : undefined
  };

  const note = new StaveNote(staveNoteData);
  /** Cache note-level mappings once to avoid duplicated parse/diagnostic work. */
  const perNoteMappings: PerNoteModifierMapping[] = event.notes.map((noteData) => ({
    articulation: mapArticulations(noteData, diagnostics),
    ornament: mapOrnaments(noteData, diagnostics)
  }));

  /**
   * Accidentals are pitch-specific and must stay index-bound, so we attach
   * those in a dedicated first pass before any chord-level modifier merging.
   */
  event.notes.forEach((noteData, index) => {
    const accidental = createAccidentalModifier(noteData, diagnostics);
    if (accidental) {
      note.addModifier(accidental, index);
    }
  });

  /**
   * MusicXML chord notes often duplicate shared articulations/ornaments on each
   * notehead. If we mirror that naively, VexFlow stacks identical modifiers in
   * the same location and creates dense text/symbol overlaps. We therefore
   * merge shared modifiers across chord noteheads and attach each unique
   * modifier once at a stable chord anchor index.
   */
  const mergedModifiers = collectChordLevelModifiers(perNoteMappings);
  const anchorIndex = resolveChordModifierAnchorIndex(event);

  for (const articulationCode of mergedModifiers.articulationCodes) {
    note.addModifier(new Articulation(articulationCode), anchorIndex);
  }
  for (const ornamentCode of mergedModifiers.ornamentCodesFromArticulations) {
    note.addModifier(new Ornament(ornamentCode), anchorIndex);
  }
  for (const ornamentCode of mergedModifiers.ornamentCodes) {
    note.addModifier(new Ornament(ornamentCode), anchorIndex);
  }
  if (mergedModifiers.vibrato) {
    note.addModifier(new Vibrato(), anchorIndex);
  }

  for (const strokeType of mergedModifiers.strokeTypes) {
    note.addModifier(new Stroke(strokeType), anchorIndex);
  }
  for (const tremoloSlashCount of mergedModifiers.tremoloSlashCounts) {
    note.addModifier(new Tremolo(tremoloSlashCount), anchorIndex);
  }

  /**
   * Technical text/fingering annotations are often note-specific. Keep them at
   * note index granularity, but compact multi-token clusters so VexFlow does
   * not stack unreadable piles on one glyph anchor.
   */
  perNoteMappings.forEach((mapping, index) => {
    attachPerNoteTextualModifiers(note, index, mapping);
  });

  for (let index = 0; index < dots; index += 1) {
    Dot.buildAndAttach([note], { all: true });
  }

  if (event.cue) {
    diagnostics.push({
      code: 'CUE_NOTE_RENDERED',
      severity: 'info',
      message: 'Rendered cue-sized notehead/stem in M6 baseline.'
    });
  }

  return note;
}

/** Chord-level merged modifier payload to avoid duplicate notehead attachments. */
interface ChordLevelModifierMapping {
  articulationCodes: string[];
  ornamentCodesFromArticulations: string[];
  ornamentCodes: string[];
  strokeTypes: number[];
  vibrato: boolean;
  tremoloSlashCounts: number[];
}

/** Per-note modifier payload retained for technical text/fingering routing. */
interface PerNoteModifierMapping {
  articulation: ArticulationMapping;
  ornament: OrnamentMapping;
}

/** Deduplicate chord-level note modifiers while preserving source token order. */
function collectChordLevelModifiers(
  perNoteMappings: PerNoteModifierMapping[]
): ChordLevelModifierMapping {
  const articulationCodes = new Set<string>();
  const ornamentCodesFromArticulations = new Set<string>();
  const ornamentCodes = new Set<string>();
  const strokeTypes = new Set<number>();
  const tremoloSlashCounts = new Set<number>();
  let vibrato = false;

  for (const mapping of perNoteMappings) {
    const articulationMapping = mapping.articulation;
    for (const code of articulationMapping.codes) {
      articulationCodes.add(code);
    }
    for (const ornamentCode of articulationMapping.ornamentCodes) {
      ornamentCodesFromArticulations.add(ornamentCode);
    }

    const ornamentMapping = mapping.ornament;
    for (const ornamentCode of ornamentMapping.ornamentCodes) {
      ornamentCodes.add(ornamentCode);
    }
    for (const strokeType of ornamentMapping.strokeTypes) {
      strokeTypes.add(strokeType);
    }
    for (const tremoloSlashCount of ornamentMapping.tremoloSlashCounts) {
      tremoloSlashCounts.add(tremoloSlashCount);
    }
    vibrato = vibrato || ornamentMapping.vibrato;
  }

  return {
    articulationCodes: [...articulationCodes],
    ornamentCodesFromArticulations: [...ornamentCodesFromArticulations],
    ornamentCodes: [...ornamentCodes],
    strokeTypes: [...strokeTypes],
    vibrato,
    tremoloSlashCounts: [...tremoloSlashCounts]
  };
}

/**
 * Resolve a stable anchor note index for chord-level modifiers.
 * We keep this simple and deterministic: the first key serves as the chord
 * anchor until we add placement-aware chord indexing in a later milestone.
 */
function resolveChordModifierAnchorIndex(event: NoteEvent): number {
  return event.notes.length > 0 ? 0 : 0;
}

/** Build note-level text annotations with compact typography and top placement. */
function buildNoteTextAnnotation(text: string): Annotation {
  const annotation = new Annotation(text);
  annotation.setFont('Times New Roman', 10, 'normal', 'italic');
  annotation.setVerticalJustification(Annotation.VerticalJustify.TOP);
  return annotation;
}

/** Attach note-specific technical labels while preventing intra-note text pileups. */
function attachPerNoteTextualModifiers(
  note: StaveNote,
  index: number,
  mapping: PerNoteModifierMapping
): void {
  if (mapping.articulation.fingerings.length === 1) {
    note.addModifier(new FretHandFinger(mapping.articulation.fingerings[0] ?? ''), index);
  } else if (mapping.articulation.fingerings.length > 1) {
    note.addModifier(buildNoteTextAnnotation(mapping.articulation.fingerings.join(' ')), index);
  }

  const textAnnotations = dedupeStrings([
    ...mapping.articulation.textAnnotations,
    ...mapping.ornament.textAnnotations
  ]);
  for (const text of textAnnotations) {
    note.addModifier(buildNoteTextAnnotation(text), index);
  }
}

/** Stable-order string dedupe helper for annotation token lists. */
function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

/** Translate parser stem tokens into VexFlow stem-direction numbers. */
function mapStemDirection(direction: NoteEvent['stemDirection']): number | undefined {
  if (direction === 'up') {
    return 1;
  }
  if (direction === 'down') {
    return -1;
  }
  return undefined;
}

/** Build stable map keys for one rendered voice event. */
export function buildVoiceEventKey(voiceId: string, eventIndex: number): string {
  return `${voiceId}:${eventIndex}`;
}

/**
 * Parse one `buildVoiceEventKey` payload back into voice/event coordinates.
 * We split on the last `:` so voice identifiers can safely contain colons.
 */
export function parseVoiceEventKey(
  eventKey: string
): { voiceId: string; eventIndex: number } | undefined {
  const separatorIndex = eventKey.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= eventKey.length - 1) {
    return undefined;
  }

  const voiceId = eventKey.slice(0, separatorIndex);
  const eventIndexText = eventKey.slice(separatorIndex + 1);
  const eventIndex = Number.parseInt(eventIndexText, 10);
  if (!Number.isFinite(eventIndex) || eventIndex < 0) {
    return undefined;
  }

  return { voiceId, eventIndex };
}

/** Convert pending grace events into a GraceNoteGroup attached to the anchor note. */
function attachGraceGroup(
  anchor: StaveNote,
  graceEvents: NoteEvent[],
  clef: string,
  diagnostics: Diagnostic[]
): void {
  const graceNotes = graceEvents
    .map((event) => createGraceNote(event, clef, diagnostics))
    .filter((note): note is GraceNote => !!note);

  if (graceNotes.length === 0) {
    return;
  }

  const graceGroup = new GraceNoteGroup(graceNotes, false);
  // VexFlow can throw for unsupported grace-beam combinations (for example
  // when a source encodes grace durations that cannot be auto-beamed). We keep
  // rendering by attaching unbeamed grace notes and emit a diagnostic for triage.
  try {
    graceGroup.beamNotes();
  } catch (error) {
    diagnostics.push({
      code: 'GRACE_NOTES_BEAMING_FAILED',
      severity: 'warning',
      message: `Grace-note beaming failed in VexFlow; rendering without beams (${String(error)}).`
    });
  }
  anchor.addModifier(graceGroup, 0);
}

/** Build one VexFlow `GraceNote` from a parsed grace event. */
function createGraceNote(event: NoteEvent, clef: string, diagnostics: Diagnostic[]): GraceNote | undefined {
  const keys: string[] = [];
  for (const noteData of event.notes) {
    const key = noteDataToKey(noteData, diagnostics);
    if (key) {
      keys.push(key);
    }
  }

  if (keys.length === 0) {
    return undefined;
  }

  const grace = new GraceNote({
    clef,
    keys,
    duration: mapDurationFromType(event.noteType, event.dotCount)?.duration ?? '8',
    slash: event.graceSlash ?? false
  });

  event.notes.forEach((noteData, index) => {
    const accidental = createAccidentalModifier(noteData, diagnostics);
    if (accidental) {
      grace.addModifier(accidental, index);
    }
  });

  return grace;
}

/** Update active tuplet state for this note and emit completed tuplets. */
function processTupletBoundaries(
  event: NoteEvent,
  renderedNote: StaveNote,
  activeTuplets: Map<string, ActiveTupletState>,
  tuplets: RenderedTupletSpec[],
  diagnostics: Diagnostic[]
): void {
  if (!event.tuplets || event.tuplets.length === 0) {
    return;
  }

  for (const endpoint of event.tuplets) {
    const number = endpoint.number ?? '1';
    if (endpoint.type === 'start') {
      if (activeTuplets.has(number)) {
        diagnostics.push({
          code: 'OVERLAPPING_TUPLET_START',
          severity: 'warning',
          message: `Tuplet number '${number}' started before prior tuplets with same number closed.`
        });
      }

      activeTuplets.set(number, createTupletState(renderedNote, endpoint.bracket, endpoint.showNumber, endpoint.placement, event.timeModification));
      continue;
    }

    const active = activeTuplets.get(number);
    if (!active) {
      diagnostics.push({
        code: 'UNMATCHED_TUPLET_STOP',
        severity: 'warning',
        message: `Tuplet stop for number '${number}' had no matching start.`
      });
      continue;
    }

    if (endpoint.showNumber) {
      active.ratioed = endpoint.showNumber === 'both';
    }
    if (endpoint.bracket !== undefined) {
      active.bracketed = endpoint.bracket;
    }
    if (endpoint.placement === 'above' || endpoint.placement === 'below') {
      active.location = endpoint.placement === 'below' ? Tuplet.LOCATION_BOTTOM : Tuplet.LOCATION_TOP;
    }

    tuplets.push({
      notes: [...active.notes],
      numNotes: active.numNotes,
      notesOccupied: active.notesOccupied,
      bracketed: active.bracketed,
      ratioed: active.ratioed,
      location: active.location
    });
    activeTuplets.delete(number);
  }
}

/** Create active tuplet state from start metadata and optional time-modification ratio. */
function createTupletState(
  renderedNote: StaveNote,
  bracketed: boolean | undefined,
  showNumber: string | undefined,
  placement: string | undefined,
  ratio: TupletTimeModification | undefined
): ActiveTupletState {
  const numNotes = ratio?.actualNotes ?? 3;
  const notesOccupied = ratio?.normalNotes ?? 2;
  const ratioed = showNumber ? showNumber === 'both' : Math.abs(numNotes - notesOccupied) > 1;

  return {
    notes: [renderedNote],
    numNotes,
    notesOccupied,
    bracketed,
    ratioed,
    location: placement === 'below' ? Tuplet.LOCATION_BOTTOM : Tuplet.LOCATION_TOP
  };
}

/** Convert a note payload to a VexFlow key string (`c/4`, `f#/5`, etc). */
function noteDataToKey(noteData: NoteData, diagnostics: Diagnostic[]): string | undefined {
  if (noteData.pitch) {
    const step = noteData.pitch.step.toLowerCase();
    return `${step}/${noteData.pitch.octave}`;
  }

  if (noteData.unpitched?.displayStep && noteData.unpitched.displayOctave !== undefined) {
    return `${noteData.unpitched.displayStep.toLowerCase()}/${noteData.unpitched.displayOctave}`;
  }

  diagnostics.push({
    code: 'UNPITCHED_NOTE_UNSUPPORTED',
    severity: 'warning',
    message: 'Unpitched note without display-step/display-octave cannot be rendered in M2.'
  });
  return undefined;
}

/** Build one VexFlow accidental modifier from MusicXML accidental metadata. */
function createAccidentalModifier(noteData: NoteData, diagnostics: Diagnostic[]): Accidental | undefined {
  const token = mapAccidental(noteData);
  if (!token) {
    if (noteData.accidental?.value) {
      diagnostics.push({
        code: 'UNSUPPORTED_ACCIDENTAL',
        severity: 'warning',
        message: `Unsupported accidental '${noteData.accidental.value}' is not rendered.`
      });
    } else if (hasUnsupportedFractionalAlter(noteData.pitch?.alter)) {
      diagnostics.push({
        code: 'UNSUPPORTED_MICROTONAL_ALTER',
        severity: 'warning',
        message: `Unsupported fractional pitch alter '${noteData.pitch?.alter}' cannot be rendered as a VexFlow accidental.`
      });
    }
    return undefined;
  }

  try {
    const accidental = new Accidental(token);
    if (noteData.accidental?.cautionary || noteData.accidental?.parentheses || noteData.accidental?.bracket) {
      accidental.setAsCautionary();
    }
    return accidental;
  } catch {
    diagnostics.push({
      code: 'UNSUPPORTED_ACCIDENTAL',
      severity: 'warning',
      message: `Unsupported accidental '${noteData.accidental?.value ?? token}' is not rendered.`
    });
    return undefined;
  }
}

/** Map MusicXML accidental tokens into VexFlow accidental symbols. */
function mapAccidental(noteData: NoteData): string | undefined {
  const value = noteData.accidental?.value?.trim();
  const mappedFromToken = value ? mapAccidentalToken(value) : undefined;
  if (mappedFromToken) {
    return mappedFromToken;
  }

  // Many microtonal fixtures encode quarter-tone accidentals via fractional
  // `pitch.alter` without an explicit `<accidental>` element. We only infer
  // fractional tokens here to avoid over-emitting regular key-signature
  // accidentals when explicit accidental intent is absent.
  return mapFractionalPitchAlterToAccidental(noteData.pitch?.alter);
}

/** Map one explicit accidental token string into a VexFlow accidental symbol. */
function mapAccidentalToken(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  const map: Record<string, string> = {
    sharp: '#',
    flat: 'b',
    natural: 'n',
    'double-sharp': '##',
    'sharp-sharp': '##',
    'double-flat': 'bb',
    'flat-flat': 'bb',
    'triple-sharp': '###',
    'triple-flat': 'bbb',
    'natural-sharp': '#',
    'natural-flat': 'b',
    'quarter-flat': 'd',
    'quarter-sharp': '+',
    'three-quarters-flat': 'db',
    'three-quarters-sharp': '++',
    'slash-quarter-sharp': '+',
    'slash-sharp': '#',
    'slash-flat': 'b',
    'double-sharp-up': '##',
    'double-sharp-down': '##',
    'double-flat-up': 'bb',
    'double-flat-down': 'bb',
    sori: 'o',
    koron: 'k',
    'sharp-up': '#',
    'sharp-down': '#',
    'flat-up': 'b',
    'flat-down': 'b',
    'natural-up': 'n',
    'natural-down': 'n',
    sharpup: '#',
    sharpdown: '#',
    flatup: 'b',
    flatdown: 'b',
    naturalup: 'n',
    naturaldown: 'n',
    '#': '#',
    b: 'b',
    n: 'n',
    '##': '##',
    bb: 'bb',
    d: 'd',
    db: 'db',
    '+': '+',
    '++': '++',
    '+-': '+-',
    bs: 'bs',
    bss: 'bss',
    bbs: 'bbs',
    ashs: 'ashs',
    afhf: 'afhf',
    o: 'o',
    k: 'k'
  };

  return map[normalized] ?? undefined;
}

/** Map supported quarter-tone `pitch.alter` values into accidental symbols. */
function mapFractionalPitchAlterToAccidental(alter: number | undefined): string | undefined {
  if (!Number.isFinite(alter)) {
    return undefined;
  }

  const roundedToHalf = Math.round((alter ?? 0) * 2) / 2;
  if (Math.abs((alter ?? 0) - roundedToHalf) > 0.001) {
    return undefined;
  }

  switch (roundedToHalf) {
    case 0.5:
      return '+';
    case -0.5:
      return 'd';
    case 1.5:
      return '++';
    case -1.5:
      return 'db';
    default:
      return undefined;
  }
}

/** True when pitch alter is fractional but not currently supported by the mapper. */
function hasUnsupportedFractionalAlter(alter: number | undefined): boolean {
  if (!Number.isFinite(alter)) {
    return false;
  }

  const roundedToHalf = Math.round((alter ?? 0) * 2) / 2;
  const isFractional = Math.abs(roundedToHalf % 1) > 0.001;
  if (!isFractional) {
    return false;
  }

  return mapFractionalPitchAlterToAccidental(alter) === undefined;
}

/** VexFlow-ready articulation mapping payload for one parsed note token set. */
interface ArticulationMapping {
  codes: string[];
  ornamentCodes: string[];
  fingerings: string[];
  textAnnotations: string[];
}

/** Map normalized articulation tokens into VexFlow articulation glyph IDs. */
function mapArticulations(noteData: NoteData, diagnostics: Diagnostic[]): ArticulationMapping {
  if (!noteData.articulations || noteData.articulations.length === 0) {
    return {
      codes: [],
      ornamentCodes: [],
      fingerings: [],
      textAnnotations: []
    };
  }

  const map: Record<string, string> = {
    staccato: 'a.',
    tenuto: 'a-',
    accent: 'a>',
    staccatissimo: 'av',
    marcato: 'a^',
    'strong-accent': 'a^',
    'detached-legato': 'a-',
    spiccato: 'av',
    stress: 'a>',
    unstress: 'a-',
    'soft-accent': 'a>',
    'up-bow': 'a|',
    'down-bow': 'am',
    'snap-pizzicato': 'ao',
    'open-string': 'ah',
    harmonic: 'ah',
    stopped: 'a+',
    fermata: 'a@a',
    'fermata-inverted': 'a@u',
    'fermata-angled': 'a@s',
    'fermata-square': 'a@l'
  };

  const codes: string[] = [];
  const ornamentCodes: string[] = [];
  const fingerings: string[] = [];
  const textAnnotations: string[] = [];

  for (const articulation of noteData.articulations) {
    const token = articulation.type;
    if (token.startsWith('fingering:')) {
      const value = token.slice('fingering:'.length).trim();
      if (value.length > 0) {
        fingerings.push(value);
      }
      continue;
    }

    if (token.startsWith('pluck:')) {
      const value = token.slice('pluck:'.length).trim();
      if (value.length > 0) {
        textAnnotations.push(value);
      }
      continue;
    }

    if (token.startsWith('fret:')) {
      const value = token.slice('fret:'.length).trim();
      if (value.length > 0) {
        textAnnotations.push(value);
      }
      continue;
    }

    if (token.startsWith('string:')) {
      const value = token.slice('string:'.length).trim();
      if (value.length > 0) {
        textAnnotations.push(`str.${value}`);
      }
      continue;
    }

    if (token.startsWith('tap:')) {
      const value = token.slice('tap:'.length).trim();
      if (value.length > 0) {
        textAnnotations.push(value);
      }
      continue;
    }

    if (token === 'bend') {
      ornamentCodes.push('bend');
      continue;
    }
    if (token === 'hammer-on') {
      textAnnotations.push('H');
      continue;
    }
    if (token === 'pull-off') {
      textAnnotations.push('P');
      continue;
    }
    if (token === 'heel') {
      textAnnotations.push('heel');
      continue;
    }
    if (token === 'toe') {
      textAnnotations.push('toe');
      continue;
    }
    if (token === 'thumb-position') {
      textAnnotations.push('T.P.');
      continue;
    }
    if (token === 'double-tongue') {
      textAnnotations.push('d.t.');
      continue;
    }
    if (token === 'triple-tongue') {
      textAnnotations.push('t.t.');
      continue;
    }
    if (token === 'tap') {
      textAnnotations.push('tap');
      continue;
    }
    if (token === 'fingernails') {
      textAnnotations.push('nails');
      continue;
    }

    if (token === 'scoop') {
      ornamentCodes.push('scoop');
      continue;
    }
    if (token === 'plop') {
      ornamentCodes.push('doitLong');
      continue;
    }
    if (token === 'doit') {
      ornamentCodes.push('doit');
      continue;
    }
    if (token === 'falloff') {
      ornamentCodes.push('fall');
      continue;
    }
    if (token === 'breath-mark') {
      textAnnotations.push(',');
      continue;
    }
    if (token === 'caesura') {
      textAnnotations.push('//');
      continue;
    }

    const code = map[token];
    if (code) {
      codes.push(code);
      continue;
    }

    diagnostics.push({
      code: 'UNSUPPORTED_ARTICULATION',
      severity: 'warning',
      message: `Unsupported articulation '${token}' is not rendered.`
    });
  }

  return {
    codes,
    ornamentCodes,
    fingerings,
    textAnnotations
  };
}

/** VexFlow-ready ornament/stroke payload for one parsed note token set. */
interface OrnamentMapping {
  ornamentCodes: string[];
  strokeTypes: number[];
  vibrato: boolean;
  tremoloSlashCounts: number[];
  textAnnotations: string[];
}

/** Map normalized ornament tokens into VexFlow ornament IDs and related modifiers. */
function mapOrnaments(noteData: NoteData, diagnostics: Diagnostic[]): OrnamentMapping {
  if (!noteData.ornaments || noteData.ornaments.length === 0) {
    return {
      ornamentCodes: [],
      strokeTypes: [],
      vibrato: false,
      tremoloSlashCounts: [],
      textAnnotations: []
    };
  }

  const map: Record<string, string> = {
    'trill-mark': 'tr',
    turn: 'turn',
    'delayed-turn': 'turn',
    'vertical-turn': 'turn',
    'inverted-turn': 'turn_inverted',
    'delayed-inverted-turn': 'turn_inverted',
    'inverted-vertical-turn': 'turn_inverted',
    mordent: 'mordent',
    'inverted-mordent': 'mordent_inverted',
    schleifer: 'upprall',
    shake: 'tr',
    scoop: 'scoop',
    plop: 'doitLong',
    doit: 'doit',
    falloff: 'fall',
    haydn: 'turn'
  };

  const ornamentCodes: string[] = [];
  const strokeTypes: number[] = [];
  const tremoloSlashCounts: number[] = [];
  const textAnnotations: string[] = [];
  let vibrato = false;
  for (const ornament of noteData.ornaments) {
    if (ornament.type === 'arpeggiate') {
      strokeTypes.push(Stroke.Type.ARPEGGIO_DIRECTIONLESS);
      continue;
    }
    if (ornament.type === 'arpeggiate-up') {
      strokeTypes.push(Stroke.Type.ROLL_UP);
      continue;
    }
    if (ornament.type === 'arpeggiate-down') {
      strokeTypes.push(Stroke.Type.ROLL_DOWN);
      continue;
    }
    if (ornament.type.startsWith('wavy-line')) {
      vibrato = true;
      continue;
    }
    if (ornament.type.startsWith('accidental-mark:')) {
      const accidentalToken = ornament.type.slice('accidental-mark:'.length).trim().toLowerCase();
      const accidentalText = mapAccidentalMarkText(accidentalToken);
      if (accidentalText) {
        textAnnotations.push(accidentalText);
      }
      continue;
    }
    if (ornament.type === 'accidental-mark') {
      textAnnotations.push('acc');
      continue;
    }
    if (ornament.type.startsWith('tremolo:')) {
      const rawMarks = Number.parseInt(ornament.type.slice('tremolo:'.length), 10);
      if (Number.isFinite(rawMarks)) {
        tremoloSlashCounts.push(clampTremoloSlashCount(rawMarks));
      } else {
        tremoloSlashCounts.push(3);
      }
      continue;
    }
    if (ornament.type === 'tremolo') {
      tremoloSlashCounts.push(3);
      continue;
    }
    if (ornament.type.startsWith('non-arpeggiate')) {
      diagnostics.push({
        code: 'NON_ARPEGGIATE_UNSUPPORTED',
        severity: 'warning',
        message: 'non-arpeggiate is parsed but currently has no direct VexFlow glyph mapping.'
      });
      continue;
    }

    const code = map[ornament.type];
    if (code) {
      ornamentCodes.push(code);
      continue;
    }

    diagnostics.push({
      code: 'UNSUPPORTED_ORNAMENT',
      severity: 'warning',
      message: `Unsupported ornament '${ornament.type}' is not rendered.`
    });
  }

  return {
    ornamentCodes,
    strokeTypes,
    vibrato,
    tremoloSlashCounts,
    textAnnotations
  };
}

/** Clamp tremolo slash counts to VexFlow-compatible range. */
function clampTremoloSlashCount(value: number): number {
  return Math.min(4, Math.max(1, value));
}

/** Map MusicXML accidental-mark tokens into compact textual glyph surrogates. */
function mapAccidentalMarkText(token: string): string | undefined {
  const map: Record<string, string> = {
    sharp: '#',
    flat: 'b',
    natural: 'n',
    'double-sharp': 'x',
    'flat-flat': 'bb',
    'quarter-sharp': '+',
    'quarter-flat': 'd'
  };
  return map[token];
}

/**
 * Convert canonical tick durations into the small M2 duration vocabulary.
 * Unknown values degrade to quarter notes with a warning diagnostic.
 */
function mapDuration(
  event: TimedEvent,
  ticksPerQuarter: number,
  diagnostics: Diagnostic[]
): { duration: string; dots: number } | undefined {
  if (event.kind === 'note') {
    const fromType = mapDurationFromType(event.noteType, event.dotCount);
    if (fromType) {
      return fromType;
    }

    // When a note explicitly declares an unsupported `<type>`, dropping the
    // event is safer than coercing to a quarter note: fallback coercion can
    // create misleading spacing and stem/flag artifacts in dense rhythm tests.
    if (event.noteType) {
      diagnostics.push({
        code: 'UNSUPPORTED_DURATION_TYPE_SKIPPED',
        severity: 'warning',
        message: `Unsupported note type '${event.noteType}' was skipped.`
      });
      return undefined;
    }

    if (event.grace) {
      // Grace notes often omit `<duration>` in MusicXML. Use a stable visual default.
      return { duration: '8', dots: event.dotCount ?? 0 };
    }
  }

  const durationTicks = event.durationTicks;
  if (durationTicks <= 0) {
    diagnostics.push({
      code: 'NON_POSITIVE_DURATION',
      severity: 'warning',
      message: 'Skipping event with non-positive duration.'
    });
    return undefined;
  }

  const ratio = durationTicks / ticksPerQuarter;
  const approx = (target: number) => Math.abs(ratio - target) < 0.0001;

  if (approx(4)) return { duration: 'w', dots: 0 };
  if (approx(3)) return { duration: 'h', dots: 1 };
  if (approx(2)) return { duration: 'h', dots: 0 };
  if (approx(1.5)) return { duration: 'q', dots: 1 };
  if (approx(1)) return { duration: 'q', dots: 0 };
  if (approx(0.75)) return { duration: '8', dots: 1 };
  if (approx(0.5)) return { duration: '8', dots: 0 };
  if (approx(0.25)) return { duration: '16', dots: 0 };
  if (approx(0.125)) return { duration: '32', dots: 0 };
  if (approx(0.0625)) return { duration: '64', dots: 0 };
  if (approx(0.03125)) return { duration: '128', dots: 0 };
  if (approx(0.015625)) return { duration: '256', dots: 0 };

  diagnostics.push({
    code: 'UNSUPPORTED_DURATION_SKIPPED',
    severity: 'warning',
    message: `Unsupported duration ratio ${ratio.toFixed(4)} quarter notes. Event was skipped.`
  });
  return undefined;
}

/** Map MusicXML `<type>` + `<dot/>` values into VexFlow duration tokens. */
function mapDurationFromType(noteType: string | undefined, dotCount: number | undefined): { duration: string; dots: number } | undefined {
  if (!noteType) {
    return undefined;
  }

  const map: Record<string, string> = {
    // VexFlow supports breve (`1/2`) but not longa (`1/4`).
    // We currently approximate longa with breve so rhythm planning remains
    // deterministic until a true longa representation is introduced.
    longa: '1/2',
    long: '1/2',
    breve: '1/2',
    whole: 'w',
    half: 'h',
    quarter: 'q',
    eighth: '8',
    '16th': '16',
    '32nd': '32',
    '64th': '64',
    '128th': '128',
    '256th': '256'
  };

  const duration = map[noteType.toLowerCase()];
  if (!duration) {
    return undefined;
  }

  return {
    duration,
    dots: Math.max(0, dotCount ?? 0)
  };
}

/** Map MusicXML clef descriptors into VexFlow clef IDs. */
export function mapClef(clef: ClefInfo | undefined, diagnostics: Diagnostic[]): string {
  if (!clef) {
    return 'treble';
  }

  const sign = clef.sign.toUpperCase();
  const line = clef.line;

  if (sign === 'G' && line === 2) return 'treble';
  if (sign === 'F' && line === 4) return 'bass';
  if (sign === 'C' && line === 3) return 'alto';
  if (sign === 'C' && line === 4) return 'tenor';
  if (sign === 'PERCUSSION') return 'percussion';

  diagnostics.push({
    code: 'UNSUPPORTED_CLEF',
    severity: 'warning',
    message: `Unsupported clef '${clef.sign}' on line '${clef.line ?? 'unknown'}'. Falling back to treble.`
  });

  return 'treble';
}

/** Serialize the time signature for VexFlow stave headers. */
export function mapTimeSignature(timeSignature: TimeSignatureInfo | undefined): string | undefined {
  if (!timeSignature) {
    return undefined;
  }

  if (timeSignature.symbol === 'common') {
    return 'C';
  }

  if (timeSignature.symbol === 'cut') {
    return 'C|';
  }

  return `${timeSignature.beats}/${timeSignature.beatType}`;
}

/** Return a safe voice time signature fallback for measure formatting. */
export function parseTime(timeSignature: TimeSignatureInfo | undefined): [number, number] {
  if (!timeSignature || timeSignature.beats <= 0 || timeSignature.beatType <= 0) {
    return [4, 4];
  }

  return [timeSignature.beats, timeSignature.beatType];
}

/** Map key signature fifth counts into VexFlow key names. */
export function mapKeySignature(keySignature: KeySignatureInfo | undefined): string | undefined {
  if (!keySignature) {
    return undefined;
  }

  const map: Record<number, string> = {
    [-7]: 'Cb',
    [-6]: 'Gb',
    [-5]: 'Db',
    [-4]: 'Ab',
    [-3]: 'Eb',
    [-2]: 'Bb',
    [-1]: 'F',
    0: 'C',
    1: 'G',
    2: 'D',
    3: 'A',
    4: 'E',
    5: 'B',
    6: 'F#',
    7: 'C#'
  };

  return map[keySignature.fifths] ?? undefined;
}
