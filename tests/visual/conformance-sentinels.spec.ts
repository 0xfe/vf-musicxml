import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { parseMusicXMLAsync, renderToSVGPages } from '../../src/public/index.js';

/** High-signal conformance fixtures kept as browser visual sentinels in M3-M5. */
const VISUAL_SENTINELS = [
  {
    id: 'smoke-minimal-partwise',
    fixturePath: 'fixtures/conformance/smoke/minimal-partwise.musicxml',
    format: 'xml'
  },
  {
    id: 'timewise-minimal',
    fixturePath: 'fixtures/conformance/timewise/minimal-timewise.musicxml',
    format: 'xml'
  },
  {
    id: 'rhythm-backup-forward-two-voices',
    fixturePath: 'fixtures/conformance/rhythm/backup-forward-two-voices.musicxml',
    format: 'xml'
  },
  {
    id: 'notation-m4-baseline',
    fixturePath: 'fixtures/conformance/notation/m4-notation-baseline.musicxml',
    format: 'xml'
  },
  {
    id: 'layout-m5-multipart-baseline',
    fixturePath: 'fixtures/conformance/layout/m5-multipart-baseline.musicxml',
    format: 'xml'
  },
  {
    id: 'text-m5-lyrics-harmony-baseline',
    fixturePath: 'fixtures/conformance/text/m5-lyrics-harmony-baseline.musicxml',
    format: 'xml'
  },
  {
    id: 'lilypond-01a-pitches-pitches',
    fixturePath: 'fixtures/conformance/lilypond/01a-pitches-pitches.musicxml',
    format: 'xml'
  },
  {
    id: 'realworld-music21-bach-bwv1-6',
    fixturePath: 'fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl',
    format: 'mxl'
  }
] as const;

for (const sentinel of VISUAL_SENTINELS) {
  test(`renders visual sentinel fixture ${sentinel.id}`, async ({ page }) => {
    const fixturePath = path.resolve(sentinel.fixturePath);
    const raw = await readFile(fixturePath);
    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(raw),
        format: sentinel.format
      },
      { sourceName: sentinel.fixturePath, mode: 'lenient' }
    );
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);

    await page.setContent(`<div data-fixture="${sentinel.id}">${rendered.pages[0]}</div>`);

    const svg = page.locator(`[data-fixture="${sentinel.id}"] svg`);
    await expect(svg).toBeVisible();

    const box = await svg.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.height ?? 0).toBeGreaterThan(80);

    const noteheads = page.locator(`[data-fixture="${sentinel.id}"] .vf-notehead path`);
    expect(await noteheads.count()).toBeGreaterThan(0);

    const image = await svg.screenshot();
    expect(image.byteLength).toBeGreaterThan(5000);

    await expect(svg).toHaveScreenshot(`conformance-${sentinel.id}.png`, {
      animations: 'disabled',
      scale: 'css'
    });
  });
}
