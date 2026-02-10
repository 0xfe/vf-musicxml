import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConformanceMetadataError,
  loadConformanceFixtures
} from '../../src/testkit/conformance.js';

describe('conformance fixture loader', () => {
  it('loads repository conformance fixtures', async () => {
    const fixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance'));

    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures[0]?.meta.id).toBe('smoke-minimal-partwise');
    expect(fixtures[0]?.scorePath.endsWith('.musicxml')).toBe(true);
  });

  it('fails on invalid metadata shape', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'musicxml-conformance-'));
    const fixtureDir = path.join(tempDir, 'bad');
    await mkdir(fixtureDir, { recursive: true });

    await writeFile(
      path.join(fixtureDir, 'broken.meta.yaml'),
      ['id: bad', 'source: test', 'category: smoke', 'expected: maybe', 'status: active'].join('\n'),
      'utf8'
    );
    await writeFile(path.join(fixtureDir, 'broken.musicxml'), '<score-partwise version="4.0" />', 'utf8');

    await expect(loadConformanceFixtures(tempDir)).rejects.toBeInstanceOf(ConformanceMetadataError);
  });
});
