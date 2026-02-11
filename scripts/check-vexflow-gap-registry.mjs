/* global console, process */

import { loadConformanceFixtures, loadVexflowGapRegistry, validateVexflowGapRegistry } from '../dist/testkit/index.js';

/** Default VexFlow gap registry path used by M7D checks. */
const DEFAULT_GAP_REGISTRY_PATH = '/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json';
/** Default conformance fixture root used to validate fixture references. */
const DEFAULT_CONFORMANCE_ROOT = '/Users/mo/git/musicxml/fixtures/conformance';
/** Default workspace root used for absolute-path validation in registry links. */
const DEFAULT_WORKSPACE_ROOT = '/Users/mo/git/musicxml';

/** Run VexFlow gap registry validation and exit non-zero on policy violations. */
async function main() {
  const registryPath = process.argv[2] ?? DEFAULT_GAP_REGISTRY_PATH;
  const conformanceRoot = process.argv[3] ?? DEFAULT_CONFORMANCE_ROOT;

  const [registry, fixtures] = await Promise.all([
    loadVexflowGapRegistry(registryPath),
    loadConformanceFixtures(conformanceRoot)
  ]);

  const knownFixtureIds = new Set(fixtures.map((fixture) => fixture.meta.id));
  const issues = await validateVexflowGapRegistry(registry, {
    knownFixtureIds,
    workspaceRoot: DEFAULT_WORKSPACE_ROOT
  });

  if (issues.length > 0) {
    console.error(`VexFlow gap registry validation failed (${issues.length} issue(s))`);
    for (const issue of issues) {
      const prefix = issue.entryId ? `[${issue.entryId}]` : '[registry]';
      console.error(`${prefix} ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `VexFlow gap registry OK (${registry.entries.length} entr${registry.entries.length === 1 ? 'y' : 'ies'})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
