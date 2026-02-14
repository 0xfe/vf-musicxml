import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';

/** Absolute path to tracked MusicXML demo sources. */
const DEMO_SCORES_DIR = path.resolve('demos/scores');
/** Absolute path to generated static demo pages. */
const DEMO_SITE_DIR = path.resolve('demos/site');

/** Return sorted demo score filenames so test order remains deterministic. */
async function loadDemoScoreFiles(): Promise<string[]> {
  const entries = await readdir(DEMO_SCORES_DIR);
  return entries.filter((entry) => entry.endsWith('.musicxml')).sort((left, right) => left.localeCompare(right));
}

interface DemoPageMetric {
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  measureWindow?: { startMeasure: number; endMeasure: number };
  overflow?: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/** Decode escaped JSON payload from embedded `application/json` script tags. */
function decodeHtmlEscapes(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

/** Extract embedded page metrics payload from one generated demo HTML page. */
function extractEmbeddedPageMetrics(html: string): DemoPageMetric[] {
  const match = html.match(
    /<script id="mx-page-metrics-json" type="application\/json">([\s\S]*?)<\/script>/
  );
  expect(match).toBeTruthy();
  const encodedPayload = match?.[1] ?? '[]';
  return JSON.parse(decodeHtmlEscapes(encodedPayload)) as DemoPageMetric[];
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

  it('ships pager controls and telemetry payloads on multi-page real-world demos', async () => {
    const demoPages = [
      {
        file: 'realworld-music21-bach-bwv1-6.html',
        minPageCount: 2
      },
      {
        file: 'realworld-music21-schumann-clara-polonaise-op1n1.html',
        minPageCount: 3
      }
    ];

    for (const demo of demoPages) {
      const pagePath = path.join(DEMO_SITE_DIR, demo.file);
      const html = await readFile(pagePath, 'utf8');
      expect(html).toContain('id="mx-prev-page"');
      expect(html).toContain('id="mx-next-page"');
      expect(html).toContain('id="mx-page-indicator"');
      expect(html).toContain('id="mx-page-metrics-json"');

      const metrics = extractEmbeddedPageMetrics(html);
      expect(metrics.length).toBeGreaterThanOrEqual(demo.minPageCount);

      let measureCursor = 0;
      for (let index = 0; index < metrics.length; index += 1) {
        const metric = metrics[index];
        expect(metric?.pageIndex).toBe(index);
        expect(metric?.pageNumber).toBe(index + 1);
        expect(metric?.pageCount).toBe(metrics.length);
        expect(metric?.measureWindow).toBeDefined();
        expect(metric?.measureWindow?.startMeasure).toBe(measureCursor);
        expect((metric?.measureWindow?.endMeasure ?? 0)).toBeGreaterThan(measureCursor);
        measureCursor = metric?.measureWindow?.endMeasure ?? measureCursor;
        expect(typeof metric?.overflow?.left).toBe('boolean');
        expect(typeof metric?.overflow?.right).toBe('boolean');
        expect(typeof metric?.overflow?.top).toBe('boolean');
        expect(typeof metric?.overflow?.bottom).toBe('boolean');
      }
    }
  });
});
