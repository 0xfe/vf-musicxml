import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';
import { detectSvgOverlaps, extractSvgElementBounds } from '../../src/testkit/index.js';

describe('SVG collision audit helpers', () => {
  it('detects overlap for synthetic rectangles', () => {
    const svg = `
<svg viewBox="0 0 100 100">
  <rect id="a" x="10" y="10" width="20" height="20" />
  <rect id="b" x="25" y="25" width="20" height="20" />
</svg>`;

    const bounds = extractSvgElementBounds(svg, { selector: 'rect' });
    const overlaps = detectSvgOverlaps(bounds);

    expect(bounds).toHaveLength(2);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.area).toBeGreaterThan(0);
  });

  it('handles path-based bounds for overlap checks', () => {
    const svg = `
<svg viewBox="0 0 100 100">
  <path id="p1" d="M 10 10 C 20 10 20 20 30 20" />
  <path id="p2" d="M 25 15 L 45 15 L 45 35 Z" />
</svg>`;

    const bounds = extractSvgElementBounds(svg, { selector: 'path' });
    const overlaps = detectSvgOverlaps(bounds);

    expect(bounds).toHaveLength(2);
    expect(overlaps.length).toBeGreaterThan(0);
  });

  it('extracts notehead bounds from rendered score and reports no self-collision in smoke fixture', async () => {
    const fixturePath = path.resolve('fixtures/conformance/smoke/minimal-partwise.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, { sourceName: 'minimal-partwise.musicxml' });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    const page = rendered.pages[0] ?? '';

    const noteheadBounds = extractSvgElementBounds(page, { selector: '.vf-notehead path' });
    const overlaps = detectSvgOverlaps(noteheadBounds);

    expect(noteheadBounds.length).toBeGreaterThan(0);
    expect(overlaps).toHaveLength(0);
  });

  it('supports padding/min-area thresholds to tune sensitivity', () => {
    const svg = `
<svg viewBox="0 0 200 100">
  <rect id="left" x="10" y="10" width="20" height="20" />
  <rect id="right" x="31" y="10" width="20" height="20" />
</svg>`;

    const bounds = extractSvgElementBounds(svg, { selector: 'rect' });
    const noPadding = detectSvgOverlaps(bounds);
    const withPadding = detectSvgOverlaps(bounds, { padding: 1.5 });
    const withMinArea = detectSvgOverlaps(bounds, { padding: 5, minOverlapArea: 300 });

    expect(noPadding).toHaveLength(0);
    expect(withPadding.length).toBeGreaterThan(0);
    expect(withMinArea).toHaveLength(0);
  });

  it('estimates text element bounds for lyric/harmony collision checks', () => {
    const svg = `
<svg viewBox="0 0 200 80">
  <text x="20" y="20" font-size="12">C maj7</text>
  <text x="25" y="24" font-size="12">Hello</text>
</svg>`;

    const bounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(bounds, { minOverlapArea: 10 });

    expect(bounds).toHaveLength(2);
    expect(overlaps.length).toBeGreaterThan(0);
  });
});
