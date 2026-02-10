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

    expect(fixtures.length).toBeGreaterThanOrEqual(10);

    const smokeFixture = fixtures.find((fixture) => fixture.meta.id === 'smoke-minimal-partwise');
    expect(smokeFixture).toBeDefined();
    expect(smokeFixture?.scorePath.endsWith('.musicxml')).toBe(true);
    expect(smokeFixture?.meta.collision_audit?.selector).toBe('.vf-notehead path');
    expect(smokeFixture?.meta.collision_audit?.max_overlaps).toBe(0);

    const strictNotationFixture = fixtures.find(
      (fixture) => fixture.meta.id === 'notation-invalid-pitch-step-strict'
    );
    expect(strictNotationFixture?.meta.parse_mode).toBe('strict');

    const m4NotationFixture = fixtures.find((fixture) => fixture.meta.id === 'notation-m4-baseline');
    expect(m4NotationFixture?.meta.expected).toBe('pass');
    expect(m4NotationFixture?.meta.parse_mode).toBe('lenient');

    const m5LayoutFixture = fixtures.find((fixture) => fixture.meta.id === 'layout-m5-multipart-baseline');
    expect(m5LayoutFixture?.meta.expected).toBe('pass');
    expect(m5LayoutFixture?.meta.category).toBe('layout');

    const textFixture = fixtures.find((fixture) => fixture.meta.id === 'text-m5-lyrics-harmony-baseline');
    expect(textFixture?.meta.expected).toBe('pass');
    expect(textFixture?.meta.category).toBe('text');

    const advancedFixture = fixtures.find((fixture) => fixture.meta.id === 'advanced-m6-notation-baseline');
    expect(advancedFixture?.meta.expected).toBe('pass');
    expect(advancedFixture?.meta.category).toBe('advanced');

    const lilyPondFixture = fixtures.find((fixture) => fixture.meta.id === 'lilypond-12a-clefs');
    expect(lilyPondFixture?.meta.expected).toBe('pass');
    expect(lilyPondFixture?.meta.category).toBe('lilypond-12');

    const lilyPondGraceFixture = fixtures.find((fixture) => fixture.meta.id === 'lilypond-24a-gracenotes');
    expect(lilyPondGraceFixture?.meta.status).toBe('active');
    expect(lilyPondGraceFixture?.meta.expected).toBe('pass');

    const realWorldFixture = fixtures.find((fixture) => fixture.meta.id === 'realworld-music21-bach-bwv1-6');
    expect(realWorldFixture?.meta.category).toBe('realworld-chorale-satb');
    expect(realWorldFixture?.meta.expected).toBe('pass');

    const leadSheetFixture = fixtures.find(
      (fixture) => fixture.meta.id === 'realworld-music21-berlin-alexanders-ragtime'
    );
    expect(leadSheetFixture?.meta.category).toBe('realworld-solo-lead-sheet');
    expect(leadSheetFixture?.meta.expected).toBe('pass');

    const orchestralFixture = fixtures.find((fixture) => fixture.meta.id === 'realworld-music21-bach-bwv248-42-4');
    expect(orchestralFixture?.meta.category).toBe('realworld-orchestral-excerpt');
    expect(orchestralFixture?.meta.expected).toBe('pass');

    const longFormFixture = fixtures.find((fixture) => fixture.meta.id === 'realworld-music21-beethoven-op133-longform');
    expect(longFormFixture?.meta.category).toBe('realworld-chamber-quartet');
    expect(longFormFixture?.meta.expected).toBe('pass');
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
