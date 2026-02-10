import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';

test('renders a simple score to visible SVG in the browser', async ({ page }) => {
  const fixturePath = path.resolve('fixtures/conformance/smoke/minimal-partwise.musicxml');
  const xml = await readFile(fixturePath, 'utf8');

  const parsed = parseMusicXML(xml, { sourceName: 'minimal-partwise.musicxml' });
  expect(parsed.score).toBeDefined();

  const rendered = renderToSVGPages(parsed.score!);
  expect(rendered.pages.length).toBe(1);

  await page.setContent(`<div id="score-root">${rendered.pages[0]}</div>`);

  const svg = page.locator('#score-root svg');
  await expect(svg).toBeVisible();

  const box = await svg.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect(box?.height ?? 0).toBeGreaterThan(80);

  const image = await svg.screenshot();
  expect(image.byteLength).toBeGreaterThan(5000);

  await expect(svg).toHaveScreenshot('render-smoke-minimal-partwise.png', {
    animations: 'disabled',
    scale: 'css'
  });
});
