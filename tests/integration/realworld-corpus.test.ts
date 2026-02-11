import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConformanceFixtures } from '../../src/testkit/conformance.js';

/** Location of the real-world corpus manifest tracked in git. */
const REALWORLD_CORPUS_MANIFEST_PATH = path.resolve('fixtures/corpus/real-world-samples.json');

/** Required real-world complexity buckets for M7A breadth gates. */
const REQUIRED_REALWORLD_BUCKETS = [
  'solo-lead-sheet',
  'piano-solo',
  'chorale-satb',
  'chamber-quartet',
  'orchestral-excerpt'
] as const;

/** Minimal typed shape used by tests for one real-world sample row. */
interface RealworldSampleRecord {
  id: string;
  bucket: string;
  complexity_level: 'small' | 'medium' | 'large';
  part_count_hint: number;
  long_form: boolean;
  sourceUrl: string;
  license: string;
}

/** Minimal typed shape used by tests for the real-world corpus manifest JSON. */
interface RealworldManifest {
  schemaVersion: number;
  samples: RealworldSampleRecord[];
}

/** Match build-demos complex-score selection criteria to prevent drift. */
function isSelectedComplexSample(sample: RealworldSampleRecord): boolean {
  return sample.long_form || sample.complexity_level !== 'small' || sample.part_count_hint >= 4;
}

/** Parse one JSON file from disk with strict UTF-8 semantics. */
async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

describe('real-world corpus manifest', () => {
  it('covers required M7A complexity buckets with active conformance fixtures', async () => {
    const manifest = await readJson<RealworldManifest>(REALWORLD_CORPUS_MANIFEST_PATH);
    const conformanceFixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance'));
    const realworldFixtures = conformanceFixtures.filter((fixture) => fixture.meta.category.startsWith('realworld-'));

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.samples.length).toBeGreaterThanOrEqual(REQUIRED_REALWORLD_BUCKETS.length);

    const sampleIds = new Set<string>();
    const sampleBuckets = new Set<string>();
    const sampleSources = new Set<string>();
    const longFormByBucket = new Map<string, number>();

    for (const sample of manifest.samples) {
      expect(sampleIds.has(sample.id), `sample id '${sample.id}' should be unique`).toBe(false);
      sampleIds.add(sample.id);

      expect(sample.sourceUrl.endsWith('.mxl'), `${sample.id} should use .mxl for deterministic compressed-path coverage`).toBe(
        true
      );
      expect(sample.license.length).toBeGreaterThan(0);
      expect(['small', 'medium', 'large'].includes(sample.complexity_level)).toBe(true);
      expect(Number.isInteger(sample.part_count_hint)).toBe(true);
      expect(sample.part_count_hint).toBeGreaterThan(0);

      sampleBuckets.add(sample.bucket);
      sampleSources.add(sample.sourceUrl);
      if (sample.long_form) {
        longFormByBucket.set(sample.bucket, (longFormByBucket.get(sample.bucket) ?? 0) + 1);
      }
    }

    const activeRealworldByCategory = new Set(
      realworldFixtures
        .filter((fixture) => fixture.meta.status === 'active')
        .map((fixture) => fixture.meta.category)
    );
    const conformanceSources = new Set(realworldFixtures.map((fixture) => fixture.meta.source));

    for (const requiredBucket of REQUIRED_REALWORLD_BUCKETS) {
      expect(sampleBuckets.has(requiredBucket), `required bucket '${requiredBucket}' missing from manifest`).toBe(true);
      expect(
        activeRealworldByCategory.has(`realworld-${requiredBucket}`),
        `required bucket '${requiredBucket}' missing active conformance fixture`
      ).toBe(true);
    }

    for (const sourceUrl of sampleSources) {
      expect(conformanceSources.has(sourceUrl), `missing conformance fixture for ${sourceUrl}`).toBe(true);
    }

    // M7A long-form breadth gate:
    // Require at least one chamber long-form and one large orchestral/choral sample
    // so corpus comprehensiveness is not biased toward only short examples.
    expect(longFormByBucket.get('chamber-quartet') ?? 0).toBeGreaterThanOrEqual(1);
    expect(longFormByBucket.get('orchestral-excerpt') ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('keeps selected complex real-world samples aligned with active conformance fixtures', async () => {
    const manifest = await readJson<RealworldManifest>(REALWORLD_CORPUS_MANIFEST_PATH);
    const conformanceFixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance'));
    const activeRealworldFixtureIds = new Set(
      conformanceFixtures
        .filter((fixture) => fixture.meta.status === 'active' && fixture.meta.category.startsWith('realworld-'))
        .map((fixture) => fixture.meta.id)
    );

    const selectedComplexSampleIds = manifest.samples.filter(isSelectedComplexSample).map((sample) => sample.id);
    expect(selectedComplexSampleIds.length).toBeGreaterThanOrEqual(5);

    for (const sampleId of selectedComplexSampleIds) {
      expect(
        activeRealworldFixtureIds.has(sampleId),
        `selected complex sample '${sampleId}' should have an active real-world conformance fixture`
      ).toBe(true);
    }
  });
});
