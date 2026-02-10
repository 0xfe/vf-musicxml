import { inflateRawSync } from 'node:zlib';

import type { Diagnostic } from '../core/diagnostics.js';
import { parseXmlToAst, XmlParseError } from './xml-ast.js';
import { attribute, firstChild } from './xml-utils.js';

/** ZIP local-file header signature. */
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
/** ZIP central-directory file-header signature. */
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
/** ZIP end-of-central-directory signature. */
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** Maximum ZIP comment size used by EOCD backwards scan. */
const ZIP_MAX_COMMENT_LENGTH = 0xffff;

/** Extracted ZIP entry metadata required for payload decoding. */
interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Result envelope for MXL extraction. */
export interface MxlExtractionResult {
  xmlText?: string;
  diagnostics: Diagnostic[];
}

/**
 * Extract the MusicXML payload from an MXL (ZIP) container.
 * This resolves `META-INF/container.xml` when present and falls back to first score-like XML entry.
 */
export function extractMusicXmlFromMxl(data: Uint8Array, sourceName?: string): MxlExtractionResult {
  const diagnostics: Diagnostic[] = [];
  const textDecoder = new TextDecoder();

  let entries: ZipEntry[];
  try {
    entries = readZipEntries(data);
  } catch (error) {
    diagnostics.push({
      code: 'MXL_INVALID_ARCHIVE',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Invalid MXL archive.'
    });
    return { diagnostics };
  }

  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const containerEntry = findContainerEntry(entryMap);

  let scorePath: string | undefined;
  if (!containerEntry) {
    diagnostics.push({
      code: 'MXL_CONTAINER_MISSING',
      severity: 'warning',
      message: 'META-INF/container.xml not found; falling back to first score XML entry.'
    });
  } else {
    try {
      const containerXmlBytes = decodeZipEntry(data, containerEntry);
      const containerXml = textDecoder.decode(containerXmlBytes);
      scorePath = parseRootFilePath(containerXml, sourceName, diagnostics);
    } catch (error) {
      diagnostics.push({
        code: 'MXL_CONTAINER_READ_FAILED',
        severity: 'warning',
        message: error instanceof Error ? error.message : 'Unable to read container.xml; using fallback score lookup.'
      });
    }
  }

  if (!scorePath) {
    scorePath = findFallbackScorePath(entries);
  }

  if (!scorePath) {
    diagnostics.push({
      code: 'MXL_SCORE_FILE_NOT_FOUND',
      severity: 'error',
      message: 'No score XML file found in MXL archive.'
    });
    return { diagnostics };
  }

  const scoreEntry = findEntryByPath(entryMap, scorePath);
  if (!scoreEntry) {
    diagnostics.push({
      code: 'MXL_SCORE_FILE_NOT_FOUND',
      severity: 'error',
      message: `Referenced score path '${scorePath}' not found in MXL archive.`
    });
    return { diagnostics };
  }

  try {
    const scoreXmlBytes = decodeZipEntry(data, scoreEntry);
    const xmlText = textDecoder.decode(scoreXmlBytes);
    return { xmlText, diagnostics };
  } catch (error) {
    diagnostics.push({
      code: 'MXL_SCORE_FILE_READ_FAILED',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Unable to read score XML entry from MXL archive.'
    });
    return { diagnostics };
  }
}

/** Read all entries from ZIP central directory metadata. */
function readZipEntries(data: Uint8Array): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectoryOffset(data);
  const totalEntries = readUInt16LE(data, eocdOffset + 10);
  const centralDirectorySize = readUInt32LE(data, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32LE(data, eocdOffset + 16);

  if (centralDirectoryOffset + centralDirectorySize > data.length) {
    throw new Error('MXL central directory exceeds archive bounds.');
  }

  const entries: ZipEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    ensureBounds(data, cursor, 46, 'central directory header');
    const signature = readUInt32LE(data, cursor);
    if (signature !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('MXL central directory header signature is invalid.');
    }

    const compressionMethod = readUInt16LE(data, cursor + 10);
    const compressedSize = readUInt32LE(data, cursor + 20);
    const uncompressedSize = readUInt32LE(data, cursor + 24);
    const fileNameLength = readUInt16LE(data, cursor + 28);
    const extraLength = readUInt16LE(data, cursor + 30);
    const fileCommentLength = readUInt16LE(data, cursor + 32);
    const localHeaderOffset = readUInt32LE(data, cursor + 42);

    const nameOffset = cursor + 46;
    ensureBounds(data, nameOffset, fileNameLength, 'central directory file name');
    const name = decodeEntryName(data.subarray(nameOffset, nameOffset + fileNameLength));

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    cursor = nameOffset + fileNameLength + extraLength + fileCommentLength;
  }

  return entries;
}

/** Locate EOCD signature by scanning backwards from archive tail. */
function findEndOfCentralDirectoryOffset(data: Uint8Array): number {
  const minOffset = Math.max(0, data.length - (22 + ZIP_MAX_COMMENT_LENGTH));
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32LE(data, offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('MXL end-of-central-directory signature not found.');
}

/** Decode and inflate an entry payload from local file header coordinates. */
function decodeZipEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
  ensureBounds(data, entry.localHeaderOffset, 30, 'local file header');

  const signature = readUInt32LE(data, entry.localHeaderOffset);
  if (signature !== ZIP_LOCAL_HEADER_SIGNATURE) {
    throw new Error(`Local file header is invalid for entry '${entry.name}'.`);
  }

  const fileNameLength = readUInt16LE(data, entry.localHeaderOffset + 26);
  const extraLength = readUInt16LE(data, entry.localHeaderOffset + 28);
  const payloadOffset = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  ensureBounds(data, payloadOffset, entry.compressedSize, `entry payload '${entry.name}'`);

  const compressed = data.subarray(payloadOffset, payloadOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return compressed;
  }

  if (entry.compressionMethod === 8) {
    const inflated = inflateRawSync(Buffer.from(compressed));
    return new Uint8Array(inflated);
  }

  throw new Error(`Unsupported compression method ${entry.compressionMethod} for entry '${entry.name}'.`);
}

/** Parse container.xml and return first rootfile path, if valid. */
function parseRootFilePath(
  containerXml: string,
  sourceName: string | undefined,
  diagnostics: Diagnostic[]
): string | undefined {
  try {
    const root = parseXmlToAst(containerXml, sourceName ?? 'META-INF/container.xml');
    const rootfiles = firstChild(root, 'rootfiles');
    const rootfile = firstChild(rootfiles, 'rootfile');
    const fullPath = attribute(rootfile, 'full-path');

    if (!fullPath) {
      diagnostics.push({
        code: 'MXL_CONTAINER_INVALID',
        severity: 'warning',
        message: 'container.xml is missing rootfile full-path; using fallback score lookup.'
      });
      return undefined;
    }

    return normalizePath(fullPath);
  } catch (error) {
    if (error instanceof XmlParseError) {
      diagnostics.push({
        code: 'MXL_CONTAINER_INVALID',
        severity: 'warning',
        message: `container.xml is malformed (${error.message}); using fallback score lookup.`
      });
      return undefined;
    }

    throw error;
  }
}

/** Prefer MusicXML entry names while ignoring container metadata itself. */
function findFallbackScorePath(entries: ZipEntry[]): string | undefined {
  for (const entry of entries) {
    const normalized = normalizePath(entry.name);
    const lower = normalized.toLowerCase();
    if (lower === 'meta-inf/container.xml') {
      continue;
    }
    if (lower.endsWith('.musicxml')) {
      return normalized;
    }
  }

  for (const entry of entries) {
    const normalized = normalizePath(entry.name);
    const lower = normalized.toLowerCase();
    if (lower === 'meta-inf/container.xml') {
      continue;
    }
    if (lower.endsWith('.xml')) {
      return normalized;
    }
  }

  return undefined;
}

/** Locate container entry using case-insensitive path matching. */
function findContainerEntry(entryMap: Map<string, ZipEntry>): ZipEntry | undefined {
  return findEntryByPath(entryMap, 'META-INF/container.xml');
}

/** Find entry by normalized path using case-insensitive fallback. */
function findEntryByPath(entryMap: Map<string, ZipEntry>, path: string): ZipEntry | undefined {
  const normalized = normalizePath(path);

  if (entryMap.has(normalized)) {
    return entryMap.get(normalized);
  }

  const lower = normalized.toLowerCase();
  for (const [name, entry] of entryMap.entries()) {
    if (name.toLowerCase() === lower) {
      return entry;
    }
  }

  return undefined;
}

/** Decode a ZIP entry name. */
function decodeEntryName(bytes: Uint8Array): string {
  return normalizePath(new TextDecoder().decode(bytes));
}

/** Normalize ZIP paths for matching and map lookups. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Read unsigned 16-bit little-endian value with bounds checks. */
function readUInt16LE(data: Uint8Array, offset: number): number {
  ensureBounds(data, offset, 2, 'u16');
  return data[offset]! | (data[offset + 1]! << 8);
}

/** Read unsigned 32-bit little-endian value with bounds checks. */
function readUInt32LE(data: Uint8Array, offset: number): number {
  ensureBounds(data, offset, 4, 'u32');
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}

/** Ensure read windows are within archive bounds. */
function ensureBounds(data: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new Error(`MXL ${label} exceeds archive bounds.`);
  }
}
