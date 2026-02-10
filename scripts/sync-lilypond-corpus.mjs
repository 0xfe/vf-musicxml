/* global console */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Absolute repository root used for deterministic output path resolution.
 * We resolve from this script location so the command works from any cwd.
 */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Canonical LilyPond collated MusicXML suite index for v2.25 docs. */
const LILYPOND_COLLATED_URL = 'https://lilypond.org/doc/v2.25/input/regression/musicxml/collated-files.html';
/** Base URL used to resolve relative fixture links discovered in the collated page. */
const LILYPOND_BASE_URL = 'https://lilypond.org/doc/v2.25/input/regression/musicxml/';
/** Default output path for machine-readable corpus manifest artifacts. */
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, 'fixtures', 'corpus', 'lilypond-collated-v2.25.json');

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   fixtureCount: number;
 * }} LilyPondCategory
 */

/**
 * @typedef {{
 *   id: string;
 *   caseId: string;
 *   sourceName: string;
 *   sourceUrl: string;
 *   categoryId: string;
 * }} LilyPondFixture
 */

/**
 * @typedef {{
 *   schemaVersion: number;
 *   generatedAt: string;
 *   suite: {
 *     sourceUrl: string;
 *     version: string;
 *     license: string;
 *   };
 *   categories: LilyPondCategory[];
 *   fixtures: LilyPondFixture[];
 * }} LilyPondCorpusManifest
 */

/** Parse minimal CLI arguments used by this script. */
function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUTPUT_PATH,
    sourceUrl: LILYPOND_COLLATED_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      args.out = argv[index + 1] ?? args.out;
      index += 1;
      continue;
    }
    if (token === '--source-url') {
      args.sourceUrl = argv[index + 1] ?? args.sourceUrl;
      index += 1;
    }
  }

  return args;
}

/** Fetch the collated suite HTML and fail hard on non-success responses. */
async function fetchSuiteHtml(sourceUrl) {
  const response = await globalThis.fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`failed to download collated suite page (${response.status} ${response.statusText})`);
  }
  return await response.text();
}

/**
 * Decode HTML entities used in category and fixture headings.
 * The LilyPond page uses a small subset so this compact decoder is sufficient.
 */
function decodeEntities(input) {
  return input
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&rsquo;', "'")
    .replaceAll('&ndash;', '-')
    .replaceAll('&mdash;', '-');
}

/** Convert a fixture source filename to a stable lowercase identifier. */
function toFixtureId(sourceName) {
  return sourceName
    .toLowerCase()
    .replace(/\.(xml|mxl)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Convert the collated heading title into a compact category display title. */
function normalizeCategoryTitle(rawTitle) {
  return decodeEntities(rawTitle).replace(/\s+/g, ' ').trim();
}

/** Parse category sections from the collated suite HTML. */
function parseCategories(html) {
  /** @type {LilyPondCategory[]} */
  const categories = [];
  const categoryRegex = /<h3 class="unnumberedsec">(\d{2})\s+\.\.\.\s+([^<]+)<\/h3>/g;
  let match = categoryRegex.exec(html);

  while (match) {
    const id = match[1];
    const title = normalizeCategoryTitle(match[2]);
    categories.push({ id, title, fixtureCount: 0 });
    match = categoryRegex.exec(html);
  }

  return categories;
}

/** Parse fixture records from the collated suite HTML with category assignment. */
function parseFixtures(html, categories) {
  /**
   * The parser walks a stream of category headers, fixture headers, and fixture links.
   * This preserves source ordering and lets us assign each fixture to the nearest category.
   */
  const tokenRegex =
    /<h3 class="unnumberedsec">(\d{2})\s+\.\.\.\s+([^<]+)<\/h3>|<h4 class="subheading">([^<]+\.(xml|mxl))<\/h4>|<p><a href="([^"]+\.(xml|mxl))">/g;
  /** @type {LilyPondFixture[]} */
  const fixtures = [];
  /** @type {string | undefined} */
  let currentCategoryId;
  /** @type {string | undefined} */
  let pendingSourceName;
  let tokenMatch = tokenRegex.exec(html);

  while (tokenMatch) {
    const categoryId = tokenMatch[1];
    const fixtureHeading = tokenMatch[3];
    const fixtureHref = tokenMatch[5];

    if (categoryId) {
      currentCategoryId = categoryId;
    } else if (fixtureHeading) {
      pendingSourceName = decodeEntities(fixtureHeading).trim();
    } else if (fixtureHref && pendingSourceName && currentCategoryId) {
      const sourceUrl = new globalThis.URL(fixtureHref, LILYPOND_BASE_URL).toString();
      const caseIdMatch = pendingSourceName.match(/^(\d{2}[a-z])/i);
      const caseId = caseIdMatch ? caseIdMatch[1].toLowerCase() : pendingSourceName.toLowerCase();

      fixtures.push({
        id: toFixtureId(pendingSourceName),
        caseId,
        sourceName: pendingSourceName,
        sourceUrl,
        categoryId: currentCategoryId
      });
      pendingSourceName = undefined;
    }

    tokenMatch = tokenRegex.exec(html);
  }

  const categoryIds = new Set(categories.map((category) => category.id));
  for (const fixture of fixtures) {
    if (!categoryIds.has(fixture.categoryId)) {
      throw new Error(`fixture ${fixture.sourceName} mapped to unknown category ${fixture.categoryId}`);
    }
  }

  return fixtures;
}

/** Build the normalized corpus manifest JSON object. */
function buildManifest(categories, fixtures) {
  /** @type {Map<string, number>} */
  const fixtureCounts = new Map(categories.map((category) => [category.id, 0]));
  for (const fixture of fixtures) {
    fixtureCounts.set(fixture.categoryId, (fixtureCounts.get(fixture.categoryId) ?? 0) + 1);
  }

  /** @type {LilyPondCategory[]} */
  const normalizedCategories = categories.map((category) => ({
    ...category,
    fixtureCount: fixtureCounts.get(category.id) ?? 0
  }));

  /** @type {LilyPondCorpusManifest} */
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    suite: {
      sourceUrl: LILYPOND_COLLATED_URL,
      version: '2.25',
      license: 'MIT'
    },
    categories: normalizedCategories,
    fixtures
  };

  return manifest;
}

/** Program entrypoint: fetch, parse, and write the corpus manifest artifact. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const html = await fetchSuiteHtml(args.sourceUrl);
  const categories = parseCategories(html);
  const fixtures = parseFixtures(html, categories);
  const manifest = buildManifest(categories, fixtures);

  await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    `Synced LilyPond corpus manifest: ${manifest.categories.length} categories, ${manifest.fixtures.length} fixtures -> ${args.out}`
  );
}

await main();
