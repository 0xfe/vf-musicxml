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
});
