/* global console */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseMusicXMLAsync, renderToSVGPages } from '../dist/public/index.js';

/** Absolute repository root path derived from this script location. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Source manifest of representative real-world sample metadata. */
const REALWORLD_MANIFEST_PATH = path.join(ROOT_DIR, 'fixtures', 'corpus', 'real-world-samples.json');
/** Output directory for imported real-world conformance fixtures. */
const REALWORLD_CONFORMANCE_DIR = path.join(ROOT_DIR, 'fixtures', 'conformance', 'realworld');

/** Parse minimal CLI options (`--dry-run`). */
function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run')
  };
}

/** Parse one JSON file from disk. */
async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/** Return true if a file basename already exists in conformance output. */
function hasExistingMeta(existingMetaBasenames, sampleId) {
  return existingMetaBasenames.has(sampleId);
}

/** Parse/render classify one `.mxl` sample for expected pass/fail metadata assignment. */
async function classifySample(sample, payload) {
  const parseResult = await parseMusicXMLAsync(
    {
      data: payload,
      format: 'mxl'
    },
    {
      sourceName: sample.sourceUrl,
      mode: 'lenient'
    }
  );

  const parseErrors = parseResult.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);

  /** @type {string[]} */
  const failureReasons = [];
  if (!parseResult.score) {
    failureReasons.push('parse returned no score');
  }
  if (parseErrors.length > 0) {
    failureReasons.push(`parse errors: ${Array.from(new Set(parseErrors)).join(',')}`);
  }

  if (parseResult.score) {
    try {
      const renderResult = renderToSVGPages(parseResult.score);
      const renderErrors = renderResult.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.code);
      if (renderResult.pages.length === 0) {
        failureReasons.push('render returned zero pages');
      }
      if (renderErrors.length > 0) {
        failureReasons.push(`render errors: ${Array.from(new Set(renderErrors)).join(',')}`);
      }
    } catch (error) {
      failureReasons.push(`render throw: ${String(error?.code ?? error?.message ?? error)}`);
    }
  }

  return {
    observed: failureReasons.length === 0 ? 'pass' : 'fail',
    failureReasons
  };
}

/** Quote free-form string for YAML-safe scalar serialization. */
function quoteYaml(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Build metadata text for one imported real-world sample. */
function buildMetaText(sample, classification) {
  const waivers = [quoteYaml(`license:${sample.license}`)];

  const lines = [
    `id: ${sample.id}`,
    `source: ${sample.sourceUrl}`,
    `category: realworld-${sample.bucket}`,
    `expected: ${classification.observed}`,
    'status: active',
    'parse_mode: lenient',
    `notes: ${quoteYaml(`${sample.notes} Source repo: ${sample.sourceRepo} (license: ${sample.license}).`)}`
  ];

  if (classification.observed === 'fail') {
    lines.push(`linked_todo: R-002`);
    waivers.push(quoteYaml(`observed-fail:${classification.failureReasons.join('; ')}`));
  }

  lines.push(`waivers: [${waivers.join(', ')}]`);

  return `${lines.join('\n')}\n`;
}

/** Import all non-imported samples from the real-world manifest. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await readJson(REALWORLD_MANIFEST_PATH);
  await mkdir(REALWORLD_CONFORMANCE_DIR, { recursive: true });

  const existingMetaBasenames = new Set(
    (await readdir(REALWORLD_CONFORMANCE_DIR))
      .filter((entry) => entry.endsWith('.meta.yaml'))
      .map((entry) => entry.replace(/\.meta\.yaml$/i, ''))
  );

  const pending = manifest.samples.filter((sample) => !hasExistingMeta(existingMetaBasenames, sample.id));

  let imported = 0;
  for (const sample of pending) {
    const response = await globalThis.fetch(sample.sourceUrl);
    if (!response.ok) {
      throw new Error(`download failed for ${sample.id} (${response.status} ${response.statusText})`);
    }

    const payload = new Uint8Array(await response.arrayBuffer());
    const classification = await classifySample(sample, payload);
    const metaText = buildMetaText(sample, classification);

    if (!args.dryRun) {
      await writeFile(path.join(REALWORLD_CONFORMANCE_DIR, `${sample.id}.mxl`), payload);
      await writeFile(path.join(REALWORLD_CONFORMANCE_DIR, `${sample.id}.meta.yaml`), metaText, 'utf8');
    }

    imported += 1;
    console.log(
      `${args.dryRun ? '[dry-run] ' : ''}${sample.id} -> expected ${classification.observed}${
        classification.failureReasons.length > 0 ? ` (${classification.failureReasons.join('; ')})` : ''
      }`
    );
  }

  console.log(`${args.dryRun ? '[dry-run] ' : ''}Imported ${imported} real-world fixture(s).`);
}

await main();
