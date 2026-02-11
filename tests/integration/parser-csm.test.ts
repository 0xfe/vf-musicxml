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

  it('captures MusicXML measure width hints for layout planning', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" width="120">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
    <measure number="2" width="360">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml);
    const measures = result.score?.parts[0]?.measures;

    expect(measures?.[0]?.sourceWidthTenths).toBe(120);
    expect(measures?.[1]?.sourceWidthTenths).toBe(360);
  });

  it('captures MusicXML note default-x hints for source spacing alignment', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note default-x="15">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>up</stem>
        <beam number="1">begin</beam>
      </note>
      <note default-x="92">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>down</stem>
        <beam number="1">end</beam>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
      <note default-x="211">
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml);
    const events = result.score?.parts[0]?.measures[0]?.voices[0]?.events;

    expect(events?.[0]?.kind).toBe('note');
    expect(events?.[1]?.kind).toBe('note');
    expect(events?.[2]?.kind).toBe('note');
    expect(events?.[3]?.kind).toBe('note');

    if (
      events?.[0]?.kind === 'note' &&
      events?.[1]?.kind === 'note' &&
      events?.[2]?.kind === 'note' &&
      events?.[3]?.kind === 'note'
    ) {
      expect(events[0].sourceDefaultXTenths).toBe(15);
      expect(events[0].stemDirection).toBe('up');
      expect(events[0].beams).toEqual([{ number: 1, value: 'begin' }]);
      expect(events[1].sourceDefaultXTenths).toBe(92);
      expect(events[1].stemDirection).toBe('down');
      expect(events[1].beams).toEqual([{ number: 1, value: 'end' }]);
      expect(events[2].sourceDefaultXTenths).toBeUndefined();
      expect(events[2].stemDirection).toBeUndefined();
      expect(events[2].beams).toBeUndefined();
      expect(events[3].sourceDefaultXTenths).toBe(211);
    }
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

  it('falls back to centered credit-words for metadata title when work-title is absent', () => {
    const xml = `
<score-partwise version="4.0">
  <credit><credit-words justify="left" font-size="6">Arranger Note</credit-words></credit>
  <credit><credit-words justify="center" font-size="14" default-y="1200">Credit Title</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.metadata?.workTitle).toBe('Credit Title');
  });

  it('prefers explicit work-title metadata over credit-word fallbacks', () => {
    const xml = `
<score-partwise version="4.0">
  <work><work-title>Explicit Work Title</work-title></work>
  <credit><credit-words justify="center" font-size="18">Credit Title</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.metadata?.workTitle).toBe('Explicit Work Title');
  });

  it('extracts top-side credit words into metadata header fields', () => {
    const xml = `
<score-partwise version="4.0">
  <credit><credit-words justify="center" font-size="18" default-y="1450">Main Title</credit-words></credit>
  <credit><credit-words justify="left" font-size="8" default-y="1320">Harmonized by J.S. Bach</credit-words></credit>
  <credit><credit-words justify="right" font-size="8" default-y="1320">jsbchorales.net</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.metadata?.workTitle).toBe('Main Title');
    expect(result.score?.metadata?.headerLeft).toBe('Harmonized by J.S. Bach');
    expect(result.score?.metadata?.headerRight).toBe('jsbchorales.net');
  });

  it('preserves multiline credit words for header metadata fields', () => {
    const xml = `
<score-partwise version="4.0">
  <credit><credit-words justify="center" font-size="18" default-y="1450">Main Title</credit-words></credit>
  <credit><credit-words justify="right" font-size="8" default-y="1320">PDF ©2004 Margaret Greentree
www.jsbchorales.net</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.metadata?.headerRight).toBe('PDF ©2004 Margaret Greentree\nwww.jsbchorales.net');
  });

  it('uses credit default-x with defaults page width to classify side headers', () => {
    const xml = `
<score-partwise version="4.0">
  <defaults>
    <page-layout><page-width>1600</page-width></page-layout>
  </defaults>
  <credit><credit-words default-x="800" font-size="16">Main Title</credit-words></credit>
  <credit><credit-words default-x="180" font-size="8">Left Header</credit-words></credit>
  <credit><credit-words default-x="1420" font-size="8">Right Header</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.metadata?.workTitle).toBe('Main Title');
    expect(result.score?.metadata?.headerLeft).toBe('Left Header');
    expect(result.score?.metadata?.headerRight).toBe('Right Header');
  });

  it('parses MusicXML time signature symbol metadata', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.parts[0]?.measures[0]?.effectiveAttributes.timeSignature?.symbol).toBe('common');
  });

  it('parses defaults page and spacing layout values for renderer planning', () => {
    const xml = `
<score-partwise version="4.0">
  <defaults>
    <scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>
    <page-layout>
      <page-width>1500</page-width>
      <page-height>2000</page-height>
      <page-margins type="both">
        <left-margin>100</left-margin>
        <right-margin>80</right-margin>
        <top-margin>70</top-margin>
        <bottom-margin>60</bottom-margin>
      </page-margins>
    </page-layout>
    <system-layout>
      <system-margins><left-margin>12</left-margin><right-margin>4</right-margin></system-margins>
      <system-distance>140</system-distance>
      <top-system-distance>130</top-system-distance>
    </system-layout>
    <staff-layout><staff-distance>52</staff-distance></staff-layout>
  </defaults>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.score?.defaults?.pageWidth).toBe(1500);
    expect(result.score?.defaults?.pageHeight).toBe(2000);
    expect(result.score?.defaults?.pageMargins?.left).toBe(100);
    expect(result.score?.defaults?.pageMargins?.top).toBe(70);
    expect(result.score?.defaults?.systemMargins?.left).toBe(12);
    expect(result.score?.defaults?.systemMargins?.right).toBe(4);
    expect(result.score?.defaults?.systemDistance).toBe(140);
    expect(result.score?.defaults?.topSystemDistance).toBe(130);
    expect(result.score?.defaults?.staffDistance).toBe(52);
  });

  it('parses measure-level print break directives for new systems and pages', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <print new-system="yes">
        <page-layout>
          <page-width>720</page-width>
          <page-height>480</page-height>
          <page-margins type="both">
            <left-margin>22</left-margin>
            <right-margin>18</right-margin>
            <top-margin>24</top-margin>
            <bottom-margin>20</bottom-margin>
          </page-margins>
        </page-layout>
      </print>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="3">
      <print new-page="yes" />
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    const measures = result.score?.parts[0]?.measures ?? [];
    expect(result.score).toBeDefined();
    expect(measures[1]?.print?.newSystem).toBe(true);
    expect(measures[2]?.print?.newPage).toBe(true);
    expect(measures[1]?.print?.pageWidth).toBe(720);
    expect(measures[1]?.print?.pageHeight).toBe(480);
    expect(measures[1]?.print?.pageMargins?.left).toBe(22);
    expect(measures[1]?.print?.pageMargins?.right).toBe(18);
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

  it('parses M6 advanced note/barline metadata for grace, cue, ornaments, tuplets, repeats, and endings', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Advanced</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>6</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <barline location="left"><repeat direction="forward"/><ending number="1" type="start">1.</ending></barline>
      <note>
        <grace slash="yes"/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <voice>1</voice>
        <type>eighth</type>
      </note>
      <note>
        <cue/>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>6</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><ornaments><trill-mark/></ornaments></notations>
      </note>
      <note><rest/><duration>18</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="start" number="1" bracket="yes" show-number="both"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="stop" number="1"/></notations>
      </note>
      <note><rest/><duration>18</duration><voice>1</voice><type>half</type></note>
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXML(xml, { mode: 'lenient' });
    expect(result.score).toBeDefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const measureOne = result.score?.parts[0]?.measures[0];
    const measureTwo = result.score?.parts[0]?.measures[1];
    const graceEvent = measureOne?.voices[0]?.events[0];
    const cueEvent = measureOne?.voices[0]?.events[1];
    const tupletStartEvent = measureTwo?.voices[0]?.events[0];
    const tupletStopEvent = measureTwo?.voices[0]?.events[2];

    expect(graceEvent?.kind).toBe('note');
    if (graceEvent?.kind === 'note') {
      expect(graceEvent.grace).toBe(true);
      expect(graceEvent.graceSlash).toBe(true);
      expect(graceEvent.noteType).toBe('eighth');
    }

    expect(cueEvent?.kind).toBe('note');
    if (cueEvent?.kind === 'note') {
      expect(cueEvent.cue).toBe(true);
      expect(cueEvent.notes[0]?.ornaments?.[0]?.type).toBe('trill-mark');
    }

    expect(tupletStartEvent?.kind).toBe('note');
    if (tupletStartEvent?.kind === 'note') {
      expect(tupletStartEvent.timeModification?.actualNotes).toBe(3);
      expect(tupletStartEvent.timeModification?.normalNotes).toBe(2);
      expect(tupletStartEvent.tuplets?.[0]?.type).toBe('start');
      expect(tupletStartEvent.tuplets?.[0]?.showNumber).toBe('both');
    }

    expect(tupletStopEvent?.kind).toBe('note');
    if (tupletStopEvent?.kind === 'note') {
      expect(tupletStopEvent.tuplets?.[0]?.type).toBe('stop');
    }

    const leftRepeat = measureOne?.barlines?.flatMap((barline) => barline.repeats ?? []).find((repeat) => repeat.location === 'left');
    const leftEnding = measureOne?.barlines?.flatMap((barline) => barline.endings ?? []).find((ending) => ending.location === 'left');
    const rightRepeat = measureTwo?.barlines?.flatMap((barline) => barline.repeats ?? []).find((repeat) => repeat.location === 'right');
    const rightEnding = measureTwo?.barlines?.flatMap((barline) => barline.endings ?? []).find((ending) => ending.location === 'right');
    expect(leftRepeat?.direction).toBe('forward');
    expect(leftEnding?.type).toBe('start');
    expect(rightRepeat?.direction).toBe('backward');
    expect(rightEnding?.type).toBe('stop');
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
