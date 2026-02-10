import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Expected fixture behavior for the current implementation stage. */
export type FixtureExpectation = 'pass' | 'fail';
/** Fixture activation status in the conformance suite. */
export type FixtureStatus = 'active' | 'skip';

/** Metadata contract for one conformance fixture sidecar file. */
export interface ConformanceFixtureMeta {
  id: string;
  source: string;
  category: string;
  expected: FixtureExpectation;
  status: FixtureStatus;
  notes?: string;
  linked_todo?: string;
  waivers?: string[];
}

/** Resolved fixture record including metadata and score file paths. */
export interface ConformanceFixtureRecord {
  metaPath: string;
  scorePath: string;
  meta: ConformanceFixtureMeta;
}

/** Validation error for malformed conformance metadata. */
export class ConformanceMetadataError extends Error {
  readonly filePath: string;

  constructor(filePath: string, message: string) {
    super(`Metadata error in ${filePath}: ${message}`);
    this.name = 'ConformanceMetadataError';
    this.filePath = filePath;
  }
}

/** Accepted metadata filename suffixes. */
const META_SUFFIXES = ['.meta.yaml', '.meta.yml'];
/** Score extensions probed when resolving a fixture payload from metadata. */
const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl'];

/** Load and validate all conformance fixture records under `rootDir`. */
export async function loadConformanceFixtures(rootDir: string): Promise<ConformanceFixtureRecord[]> {
  const metaFiles = await findMetadataFiles(rootDir);
  const records: ConformanceFixtureRecord[] = [];

  for (const metaPath of metaFiles) {
    const raw = await readFile(metaPath, 'utf8');
    const parsed = parseYaml(raw);
    const meta = parseAndValidateMeta(metaPath, parsed);
    const scorePath = await resolveScorePath(metaPath);
    records.push({ metaPath, scorePath, meta });
  }

  records.sort((left, right) => left.meta.id.localeCompare(right.meta.id));
  return records;
}

/** Recursively discover metadata files from the conformance root. */
async function findMetadataFiles(rootDir: string): Promise<string[]> {
  const matches: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (META_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        matches.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return matches;
}

/** Parse YAML metadata into a validated `ConformanceFixtureMeta` object. */
function parseAndValidateMeta(filePath: string, input: unknown): ConformanceFixtureMeta {
  if (!input || typeof input !== 'object') {
    throw new ConformanceMetadataError(filePath, 'metadata must be a YAML object');
  }

  const obj = input as Record<string, unknown>;

  const id = readRequiredString(filePath, obj, 'id');
  const source = readRequiredString(filePath, obj, 'source');
  const category = readRequiredString(filePath, obj, 'category');

  const expectedRaw = readRequiredString(filePath, obj, 'expected');
  if (expectedRaw !== 'pass' && expectedRaw !== 'fail') {
    throw new ConformanceMetadataError(filePath, "'expected' must be 'pass' or 'fail'");
  }

  const statusRaw = readRequiredString(filePath, obj, 'status');
  if (statusRaw !== 'active' && statusRaw !== 'skip') {
    throw new ConformanceMetadataError(filePath, "'status' must be 'active' or 'skip'");
  }

  const notes = readOptionalString(filePath, obj, 'notes');
  const linkedTodo = readOptionalString(filePath, obj, 'linked_todo');
  const waivers = readOptionalStringArray(filePath, obj, 'waivers');

  const meta: ConformanceFixtureMeta = {
    id,
    source,
    category,
    expected: expectedRaw,
    status: statusRaw
  };

  if (notes !== undefined) {
    meta.notes = notes;
  }
  if (linkedTodo !== undefined) {
    meta.linked_todo = linkedTodo;
  }
  if (waivers !== undefined) {
    meta.waivers = waivers;
  }

  return meta;
}

/** Read a required non-empty string metadata field. */
function readRequiredString(filePath: string, obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConformanceMetadataError(filePath, `missing or invalid '${key}'`);
  }
  return value;
}

/** Read an optional string metadata field. */
function readOptionalString(filePath: string, obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new ConformanceMetadataError(filePath, `'${key}' must be a string`);
  }

  return value;
}

/** Read an optional string-array metadata field. */
function readOptionalStringArray(
  filePath: string,
  obj: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ConformanceMetadataError(filePath, `'${key}' must be an array of strings`);
  }

  return value;
}

/** Resolve the score file that belongs to one metadata file. */
async function resolveScorePath(metaPath: string): Promise<string> {
  const base = stripMetaSuffix(metaPath);

  for (const extension of SCORE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new ConformanceMetadataError(metaPath, 'no matching score file found for metadata');
}

/** Remove `.meta.yaml`/`.meta.yml` from a metadata file path. */
function stripMetaSuffix(filePath: string): string {
  for (const suffix of META_SUFFIXES) {
    if (filePath.endsWith(suffix)) {
      return filePath.slice(0, -suffix.length);
    }
  }

  return filePath;
}

/** Promise-based existence check used by fixture resolution. */
async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
