import { describe, expect, it } from 'vitest';

import type { Diagnostic } from '../../src/core/diagnostics.js';
import type { TimeSignatureInfo } from '../../src/core/score.js';
import { parseMusicXML } from '../../src/public/index.js';
import {
  buildMeasureNotes,
  mapClef,
  mapTimeSignature,
  parseVoiceEventKey
} from '../../src/vexflow/render-note-mapper.js';

describe('render note mapper', () => {
  it('attaches supported articulation tokens without unsupported warnings', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <notations><articulations><staccato/></articulations></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <notations><articulations><detached-legato/></articulations></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);
    expect(noteResult.notes).toHaveLength(2);

    // Articulation modifiers are attached at note build time for supported tokens.
    const firstModifiers = noteResult.notes[0]?.getModifiersByType('Articulation') ?? [];
    const secondModifiers = noteResult.notes[1]?.getModifiersByType('Articulation') ?? [];
    expect(firstModifiers.length).toBe(1);
    expect(secondModifiers.length).toBe(1);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ARTICULATION')).toBe(false);
  });

  it('maps category-32 ornaments and technical markings to dedicated VexFlow modifiers', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <notations>
          <articulations><staccato/></articulations>
          <technical><fingering>2</fingering><pluck>p</pluck></technical>
          <fermata type="inverted"/>
        </notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <notations>
          <ornaments>
            <trill-mark/>
            <wavy-line type="start"/>
          </ornaments>
          <arpeggiate direction="up"/>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);
    expect(noteResult.notes).toHaveLength(2);

    const firstArticulations = noteResult.notes[0]?.getModifiersByType('Articulation') ?? [];
    const firstFingerings = noteResult.notes[0]?.getModifiersByType('FretHandFinger') ?? [];
    const firstAnnotations = noteResult.notes[0]?.getModifiersByType('Annotation') ?? [];
    const secondOrnaments = noteResult.notes[1]?.getModifiersByType('Ornament') ?? [];
    const secondVibratos = noteResult.notes[1]?.getModifiersByType('Vibrato') ?? [];
    const secondStrokes = noteResult.notes[1]?.getModifiersByType('Stroke') ?? [];

    expect(firstArticulations.length).toBeGreaterThanOrEqual(1);
    expect(firstFingerings.length).toBe(1);
    expect(firstAnnotations.length).toBe(1);
    expect(secondOrnaments.length).toBeGreaterThanOrEqual(1);
    expect(secondVibratos.length).toBe(1);
    expect(secondStrokes.length).toBe(1);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ARTICULATION')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ORNAMENT')).toBe(false);
  });

  it('records non-arpeggiate fallback diagnostics during note mapping', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><non-arpeggiate type="bottom"/></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><non-arpeggiate type="top"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);

    expect(noteResult.notes).toHaveLength(1);
    const strokes = noteResult.notes[0]?.getModifiersByType('Stroke') ?? [];
    expect(strokes.length).toBe(0);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'NON_ARPEGGIATE_UNSUPPORTED')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'NON_ARPEGGIATE_FALLBACK_RENDERED')).toBe(true);
  });

  it('routes note events by staff number for multi-staff measures', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>2</voice>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const treble = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const bass = mapClef(measure?.effectiveAttributes.clefs[1], []);
    const upper = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, treble, diagnostics, 1);
    const lower = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, bass, diagnostics, 2);

    expect(upper.notes).toHaveLength(1);
    expect(lower.notes).toHaveLength(1);
    expect(upper.noteByEventKey.has('1:0')).toBe(true);
    expect(lower.noteByEventKey.has('2:0')).toBe(true);
  });

  it('attaches grace/ornament modifiers and emits tuplet payloads for M6 baseline', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Advanced</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <grace slash="yes"/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <voice>1</voice>
        <type>eighth</type>
      </note>
      <note>
        <cue/>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations>
          <ornaments><trill-mark/></ornaments>
          <tuplet type="start" number="1" show-number="both"/>
        </notations>
      </note>
      <note>
        <pitch><step>F</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="stop" number="1"/></notations>
      </note>
      <note><rest/><duration>18</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);

    expect(noteResult.notes).toHaveLength(4);
    expect(noteResult.tuplets).toHaveLength(1);
    expect(noteResult.tuplets[0]?.numNotes).toBe(3);
    expect(noteResult.tuplets[0]?.notesOccupied).toBe(2);

    const firstModifiers = noteResult.notes[0]?.getModifiersByType('GraceNoteGroup') ?? [];
    const firstOrnaments = noteResult.notes[0]?.getModifiersByType('Ornament') ?? [];
    expect(firstModifiers.length).toBe(1);
    expect(firstOrnaments.length).toBe(1);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'CUE_NOTE_RENDERED')).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'NON_POSITIVE_DURATION')).toBe(false);
  });

  it('maps common and cut time symbols to VexFlow glyph tokens', () => {
    const common: TimeSignatureInfo = { beats: 4, beatType: 4, symbol: 'common' };
    const cut: TimeSignatureInfo = { beats: 2, beatType: 2, symbol: 'cut' };
    const numeric: TimeSignatureInfo = { beats: 3, beatType: 8 };

    expect(mapTimeSignature(common)).toBe('C');
    expect(mapTimeSignature(cut)).toBe('C|');
    expect(mapTimeSignature(numeric)).toBe('3/8');
  });

  it('respects explicit MusicXML stem directions for rendered notes', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>up</stem>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>down</stem>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);

    expect(noteResult.notes).toHaveLength(2);
    expect(noteResult.notes[0]?.getStemDirection()).toBe(1);
    expect(noteResult.notes[1]?.getStemDirection()).toBe(-1);
  });

  it('renders parenthesized and microtonal accidentals from MusicXML accidental tokens', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <accidental cautionary="yes" parentheses="yes">quarter-flat</accidental>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <accidental>three-quarters-sharp</accidental>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);

    const firstAccidental = noteResult.notes[0]?.getModifiersByType('Accidental')[0] as
      | { type?: string; cautionary?: boolean }
      | undefined;
    const secondAccidental = noteResult.notes[1]?.getModifiersByType('Accidental')[0] as
      | { type?: string; cautionary?: boolean }
      | undefined;

    expect(firstAccidental?.type).toBe('d');
    expect(firstAccidental?.cautionary).toBe(true);
    expect(secondAccidental?.type).toBe('++');
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ACCIDENTAL')).toBe(false);
  });

  it('skips unsupported explicit duration types instead of coercing quarter-note fallbacks', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Rhythm</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1024</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1024</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>1024th</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>128</duration>
        <voice>1</voice>
        <type>32nd</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);

    // Quarter + 32nd remain; the explicit 1024th note is skipped.
    expect(noteResult.notes).toHaveLength(2);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_DURATION_TYPE_SKIPPED')).toBe(true);
  });

  it('renders fractional pitch alters as microtonal accidentals when explicit accidental tags are absent', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><alter>0.5</alter><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>D</step><alter>-0.5</alter><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>E</step><alter>1.5</alter><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note>
        <pitch><step>F</step><alter>-1.5</alter><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const measure = parsed.score?.parts[0]?.measures[0];
    expect(measure).toBeDefined();

    const diagnostics: Diagnostic[] = [];
    const clef = mapClef(measure?.effectiveAttributes.clefs[0], []);
    const noteResult = buildMeasureNotes(measure!, parsed.score!.ticksPerQuarter, clef, diagnostics);

    const accidentalTypes = noteResult.notes.map((note) => {
      const accidental = note?.getModifiersByType('Accidental')[0] as { type?: string } | undefined;
      return accidental?.type;
    });

    expect(accidentalTypes).toEqual(['+', 'd', '++', 'db']);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_MICROTONAL_ALTER')).toBe(false);
  });

  it('parses voice-event map keys for downstream render passes', () => {
    expect(parseVoiceEventKey('1:0')).toEqual({ voiceId: '1', eventIndex: 0 });
    expect(parseVoiceEventKey('voice:alpha:9')).toEqual({ voiceId: 'voice:alpha', eventIndex: 9 });
    expect(parseVoiceEventKey('voice-only')).toBeUndefined();
    expect(parseVoiceEventKey('voice:bad')).toBeUndefined();
  });
});
