/* global console */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { parseMusicXMLAsync, renderToSVGPages } from '../dist/public/index.js';
import { loadConformanceFixtures } from '../dist/testkit/index.js';
import { extractSvgElementBounds } from '../dist/testkit/svg-collision.js';

/** Absolute repository root path resolved from this script location. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Generated static demo site output directory. */
const SITE_DIR = path.join(ROOT_DIR, 'demos', 'site');
/** LilyPond demo roadmap manifest tracked in git. */
const LILYPOND_MANIFEST_PATH = path.join(ROOT_DIR, 'demos', 'lilypond', 'manifest.json');
/** Real-world corpus metadata used to select complex showcase demos. */
const REALWORLD_CORPUS_PATH = path.join(ROOT_DIR, 'fixtures', 'corpus', 'real-world-samples.json');
/** Conformance fixture root used for roadmap alignment reporting. */
const CONFORMANCE_FIXTURES_DIR = path.join(ROOT_DIR, 'fixtures', 'conformance');
/** Demo pages use the same default scale as the library renderer. */
const DEMO_RENDER_SCALE = 0.7;
/** Render wide first, then trim SVG viewBox to notation bounds for dense/short scores. */
const DEMO_PAGE_WIDTH = 1320;
/** Extra vertical room keeps long systems intact before post-render crop. */
const DEMO_PAGE_HEIGHT = 1800;
/** Selector set used to estimate visible notation bounds for dynamic demo canvas sizing. */
const DEMO_NOTATION_BOUNDS_SELECTOR = [
  '.vf-stavenote',
  '.vf-notehead',
  '.vf-stem',
  '.vf-beam',
  '.vf-flag',
  '.vf-staveline',
  '.vf-clef',
  '.vf-modifiers',
  '.vf-keysignature',
  '.vf-timesignature',
  '.vf-stroke',
  '.vf-annotation',
  '.vf-ornament',
  '.vf-articulation',
  '.vf-stavetext',
  '.vf-staverepetition',
  '.vf-stavetempo',
].join(', ');
/** Text selector used for optional lyric/chord inclusion after notation bounds are known. */
const DEMO_TEXT_BOUNDS_SELECTOR = 'text';
/** Padding applied around trimmed notation bounds to avoid clipping tall glyphs. */
const DEMO_SVG_TRIM_PADDING = 20;
/** Vertical reach above/below notation where text still counts as musical content. */
const DEMO_TEXT_VERTICAL_INCLUSION_PADDING = {
  top: 40,
  bottom: 132
};
/** Horizontal reach around notation bounds where text still counts as musical content. */
const DEMO_TEXT_HORIZONTAL_INCLUSION_PADDING = 40;

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   description: string;
 *   sourceName: string;
 *   sourceUrl: string;
 *   localScore: string;
 *   categoryId: string;
 * }} LilyPondSeedDemo
 */

/**
 * @typedef {{
 *   id: string;
 *   // Demo-page seeding progress for this category. This is intentionally
 *   // separate from conformance completion status.
 *   status: 'seeded' | 'in-progress' | 'not-started';
 *   notes: string;
 * }} LilyPondCategoryStatus
 */

/**
 * @typedef {{
 *   suiteSource: string;
 *   corpusManifestPath: string;
 *   endGoal: string;
 *   categoryStatusSemantics?: string;
 *   seedDemos: LilyPondSeedDemo[];
 *   categoryStatus: LilyPondCategoryStatus[];
 * }} LilyPondManifest
 */

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   fixtureCount: number;
 * }} LilyPondCorpusCategory
 */

/**
 * @typedef {{
 *   sourceName: string;
 *   sourceUrl: string;
 *   categoryId: string;
 * }} LilyPondCorpusFixture
 */

/**
 * @typedef {{
 *   categories: LilyPondCorpusCategory[];
 *   fixtures: LilyPondCorpusFixture[];
 * }} LilyPondCorpusManifest
 */

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   description: string;
 *   sourceName: string;
 *   sourceUrl: string;
 *   scorePath: string;
 *   expected: 'pass' | 'fail';
 *   parseMode: 'strict' | 'lenient';
 *   category: string;
 *   categoryLabel?: string;
 *   collection: 'lilypond' | 'realworld';
 * }} DemoDefinition
 */

/**
 * @typedef {{
 *   observedOutcome: 'pass' | 'parse-fail' | 'render-fail';
 *   svgMarkup: string | null;
 *   diagnostics: import('../src/core/diagnostics.js').Diagnostic[];
 * }} DemoRenderOutcome
 */

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   bucket: string;
 *   complexity_level: 'small' | 'medium' | 'large';
 *   part_count_hint: number;
 *   long_form: boolean;
 *   sourceUrl: string;
 *   notes: string;
 * }} RealWorldSample
 */

/**
 * @typedef {{
 *   schemaVersion: number;
 *   generatedAt: string;
 *   samples: RealWorldSample[];
 * }} RealWorldCorpusManifest
 */

/**
 * Escape text for safe embedding in HTML.
 * Demo pages only embed trusted local strings, but escaping keeps output robust.
 */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Convert diagnostics to a readable HTML list for demo inspection. */
function renderDiagnosticsList(diagnostics) {
  if (diagnostics.length === 0) {
    return '<p class="diag-ok">No diagnostics.</p>';
  }

  const items = diagnostics
    .map((diagnostic) => {
      const code = escapeHtml(diagnostic.code);
      const severity = escapeHtml(diagnostic.severity);
      const message = escapeHtml(diagnostic.message);
      return `<li><strong>[${severity}] ${code}</strong>: ${message}</li>`;
    })
    .join('\n');

  return `<ul class="diag-list">${items}</ul>`;
}

/** Derive a compact source label from URL/path when explicit names are unavailable. */
function inferSourceName(sourceUrl, scorePath) {
  if (sourceUrl) {
    try {
      const { pathname } = new globalThis.URL(sourceUrl);
      const urlLeaf = path.basename(pathname);
      if (urlLeaf) {
        return urlLeaf;
      }
    } catch {
      // Non-URL sources fall back to score path.
    }
  }

  return path.basename(scorePath);
}

/** Build a source-reference line for one demo page. */
function renderDemoSource(demo) {
  const sourceLabel = escapeHtml(demo.sourceName);
  if (!demo.sourceUrl) {
    return `<p><strong>Source:</strong> ${sourceLabel}</p>`;
  }
  const sourceUrl = escapeHtml(demo.sourceUrl);
  return `<p><strong>Source:</strong> <a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceLabel}</a></p>`;
}

/** Build one standalone HTML page for a rendered demo score. */
function buildDemoPageHtml(demo, renderOutcome) {
  const observedLabel =
    renderOutcome.observedOutcome === 'pass'
      ? 'pass'
      : renderOutcome.observedOutcome === 'parse-fail'
      ? 'parse-fail'
      : 'render-fail';
  const expectedMatches =
    (demo.expected === 'pass' && renderOutcome.observedOutcome === 'pass') ||
    (demo.expected === 'fail' && renderOutcome.observedOutcome !== 'pass');
  const statusTone = expectedMatches ? '#1b6f3a' : '#7a2f2f';
  const renderSurface =
    renderOutcome.svgMarkup === null
      ? `<p><strong>No SVG output.</strong> This fixture currently produced <code>${escapeHtml(
          observedLabel
        )}</code> in demo generation.</p>`
      : renderOutcome.svgMarkup;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(demo.title)} Demo</title>
    <style>
      :root {
        --bg: #f6f6f8;
        --fg: #1c1d22;
        --muted: #5f6573;
        --surface: #ffffff;
        --border: #d7dbe3;
      }

      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
        color: var(--fg);
        background: linear-gradient(180deg, #ffffff 0%, var(--bg) 70%);
        overflow-x: hidden;
      }

      html {
        overflow-x: hidden;
      }

      main {
        max-width: 1520px;
        width: min(1520px, 98vw);
        margin: 0 auto;
        padding: 24px;
      }

      h1 {
        margin: 0 0 8px;
      }

      p {
        margin: 0 0 16px;
        color: var(--muted);
      }

      .surface {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
        overflow-x: auto;
        max-width: 100%;
      }

      .surface svg {
        display: block;
        width: auto;
        height: auto;
        max-width: 100%;
        margin: 0 auto;
      }

      .diag-ok {
        margin: 0;
        color: #1b6f3a;
      }

      .diag-list {
        margin: 0;
        padding-left: 18px;
      }

      .actions {
        margin-top: 10px;
      }
    </style>
  </head>
  <body>
    <main>
      <a href="./index.html">Back to demos</a>
      <h1>${escapeHtml(demo.title)}</h1>
      <p>${escapeHtml(demo.description)}</p>
      <p><strong>Category:</strong> ${escapeHtml(demo.categoryLabel ?? demo.category)} | <strong>Collection:</strong> ${escapeHtml(
        demo.collection
      )}</p>
      <p><strong>Expected outcome:</strong> ${escapeHtml(demo.expected)} | <strong>Observed outcome:</strong> <span style="color:${statusTone};">${escapeHtml(
        observedLabel
      )}</span> | <strong>Parse mode:</strong> ${escapeHtml(demo.parseMode)}</p>
      ${renderDemoSource(demo)}
      <section class="surface">
        ${renderSurface}
      </section>
      <section class="surface">
        <h2>Diagnostics</h2>
        ${renderDiagnosticsList(renderOutcome.diagnostics)}
      </section>
    </main>
  </body>
</html>
`;
}

/** Convert an absolute repository path into a stable repo-relative path label. */
function toRepoRelativePath(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).replaceAll(path.sep, '/');
}

/** Render one shared table row for index-page demo collections. */
function renderDemoTableRow(demo) {
  const source = demo.sourceUrl
    ? `<a href="${escapeHtml(demo.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(demo.sourceName)}</a>`
    : escapeHtml(demo.sourceName);
  return `<tr>
  <td><a href="./${escapeHtml(demo.id)}.html">${escapeHtml(demo.id)}</a></td>
  <td>${escapeHtml(demo.title)}</td>
  <td>${escapeHtml(demo.expected)}</td>
  <td>${escapeHtml(demo.parseMode)}</td>
  <td>${source}</td>
</tr>`;
}

/** Build one per-category details block for full LilyPond suite navigation. */
function renderLilyPondCategorySection(categoryId, categoryTitle, demosInCategory) {
  const rows = demosInCategory.map((demo) => renderDemoTableRow(demo)).join('\n');
  const labeledCategory = categoryTitle
    ? `Category ${escapeHtml(categoryId)} - ${escapeHtml(categoryTitle)}`
    : `Category ${escapeHtml(categoryId)}`;
  return `<details class="category-details">
  <summary>${labeledCategory} (${demosInCategory.length} demos)</summary>
  <table>
    <thead>
      <tr>
        <th>Fixture ID</th>
        <th>Title</th>
        <th>Expected</th>
        <th>Parse Mode</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</details>`;
}

/** Build the static index page that links to each generated demo page. */
function buildIndexPageHtml(
  featuredDemos,
  lilypondSuiteDemos,
  complexScoreDemos,
  lilypondManifest,
  lilyPondCategoryTitleById,
  conformanceSummary
) {
  const featuredRows = featuredDemos.map((demo) => renderDemoTableRow(demo)).join('\n');
  const complexRows = complexScoreDemos.map((demo) => renderDemoTableRow(demo)).join('\n');
  const lilyPondByCategory = new Map();
  for (const demo of lilypondSuiteDemos) {
    const categoryId = demo.category.replace('lilypond-', '');
    const existing = lilyPondByCategory.get(categoryId) ?? [];
    existing.push(demo);
    lilyPondByCategory.set(categoryId, existing);
  }
  const lilyPondCategorySections = [...lilyPondByCategory.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([categoryId, demosInCategory]) =>
      renderLilyPondCategorySection(
        categoryId,
        lilyPondCategoryTitleById.get(categoryId),
        [...demosInCategory].sort((left, right) => left.id.localeCompare(right.id))
      )
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>musicxml demos</title>
    <style>
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
        color: #1c1d22;
        background: linear-gradient(180deg, #ffffff 0%, #f6f6f8 70%);
      }

      main {
        max-width: 880px;
        margin: 0 auto;
        padding: 24px;
      }

      h1 {
        margin: 0 0 10px;
      }

      .panel {
        margin-top: 18px;
        padding: 14px;
        border: 1px solid #d7dbe3;
        border-radius: 12px;
        background: #ffffff;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border: 1px solid #d7dbe3;
        padding: 8px;
        text-align: left;
        vertical-align: top;
      }

      .category-details {
        margin-top: 12px;
      }

      .category-details summary {
        font-weight: 600;
        cursor: pointer;
        margin-bottom: 8px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>musicxml demos</h1>
      <p>Static SVG demos generated from authoritative MusicXML fixtures.</p>
      <section class="panel">
        <h2>LilyPond Suite Roadmap</h2>
        <p>${escapeHtml(lilypondManifest.endGoal)}</p>
        <p>
          Active conformance fixtures: <strong>${conformanceSummary.active}</strong>
          (expected pass: <strong>${conformanceSummary.expectedPass}</strong>,
          expected fail: <strong>${conformanceSummary.expectedFail}</strong>)
        </p>
        <p>
          Full LilyPond demo pages: <strong>${lilypondSuiteDemos.length}</strong> |
          Featured seed demos: <strong>${featuredDemos.length}</strong> |
          Selected complex demos: <strong>${complexScoreDemos.length}</strong>
        </p>
        <p>
          <a href="./lilypond-roadmap.html">Open roadmap and coverage matrix</a>
        </p>
      </section>
      <section class="panel">
        <h2>Featured Seed Demos</h2>
        <table>
          <thead>
            <tr>
              <th>Fixture ID</th>
              <th>Title</th>
              <th>Expected</th>
              <th>Parse Mode</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${featuredRows}
          </tbody>
        </table>
      </section>
      <section class="panel">
        <h2>Selected Complex Score Demos</h2>
        <table>
          <thead>
            <tr>
              <th>Fixture ID</th>
              <th>Title</th>
              <th>Expected</th>
              <th>Parse Mode</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${complexRows}
          </tbody>
        </table>
      </section>
      <section class="panel">
        <h2>All LilyPond Suite Demos</h2>
        <p>Every active LilyPond conformance fixture is generated as an individual demo page below.</p>
        ${lilyPondCategorySections}
      </section>
    </main>
  </body>
</html>
`;
}

/**
 * Merge corpus categories with local M7 planning status so every suite category
 * appears in the roadmap even if no explicit status override exists yet.
 */
function buildCategoryPlanRows(manifest, corpusManifest, activeConformanceByCategoryId) {
  const statusByCategoryId = new Map(manifest.categoryStatus.map((entry) => [entry.id, entry]));

  return corpusManifest.categories.map((category) => {
    const statusEntry = statusByCategoryId.get(category.id);
    const activeConformanceCount = activeConformanceByCategoryId.get(category.id) ?? 0;
    let demoStatus = statusEntry?.status;
    let notes = statusEntry?.notes;

    if (!demoStatus) {
      if (activeConformanceCount > 0) {
        demoStatus = 'in-progress';
        notes = 'Conformance fixtures are active; seeded demo page pending.';
      } else {
        demoStatus = 'not-started';
        notes = 'Planned for M7 activation.';
      }
    }

    let conformanceStatus = 'not-started';
    if (activeConformanceCount >= category.fixtureCount && category.fixtureCount > 0) {
      conformanceStatus = 'complete';
    } else if (activeConformanceCount > 0) {
      conformanceStatus = 'in-progress';
    }

    return {
      id: category.id,
      title: category.title,
      fixtureCount: category.fixtureCount,
      activeConformanceCount,
      conformanceStatus,
      demoStatus,
      notes
    };
  });
}

/** Select a stable subset of real-world fixtures that represent high complexity. */
function isComplexRealWorldSample(sample) {
  return sample.long_form || sample.complexity_level !== 'small' || sample.part_count_hint >= 4;
}

/** Build demo definitions for the full active LilyPond conformance suite. */
function buildLilyPondDemoDefinitions(manifest, conformanceFixtures) {
  const seedById = new Map(manifest.seedDemos.map((seedDemo) => [seedDemo.id, seedDemo]));

  return conformanceFixtures
    .filter((fixture) => fixture.meta.status === 'active' && fixture.meta.category.startsWith('lilypond-'))
    .sort((left, right) => left.meta.id.localeCompare(right.meta.id))
    .map((fixture) => {
      const seed = seedById.get(fixture.meta.id);
      const sourceUrl = typeof fixture.meta.source === 'string' ? fixture.meta.source : '';
      const sourceName = seed?.sourceName ?? inferSourceName(sourceUrl, fixture.scorePath);
      const compactCaseId = fixture.meta.id.replace(/^lilypond-/, '').replaceAll('-', ' ');
      return {
        id: fixture.meta.id,
        title: seed?.title ?? `LilyPond ${compactCaseId}`,
        description:
          seed?.description ??
          `LilyPond collated-suite fixture ${sourceName} from ${fixture.meta.category}. Expected ${fixture.meta.expected}.`,
        sourceName,
        sourceUrl,
        scorePath: fixture.scorePath,
        expected: fixture.meta.expected,
        parseMode: fixture.meta.parse_mode ?? 'lenient',
        category: fixture.meta.category,
        collection: 'lilypond'
      };
    });
}

/** Build demo definitions for selected complex real-world corpus fixtures. */
function buildComplexRealWorldDemoDefinitions(conformanceFixtures, realWorldManifest) {
  const sampleById = new Map(realWorldManifest.samples.map((sample) => [sample.id, sample]));

  return conformanceFixtures
    .filter((fixture) => fixture.meta.status === 'active' && fixture.meta.category.startsWith('realworld-'))
    .map((fixture) => {
      const sample = sampleById.get(fixture.meta.id);
      if (!sample || !isComplexRealWorldSample(sample)) {
        return null;
      }

      const sourceUrl = typeof fixture.meta.source === 'string' ? fixture.meta.source : sample.sourceUrl;
      const sourceName = inferSourceName(sourceUrl, fixture.scorePath);
      return {
        id: fixture.meta.id,
        title: sample.title,
        description: `${sample.notes} Bucket: ${sample.bucket}. Complexity: ${sample.complexity_level}.`,
        sourceName,
        sourceUrl,
        scorePath: fixture.scorePath,
        expected: fixture.meta.expected,
        parseMode: fixture.meta.parse_mode ?? 'lenient',
        category: fixture.meta.category,
        collection: 'realworld'
      };
    })
    .filter((demoDefinition) => demoDefinition !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Resolve featured seed demos against the generated full LilyPond demo set. */
function buildFeaturedDemoDefinitions(manifest, lilyPondDemoDefinitions) {
  const toCaseKey = (fixtureId) => fixtureId.split('-').slice(0, 2).join('-');
  const lilyById = new Map(lilyPondDemoDefinitions.map((demoDefinition) => [demoDefinition.id, demoDefinition]));
  const lilyByCaseKey = new Map(lilyPondDemoDefinitions.map((demoDefinition) => [toCaseKey(demoDefinition.id), demoDefinition]));
  return manifest.seedDemos.map((seedDemo) => {
    const resolved = lilyById.get(seedDemo.id) ?? lilyByCaseKey.get(toCaseKey(seedDemo.id));
    if (!resolved) {
      throw new Error(
        `seed demo '${seedDemo.id}' (${seedDemo.sourceName}) is missing from active LilyPond conformance fixtures`
      );
    }
    return {
      ...resolved,
      title: seedDemo.title,
      description: seedDemo.description
    };
  });
}

/**
 * Validate seeded demo records against the corpus manifest so roadmap/demo state
 * never drifts from the canonical suite mapping.
 */
function assertSeedDemoCorpusAlignment(manifest, corpusManifest) {
  const fixturesByName = new Map(corpusManifest.fixtures.map((fixture) => [fixture.sourceName, fixture]));

  for (const seed of manifest.seedDemos) {
    const fixture = fixturesByName.get(seed.sourceName);
    if (!fixture) {
      throw new Error(`seed demo '${seed.id}' references unknown source '${seed.sourceName}'`);
    }
    if (fixture.categoryId !== seed.categoryId) {
      throw new Error(
        `seed demo '${seed.id}' category mismatch: manifest=${seed.categoryId} corpus=${fixture.categoryId}`
      );
    }
    if (fixture.sourceUrl !== seed.sourceUrl) {
      throw new Error(
        `seed demo '${seed.id}' source URL mismatch: manifest='${seed.sourceUrl}' corpus='${fixture.sourceUrl}'`
      );
    }
  }
}

/**
 * Trim SVG page whitespace by cropping viewBox to notation geometry bounds.
 * This keeps demos compact across short fixtures while preserving deterministic
 * layout pixels inside the cropped region.
 */
function trimSvgMarkupToNotationBounds(svgMarkup) {
  const notationBounds = extractSvgElementBounds(svgMarkup, {
    selector: DEMO_NOTATION_BOUNDS_SELECTOR
  });
  if (notationBounds.length === 0) {
    return svgMarkup;
  }

  const textBounds = extractSvgElementBounds(svgMarkup, {
    selector: DEMO_TEXT_BOUNDS_SELECTOR
  });
  const bounds = mergeNotationAndNearbyTextBounds(notationBounds, textBounds);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const entry of bounds) {
    const left = entry.bounds.x;
    const top = entry.bounds.y;
    const right = entry.bounds.x + entry.bounds.width;
    const bottom = entry.bounds.y + entry.bounds.height;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
      continue;
    }
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return svgMarkup;
  }

  const dom = new JSDOM(svgMarkup, { contentType: 'image/svg+xml' });
  const svg = dom.window.document.querySelector('svg');
  if (!svg) {
    dom.window.close();
    return svgMarkup;
  }

  const viewport = resolveSvgViewport(svg);
  const cropX = clamp(minX - DEMO_SVG_TRIM_PADDING, viewport.x, viewport.x + viewport.width);
  const cropY = clamp(minY - DEMO_SVG_TRIM_PADDING, viewport.y, viewport.y + viewport.height);
  const cropRight = clamp(maxX + DEMO_SVG_TRIM_PADDING, viewport.x, viewport.x + viewport.width);
  const cropBottom = clamp(maxY + DEMO_SVG_TRIM_PADDING, viewport.y, viewport.y + viewport.height);
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);

  svg.setAttribute('viewBox', `${cropX.toFixed(2)} ${cropY.toFixed(2)} ${cropWidth.toFixed(2)} ${cropHeight.toFixed(2)}`);
  svg.setAttribute('width', `${Math.ceil(cropWidth)}`);
  svg.setAttribute('height', `${Math.ceil(cropHeight)}`);

  const trimmed = svg.outerHTML;
  dom.window.close();
  return trimmed;
}

/** Merge core notation bounds with nearby text (lyrics/chords) while excluding far headers/footers. */
function mergeNotationAndNearbyTextBounds(notationBounds, textBounds) {
  let notationMinX = Number.POSITIVE_INFINITY;
  let notationMinY = Number.POSITIVE_INFINITY;
  let notationMaxX = Number.NEGATIVE_INFINITY;
  let notationMaxY = Number.NEGATIVE_INFINITY;

  for (const entry of notationBounds) {
    notationMinX = Math.min(notationMinX, entry.bounds.x);
    notationMinY = Math.min(notationMinY, entry.bounds.y);
    notationMaxX = Math.max(notationMaxX, entry.bounds.x + entry.bounds.width);
    notationMaxY = Math.max(notationMaxY, entry.bounds.y + entry.bounds.height);
  }

  if (
    !Number.isFinite(notationMinX) ||
    !Number.isFinite(notationMinY) ||
    !Number.isFinite(notationMaxX) ||
    !Number.isFinite(notationMaxY)
  ) {
    return notationBounds;
  }

  const mergedBounds = [...notationBounds];
  for (const textEntry of textBounds) {
    const left = textEntry.bounds.x;
    const top = textEntry.bounds.y;
    const right = textEntry.bounds.x + textEntry.bounds.width;
    const bottom = textEntry.bounds.y + textEntry.bounds.height;

    const overlapsHorizontalWindow =
      right >= notationMinX - DEMO_TEXT_HORIZONTAL_INCLUSION_PADDING &&
      left <= notationMaxX + DEMO_TEXT_HORIZONTAL_INCLUSION_PADDING;
    const overlapsVerticalWindow =
      bottom >= notationMinY - DEMO_TEXT_VERTICAL_INCLUSION_PADDING.top &&
      top <= notationMaxY + DEMO_TEXT_VERTICAL_INCLUSION_PADDING.bottom;

    if (overlapsHorizontalWindow && overlapsVerticalWindow) {
      mergedBounds.push(textEntry);
    }
  }

  return mergedBounds;
}

/** Resolve SVG viewport rectangle from `viewBox` or width/height attributes. */
function resolveSvgViewport(svgElement) {
  const viewBoxRaw = svgElement.getAttribute('viewBox');
  if (viewBoxRaw) {
    const parts = viewBoxRaw
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseFloat(part));
    if (
      parts.length === 4 &&
      Number.isFinite(parts[0]) &&
      Number.isFinite(parts[1]) &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3])
    ) {
      return {
        x: parts[0],
        y: parts[1],
        width: Math.max(1, parts[2]),
        height: Math.max(1, parts[3])
      };
    }
  }

  const width = parseSvgDimension(svgElement.getAttribute('width')) ?? DEMO_PAGE_WIDTH;
  const height = parseSvgDimension(svgElement.getAttribute('height')) ?? DEMO_PAGE_HEIGHT;
  return {
    x: 0,
    y: 0,
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

/** Parse one SVG dimension token (`980`, `980px`) into a finite number. */
function parseSvgDimension(value) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Clamp a number into a closed interval. */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Parse/render one demo fixture and classify observed outcome for page generation. */
async function renderDemoFixture(demoDefinition) {
  const sourceData = await readFile(demoDefinition.scorePath);
  const parsed = await parseMusicXMLAsync(
    {
      data: sourceData,
      format: 'auto'
    },
    {
      sourceName: demoDefinition.scorePath,
      mode: demoDefinition.parseMode
    }
  );
  const parseErrors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (!parsed.score || parseErrors.length > 0) {
    return /** @type {DemoRenderOutcome} */ ({
      observedOutcome: 'parse-fail',
      svgMarkup: null,
      diagnostics: parsed.diagnostics
    });
  }

  const rendered = renderToSVGPages(parsed.score, {
    layout: {
      scale: DEMO_RENDER_SCALE,
      page: {
        width: DEMO_PAGE_WIDTH,
        height: DEMO_PAGE_HEIGHT,
        margins: {
          top: 28,
          right: 28,
          bottom: 28,
          left: 28
        }
      }
    }
  });
  const renderErrors = rendered.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (rendered.pages.length === 0 || renderErrors.length > 0) {
    return /** @type {DemoRenderOutcome} */ ({
      observedOutcome: 'render-fail',
      svgMarkup: rendered.pages[0] ?? null,
      diagnostics: [...parsed.diagnostics, ...rendered.diagnostics]
    });
  }

  return /** @type {DemoRenderOutcome} */ ({
    observedOutcome: 'pass',
    svgMarkup: trimSvgMarkupToNotationBounds(rendered.pages[0]),
    diagnostics: [...parsed.diagnostics, ...rendered.diagnostics]
  });
}

/** Build the LilyPond roadmap page with category status and conformance alignment. */
function buildLilyPondRoadmapPageHtml(manifest, corpusManifest, conformanceFixtures) {
  const titleByCategoryId = new Map(corpusManifest.categories.map((category) => [category.id, category.title]));
  const activeConformanceByCategoryId = new Map();
  for (const fixture of conformanceFixtures) {
    if (fixture.meta.status !== 'active') {
      continue;
    }
    if (!fixture.meta.category.startsWith('lilypond-')) {
      continue;
    }
    const categoryId = fixture.meta.category.slice('lilypond-'.length);
    activeConformanceByCategoryId.set(categoryId, (activeConformanceByCategoryId.get(categoryId) ?? 0) + 1);
  }

  const seedRows = manifest.seedDemos
    .map((seed) => {
      const localPath = escapeHtml(seed.localScore);
      const title = escapeHtml(seed.title);
      const sourceName = escapeHtml(seed.sourceName);
      const sourceUrl = escapeHtml(seed.sourceUrl);
      const categoryTitle = titleByCategoryId.get(seed.categoryId);
      const categoryLabel = categoryTitle
        ? `${escapeHtml(seed.categoryId)} - ${escapeHtml(categoryTitle)}`
        : escapeHtml(seed.categoryId);
      return `<tr>
  <td>${title}</td>
  <td>${categoryLabel}</td>
  <td><code>${localPath}</code></td>
  <td><a href="./${escapeHtml(seed.id)}.html">Rendered demo</a></td>
  <td><a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceName}</a></td>
</tr>`;
    })
    .join('\n');

  const categoryRows = buildCategoryPlanRows(manifest, corpusManifest, activeConformanceByCategoryId)
    .map((category) => {
      return `<tr>
  <td>${escapeHtml(category.id)}</td>
  <td>${escapeHtml(category.title)}</td>
  <td>${category.fixtureCount}</td>
  <td>${category.activeConformanceCount}</td>
  <td>${escapeHtml(category.conformanceStatus)}</td>
  <td>${escapeHtml(category.demoStatus)}</td>
  <td>${escapeHtml(category.notes)}</td>
</tr>`;
    })
    .join('\n');

  const fixtureRows = conformanceFixtures
    .map((fixture) => {
      const source = fixture.meta.source.startsWith('http')
        ? `<a href="${escapeHtml(fixture.meta.source)}" target="_blank" rel="noreferrer">source</a>`
        : escapeHtml(fixture.meta.source);
      return `<tr>
  <td>${escapeHtml(fixture.meta.id)}</td>
  <td>${escapeHtml(fixture.meta.category)}</td>
  <td>${escapeHtml(fixture.meta.status)}</td>
  <td>${escapeHtml(fixture.meta.expected)}</td>
  <td>${escapeHtml(fixture.meta.parse_mode ?? 'lenient')}</td>
  <td><code>${escapeHtml(toRepoRelativePath(fixture.scorePath))}</code></td>
  <td>${source}</td>
</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LilyPond Suite Roadmap</title>
    <style>
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
        color: #1c1d22;
        background: linear-gradient(180deg, #ffffff 0%, #f6f6f8 70%);
      }

      main {
        max-width: 1160px;
        margin: 0 auto;
        padding: 24px;
      }

      h1, h2 {
        margin-bottom: 8px;
      }

      .panel {
        margin-top: 16px;
        padding: 16px;
        border: 1px solid #d7dbe3;
        border-radius: 12px;
        background: #ffffff;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border: 1px solid #d7dbe3;
        padding: 8px;
        text-align: left;
        vertical-align: top;
      }
    </style>
  </head>
  <body>
    <main>
      <a href="./index.html">Back to demos</a>
      <h1>LilyPond MusicXML Demo Roadmap</h1>
      <p><strong>Suite:</strong> <a href="${escapeHtml(manifest.suiteSource)}" target="_blank" rel="noreferrer">${escapeHtml(
        manifest.suiteSource
      )}</a></p>
      <p><strong>End goal:</strong> ${escapeHtml(manifest.endGoal)}</p>
      <p><strong>Corpus fixtures indexed:</strong> ${corpusManifest.fixtures.length}</p>

      <section class="panel">
        <h2>Seeded LilyPond Demo Pages</h2>
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Category</th>
              <th>Local Score</th>
              <th>Rendered</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${seedRows}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Category Coverage (Conformance + Demo Seeding)</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Title</th>
              <th>Fixture Count</th>
              <th>Active Conformance</th>
              <th>Conformance Status</th>
              <th>Demo Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRows}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Current Conformance Fixture Alignment</h2>
        <table>
          <thead>
            <tr>
              <th>Fixture ID</th>
              <th>Category</th>
              <th>Status</th>
              <th>Expected</th>
              <th>Parse Mode</th>
              <th>Score Path</th>
              <th>Meta Source</th>
            </tr>
          </thead>
          <tbody>
            ${fixtureRows}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>
`;
}

/** Read and parse the tracked LilyPond roadmap manifest. */
async function loadLilyPondManifest() {
  const raw = await readFile(LILYPOND_MANIFEST_PATH, 'utf8');
  return /** @type {LilyPondManifest} */ (JSON.parse(raw));
}

/** Read and parse the generated LilyPond corpus manifest referenced by roadmap config. */
async function loadLilyPondCorpusManifest(manifest) {
  const absolutePath = path.join(ROOT_DIR, manifest.corpusManifestPath);
  const raw = await readFile(absolutePath, 'utf8');
  return /** @type {LilyPondCorpusManifest} */ (JSON.parse(raw));
}

/** Read and parse real-world corpus metadata used for complex demo selection. */
async function loadRealWorldCorpusManifest() {
  const raw = await readFile(REALWORLD_CORPUS_PATH, 'utf8');
  return /** @type {RealWorldCorpusManifest} */ (JSON.parse(raw));
}

/** Build static demo pages from tracked MusicXML demo scores. */
async function buildDemos() {
  const lilypondManifest = await loadLilyPondManifest();
  const lilypondCorpusManifest = await loadLilyPondCorpusManifest(lilypondManifest);
  const realWorldCorpusManifest = await loadRealWorldCorpusManifest();
  assertSeedDemoCorpusAlignment(lilypondManifest, lilypondCorpusManifest);
  const conformanceFixtures = await loadConformanceFixtures(CONFORMANCE_FIXTURES_DIR);
  const lilyPondCategoryTitleById = new Map(
    lilypondCorpusManifest.categories.map((category) => [category.id, category.title])
  );
  const lilyPondSuiteDemoDefinitions = buildLilyPondDemoDefinitions(lilypondManifest, conformanceFixtures).map(
    (demoDefinition) => {
      const categoryId = demoDefinition.category.replace('lilypond-', '');
      const categoryTitle = lilyPondCategoryTitleById.get(categoryId);
      return {
        ...demoDefinition,
        categoryLabel: categoryTitle ? `${categoryId} - ${categoryTitle}` : categoryId
      };
    }
  );
  const complexScoreDemoDefinitions = buildComplexRealWorldDemoDefinitions(
    conformanceFixtures,
    realWorldCorpusManifest
  );
  const featuredDemoDefinitions = buildFeaturedDemoDefinitions(lilypondManifest, lilyPondSuiteDemoDefinitions);
  const allDemoDefinitionsById = new Map(
    [...lilyPondSuiteDemoDefinitions, ...complexScoreDemoDefinitions].map((demoDefinition) => [
      demoDefinition.id,
      demoDefinition
    ])
  );
  const allDemoDefinitions = [...allDemoDefinitionsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );

  await rm(SITE_DIR, { recursive: true, force: true });
  await mkdir(SITE_DIR, { recursive: true });

  for (const demoDefinition of allDemoDefinitions) {
    const renderOutcome = await renderDemoFixture(demoDefinition);
    const expectedPass = demoDefinition.expected === 'pass';
    if (expectedPass && renderOutcome.observedOutcome !== 'pass') {
      const failureCodes = renderOutcome.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.code)
        .join(', ');
      throw new Error(
        `Demo '${demoDefinition.id}' expected pass but observed ${renderOutcome.observedOutcome}: ${failureCodes}`
      );
    }
    const pageHtml = buildDemoPageHtml(demoDefinition, renderOutcome);
    await writeFile(path.join(SITE_DIR, `${demoDefinition.id}.html`), pageHtml, 'utf8');
  }

  const activeFixtures = conformanceFixtures.filter((fixture) => fixture.meta.status === 'active');
  const conformanceSummary = {
    active: activeFixtures.length,
    expectedPass: activeFixtures.filter((fixture) => fixture.meta.expected === 'pass').length,
    expectedFail: activeFixtures.filter((fixture) => fixture.meta.expected === 'fail').length
  };

  await writeFile(
    path.join(SITE_DIR, 'lilypond-roadmap.html'),
    buildLilyPondRoadmapPageHtml(lilypondManifest, lilypondCorpusManifest, conformanceFixtures),
    'utf8'
  );
  await writeFile(
    path.join(SITE_DIR, 'index.html'),
    buildIndexPageHtml(
      featuredDemoDefinitions,
      lilyPondSuiteDemoDefinitions,
      complexScoreDemoDefinitions,
      lilypondManifest,
      lilyPondCategoryTitleById,
      conformanceSummary
    ),
    'utf8'
  );
  // Console output is intentionally short because this script is used in npm pipelines.
  console.log(
    `Built ${allDemoDefinitions.length} demos + LilyPond roadmap (${conformanceSummary.active} active fixtures) into ${SITE_DIR}`
  );
}

await buildDemos();
