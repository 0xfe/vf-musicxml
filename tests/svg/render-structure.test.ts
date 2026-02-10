import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';

describe('SVG rendering structure', () => {
  it('renders the smoke fixture into SVG markup with stave and notes', async () => {
    const fixturePath = path.resolve('fixtures/conformance/smoke/minimal-partwise.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, { sourceName: 'minimal-partwise.musicxml' });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);

    const svg = rendered.pages[0] ?? '';
    expect(svg).toContain('<svg');
    expect(svg).toContain('vf-stave');
    expect(svg).toContain('vf-note');
    expect(rendered.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('emits warning for multi-voice measure and still renders', () => {
    const parsed = parseMusicXML(`
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note>
    </measure>
  </part>
</score-partwise>
    `);

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((d) => d.code === 'MULTI_VOICE_NOT_SUPPORTED_IN_M2')).toBe(true);
  });

  it('renders M4 notation baseline with direction text and spanners without hard failures', async () => {
    const fixturePath = path.resolve('fixtures/conformance/notation/m4-notation-baseline.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, { sourceName: 'm4-notation-baseline.musicxml' });
    expect(parsed.score).toBeDefined();
    expect(parsed.score?.spanners.some((spanner) => spanner.type === 'tie')).toBe(true);
    expect(parsed.score?.spanners.some((spanner) => spanner.type === 'slur')).toBe(true);
    expect(parsed.score?.spanners.some((spanner) => spanner.type === 'wedge')).toBe(true);

    const rendered = renderToSVGPages(parsed.score!);
    const svg = rendered.pages[0] ?? '';
    const noteheadCount = (svg.match(/vf-notehead/g) ?? []).length;

    expect(rendered.pages.length).toBe(1);
    expect(svg).toContain('Allegro');
    expect(svg).toContain('q = 120');
    expect(svg).toContain('mf');
    expect(noteheadCount).toBeGreaterThanOrEqual(2);
    expect(rendered.diagnostics.some((d) => d.code === 'WEDGE_DIRECTION_TEXT_FALLBACK')).toBe(true);
    expect(rendered.diagnostics.some((d) => d.code === 'TIE_RENDER_FAILED')).toBe(false);
    expect(rendered.diagnostics.some((d) => d.code === 'SLUR_RENDER_FAILED')).toBe(false);
    expect(rendered.diagnostics.some((d) => d.code === 'WEDGE_RENDER_FAILED')).toBe(false);
    expect(rendered.diagnostics.some((d) => d.code === 'SPANNER_ANCHOR_NOT_RENDERED')).toBe(false);
    expect(rendered.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('renders multi-part and multi-staff systems with connectors and staff-routed notes', () => {
    const parsed = parseMusicXML(`
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
    <score-part id="P2"><part-name>Violin</part-name></score-part>
  </part-list>
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
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>2</voice>
        <staff>2</staff>
      </note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </measure>
  </part>
</score-partwise>
    `);

    expect(parsed.score).toBeDefined();
    const rendered = renderToSVGPages(parsed.score!);
    const svg = rendered.pages[0] ?? '';

    expect(rendered.pages.length).toBe(1);
    expect((svg.match(/vf-stave/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((svg.match(/vf-notehead/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((svg.match(/width="3" height="/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'MULTI_PART_NOT_SUPPORTED_IN_M2')).toBe(false);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
  });

  it('renders lyric and harmony baseline text attachments', async () => {
    const fixturePath = path.resolve('fixtures/conformance/text/m5-lyrics-harmony-baseline.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, { sourceName: 'm5-lyrics-harmony-baseline.musicxml' });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    const svg = rendered.pages[0] ?? '';

    expect(rendered.pages.length).toBe(1);
    expect(svg).toContain('Hel');
    expect(svg).toContain('lo');
    expect(svg).toContain('C maj7');
    expect(svg).toContain('G 7');
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'LYRIC_TEXT_RENDERED')).toBe(true);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
  });
});
