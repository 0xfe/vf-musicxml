import { Accidental, Dot, StaveNote, type StaveNoteStruct } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type {
  ClefInfo,
  KeySignatureInfo,
  Measure,
  NoteData,
  NoteEvent,
  TimeSignatureInfo,
  TimedEvent
} from '../core/score.js';

/** Build renderable notes for the first measure voice (M2 baseline behavior). */
export function buildMeasureNotes(
  measure: Measure,
  ticksPerQuarter: number,
  clef: string,
  diagnostics: Diagnostic[]
): StaveNote[] {
  if (measure.voices.length === 0) {
    return [];
  }

  if (measure.voices.length > 1) {
    diagnostics.push({
      code: 'MULTI_VOICE_NOT_SUPPORTED_IN_M2',
      severity: 'warning',
      message: `Measure ${measure.index + 1} has multiple voices. Rendering only voice ${measure.voices[0]?.id ?? '1'}.`
    });
  }

  const voice = measure.voices[0];
  if (!voice) {
    return [];
  }

  return voice.events
    .map((event) => toStaveNote(event, ticksPerQuarter, clef, diagnostics))
    .filter((note): note is StaveNote => note !== undefined);
}

/** Map one timed event into a VexFlow `StaveNote` when supported. */
function toStaveNote(
  event: TimedEvent,
  ticksPerQuarter: number,
  clef: string,
  diagnostics: Diagnostic[]
): StaveNote | undefined {
  const duration = mapDuration(event.durationTicks, ticksPerQuarter, diagnostics);
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
    duration
  };

  const note = new StaveNote(staveNoteData);

  event.notes.forEach((noteData, index) => {
    const accidental = mapAccidental(noteData);
    if (accidental) {
      note.addModifier(new Accidental(accidental), index);
    }
  });

  for (let index = 0; index < dots; index += 1) {
    Dot.buildAndAttach([note], { all: true });
  }

  return note;
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

/**
 * Convert canonical tick durations into the small M2 duration vocabulary.
 * Unknown values degrade to quarter notes with a warning diagnostic.
 */
function mapDuration(
  durationTicks: number,
  ticksPerQuarter: number,
  diagnostics: Diagnostic[]
): { duration: string; dots: number } | undefined {
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
