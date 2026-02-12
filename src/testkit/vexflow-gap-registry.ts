import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Lifecycle stages used for VexFlow gap tracking from detection through de-patch. */
export type VexflowGapLifecycleStage =
  | 'detected'
  | 'reproduced'
  | 'local_patch'
  | 'upstream_pr'
  | 'merged'
  | 'released'
  | 'de_patched';

/** Local workaround shape used by gap records to point at concrete code/patch locations. */
export interface VexflowGapLocalPatchInfo {
  type: 'wrapper' | 'patch-package' | 'none';
  scope: string;
  path?: string;
  patch_file?: string;
}

/** Upstream tracking fields attached to each gap entry. */
export interface VexflowGapUpstreamInfo {
  issue_url?: string;
  pr_url?: string;
  target_branch?: string;
  status: 'not_started' | 'planned' | 'opened' | 'merged' | 'released';
}

/** One registry row that maps a renderer gap to fixtures, diagnostics, and upstream state. */
export interface VexflowGapRegistryEntry {
  id: string;
  title: string;
  lifecycle_stage: VexflowGapLifecycleStage;
  severity: 'low' | 'medium' | 'high' | 'critical';
  owner: string;
  musicxml_fixture_ids: string[];
  diagnostic_codes: string[];
  workaround_summary: string;
  local_patch: VexflowGapLocalPatchInfo;
  upstream: VexflowGapUpstreamInfo;
  tests: string[];
  updated_at: string;
}

/** Root registry contract loaded from `fixtures/vexflow/gap-registry.json`. */
export interface VexflowGapRegistry {
  version: string;
  generated_at: string;
  entries: VexflowGapRegistryEntry[];
}

/** Validation issue emitted when the registry breaks policy or contains stale links. */
export interface VexflowGapRegistryValidationIssue {
  entryId?: string;
  message: string;
}

/** Load and parse gap registry JSON from disk. */
export async function loadVexflowGapRegistry(filePath: string): Promise<VexflowGapRegistry> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as VexflowGapRegistry;
}

/** Validate registry structure, lifecycle policy fields, and fixture/test/patch references. */
export async function validateVexflowGapRegistry(
  registry: VexflowGapRegistry,
  options: {
    knownFixtureIds: Set<string>;
    workspaceRoot: string;
  }
): Promise<VexflowGapRegistryValidationIssue[]> {
  const issues: VexflowGapRegistryValidationIssue[] = [];

  if (!registry.version || typeof registry.version !== 'string') {
    issues.push({ message: 'registry.version must be a non-empty string' });
  }

  if (!registry.generated_at || typeof registry.generated_at !== 'string') {
    issues.push({ message: 'registry.generated_at must be a non-empty string timestamp' });
  }

  if (!Array.isArray(registry.entries)) {
    issues.push({ message: 'registry.entries must be an array' });
    return issues;
  }

  const seenIds = new Set<string>();

  for (const entry of registry.entries) {
    if (!entry.id || typeof entry.id !== 'string') {
      issues.push({ message: 'entry.id must be a non-empty string' });
      continue;
    }

    const entryId = entry.id;
    if (seenIds.has(entryId)) {
      issues.push({ entryId, message: 'duplicate entry.id' });
    }
    seenIds.add(entryId);

    if (!entry.title || typeof entry.title !== 'string') {
      issues.push({ entryId, message: 'title must be a non-empty string' });
    }

    if (!entry.owner || typeof entry.owner !== 'string') {
      issues.push({ entryId, message: 'owner must be a non-empty string' });
    }

    if (!Array.isArray(entry.musicxml_fixture_ids) || entry.musicxml_fixture_ids.length === 0) {
      issues.push({ entryId, message: 'musicxml_fixture_ids must contain at least one fixture ID' });
    } else {
      for (const fixtureId of entry.musicxml_fixture_ids) {
        if (!options.knownFixtureIds.has(fixtureId)) {
          issues.push({ entryId, message: `unknown fixture reference '${fixtureId}'` });
        }
      }
    }

    if (!Array.isArray(entry.diagnostic_codes) || entry.diagnostic_codes.length === 0) {
      issues.push({ entryId, message: 'diagnostic_codes must contain at least one diagnostic code' });
    }

    if (!entry.workaround_summary || typeof entry.workaround_summary !== 'string') {
      issues.push({ entryId, message: 'workaround_summary must be a non-empty string' });
    }

    if (!entry.updated_at || typeof entry.updated_at !== 'string') {
      issues.push({ entryId, message: 'updated_at must be a non-empty string timestamp' });
    }

    if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
      issues.push({ entryId, message: 'tests must contain at least one test path' });
    } else {
      for (const testPath of entry.tests) {
        const resolvedTestPath = resolveWorkspacePath(testPath, options.workspaceRoot);
        if (!(await pathExists(resolvedTestPath))) {
          issues.push({ entryId, message: `test path does not exist: ${testPath}` });
        }
      }
    }

    if (!entry.local_patch || typeof entry.local_patch !== 'object') {
      issues.push({ entryId, message: 'local_patch is required' });
    } else if (entry.local_patch.type === 'patch-package') {
      const patchPath = entry.local_patch.patch_file;
      if (!patchPath) {
        issues.push({ entryId, message: "local_patch.patch_file is required for 'patch-package' type" });
      } else if (!(await pathExists(resolveWorkspacePath(patchPath, options.workspaceRoot)))) {
        issues.push({ entryId, message: `patch file does not exist: ${patchPath}` });
      }
    }

    if (!entry.upstream || typeof entry.upstream !== 'object') {
      issues.push({ entryId, message: 'upstream tracking block is required' });
    } else if (entry.upstream.status !== 'released') {
      if (!entry.upstream.target_branch) {
        issues.push({ entryId, message: 'upstream.target_branch is required before release' });
      } else if (!entry.upstream.target_branch.startsWith('codex/vexflow-')) {
        issues.push({ entryId, message: "upstream.target_branch must start with 'codex/vexflow-'" });
      }
    }
  }

  return issues;
}

/** Check filesystem existence without throwing. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve registry paths against the current workspace root.
 * The registry now stores portable relative paths, but this resolver also keeps
 * backward compatibility for older absolute paths that were authored under a
 * `/.../musicxml/...` root on another machine.
 */
function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  if (!path.isAbsolute(inputPath)) {
    return path.resolve(workspaceRoot, inputPath);
  }

  if (inputPath.startsWith(`${workspaceRoot}${path.sep}`) || inputPath === workspaceRoot) {
    return inputPath;
  }

  const legacyRootMarker = `${path.sep}musicxml${path.sep}`;
  const markerIndex = inputPath.lastIndexOf(legacyRootMarker);
  if (markerIndex < 0) {
    return inputPath;
  }

  const legacyRelativeSuffix = inputPath.slice(markerIndex + legacyRootMarker.length);
  return path.resolve(workspaceRoot, legacyRelativeSuffix);
}
