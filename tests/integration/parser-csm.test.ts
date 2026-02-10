import { describe, expect, it } from 'vitest';

import { parseMusicXML } from '../../src/public/index.js';

describe('parser CSM transformation', () => {
  it('normalizes score-timewise measures into per-part measure timelines', () => {
    const xml = `
<score-timewise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Part 1</part-name></score-part>
    <score-part id="P2"><part-name>Part 2</part-name></score-part>
  </part-list>
  <measure number="1">
    <part id="P1">
      <attributes><divisions>1</divisions></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </part>
    <part id="P2">
      <attributes><divisions>1</divisions></attributes>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </part>
  </measure>
  <measure number="2">
    <part id="P1">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </part>
  </measure>
</score-timewise>`;

    const result = parseMusicXML(xml);
    const p1 = result.score?.parts.find((part) => part.id === 'P1');
    const p2 = result.score?.parts.find((part) => part.id === 'P2');

    expect(result.score).toBeDefined();
    expect(p1?.measures).toHaveLength(2);
    expect(p2?.measures).toHaveLength(2);
    expect(p1?.measures[1]?.voices[0]?.events[0]?.kind).toBe('note');
    expect(p2?.measures[1]?.voices).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'SCORE_TIMEWISE_NORMALIZED')).toBe(true);
  });

  it('consumes backup events into independent voice timelines', () => {
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
        <duration>4</duration>
        <voice>1</voice>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>2</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml);
    const measure = result.score?.parts[0]?.measures[0];

    expect(result.score).toBeDefined();
    expect(measure?.voices).toHaveLength(2);
    expect(measure?.voices[0]?.events[0]?.offsetTicks).toBe(0);
    expect(measure?.voices[1]?.events[0]?.offsetTicks).toBe(0);
  });

  it('normalizes chord notes into notes[] on a single NoteEvent', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml);
    const event = result.score?.parts[0]?.measures[0]?.voices[0]?.events[0];

    expect(event?.kind).toBe('note');
    if (event?.kind === 'note') {
      expect(event.notes).toHaveLength(2);
      expect(event.offsetTicks).toBe(0);
    }
  });

  it('truncates lenient overflow to expected measure duration', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>1</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    const event = result.score?.parts[0]?.measures[0]?.voices[0]?.events[0];

    expect(result.diagnostics.some((d) => d.code === 'DURATION_OVERFLOW')).toBe(true);
    expect(event?.durationTicks).toBe(480);
  });
});
