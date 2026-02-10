/* global console */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMusicXML, renderToSVGPages } from '../dist/public/index.js';

/** Absolute repository root path resolved from this script location. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Demo source score directory tracked in git. */
const SCORES_DIR = path.join(ROOT_DIR, 'demos', 'scores');
/** Generated static demo site output directory. */
const SITE_DIR = path.join(ROOT_DIR, 'demos', 'site');

/** Declarative demo catalog used to build the index page and per-demo pages. */
const DEMO_DEFINITIONS = [
  {
    id: 'happy-birthday',
    title: 'Happy Birthday',
    description: 'Simple melody demo with harmony symbols.',
    scorePath: path.join(SCORES_DIR, 'happy-birthday.musicxml')
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    description: 'Holiday melody demo with harmony symbols.',
    scorePath: path.join(SCORES_DIR, 'jingle-bells.musicxml')
  }
];

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

/** Build the static index page that links to each generated demo page. */
function buildIndexPageHtml(demos) {
  const links = demos
    .map(
      (demo) => `<li><a href="./${demo.id}.html">${escapeHtml(demo.title)}</a> - ${escapeHtml(
        demo.description
      )}</li>`
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

      ul {
        margin: 16px 0 0;
        padding-left: 20px;
      }

      li {
        margin-bottom: 10px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>musicxml demos</h1>
      <p>Static SVG demos generated from MusicXML fixtures.</p>
      <ul>
        ${links}
      </ul>
    </main>
  </body>
</html>
`;
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

  await writeFile(path.join(SITE_DIR, 'index.html'), buildIndexPageHtml(DEMO_DEFINITIONS), 'utf8');
  // Console output is intentionally short because this script is used in npm pipelines.
  console.log(`Built ${DEMO_DEFINITIONS.length} demos into ${SITE_DIR}`);
}

await buildDemos();
