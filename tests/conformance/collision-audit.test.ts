import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, renderToSVGPages } from '../../src/public/index.js';
import {
  loadConformanceFixtures,
  runConformanceCollisionAudit,
  type ConformanceFixtureMeta
} from '../../src/testkit/conformance.js';

/** Minimal metadata helper used for collision-audit function behavior tests. */
const META_WITHOUT_COLLISION_AUDIT: ConformanceFixtureMeta = {
  id: 'no-audit',
  source: 'test',
  category: 'smoke',
  expected: 'pass',
  status: 'active'
};

describe('conformance collision audit workflow', () => {
  it('returns undefined when fixture metadata does not enable collision auditing', () => {
    const report = runConformanceCollisionAudit('<svg />', META_WITHOUT_COLLISION_AUDIT);
    expect(report).toBeUndefined();
  });

  it('audits rendered smoke fixture noteheads using metadata configuration', async () => {
    const fixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance/smoke'));
    const fixture = fixtures.find((item) => item.meta.id === 'smoke-minimal-partwise');

    expect(fixture).toBeDefined();
    if (!fixture) {
      throw new Error('Expected smoke-minimal-partwise fixture to exist.');
    }
    expect(fixture.meta.collision_audit).toBeDefined();

    const xml = await readFile(fixture.scorePath, 'utf8');
    const parsed = parseMusicXML(xml, { sourceName: fixture.scorePath });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    const page = rendered.pages[0] ?? '';

    const report = runConformanceCollisionAudit(page, fixture.meta);
    expect(report).toBeDefined();
    expect(report?.fixtureId).toBe('smoke-minimal-partwise');
    expect(report?.maxOverlaps).toBe(0);
    expect(report?.overlapCount).toBe(0);
    expect(report?.pass).toBe(true);
  });

  it('fails collision report when overlap count exceeds configured threshold', () => {
    const meta: ConformanceFixtureMeta = {
      id: 'synthetic-overlap',
      source: 'test',
      category: 'smoke',
      expected: 'fail',
      status: 'active',
      collision_audit: {
        selector: 'rect',
        max_overlaps: 0
      }
    };

    const svg = `
<svg viewBox="0 0 100 100">
  <rect x="10" y="10" width="20" height="20" />
  <rect x="25" y="25" width="20" height="20" />
</svg>`;

    const report = runConformanceCollisionAudit(svg, meta);
    expect(report).toBeDefined();
    expect(report?.overlapCount).toBe(1);
    expect(report?.pass).toBe(false);
  });
});
