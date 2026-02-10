import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { detectSvgOverlaps, extractSvgElementBounds, type SvgOverlap } from './svg-collision.js';

/** Expected fixture behavior for the current implementation stage. */
export type FixtureExpectation = 'pass' | 'fail';
/** Fixture activation status in the conformance suite. */
export type FixtureStatus = 'active' | 'skip';
/** Parse strictness applied during conformance fixture execution. */
export type FixtureParseMode = 'strict' | 'lenient';

/**
 * Optional collision-audit configuration applied to rendered fixture SVG.
 * This keeps collision checks declarative so per-fixture sensitivity can be tuned
 * without editing test code.
 */
export interface ConformanceCollisionAuditMeta {
  selector: string;
  padding?: number;
  min_overlap_area?: number;
  max_overlaps?: number;
}

/** Metadata contract for one conformance fixture sidecar file. */
export interface ConformanceFixtureMeta {
  id: string;
  source: string;
  category: string;
  expected: FixtureExpectation;
  status: FixtureStatus;
  parse_mode?: FixtureParseMode;
  notes?: string;
  linked_todo?: string;
  waivers?: string[];
  collision_audit?: ConformanceCollisionAuditMeta;
}

/** Resolved fixture record including metadata and score file paths. */
export interface ConformanceFixtureRecord {
  metaPath: string;
  scorePath: string;
  meta: ConformanceFixtureMeta;
}

/** Serializable result from executing a configured fixture collision audit. */
export interface ConformanceCollisionAuditReport {
  fixtureId: string;
  selector: string;
  elementCount: number;
  overlapCount: number;
  maxOverlaps: number;
  pass: boolean;
  overlaps: SvgOverlap[];
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
  const parseMode = readOptionalParseMode(filePath, obj, 'parse_mode');
  const linkedTodo = readOptionalString(filePath, obj, 'linked_todo');
  const waivers = readOptionalStringArray(filePath, obj, 'waivers');
  const collisionAudit = readOptionalCollisionAudit(filePath, obj, 'collision_audit');

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
  if (parseMode !== undefined) {
    meta.parse_mode = parseMode;
  }
  if (linkedTodo !== undefined) {
    meta.linked_todo = linkedTodo;
  }
  if (waivers !== undefined) {
    meta.waivers = waivers;
  }
  if (collisionAudit !== undefined) {
    meta.collision_audit = collisionAudit;
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

/** Read optional fixture parse-mode and validate enum membership. */
function readOptionalParseMode(
  filePath: string,
  obj: Record<string, unknown>,
  key: string
): FixtureParseMode | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value !== 'strict' && value !== 'lenient') {
    throw new ConformanceMetadataError(filePath, `'${key}' must be 'strict' or 'lenient'`);
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

/** Read and validate optional nested collision-audit metadata. */
function readOptionalCollisionAudit(
  filePath: string,
  obj: Record<string, unknown>,
  key: string
): ConformanceCollisionAuditMeta | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConformanceMetadataError(filePath, `'${key}' must be an object`);
  }

  const collision = value as Record<string, unknown>;
  const selector = readRequiredString(filePath, collision, 'selector');
  const padding = readOptionalNumber(filePath, collision, 'padding');
  const minOverlapArea = readOptionalNumber(filePath, collision, 'min_overlap_area');
  const maxOverlaps = readOptionalNonNegativeInteger(filePath, collision, 'max_overlaps');

  const result: ConformanceCollisionAuditMeta = { selector };
  if (padding !== undefined) {
    result.padding = padding;
  }
  if (minOverlapArea !== undefined) {
    result.min_overlap_area = minOverlapArea;
  }
  if (maxOverlaps !== undefined) {
    result.max_overlaps = maxOverlaps;
  }

  return result;
}

/** Read an optional numeric metadata field. */
function readOptionalNumber(filePath: string, obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConformanceMetadataError(filePath, `'${key}' must be a finite number`);
  }

  return value;
}

/** Read an optional non-negative integer metadata field. */
function readOptionalNonNegativeInteger(
  filePath: string,
  obj: Record<string, unknown>,
  key: string
): number | undefined {
  const value = readOptionalNumber(filePath, obj, key);
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new ConformanceMetadataError(filePath, `'${key}' must be a non-negative integer`);
  }

  return value;
}

/**
 * Execute configured collision checks for one rendered fixture SVG.
 * Returns `undefined` when the fixture has no `collision_audit` block.
 */
export function runConformanceCollisionAudit(
  svgMarkup: string,
  meta: ConformanceFixtureMeta
): ConformanceCollisionAuditReport | undefined {
  if (!meta.collision_audit) {
    return undefined;
  }

  const selector = meta.collision_audit.selector;
  const maxOverlaps = meta.collision_audit.max_overlaps ?? 0;
  const elements = extractSvgElementBounds(svgMarkup, { selector });
  const overlaps = detectSvgOverlaps(elements, {
    padding: meta.collision_audit.padding,
    minOverlapArea: meta.collision_audit.min_overlap_area
  });

  return {
    fixtureId: meta.id,
    selector,
    elementCount: elements.length,
    overlapCount: overlaps.length,
    maxOverlaps,
    pass: overlaps.length <= maxOverlaps,
    overlaps
  };
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
