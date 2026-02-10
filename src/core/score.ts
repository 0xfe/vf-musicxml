/** Canonical score root produced by parser and consumed by renderers. */
export interface Score {
  id: string;
  source?: { name?: string; format: 'musicxml' | 'mxl' };
  ticksPerQuarter: number;
  partList: PartDefinition[];
  parts: Part[];
  spanners: SpannerRelation[];
  defaults?: ScoreDefaults;
  metadata?: ScoreMetadata;
}

/** Subset of `<defaults>` values needed by current layout decisions. */
export interface ScoreDefaults {
  scalingMillimeters?: number;
  scalingTenths?: number;
}

/** Small metadata surface preserved from header elements. */
export interface ScoreMetadata {
  workTitle?: string;
  movementTitle?: string;
}

/** Normalized part identity from `<part-list>`. */
export interface PartDefinition {
  id: string;
  name?: string;
  abbreviation?: string;
  midi?: MidiProgramInfo;
  groupPath?: string[];
}

/** MIDI program data attached to a part definition. */
export interface MidiProgramInfo {
  channel?: number;
  program?: number;
  unpitched?: number;
}

/** Renderable part payload in timeline order. */
export interface Part {
  id: string;
  measures: Measure[];
}

/** Measure model with resolved attributes and per-voice event streams. */
export interface Measure {
  index: number;
  numberLabel?: string;
  effectiveAttributes: EffectiveAttributes;
  attributeChanges: AttributeEvent[];
  voices: VoiceTimeline[];
  directions: DirectionEvent[];
  harmonies?: HarmonyEvent[];
  barlines?: BarlineInfo[];
  barline?: BarlineInfo;
}

/** Mid-measure attribute mutation captured at a tick offset. */
export interface AttributeEvent {
  offsetTicks: number;
  attributes: Partial<EffectiveAttributes>;
}

/** Effective attribute state at measure start. */
export interface EffectiveAttributes {
  staves: number;
  clefs: ClefInfo[];
  keySignature?: KeySignatureInfo;
  timeSignature?: TimeSignatureInfo;
  divisions?: number;
}

/** Clef assignment to a specific staff. */
export interface ClefInfo {
  staff: number;
  sign: string;
  line?: number;
}

/** Key signature based on MusicXML fifths convention. */
export interface KeySignatureInfo {
  fifths: number;
  mode?: string;
}

/** Time signature represented as numerator/denominator. */
export interface TimeSignatureInfo {
  beats: number;
  beatType: number;
}

/** Direction anchor currently used for words and tempo markings. */
export interface DirectionEvent {
  offsetTicks: number;
  words?: string;
  tempo?: number;
  dynamics?: string[];
  wedge?: WedgeEvent;
}

/** Direction-level wedge token parsed from `<direction-type><wedge>`. */
export interface WedgeEvent {
  type: 'crescendo' | 'diminuendo' | 'stop';
  number?: string;
  spread?: number;
}

/** Measure-level harmony symbol anchored at a measure-relative tick offset. */
export interface HarmonyEvent {
  offsetTicks: number;
  rootStep?: string;
  rootAlter?: number;
  kind?: string;
  text?: string;
  staff?: number;
}

/** Barline metadata captured from `<barline>`. */
export interface BarlineInfo {
  location?: 'left' | 'right' | 'middle';
  style?: string;
  repeats?: BarlineRepeatInfo[];
  endings?: BarlineEndingInfo[];
}

/** Repeat marker parsed from `<barline><repeat direction="...">`. */
export interface BarlineRepeatInfo {
  location: 'left' | 'right' | 'middle';
  direction: 'forward' | 'backward';
}

/** Volta/ending marker parsed from `<barline><ending ...>`. */
export interface BarlineEndingInfo {
  location: 'left' | 'right' | 'middle';
  type: 'start' | 'stop' | 'discontinue' | 'continue';
  number?: string;
  text?: string;
}

/** Ordered event stream for one voice inside one measure. */
export interface VoiceTimeline {
  id: string;
  events: TimedEvent[];
}

/** Renderable event union for baseline parser and renderer stages. */
export type TimedEvent = NoteEvent | RestEvent | TupletEvent;

/** Shared timing fields for events expressed in global score ticks. */
export interface Timed {
  offsetTicks: number;
  durationTicks: number;
}

/** Note or chord event; chords are represented by `notes.length > 1`. */
export interface NoteEvent extends Timed {
  kind: 'note';
  voice: string;
  staff?: number;
  cue?: boolean;
  grace?: boolean;
  graceSlash?: boolean;
  noteType?: string;
  dotCount?: number;
  timeModification?: TupletTimeModification;
  tuplets?: TupletEndpoint[];
  notes: NoteData[];
}

/** Per-note details preserved inside a `NoteEvent`. */
export interface NoteData {
  pitch?: Pitch;
  unpitched?: Unpitched;
  accidental?: AccidentalInfo;
  notehead?: NoteheadInfo;
  ties?: TieEndpoint[];
  slurs?: SlurEndpoint[];
  articulations?: ArticulationInfo[];
  ornaments?: OrnamentInfo[];
  lyrics?: LyricInfo[];
  notationRefs?: string[];
}

/** Fully pitched note description. */
export interface Pitch {
  step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  alter?: number;
  octave: number;
}

/** Unpitched notation fallback using display hints. */
export interface Unpitched {
  displayStep?: string;
  displayOctave?: number;
}

/** Accidental token as reported by MusicXML. */
export interface AccidentalInfo {
  value: string;
}

/** Notehead token as reported by MusicXML. */
export interface NoteheadInfo {
  value: string;
}

/** Tie endpoint relationship attached to a note entry. */
export interface TieEndpoint {
  type: 'start' | 'stop';
}

/** Articulation token attached to a note entry. */
export interface ArticulationInfo {
  type: string;
}

/** Ornament token attached to a note entry. */
export interface OrnamentInfo {
  type: string;
}

/** Slur endpoint relation attached to a note entry. */
export interface SlurEndpoint {
  type: 'start' | 'stop';
  number?: string;
  placement?: string;
  lineType?: string;
}

/** Lyric token attached to a note entry. */
export interface LyricInfo {
  number?: string;
  syllabic?: string;
  text?: string;
  extend?: boolean;
}

/** Tuplet endpoint relation attached to a note event. */
export interface TupletEndpoint {
  type: 'start' | 'stop';
  number?: string;
  bracket?: boolean;
  showNumber?: string;
  placement?: string;
}

/** Tuplet ratio data parsed from `<time-modification>`. */
export interface TupletTimeModification {
  actualNotes: number;
  normalNotes: number;
  normalType?: string;
  actualType?: string;
}

/** Rest event with optional display positioning metadata. */
export interface RestEvent extends Timed {
  kind: 'rest';
  voice: string;
  staff?: number;
  display?: RestDisplayInfo;
}

/** Display hints for positioned rests. */
export interface RestDisplayInfo {
  step?: string;
  octave?: number;
}

/** Tuplet marker event preserved for later milestone support. */
export interface TupletEvent extends Timed {
  kind: 'tuplet';
  tupletId: string;
  role: 'start' | 'stop';
}

/** Cross-event relation table used for ties, slurs, wedges, and future spanners. */
export interface SpannerRelation {
  id: string;
  type: 'tie' | 'slur' | 'wedge';
  start: EventRef;
  end?: EventRef;
  data?: Record<string, unknown>;
}

/** Stable pointer into the score event graph. */
export interface EventRef {
  partId: string;
  measureIndex: number;
  voiceId: string;
  eventIndex: number;
  noteIndex?: number;
}
