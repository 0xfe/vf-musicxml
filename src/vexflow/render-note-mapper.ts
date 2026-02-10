import {
  Accidental,
  Articulation,
  Dot,
  GraceNote,
  GraceNoteGroup,
  Ornament,
  StaveNote,
  Tuplet,
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
    glyph_font_scale: event.cue ? 30 : undefined
  };

  const note = new StaveNote(staveNoteData);

  event.notes.forEach((noteData, index) => {
    const accidental = mapAccidental(noteData);
    if (accidental) {
      note.addModifier(new Accidental(accidental), index);
    }

    const articulationCode = mapArticulation(noteData, diagnostics);
    if (articulationCode) {
      note.addModifier(new Articulation(articulationCode), index);
    }

    for (const ornamentCode of mapOrnaments(noteData, diagnostics)) {
      note.addModifier(new Ornament(ornamentCode), index);
    }
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

/** Build stable map keys for one rendered voice event. */
export function buildVoiceEventKey(voiceId: string, eventIndex: number): string {
  return `${voiceId}:${eventIndex}`;
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
  graceGroup.beamNotes();
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
    const accidental = mapAccidental(noteData);
    if (accidental) {
      grace.addModifier(new Accidental(accidental), index);
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

/** Map MusicXML accidental tokens into VexFlow accidental symbols. */
function mapAccidental(noteData: NoteData): string | undefined {
  const value = noteData.accidental?.value;
  if (!value) {
    return undefined;
  }

  const map: Record<string, string> = {
    sharp: '#',
    flat: 'b',
    natural: 'n',
    'double-sharp': '##',
    'double-flat': 'bb',
    '#': '#',
    b: 'b',
    n: 'n',
    '##': '##',
    bb: 'bb'
  };

  return map[value] ?? undefined;
}

/** Map normalized articulation tokens into VexFlow articulation glyph IDs. */
function mapArticulation(noteData: NoteData, diagnostics: Diagnostic[]): string | undefined {
  const first = noteData.articulations?.[0]?.type;
  if (!first) {
    return undefined;
  }

  const map: Record<string, string> = {
    staccato: 'a.',
    tenuto: 'a-',
    accent: 'a>',
    staccatissimo: 'av',
    marcato: 'a^'
  };

  const code = map[first];
  if (code) {
    return code;
  }

  diagnostics.push({
    code: 'UNSUPPORTED_ARTICULATION',
    severity: 'warning',
    message: `Unsupported articulation '${first}' is not rendered.`
  });
  return undefined;
}

/** Map normalized ornament tokens into VexFlow ornament IDs. */
function mapOrnaments(noteData: NoteData, diagnostics: Diagnostic[]): string[] {
  if (!noteData.ornaments || noteData.ornaments.length === 0) {
    return [];
  }

  const map: Record<string, string> = {
    'trill-mark': 'tr',
    turn: 'turn',
    'inverted-turn': 'turn_inverted',
    mordent: 'mordent',
    'inverted-mordent': 'mordent_inverted',
    schleifer: 'upprall'
  };

  const ornamentCodes: string[] = [];
  for (const ornament of noteData.ornaments) {
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

  return ornamentCodes;
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

  diagnostics.push({
    code: 'UNSUPPORTED_DURATION',
    severity: 'warning',
    message: `Unsupported duration ratio ${ratio.toFixed(4)} quarter notes. Using quarter note fallback.`
  });
  return { duration: 'q', dots: 0 };
}

/** Map MusicXML `<type>` + `<dot/>` values into VexFlow duration tokens. */
function mapDurationFromType(noteType: string | undefined, dotCount: number | undefined): { duration: string; dots: number } | undefined {
  if (!noteType) {
    return undefined;
  }

  const map: Record<string, string> = {
    longa: 'w',
    breve: 'w',
    whole: 'w',
    half: 'h',
    quarter: 'q',
    eighth: '8',
    '16th': '16',
    '32nd': '32',
    '64th': '64'
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
