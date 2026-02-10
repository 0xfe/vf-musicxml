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

    expect(fixtures.length).toBeGreaterThanOrEqual(8);

    const smokeFixture = fixtures.find((fixture) => fixture.meta.id === 'smoke-minimal-partwise');
    expect(smokeFixture).toBeDefined();
    expect(smokeFixture?.scorePath.endsWith('.musicxml')).toBe(true);
    expect(smokeFixture?.meta.collision_audit?.selector).toBe('.vf-notehead path');
    expect(smokeFixture?.meta.collision_audit?.max_overlaps).toBe(0);

    const strictNotationFixture = fixtures.find(
      (fixture) => fixture.meta.id === 'notation-invalid-pitch-step-strict'
    );
    expect(strictNotationFixture?.meta.parse_mode).toBe('strict');
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

  it('fails on invalid collision audit metadata shape', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'musicxml-conformance-'));
    const fixtureDir = path.join(tempDir, 'bad-collision');
    await mkdir(fixtureDir, { recursive: true });

    await writeFile(
      path.join(fixtureDir, 'broken.meta.yaml'),
      [
        'id: bad-collision',
        'source: test',
        'category: smoke',
        'expected: pass',
        'status: active',
        'collision_audit:',
        '  selector: 42'
      ].join('\n'),
      'utf8'
    );
    await writeFile(path.join(fixtureDir, 'broken.musicxml'), '<score-partwise version="4.0" />', 'utf8');

    await expect(loadConformanceFixtures(tempDir)).rejects.toBeInstanceOf(ConformanceMetadataError);
  });

  it('fails on invalid parse_mode metadata value', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'musicxml-conformance-'));
    const fixtureDir = path.join(tempDir, 'bad-parse-mode');
    await mkdir(fixtureDir, { recursive: true });

    await writeFile(
      path.join(fixtureDir, 'broken.meta.yaml'),
      [
        'id: bad-parse-mode',
        'source: test',
        'category: smoke',
        'expected: pass',
        'status: active',
        'parse_mode: aggressive'
      ].join('\n'),
      'utf8'
    );
    await writeFile(path.join(fixtureDir, 'broken.musicxml'), '<score-partwise version="4.0" />', 'utf8');

    await expect(loadConformanceFixtures(tempDir)).rejects.toBeInstanceOf(ConformanceMetadataError);
  });
});
