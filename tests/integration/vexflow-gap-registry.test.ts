import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConformanceFixtures } from '../../src/testkit/conformance.js';
import { loadVexflowGapRegistry, validateVexflowGapRegistry } from '../../src/testkit/vexflow-gap-registry.js';

describe('vexflow gap registry', () => {
  it('contains valid fixture/test/upstream linkage for all registered gaps', async () => {
    const [registry, fixtures] = await Promise.all([
      loadVexflowGapRegistry(path.resolve('fixtures/vexflow/gap-registry.json')),
      loadConformanceFixtures(path.resolve('fixtures/conformance'))
    ]);

    const knownFixtureIds = new Set(fixtures.map((fixture) => fixture.meta.id));
    const issues = await validateVexflowGapRegistry(registry, {
      knownFixtureIds,
      workspaceRoot: path.resolve('.')
    });

    expect(issues).toEqual([]);
    expect(registry.entries.length).toBeGreaterThanOrEqual(1);
  });
});
