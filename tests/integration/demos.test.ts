import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';

/** Absolute path to tracked MusicXML demo sources. */
const DEMO_SCORES_DIR = path.resolve('demos/scores');

/** Return sorted demo score filenames so test order remains deterministic. */
async function loadDemoScoreFiles(): Promise<string[]> {
  const entries = await readdir(DEMO_SCORES_DIR);
  return entries.filter((entry) => entry.endsWith('.musicxml')).sort((left, right) => left.localeCompare(right));
}

describe('demo scores', () => {
  it('parse and render without error diagnostics', async () => {
    const scoreFiles = await loadDemoScoreFiles();
    expect(scoreFiles.length).toBeGreaterThanOrEqual(8);

    for (const scoreFile of scoreFiles) {
      const scorePath = path.join(DEMO_SCORES_DIR, scoreFile);
      const xml = await readFile(scorePath, 'utf8');

      const parsed = parseMusicXML(xml, { sourceName: scorePath, mode: 'lenient' });
      expect(parsed.score, `${scoreFile} should parse to a score`).toBeDefined();
      expect(
        parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
        `${scoreFile} should not emit parse errors`
      ).toBe(false);

      const rendered = renderToSVGPages(parsed.score!);
      expect(rendered.pages.length, `${scoreFile} should render at least one page`).toBeGreaterThan(0);
      expect(
        rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
        `${scoreFile} should not emit render errors`
      ).toBe(false);
    }
  });
});
