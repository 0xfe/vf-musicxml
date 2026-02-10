import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';

/** Regression fixture path for the grace-note beaming runtime failure (B-002). */
const GRACE_FIXTURE_PATH = path.resolve('fixtures/conformance/lilypond/24a-gracenotes.musicxml');

describe('grace-note rendering regression', () => {
  it('renders 24a grace notes without throwing runtime errors', async () => {
    const xml = await readFile(GRACE_FIXTURE_PATH, 'utf8');
    const parsed = parseMusicXML(xml, { sourceName: GRACE_FIXTURE_PATH, mode: 'lenient' });

    expect(parsed.score).toBeDefined();
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(0);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
  });
});
