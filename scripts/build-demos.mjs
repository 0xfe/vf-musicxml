/* global console */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMusicXML, renderToSVGPages } from '../dist/public/index.js';
import { loadConformanceFixtures } from '../dist/testkit/index.js';

/** Absolute repository root path resolved from this script location. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Demo source score directory tracked in git. */
const SCORES_DIR = path.join(ROOT_DIR, 'demos', 'scores');
/** Generated static demo site output directory. */
const SITE_DIR = path.join(ROOT_DIR, 'demos', 'site');
/** LilyPond demo roadmap manifest tracked in git. */
const LILYPOND_MANIFEST_PATH = path.join(ROOT_DIR, 'demos', 'lilypond', 'manifest.json');
/** Conformance fixture root used for roadmap alignment reporting. */
const CONFORMANCE_FIXTURES_DIR = path.join(ROOT_DIR, 'fixtures', 'conformance');

/** Declarative demo catalog used to build the index page and per-demo pages. */
const DEMO_DEFINITIONS = [
  {
    id: 'lilypond-01c-pitches-no-voice',
    title: 'LilyPond 01c: No Voice Element',
    description: 'Single-note fixture that verifies optional <voice> parsing plus lyric rendering.',
    sourceName: '01c-Pitches-NoVoiceElement.xml',
    sourceUrl: 'https://lilypond.org/doc/v2.25/input/regression/musicxml/4a/lily-17c6267f.xml',
    scorePath: path.join(SCORES_DIR, 'lilypond-01c-pitches-no-voice.musicxml')
  },
  {
    id: 'lilypond-71g-multiple-chordnames',
    title: 'LilyPond 71g: Multiple Chord Names',
    description: 'Harmony-heavy fixture with multiple chord changes over sustained notes.',
    sourceName: '71g-MultipleChordnames.xml',
    sourceUrl: 'https://lilypond.org/doc/v2.25/input/regression/musicxml/6f/lily-05629908.xml',
    scorePath: path.join(SCORES_DIR, 'lilypond-71g-multiple-chordnames.musicxml')
  }
];

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   sourceName: string;
 *   sourceUrl: string;
 *   localScore: string;
 *   categoryId: string;
 * }} LilyPondSeedDemo
 */

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   status: 'seeded' | 'in-progress' | 'not-started';
 *   notes: string;
 * }} LilyPondCategory
 */

/**
 * @typedef {{
 *   suiteSource: string;
 *   endGoal: string;
 *   seedDemos: LilyPondSeedDemo[];
 *   categories: LilyPondCategory[];
 * }} LilyPondManifest
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

/** Build a source-reference line for one demo page. */
function renderDemoSource(demo) {
  if (!demo.sourceUrl) {
    return '';
  }

  const sourceLabel = escapeHtml(demo.sourceName ?? demo.sourceUrl);
  const sourceUrl = escapeHtml(demo.sourceUrl);
  return `<p><strong>Source:</strong> <a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceLabel}</a></p>`;
}

/** Build one standalone HTML page for a rendered demo score. */
function buildDemoPageHtml(demo, svgMarkup, diagnostics) {
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
      }

      main {
        max-width: 1100px;
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
      ${renderDemoSource(demo)}
      <section class="surface">
        ${svgMarkup}
      </section>
      <section class="surface">
        <h2>Diagnostics</h2>
        ${renderDiagnosticsList(diagnostics)}
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

/** Build the static index page that links to each generated demo page. */
function buildIndexPageHtml(demos, lilypondManifest, conformanceSummary) {
  const links = demos
    .map((demo) => {
      const source = demo.sourceUrl
        ? ` (<a href="${escapeHtml(demo.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(demo.sourceName)}</a>)`
        : '';
      return `<li><a href="./${demo.id}.html">${escapeHtml(demo.title)}</a> - ${escapeHtml(
        demo.description
      )}${source}</li>`;
    })
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

      ul {
        margin: 16px 0 0;
        padding-left: 20px;
      }

      li {
        margin-bottom: 10px;
      }

      .panel {
        margin-top: 18px;
        padding: 14px;
        border: 1px solid #d7dbe3;
        border-radius: 12px;
        background: #ffffff;
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
          <a href="./lilypond-roadmap.html">Open roadmap and coverage matrix</a>
        </p>
      </section>
      <ul>
        ${links}
      </ul>
    </main>
  </body>
</html>
`;
}

/** Build the LilyPond roadmap page with category status and conformance alignment. */
function buildLilyPondRoadmapPageHtml(manifest, conformanceFixtures) {
  const seedRows = manifest.seedDemos
    .map((seed) => {
      const localPath = escapeHtml(seed.localScore);
      const title = escapeHtml(seed.title);
      const sourceName = escapeHtml(seed.sourceName);
      const sourceUrl = escapeHtml(seed.sourceUrl);
      return `<tr>
  <td>${title}</td>
  <td>${escapeHtml(seed.categoryId)}</td>
  <td><code>${localPath}</code></td>
  <td><a href="./${escapeHtml(seed.id)}.html">Rendered demo</a></td>
  <td><a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceName}</a></td>
</tr>`;
    })
    .join('\n');

  const categoryRows = manifest.categories
    .map((category) => {
      return `<tr>
  <td>${escapeHtml(category.id)}</td>
  <td>${escapeHtml(category.title)}</td>
  <td>${escapeHtml(category.status)}</td>
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
        <h2>Category Coverage Plan</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Title</th>
              <th>Status</th>
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

/** Build static demo pages from tracked MusicXML demo scores. */
async function buildDemos() {
  await rm(SITE_DIR, { recursive: true, force: true });
  await mkdir(SITE_DIR, { recursive: true });

  for (const demo of DEMO_DEFINITIONS) {
    const xml = await readFile(demo.scorePath, 'utf8');
    const parsed = parseMusicXML(xml, { sourceName: demo.scorePath, mode: 'lenient' });
    const parseErrors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

    if (!parsed.score || parseErrors.length > 0) {
      throw new Error(
        `Demo '${demo.id}' failed to parse: ${parseErrors.map((diagnostic) => diagnostic.code).join(', ')}`
      );
    }

    const rendered = renderToSVGPages(parsed.score);
    const renderErrors = rendered.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (rendered.pages.length === 0 || renderErrors.length > 0) {
      throw new Error(
        `Demo '${demo.id}' failed to render: ${renderErrors.map((diagnostic) => diagnostic.code).join(', ')}`
      );
    }

    const pageHtml = buildDemoPageHtml(demo, rendered.pages[0], [...parsed.diagnostics, ...rendered.diagnostics]);
    await writeFile(path.join(SITE_DIR, `${demo.id}.html`), pageHtml, 'utf8');
  }

  const lilypondManifest = await loadLilyPondManifest();
  const conformanceFixtures = await loadConformanceFixtures(CONFORMANCE_FIXTURES_DIR);
  const activeFixtures = conformanceFixtures.filter((fixture) => fixture.meta.status === 'active');
  const conformanceSummary = {
    active: activeFixtures.length,
    expectedPass: activeFixtures.filter((fixture) => fixture.meta.expected === 'pass').length,
    expectedFail: activeFixtures.filter((fixture) => fixture.meta.expected === 'fail').length
  };

  await writeFile(
    path.join(SITE_DIR, 'lilypond-roadmap.html'),
    buildLilyPondRoadmapPageHtml(lilypondManifest, conformanceFixtures),
    'utf8'
  );
  await writeFile(
    path.join(SITE_DIR, 'index.html'),
    buildIndexPageHtml(DEMO_DEFINITIONS, lilypondManifest, conformanceSummary),
    'utf8'
  );
  // Console output is intentionally short because this script is used in npm pipelines.
  console.log(
    `Built ${DEMO_DEFINITIONS.length} demos + LilyPond roadmap (${conformanceSummary.active} active fixtures) into ${SITE_DIR}`
  );
}

await buildDemos();
