import { Accidental, Stroke } from 'vexflow';

import type { Diagnostic } from '../core/diagnostics.js';
import type { NoteData, TimedEvent } from '../core/score.js';

/** VexFlow-ready articulation mapping payload for one parsed note token set. */
export interface ArticulationMapping {
  codes: string[];
  ornamentCodes: string[];
  fingerings: string[];
  textAnnotations: string[];
}

/** VexFlow-ready ornament/stroke payload for one parsed note token set. */
export interface OrnamentMapping {
  ornamentCodes: string[];
  strokeTypes: number[];
  vibrato: boolean;
  tremoloSlashCounts: number[];
  textAnnotations: string[];
}

/** Convert a note payload to a VexFlow key string (`c/4`, `f#/5`, etc). */
export function noteDataToKey(noteData: NoteData, diagnostics: Diagnostic[]): string | undefined {
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
export function createAccidentalModifier(
  noteData: NoteData,
  diagnostics: Diagnostic[]
): Accidental | undefined {
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

/** Map normalized articulation tokens into VexFlow articulation glyph IDs. */
export function mapArticulations(noteData: NoteData, diagnostics: Diagnostic[]): ArticulationMapping {
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

/** Map normalized ornament tokens into VexFlow ornament IDs and related modifiers. */
export function mapOrnaments(noteData: NoteData, diagnostics: Diagnostic[]): OrnamentMapping {
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
        code: 'NON_ARPEGGIATE_FALLBACK_RENDERED',
        severity: 'info',
        message:
          'Rendered non-arpeggiate using a bracket fallback because VexFlow does not expose a dedicated non-arpeggiate glyph primitive.'
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

/**
 * Convert canonical tick durations into the small M2 duration vocabulary.
 * Unknown values are skipped with warning diagnostics to avoid misleading
 * spacing artifacts in dense rhythm fixtures.
 */
export function mapDuration(
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

/** Convert MusicXML note-type and dot count into a VexFlow duration token. */
export function mapDurationFromType(
  noteType: string | undefined,
  dotCount: number | undefined
): { duration: string; dots: number } | undefined {
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
