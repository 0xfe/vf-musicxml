#!/usr/bin/env node
/* global console, URL, TextDecoder, setTimeout */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

/** Absolute repository root used for deterministic path resolution. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** LilyPond v2.24 collated suite page with reference PNGs used as M8 goldens. */
const LILYPOND_V24_COLLATED_URL =
  'https://lilypond.org/doc/v2.24/input/regression/musicxml/collated-files.html';
/** Base URL used to resolve relative XML/PNG links from the collated suite page. */
const LILYPOND_V24_BASE_URL = 'https://lilypond.org/doc/v2.24/input/regression/musicxml/';
/** Secondary collated suite page used to fill cases missing from v2.24. */
const LILYPOND_V25_COLLATED_URL =
  'https://lilypond.org/doc/v2.25/input/regression/musicxml/collated-files.html';
/** Secondary base URL used when a fixture only exists in v2.25 docs. */
const LILYPOND_V25_BASE_URL = 'https://lilypond.org/doc/v2.25/input/regression/musicxml/';
/** Directory containing local LilyPond conformance fixture files + metadata. */
const LOCAL_LILYPOND_FIXTURE_DIR = path.join(ROOT_DIR, 'fixtures', 'conformance', 'lilypond');
/** Location where golden manifest JSON is written. */
const DEFAULT_MANIFEST_PATH = path.join(ROOT_DIR, 'fixtures', 'golden', 'manifest.json');
/** Location where downloaded LilyPond v2.24 golden PNGs are stored. */
const DEFAULT_IMAGE_DIR = path.join(ROOT_DIR, 'fixtures', 'golden', 'lilypond-v2.24');

/**
 * @typedef {{
 *   id: string;
 *   slug: string;
 *   caseId: string;
 *   categoryId: string;
 *   expected: 'pass' | 'fail';
 *   status: 'active' | 'skip';
 *   sourceUrl: string;
 *   localFixturePath: string;
 * }} LocalLilyPondFixture
 */

/**
 * @typedef {{
 *   slug: string;
  *   sourceName: string;
  *   caseId: string;
  *   categoryId: string;
  *   xmlUrl: string;
  *   imageUrl: string;
  *   referenceKind: 'lilypond-v2.24' | 'lilypond-v2.25-fallback';
 * }} GoldenReference
 */

/**
 * @typedef {{
 *   id: string;
 *   slug: string;
 *   caseId: string;
 *   categoryId: string;
 *   expected: 'pass' | 'fail';
 *   status: 'active' | 'skip';
 *   localFixturePath: string;
 *   conformanceSourceUrl: string;
 *   collatedSourceName: string;
  *   collatedSourceUrl: string;
  *   goldenImageUrl: string;
  *   goldenImagePath: string;
  *   goldenImageSha256: string;
  *   referenceKind: 'lilypond-v2.24' | 'lilypond-v2.25-fallback';
 * }} GoldenManifestFixture
 */

/** Parse CLI args for golden sync workflow. */
function parseArgs(argv) {
  const args = {
    sourceUrl: LILYPOND_V24_COLLATED_URL,
    baseUrl: LILYPOND_V24_BASE_URL,
    fallbackSourceUrl: LILYPOND_V25_COLLATED_URL,
    fallbackBaseUrl: LILYPOND_V25_BASE_URL,
    out: DEFAULT_MANIFEST_PATH,
    imageDir: DEFAULT_IMAGE_DIR,
    download: true,
    force: false,
    cases: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--source-url') {
      args.sourceUrl = argv[index + 1] ?? args.sourceUrl;
      index += 1;
      continue;
    }
    if (token === '--base-url') {
      args.baseUrl = argv[index + 1] ?? args.baseUrl;
      index += 1;
      continue;
    }
    if (token === '--out') {
      args.out = argv[index + 1] ?? args.out;
      index += 1;
      continue;
    }
    if (token === '--fallback-source-url') {
      args.fallbackSourceUrl = argv[index + 1] ?? args.fallbackSourceUrl;
      index += 1;
      continue;
    }
    if (token === '--fallback-base-url') {
      args.fallbackBaseUrl = argv[index + 1] ?? args.fallbackBaseUrl;
      index += 1;
      continue;
    }
    if (token === '--image-dir') {
      args.imageDir = argv[index + 1] ?? args.imageDir;
      index += 1;
      continue;
    }
    if (token === '--cases') {
      const rawCases = argv[index + 1] ?? '';
      args.cases = rawCases
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (token === '--no-download') {
      args.download = false;
      continue;
    }
    if (token === '--force') {
      args.force = true;
    }
  }

  return args;
}

/** Decode HTML entities used in source fixture names and category titles. */
function decodeEntities(input) {
  return input
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&rsquo;', "'")
    .replaceAll('&ldquo;', '"')
    .replaceAll('&rdquo;', '"')
    .replaceAll('&ndash;', '-')
    .replaceAll('&mdash;', '-');
}

/** Convert a source file name like `01a-Pitches-Pitches.xml` to stable slug form. */
function toFixtureSlug(sourceName) {
  return sourceName
    .toLowerCase()
    .replace(/\.(xml|mxl)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Extract canonical case id (`01a`, `23c`, etc.) from source fixture names. */
function extractCaseId(sourceName) {
  const match = sourceName.match(/^(\d{2}[a-z])/i);
  return match ? match[1].toLowerCase() : sourceName.toLowerCase();
}

/** Build sha256 digest for deterministic file identity tracking. */
function computeSha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** Return normalized repo-relative path for stable manifest fields. */
function toRepoRelative(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).split(path.sep).join('/');
}

/** Check whether a filesystem path exists. */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Load active LilyPond conformance fixtures from local metadata sidecars. */
async function loadLocalLilyPondFixtures() {
  const entries = await readdir(LOCAL_LILYPOND_FIXTURE_DIR);
  const metaFileNames = entries.filter((entry) => entry.endsWith('.meta.yaml')).sort();
  /** @type {LocalLilyPondFixture[]} */
  const fixtures = [];

  for (const metaFileName of metaFileNames) {
    const metaPath = path.join(LOCAL_LILYPOND_FIXTURE_DIR, metaFileName);
    const rawMeta = await readFile(metaPath, 'utf8');
    const meta = YAML.parse(rawMeta);

    if (!meta || typeof meta !== 'object') {
      throw new Error(`invalid metadata in ${metaPath}`);
    }
    if (meta.status !== 'active') {
      continue;
    }
    if (typeof meta.id !== 'string' || !meta.id.startsWith('lilypond-')) {
      continue;
    }

    const slug = metaFileName.replace(/\.meta\.yaml$/i, '');
    const caseId = extractCaseId(slug);
    const categoryId = `lilypond-${caseId.slice(0, 2)}`;
    const musicXmlPath = path.join(LOCAL_LILYPOND_FIXTURE_DIR, `${slug}.musicxml`);
    const xmlPath = path.join(LOCAL_LILYPOND_FIXTURE_DIR, `${slug}.xml`);
    const mxlPath = path.join(LOCAL_LILYPOND_FIXTURE_DIR, `${slug}.mxl`);

    let localFixturePath;
    if (await fileExists(musicXmlPath)) {
      localFixturePath = musicXmlPath;
    } else if (await fileExists(xmlPath)) {
      localFixturePath = xmlPath;
    } else if (await fileExists(mxlPath)) {
      localFixturePath = mxlPath;
    } else {
      throw new Error(`missing local fixture body for ${meta.id} (${slug})`);
    }

    fixtures.push({
      id: meta.id,
      slug,
      caseId,
      categoryId,
      expected: meta.expected === 'fail' ? 'fail' : 'pass',
      status: 'active',
      sourceUrl: String(meta.source ?? ''),
      localFixturePath: toRepoRelative(localFixturePath)
    });
  }

  return fixtures;
}

/**
 * Parse fixture records from LilyPond v2.24 collated HTML.
 * We split the document by fixture anchor boundaries and then inspect each block.
 */
function parseGoldenReferences(html, baseUrl) {
  const anchorRegex = /<a name="([^"]+\.(?:xml|mxl))"><\/a>/gi;
  /** @type {Array<{ sourceName: string; index: number; end: number }>} */
  const anchors = [];
  let match = anchorRegex.exec(html);

  while (match) {
    anchors.push({
      sourceName: decodeEntities(match[1]).trim(),
      index: match.index,
      end: match.index + match[0].length
    });
    match = anchorRegex.exec(html);
  }

  /** @type {Map<string, GoldenReference>} */
  const referencesBySlug = new Map();

  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index];
    const next = anchors[index + 1];
    const section = html.slice(current.end, next ? next.index : html.length);

    const xmlHrefMatch = section.match(/href="([^"]+\.(?:xml|mxl))"/i);
    const imageSrcMatch = section.match(/<img[^>]*src="([^"]+\.png)"/i);
    if (!xmlHrefMatch || !imageSrcMatch) {
      continue;
    }

    const slug = toFixtureSlug(current.sourceName);
    const caseId = extractCaseId(current.sourceName);
    const categoryId = caseId.slice(0, 2);

    referencesBySlug.set(slug, {
      slug,
      sourceName: current.sourceName,
      caseId,
      categoryId,
      xmlUrl: new URL(xmlHrefMatch[1], baseUrl).toString(),
      imageUrl: new URL(imageSrcMatch[1], baseUrl).toString(),
      referenceKind: baseUrl.includes('/v2.24/')
        ? 'lilypond-v2.24'
        : 'lilypond-v2.25-fallback'
    });
  }

  /**
   * LilyPond v2.25 pages commonly describe fixtures using `<h4 class="subheading">...`.
   * Parse these blocks as a fallback so we can reuse one sync pipeline across versions.
   */
  const subheadingRegex =
    /<h4 class="subheading">([^<]+\.(?:xml|mxl))<\/h4>[\s\S]*?<a href="([^"]+\.(?:xml|mxl))">[\s\S]*?<img[^>]*src="([^"]+\.png)"/gi;
  let subheadingMatch = subheadingRegex.exec(html);

  while (subheadingMatch) {
    const sourceName = decodeEntities(subheadingMatch[1]).trim();
    const slug = toFixtureSlug(sourceName);
    if (!referencesBySlug.has(slug)) {
      const caseId = extractCaseId(sourceName);
      const categoryId = caseId.slice(0, 2);
      referencesBySlug.set(slug, {
        slug,
        sourceName,
        caseId,
        categoryId,
        xmlUrl: new URL(subheadingMatch[2], baseUrl).toString(),
        imageUrl: new URL(subheadingMatch[3], baseUrl).toString(),
        referenceKind: baseUrl.includes('/v2.24/')
          ? 'lilypond-v2.24'
          : 'lilypond-v2.25-fallback'
      });
    }
    subheadingMatch = subheadingRegex.exec(html);
  }

  return referencesBySlug;
}

/** Build secondary lookup by case-id for fixtures whose slug changed across suite versions. */
function buildCaseIdReferenceMap(referencesBySlug) {
  /** @type {Map<string, GoldenReference>} */
  const referencesByCaseId = new Map();
  for (const reference of referencesBySlug.values()) {
    // Case IDs are unique in this suite; keep first if duplicates ever appear.
    if (!referencesByCaseId.has(reference.caseId)) {
      referencesByCaseId.set(reference.caseId, reference);
    }
  }
  return referencesByCaseId;
}

/** Download URL with compact retry logic for intermittent network failures. */
async function fetchWithRetry(url, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        throw new Error(`request failed (${response.status} ${response.statusText})`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/** Main sync flow: parse references, optionally download assets, and write manifest. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const primaryHtml = await fetchWithRetry(args.sourceUrl, 2);
  const fallbackHtml = await fetchWithRetry(args.fallbackSourceUrl, 2);
  const primaryReferencesBySlug = parseGoldenReferences(new TextDecoder().decode(primaryHtml), args.baseUrl);
  const fallbackReferencesBySlug = parseGoldenReferences(
    new TextDecoder().decode(fallbackHtml),
    args.fallbackBaseUrl
  );
  const primaryReferencesByCaseId = buildCaseIdReferenceMap(primaryReferencesBySlug);
  const fallbackReferencesByCaseId = buildCaseIdReferenceMap(fallbackReferencesBySlug);
  const localFixtures = await loadLocalLilyPondFixtures();

  /** Optional case-id filtering for partial sync while iterating locally. */
  const selectedFixtures =
    args.cases && args.cases.length > 0
      ? localFixtures.filter((fixture) => args.cases.includes(fixture.caseId))
      : localFixtures;

  await mkdir(path.dirname(args.out), { recursive: true });
  await mkdir(args.imageDir, { recursive: true });

  /** @type {GoldenManifestFixture[]} */
  const manifestFixtures = [];
  /** @type {string[]} */
  const missingReferences = [];
  let fallbackReferenceCount = 0;
  let downloadCount = 0;

  for (const fixture of selectedFixtures) {
    const reference =
      primaryReferencesBySlug.get(fixture.slug) ??
      fallbackReferencesBySlug.get(fixture.slug) ??
      primaryReferencesByCaseId.get(fixture.caseId) ??
      fallbackReferencesByCaseId.get(fixture.caseId);
    if (!reference) {
      missingReferences.push(fixture.id);
      continue;
    }
    if (reference.referenceKind === 'lilypond-v2.25-fallback') {
      fallbackReferenceCount += 1;
    }

    const goldenImagePath = path.join(args.imageDir, `${fixture.slug}.png`);
    const shouldDownload = args.download && (args.force || !(await fileExists(goldenImagePath)));
    if (shouldDownload) {
      const bytes = await fetchWithRetry(reference.imageUrl, 2);
      await writeFile(goldenImagePath, bytes);
      downloadCount += 1;
    }

    if (!(await fileExists(goldenImagePath))) {
      throw new Error(`missing golden image for ${fixture.id}: ${goldenImagePath}`);
    }

    const imageBytes = await readFile(goldenImagePath);
    const goldenImageSha256 = computeSha256(imageBytes);

    manifestFixtures.push({
      id: fixture.id,
      slug: fixture.slug,
      caseId: fixture.caseId,
      categoryId: fixture.categoryId,
      expected: fixture.expected,
      status: fixture.status,
      localFixturePath: fixture.localFixturePath,
      conformanceSourceUrl: fixture.sourceUrl,
      collatedSourceName: reference.sourceName,
      collatedSourceUrl: reference.xmlUrl,
      goldenImageUrl: reference.imageUrl,
      goldenImagePath: toRepoRelative(goldenImagePath),
      goldenImageSha256,
      referenceKind: reference.referenceKind
    });
  }

  if (missingReferences.length > 0) {
    throw new Error(
      `missing LilyPond v2.24 golden references for ${missingReferences.length} fixtures: ${missingReferences.join(', ')}`
    );
  }

  manifestFixtures.sort((left, right) => left.id.localeCompare(right.id));

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    suite: {
      sourceUrl: args.sourceUrl,
      baseUrl: args.baseUrl,
      fallbackSourceUrl: args.fallbackSourceUrl,
      fallbackBaseUrl: args.fallbackBaseUrl,
      version: '2.24',
      license: 'MIT'
    },
    summary: {
      fixtureCount: manifestFixtures.length,
      downloadedCount: downloadCount,
      fallbackReferenceCount
    },
    fixtures: manifestFixtures
  };

  await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    `Synced LilyPond v2.24 golden references: ${manifestFixtures.length} fixtures (${downloadCount} downloaded) -> ${args.out}`
  );
}

await main();
