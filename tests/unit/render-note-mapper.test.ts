import { describe, expect, it } from 'vitest';

import type { Diagnostic } from '../../src/core/diagnostics.js';
import { parseMusicXML } from '../../src/public/index.js';
import { buildMeasureNotes, mapClef } from '../../src/vexflow/render-note-mapper.js';

describe('render note mapper', () => {
  it('attaches supported articulations and warns for unsupported articulation tokens', () => {
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
    expect(secondModifiers.length).toBe(0);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ARTICULATION')).toBe(true);
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
});
