import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, parseMusicXMLAsync, renderToSVGPages } from '../../src/public/index.js';
import { collectNotationGeometry, detectNoteheadBarlineIntrusions } from '../../src/testkit/notation-geometry.js';

/** Trim wrapper markup and return the first SVG payload for geometry audits. */
function extractSvg(pageMarkup: string): string {
  const start = pageMarkup.indexOf('<svg');
  const end = pageMarkup.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) {
    return '';
  }

  return pageMarkup.slice(start, end + '</svg>'.length);
}

describe('renderer quality regressions', () => {
  it('prevents noteheads from intruding through barlines in lilypond-01a-pitches-pitches', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/01a-pitches-pitches.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/01a-pitches-pitches.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const geometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    const intrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });

    expect(geometry.noteheads.length).toBeGreaterThan(8);
    expect(intrusions.length).toBe(0);
  });

  it('renders beam groups for realworld-music21-bach-bwv1-6', async () => {
    const fixturePath = path.resolve('fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl');
    const archive = await readFile(fixturePath);

    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(archive),
        format: 'mxl'
      },
      {
        sourceName: 'fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl',
        mode: 'lenient'
      }
    );
    expect(parsed.score).toBeDefined();
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const geometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    expect(geometry.noteheads.length).toBeGreaterThan(100);
    expect(geometry.beams.length).toBeGreaterThan(20);
  });
});
