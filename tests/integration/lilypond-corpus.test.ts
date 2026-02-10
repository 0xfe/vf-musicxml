import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { loadConformanceFixtures } from '../../src/testkit/conformance.js';

/** Location of the generated canonical LilyPond corpus manifest. */
const LILYPOND_CORPUS_MANIFEST_PATH = path.resolve('fixtures/corpus/lilypond-collated-v2.25.json');
/** Location of local roadmap/demo planning metadata. */
const LILYPOND_ROADMAP_MANIFEST_PATH = path.resolve('demos/lilypond/manifest.json');

/** Minimal typed shape used by tests for corpus category records. */
interface CorpusCategoryRecord {
  id: string;
  title: string;
  fixtureCount: number;
}

/** Minimal typed shape used by tests for corpus fixture records. */
interface CorpusFixtureRecord {
  id: string;
  sourceName: string;
  sourceUrl: string;
  categoryId: string;
}

/** Minimal typed shape used by tests for the corpus manifest JSON. */
interface CorpusManifest {
  schemaVersion: number;
  categories: CorpusCategoryRecord[];
  fixtures: CorpusFixtureRecord[];
}

/** Minimal typed shape used by tests for roadmap seeded demo entries. */
interface RoadmapSeedDemo {
  id: string;
  sourceName: string;
  sourceUrl: string;
  localScore: string;
  categoryId: string;
}

/** Minimal typed shape used by tests for category-status overrides in roadmap metadata. */
interface RoadmapCategoryStatus {
  id: string;
  status: 'seeded' | 'in-progress' | 'not-started';
  notes: string;
}

/** Minimal typed shape used by tests for the roadmap manifest JSON. */
interface RoadmapManifest {
  suiteSource: string;
  corpusManifestPath: string;
  seedDemos: RoadmapSeedDemo[];
  categoryStatus: RoadmapCategoryStatus[];
}

/** Read and parse JSON from disk with strict UTF-8 semantics. */
async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

describe('lilypond corpus manifest', () => {
  it('indexes the full collated suite with stable category linkage', async () => {
    const corpus = await readJson<CorpusManifest>(LILYPOND_CORPUS_MANIFEST_PATH);

    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.categories.length).toBeGreaterThanOrEqual(30);
    expect(corpus.fixtures.length).toBeGreaterThanOrEqual(156);

    const categoryIds = new Set(corpus.categories.map((category) => category.id));
    const fixtureIds = new Set<string>();

    for (const fixture of corpus.fixtures) {
      expect(categoryIds.has(fixture.categoryId), `${fixture.sourceName} should map to a known category`).toBe(true);
      expect(fixture.sourceUrl.startsWith('https://lilypond.org/')).toBe(true);
      expect(fixtureIds.has(fixture.id), `fixture id '${fixture.id}' should be unique`).toBe(false);
      fixtureIds.add(fixture.id);
    }
  });

  it('keeps roadmap seed demos aligned to corpus source records', async () => {
    const corpus = await readJson<CorpusManifest>(LILYPOND_CORPUS_MANIFEST_PATH);
    const roadmap = await readJson<RoadmapManifest>(LILYPOND_ROADMAP_MANIFEST_PATH);

    expect(roadmap.suiteSource.includes('lilypond.org')).toBe(true);
    expect(path.normalize(roadmap.corpusManifestPath)).toBe(path.normalize('fixtures/corpus/lilypond-collated-v2.25.json'));
    expect(roadmap.seedDemos.length).toBeGreaterThanOrEqual(8);

    const fixturesBySourceName = new Map(corpus.fixtures.map((fixture) => [fixture.sourceName, fixture]));
    const categoryIds = new Set(corpus.categories.map((category) => category.id));

    for (const statusRow of roadmap.categoryStatus) {
      expect(categoryIds.has(statusRow.id), `status entry category '${statusRow.id}' should exist in corpus`).toBe(true);
      expect(statusRow.notes.length).toBeGreaterThan(0);
    }

    for (const seedDemo of roadmap.seedDemos) {
      const fixture = fixturesBySourceName.get(seedDemo.sourceName);
      expect(fixture, `seed demo '${seedDemo.id}' source should exist in corpus`).toBeDefined();
      expect(fixture?.sourceUrl).toBe(seedDemo.sourceUrl);
      expect(fixture?.categoryId).toBe(seedDemo.categoryId);

      const localScorePath = path.resolve(seedDemo.localScore);
      await expect(access(localScorePath)).resolves.toBeUndefined();
    }
  });

  it('keeps LilyPond conformance imports in sync with the corpus manifest', async () => {
    const corpus = await readJson<CorpusManifest>(LILYPOND_CORPUS_MANIFEST_PATH);
    const conformanceFixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance'));
    const lilyPondConformanceFixtures = conformanceFixtures.filter((fixture) =>
      fixture.meta.category.startsWith('lilypond-')
    );

    const corpusSources = new Set(corpus.fixtures.map((fixture) => fixture.sourceUrl));
    const conformanceSources = new Set(lilyPondConformanceFixtures.map((fixture) => fixture.meta.source));

    expect(lilyPondConformanceFixtures.length).toBe(corpus.fixtures.length);
    for (const sourceUrl of corpusSources) {
      expect(conformanceSources.has(sourceUrl), `missing conformance fixture for ${sourceUrl}`).toBe(true);
    }
  });

  it('keeps the only expected-fail LilyPond fixture explicitly triaged as malformed source XML', async () => {
    const conformanceFixtures = await loadConformanceFixtures(path.resolve('fixtures/conformance'));
    const lilyPondExpectedFails = conformanceFixtures.filter(
      (fixture) => fixture.meta.category.startsWith('lilypond-') && fixture.meta.expected === 'fail'
    );

    expect(lilyPondExpectedFails.length).toBe(1);
    const fixture = lilyPondExpectedFails[0];
    if (!fixture) {
      throw new Error('expected one LilyPond expected-fail fixture');
    }

    expect(fixture.meta.id).toBe('lilypond-23c-tuplet-display-nonstandard');
    expect(fixture.meta.notes?.includes('XML_NOT_WELL_FORMED')).toBe(true);
    expect(
      fixture.meta.waivers?.includes('source-malformed-xml:undefined-entity-normal-type-entity-typo')
    ).toBe(true);
  });
});
