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

  it('emits a warning when backup rewinds before measure start', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <backup><duration>2</duration></backup>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === 'BACKUP_BEFORE_MEASURE_START')).toBe(true);
  });

  it('emits a cursor overflow warning when forward advances past the measure length', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>1</beats><beat-type>4</beat-type></time>
      </attributes>
      <forward><duration>2</duration></forward>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === 'MEASURE_CURSOR_OVERFLOW')).toBe(true);
  });

  it('builds tie/slur/wedge spanners and direction metadata for M4 notation baseline', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction>
        <direction-type>
          <words>Allegro</words>
          <dynamics><mf/></dynamics>
          <wedge type="crescendo" number="1" />
        </direction-type>
        <sound tempo="120" />
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <tie type="start" />
        <notations>
          <slur type="start" number="1" placement="above" />
          <articulations><staccato/></articulations>
        </notations>
      </note>
      <direction>
        <direction-type>
          <wedge type="stop" number="1" />
        </direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <tie type="stop" />
        <notations>
          <slur type="stop" number="1" />
          <articulations><accent/></articulations>
        </notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    const spanners = result.score?.spanners ?? [];
    const measure = result.score?.parts[0]?.measures[0];
    const directions = measure?.directions ?? [];
    const firstVoiceEvents = measure?.voices[0]?.events ?? [];
    const firstNoteEvent = firstVoiceEvents[0];
    const secondNoteEvent = firstVoiceEvents[1];

    expect(result.score).toBeDefined();
    expect(firstNoteEvent?.kind).toBe('note');
    expect(secondNoteEvent?.kind).toBe('note');
    if (firstNoteEvent?.kind === 'note' && secondNoteEvent?.kind === 'note') {
      expect(firstNoteEvent.notes[0]?.articulations?.[0]?.type).toBe('staccato');
      expect(secondNoteEvent.notes[0]?.articulations?.[0]?.type).toBe('accent');
    }

    const tie = spanners.find((spanner) => spanner.type === 'tie');
    const slur = spanners.find((spanner) => spanner.type === 'slur');
    const wedge = spanners.find((spanner) => spanner.type === 'wedge');
    expect(tie).toBeDefined();
    expect(slur).toBeDefined();
    expect(wedge).toBeDefined();

    expect(tie?.start.voiceId).toBe('1');
    expect(tie?.start.eventIndex).toBe(0);
    expect(tie?.end?.eventIndex).toBe(1);

    expect(slur?.start.voiceId).toBe('1');
    expect(slur?.end?.eventIndex).toBe(1);
    expect(slur?.data?.placement).toBe('above');

    expect(wedge?.start.voiceId).toBe('1');
    expect(wedge?.end?.eventIndex).toBe(1);
    expect(wedge?.data?.kind).toBe('crescendo');

    expect(directions[0]?.words).toBe('Allegro');
    expect(directions[0]?.tempo).toBe(120);
    expect(directions[0]?.dynamics).toEqual(['mf']);
  });

  it('treats unclosed slur starts as strict-mode errors', () => {
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
        <notations><slur type="start" number="1" /></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'strict' });
    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'UNCLOSED_SLUR_START' && d.severity === 'error')).toBe(true);
  });

  it('parses lyric tokens and harmony symbols with measure-relative offsets', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <harmony>
        <root><root-step>C</root-step></root>
        <kind text="maj7">major-seventh</kind>
      </harmony>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <lyric><syllabic>begin</syllabic><text>Hel</text></lyric>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <lyric><syllabic>end</syllabic><text>lo</text></lyric>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    const measure = result.score?.parts[0]?.measures[0];
    const firstNote = measure?.voices[0]?.events[0];
    const secondNote = measure?.voices[0]?.events[1];

    expect(result.score).toBeDefined();
    expect(measure?.harmonies?.[0]?.rootStep).toBe('C');
    expect(measure?.harmonies?.[0]?.text).toBe('maj7');
    expect(measure?.harmonies?.[0]?.offsetTicks).toBe(0);

    expect(firstNote?.kind).toBe('note');
    expect(secondNote?.kind).toBe('note');
    if (firstNote?.kind === 'note' && secondNote?.kind === 'note') {
      expect(firstNote.notes[0]?.lyrics?.[0]?.text).toBe('Hel');
      expect(firstNote.notes[0]?.lyrics?.[0]?.syllabic).toBe('begin');
      expect(secondNote.notes[0]?.lyrics?.[0]?.text).toBe('lo');
      expect(secondNote.notes[0]?.lyrics?.[0]?.syllabic).toBe('end');
    }
  });

  it('tracks part-group membership in part-list group paths', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list>
    <part-group number="1" type="start"><group-symbol>brace</group-symbol></part-group>
    <score-part id="P1"><part-name>RH</part-name></score-part>
    <score-part id="P2"><part-name>LH</part-name></score-part>
    <part-group number="1" type="stop" />
    <score-part id="P3"><part-name>Solo</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
  <part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
  <part id="P3"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    const p1 = result.score?.partList.find((part) => part.id === 'P1');
    const p2 = result.score?.partList.find((part) => part.id === 'P2');
    const p3 = result.score?.partList.find((part) => part.id === 'P3');

    expect(result.score).toBeDefined();
    expect(p1?.groupPath).toEqual(['1:brace']);
    expect(p2?.groupPath).toEqual(['1:brace']);
    expect(p3?.groupPath).toBeUndefined();
  });

  it('emits a warning for part-group stop markers without matching start markers', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list>
    <part-group number="9" type="stop" />
    <score-part id="P1"><part-name>Solo</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'PART_GROUP_STOP_WITHOUT_START')).toBe(true);
  });

  it('conserves randomized backup/forward timing invariants across voices', () => {
    const rng = createDeterministicRng(0xC0FFEE);

    for (let caseIndex = 0; caseIndex < 40; caseIndex += 1) {
      const voiceOneUnits = randomPartition(4, rng);
      const leadUnits = randomInt(rng, 0, 3);
      const voiceTwoUnits = randomPartition(4 - leadUnits, rng);

      const xml = buildTwoVoiceMeasureXml(voiceOneUnits, leadUnits, voiceTwoUnits);
      const result = parseMusicXML(xml, { mode: 'lenient' });
      const measure = result.score?.parts[0]?.measures[0];
      const voiceOne = measure?.voices.find((voice) => voice.id === '1');
      const voiceTwo = measure?.voices.find((voice) => voice.id === '2');

      expect(result.score, `case ${caseIndex}`).toBeDefined();
      expect(result.diagnostics.some((d) => d.severity === 'error'), `case ${caseIndex}`).toBe(false);
      expect(result.diagnostics.some((d) => d.code === 'DURATION_OVERFLOW'), `case ${caseIndex}`).toBe(false);
      expect(result.diagnostics.some((d) => d.code === 'MEASURE_CURSOR_OVERFLOW'), `case ${caseIndex}`).toBe(false);

      assertVoiceShape(voiceOne, voiceOneUnits, 0, caseIndex);
      assertVoiceShape(voiceTwo, voiceTwoUnits, leadUnits, caseIndex);
      expect(voiceEndTicks(voiceOne), `case ${caseIndex}`).toBe(4 * 480);
      expect(voiceEndTicks(voiceTwo), `case ${caseIndex}`).toBe(4 * 480);
    }
  });
});

/** Deterministic pseudo-random generator for property-style test cases. */
function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}

/** Return an integer in [min, max], inclusive. */
function randomInt(rng: () => number, min: number, max: number): number {
  const width = max - min + 1;
  return min + (rng() % width);
}

/** Split a positive integer into random positive summands. */
function randomPartition(total: number, rng: () => number): number[] {
  const parts: number[] = [];
  let remaining = total;

  while (remaining > 0) {
    const value = randomInt(rng, 1, remaining);
    parts.push(value);
    remaining -= value;
  }

  return parts;
}

/** Build a two-voice measure that uses backup/forward for stream-cursor control. */
function buildTwoVoiceMeasureXml(voiceOneUnits: number[], leadUnits: number, voiceTwoUnits: number[]): string {
  const notesToXml = (durations: number[], step: string, octave: number, voice: string): string =>
    durations
      .map(
        (duration) => `
      <note>
        <pitch><step>${step}</step><octave>${octave}</octave></pitch>
        <duration>${duration}</duration>
        <voice>${voice}</voice>
      </note>`
      )
      .join('');

  const voiceOneTotal = voiceOneUnits.reduce((sum, value) => sum + value, 0);
  const forwardNode = leadUnits > 0 ? `<forward><duration>${leadUnits}</duration></forward>` : '';

  return `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      ${notesToXml(voiceOneUnits, 'C', 4, '1')}
      <backup><duration>${voiceOneTotal}</duration></backup>
      ${forwardNode}
      ${notesToXml(voiceTwoUnits, 'E', 3, '2')}
    </measure>
  </part>
</score-partwise>`;
}

/** Assert voice event offsets and durations match expected division-unit schedule. */
function assertVoiceShape(
  voice:
    | {
        events: Array<{ offsetTicks: number; durationTicks: number }>;
      }
    | undefined,
  durationsInDivisions: number[],
  startInDivisions: number,
  caseIndex: number
): void {
  expect(voice, `case ${caseIndex}`).toBeDefined();
  expect(voice?.events, `case ${caseIndex}`).toHaveLength(durationsInDivisions.length);

  let offsetInDivisions = startInDivisions;
  voice?.events.forEach((event, index) => {
    const expectedDuration = durationsInDivisions[index];
    expect(event.offsetTicks, `case ${caseIndex}, event ${index}`).toBe(offsetInDivisions * 480);
    expect(event.durationTicks, `case ${caseIndex}, event ${index}`).toBe((expectedDuration ?? 0) * 480);
    offsetInDivisions += expectedDuration ?? 0;
  });
}

/** Return voice end tick for the last event (or zero for empty voices). */
function voiceEndTicks(
  voice:
    | {
        events: Array<{ offsetTicks: number; durationTicks: number }>;
      }
    | undefined
): number {
  const last = voice?.events[voice.events.length - 1];
  if (!last) {
    return 0;
  }

  return last.offsetTicks + last.durationTicks;
}
