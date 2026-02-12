import {
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
  NoteEvent,
  TupletTimeModification,
  TimeSignatureInfo,
  TimedEvent
} from '../core/score.js';
import {
  createAccidentalModifier,
  mapArticulations,
  mapDuration,
  mapDurationFromType,
  mapOrnaments,
  noteDataToKey,
  type ArticulationMapping,
  type OrnamentMapping
} from './render-note-mapper-mappings.js';

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
