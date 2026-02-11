/* global console, process */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadVexflowGapRegistry } from '../dist/testkit/index.js';

/** Default VexFlow gap registry path. */
const DEFAULT_REGISTRY_PATH = '/Users/mo/git/musicxml/fixtures/vexflow/gap-registry.json';
/** Default output directory for generated upstream brief artifacts. */
const DEFAULT_OUT_DIR = '/Users/mo/git/musicxml/artifacts/vexflow-upstream';

/** Build markdown guidance per gap entry for issue/PR creation workflows. */
function formatBriefMarkdown(registry) {
  const lines = [
    '# VexFlow Upstream Brief',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Registry version: ${registry.version}`,
    ''
  ];

  for (const entry of registry.entries) {
    lines.push(`## ${entry.id}: ${entry.title}`);
    lines.push('');
    lines.push(`- Lifecycle stage: ${entry.lifecycle_stage}`);
    lines.push(`- Severity: ${entry.severity}`);
    lines.push(`- Owner: ${entry.owner}`);
    lines.push(`- Upstream status: ${entry.upstream.status}`);
    lines.push(`- Target branch: ${entry.upstream.target_branch ?? 'n/a'}`);
    if (entry.upstream.issue_url) {
      lines.push(`- Issue: ${entry.upstream.issue_url}`);
    }
    if (entry.upstream.pr_url) {
      lines.push(`- PR: ${entry.upstream.pr_url}`);
    }
    lines.push(`- Fixtures: ${entry.musicxml_fixture_ids.join(', ')}`);
    lines.push(`- Diagnostics: ${entry.diagnostic_codes.join(', ')}`);
    lines.push(`- Local patch type: ${entry.local_patch.type}`);
    lines.push(`- Workaround: ${entry.workaround_summary}`);
    lines.push('');
    lines.push('Issue template checklist:');
    lines.push('- [ ] Reproducer fixture IDs attached');
    lines.push('- [ ] Diagnostics and observed behavior described');
    lines.push('- [ ] Before/after screenshots attached');
    lines.push('');
    lines.push('PR template checklist:');
    lines.push('- [ ] Failing test linked');
    lines.push('- [ ] Passing test linked');
    lines.push('- [ ] Patch/workaround delta described');
    lines.push('- [ ] De-patch plan documented');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/** Generate upstream planning artifacts from the registry. */
async function main() {
  const registryPath = process.argv[2] ?? DEFAULT_REGISTRY_PATH;
  const outDir = process.argv[3] ?? DEFAULT_OUT_DIR;

  const registry = await loadVexflowGapRegistry(registryPath);
  await mkdir(outDir, { recursive: true });

  const markdownPath = path.join(outDir, 'upstream-brief.md');
  const jsonPath = path.join(outDir, 'upstream-brief.json');

  await writeFile(markdownPath, formatBriefMarkdown(registry), 'utf8');
  await writeFile(
    jsonPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: registry.entries }, null, 2)}\n`,
    'utf8'
  );

  console.log(`wrote ${markdownPath}`);
  console.log(`wrote ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
