/* global console, fetch, process */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { ssim } from 'ssim.js';

import { evaluateDeterministicSplit, resolveSplitResults } from '../dist/testkit/evaluation.js';

/** Default report path produced by `npm run test:conformance:report`. */
const DEFAULT_CONFORMANCE_REPORT_PATH = '/Users/mo/git/musicxml/artifacts/conformance/conformance-report.json';
/** Default split configuration path for M7C datasets. */
const DEFAULT_SPLITS_PATH = '/Users/mo/git/musicxml/fixtures/evaluation/splits.json';
/** Default deterministic/perceptual gate configuration path for M7C. */
const DEFAULT_GATES_PATH = '/Users/mo/git/musicxml/fixtures/evaluation/gates.json';
/** Default output directory for evaluation artifacts. */
const DEFAULT_OUT_DIR = '/Users/mo/git/musicxml/artifacts/evaluation';
/** Default prompt path for model-assisted page audits. */
const DEFAULT_PROMPT_PATH =
  '/Users/mo/git/musicxml/fixtures/evaluation/prompts/music-notation-rubric-v1.md';
/** Default JSON schema path for model-assisted page audits. */
const DEFAULT_PROMPT_SCHEMA_PATH =
  '/Users/mo/git/musicxml/fixtures/evaluation/prompts/music-notation-rubric-v1.schema.json';

/** Parse CLI arguments into an option bag. */
function parseArgs(argv) {
  const options = {
    reportPath: DEFAULT_CONFORMANCE_REPORT_PATH,
    splitsPath: DEFAULT_SPLITS_PATH,
    gatesPath: DEFAULT_GATES_PATH,
    outDir: DEFAULT_OUT_DIR,
    split: undefined,
    baselineDir: undefined,
    candidateDir: undefined,
    crossRendererDir: undefined,
    modelImageDir: undefined,
    modelSample: 0,
    model: 'gpt-4.1-mini',
    promptPath: DEFAULT_PROMPT_PATH,
    promptSchemaPath: DEFAULT_PROMPT_SCHEMA_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (!arg?.startsWith('--')) {
      continue;
    }

    switch (arg) {
      case '--report':
        options.reportPath = value;
        index += 1;
        break;
      case '--splits':
        options.splitsPath = value;
        index += 1;
        break;
      case '--gates':
        options.gatesPath = value;
        index += 1;
        break;
      case '--out-dir':
        options.outDir = value;
        index += 1;
        break;
      case '--split':
        options.split = value;
        index += 1;
        break;
      case '--baseline-dir':
        options.baselineDir = value;
        index += 1;
        break;
      case '--candidate-dir':
        options.candidateDir = value;
        index += 1;
        break;
      case '--cross-renderer-dir':
        options.crossRendererDir = value;
        index += 1;
        break;
      case '--model-image-dir':
        options.modelImageDir = value;
        index += 1;
        break;
      case '--model-sample':
        options.modelSample = Number.parseInt(value ?? '0', 10);
        index += 1;
        break;
      case '--model':
        options.model = value;
        index += 1;
        break;
      case '--prompt':
        options.promptPath = value;
        index += 1;
        break;
      case '--prompt-schema':
        options.promptSchemaPath = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

/** Load JSON file as object. */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** Recursively list PNG files under one directory and return relative-path keyed map. */
async function listPngFiles(rootDir) {
  const map = new Map();

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.name.toLowerCase().endsWith('.png')) {
        continue;
      }

      const relPath = path.relative(rootDir, fullPath).replaceAll('\\', '/');
      map.set(relPath, fullPath);
    }
  }

  await walk(rootDir);
  return map;
}

/** Compute per-image perceptual metrics and return aggregate summary. */
async function runPerceptualLayer(options, gateConfig) {
  if (!options.baselineDir || !options.candidateDir) {
    return {
      status: 'skipped',
      reason: 'baseline/candidate directories not provided',
      pairCount: 0
    };
  }

  const baselineFiles = await listPngFiles(options.baselineDir);
  const candidateFiles = await listPngFiles(options.candidateDir);
  const sharedKeys = [...baselineFiles.keys()]
    .filter((key) => candidateFiles.has(key))
    .sort((left, right) => left.localeCompare(right));

  if (sharedKeys.length === 0) {
    return {
      status: 'skipped',
      reason: 'no matching PNG files between baseline and candidate directories',
      pairCount: 0
    };
  }

  const perImage = [];
  const diffRoot = path.join(options.outDir, 'perceptual-diffs');
  for (const key of sharedKeys) {
    const baselinePath = baselineFiles.get(key);
    const candidatePath = candidateFiles.get(key);
    if (!baselinePath || !candidatePath) {
      continue;
    }

    const baseline = PNG.sync.read(await readFile(baselinePath));
    const candidate = PNG.sync.read(await readFile(candidatePath));

    if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
      perImage.push({
        image: key,
        mismatchRatio: 1,
        ssim: 0,
        dimensionsMatch: false
      });
      continue;
    }

    const diff = new PNG({ width: baseline.width, height: baseline.height });
    const mismatchPixels = pixelmatch(
      baseline.data,
      candidate.data,
      diff.data,
      baseline.width,
      baseline.height,
      { threshold: 0.1 }
    );

    const mismatchRatio = mismatchPixels / (baseline.width * baseline.height);
    const ssimResult = ssim(
      { data: baseline.data, width: baseline.width, height: baseline.height },
      { data: candidate.data, width: candidate.width, height: candidate.height }
    );
    const diffPath = path.join(diffRoot, key);
    await mkdir(path.dirname(diffPath), { recursive: true });
    await writeFile(diffPath, PNG.sync.write(diff));

    perImage.push({
      image: key,
      mismatchRatio: Number(mismatchRatio.toFixed(6)),
      ssim: Number(ssimResult.mssim.toFixed(6)),
      dimensionsMatch: true,
      diffPath: diffPath.replaceAll('\\', '/')
    });
  }

  const mismatchRatioMean =
    perImage.length === 0
      ? 0
      : perImage.reduce((sum, item) => sum + item.mismatchRatio, 0) / perImage.length;
  const ssimMin =
    perImage.length === 0 ? 1 : Math.min(...perImage.map((item) => item.ssim));
  const pass =
    mismatchRatioMean <= gateConfig.pixelmatch_mismatch_ratio_max && ssimMin >= gateConfig.ssim_min;

  return {
    status: pass ? 'pass' : 'fail',
    pairCount: perImage.length,
    mismatchRatioMean: Number(mismatchRatioMean.toFixed(6)),
    ssimMin: Number(ssimMin.toFixed(6)),
    gates: gateConfig,
    diffDir: diffRoot.replaceAll('\\', '/'),
    perImage
  };
}

/** Load optional cross-renderer comparison payloads from an artifact directory. */
async function runCrossRendererLayer(options) {
  if (!options.crossRendererDir) {
    return {
      status: 'skipped',
      reason: 'cross-renderer directory not provided',
      comparisonCount: 0
    };
  }

  const entries = await readdir(options.crossRendererDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(options.crossRendererDir, entry.name));

  if (jsonFiles.length === 0) {
    return {
      status: 'skipped',
      reason: 'no cross-renderer JSON files found',
      comparisonCount: 0
    };
  }

  const payloads = [];
  let pass = true;
  for (const filePath of jsonFiles) {
    const payload = await readJson(filePath);
    payloads.push(payload);
    if (payload.pass === false) {
      pass = false;
    }
  }

  return {
    status: pass ? 'pass' : 'fail',
    comparisonCount: payloads.length,
    payloads
  };
}

/** Run optional OpenAI model-assisted rubric audits on sampled PNG pages. */
async function runModelLayer(options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      status: 'skipped',
      reason: 'OPENAI_API_KEY is not set',
      sampleCount: 0
    };
  }

  if (!options.modelImageDir || options.modelSample <= 0) {
    return {
      status: 'skipped',
      reason: 'model-image-dir or model-sample is not configured',
      sampleCount: 0
    };
  }

  const imageFiles = [...(await listPngFiles(options.modelImageDir)).entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(0, options.modelSample);

  if (imageFiles.length === 0) {
    return {
      status: 'skipped',
      reason: 'no model-audit images found',
      sampleCount: 0
    };
  }

  const prompt = await readFile(options.promptPath, 'utf8');
  const schema = await readJson(options.promptSchemaPath);
  const outputs = [];

  for (const [relativePath, absolutePath] of imageFiles) {
    const buffer = await readFile(absolutePath);
    const base64 = buffer.toString('base64');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'music_notation_rubric_v1',
            schema,
            strict: true
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed (${response.status}) for ${relativePath}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    outputs.push({
      image: relativePath,
      response: content ? JSON.parse(content) : null
    });
  }

  return {
    status: 'advisory',
    sampleCount: outputs.length,
    model: options.model,
    outputs
  };
}

/** Render markdown summary for the layered evaluation artifact. */
function formatEvaluationMarkdown(report) {
  const lines = [
    '# Layered Evaluation Report',
    '',
    `Generated at: ${report.generatedAt}`,
    `Overall blocking pass: ${report.overall.blockingPass ? 'yes' : 'no'}`,
    `Blocking failed layers: ${
      report.overall.failedBlockingLayers.length > 0
        ? report.overall.failedBlockingLayers.join(', ')
        : 'none'
    }`,
    ''
  ];

  lines.push('## Layer 1: Deterministic');
  lines.push('');
  lines.push('| Split | Fixtures | Expected-pass rate | Weighted mean | Catastrophic | Critical collisions | Pass |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const split of report.layers.deterministic.splits) {
    lines.push(
      `| ${split.split} | ${split.fixtureCount} | ${split.expectedPassRate.toFixed(4)} | ${split.weightedMean.toFixed(
        4
      )} | ${split.catastrophicExpectedPassCount} | ${split.criticalCollisionExpectedPassCount} | ${
        split.pass ? 'yes' : 'no'
      } |`
    );
  }

  lines.push('');
  lines.push('## Layer 2: Perceptual');
  lines.push('');
  lines.push(`Status: ${report.layers.perceptual.status}`);
  if (report.layers.perceptual.reason) {
    lines.push(`Reason: ${report.layers.perceptual.reason}`);
  }
  if (report.layers.perceptual.pairCount) {
    lines.push(`Pairs: ${report.layers.perceptual.pairCount}`);
    lines.push(`Mismatch ratio mean: ${report.layers.perceptual.mismatchRatioMean}`);
    lines.push(`SSIM min: ${report.layers.perceptual.ssimMin}`);
  }

  lines.push('');
  lines.push('## Layer 3: Cross-renderer');
  lines.push('');
  lines.push(`Status: ${report.layers.crossRenderer.status}`);
  if (report.layers.crossRenderer.reason) {
    lines.push(`Reason: ${report.layers.crossRenderer.reason}`);
  }
  if (report.layers.crossRenderer.comparisonCount !== undefined) {
    lines.push(`Comparison files: ${report.layers.crossRenderer.comparisonCount}`);
  }

  lines.push('');
  lines.push('## Layer 4: Model-assisted');
  lines.push('');
  lines.push(`Status: ${report.layers.model.status}`);
  if (report.layers.model.reason) {
    lines.push(`Reason: ${report.layers.model.reason}`);
  }
  if (report.layers.model.sampleCount !== undefined) {
    lines.push(`Samples: ${report.layers.model.sampleCount}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Main entry point for M7C layered evaluation execution. */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  const [conformanceReport, splitConfig, gateConfig] = await Promise.all([
    readJson(options.reportPath),
    readJson(options.splitsPath),
    readJson(options.gatesPath)
  ]);

  const splitNames = options.split ? [options.split] : Object.keys(splitConfig.splits);
  const deterministicSplits = splitNames.map((splitName) => {
    const splitDefinition = splitConfig.splits[splitName];
    if (!splitDefinition) {
      throw new Error(`split '${splitName}' is not defined in ${options.splitsPath}`);
    }

    const splitGate =
      gateConfig.deterministic[splitName] ?? gateConfig.deterministic.nightly;
    if (!splitGate) {
      throw new Error(`missing deterministic gate definition for split '${splitName}'`);
    }

    const splitResults = resolveSplitResults(conformanceReport, splitDefinition);
    return evaluateDeterministicSplit(splitName, splitResults, splitGate);
  });

  const deterministicStatus = deterministicSplits.every((split) => split.pass) ? 'pass' : 'fail';
  const perceptualLayer = await runPerceptualLayer(options, gateConfig.perceptual);
  const crossRendererLayer = await runCrossRendererLayer(options);
  const modelLayer = await runModelLayer(options);

  const blockingLayers = ['deterministic', 'perceptual'];
  const failedBlockingLayers = [];
  if (deterministicStatus === 'fail') {
    failedBlockingLayers.push('deterministic');
  }
  if (perceptualLayer.status === 'fail') {
    failedBlockingLayers.push('perceptual');
  }

  const evaluationReport = {
    generatedAt: new Date().toISOString(),
    inputs: {
      reportPath: options.reportPath,
      splitsPath: options.splitsPath,
      gatesPath: options.gatesPath
    },
    layers: {
      deterministic: {
        status: deterministicStatus,
        splits: deterministicSplits
      },
      perceptual: perceptualLayer,
      crossRenderer: crossRendererLayer,
      model: modelLayer
    },
    overall: {
      blockingLayers,
      failedBlockingLayers,
      blockingPass: failedBlockingLayers.length === 0
    }
  };

  await mkdir(options.outDir, { recursive: true });
  const jsonPath = path.join(options.outDir, 'evaluation-report.json');
  const markdownPath = path.join(options.outDir, 'evaluation-report.md');
  await writeFile(jsonPath, `${JSON.stringify(evaluationReport, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, formatEvaluationMarkdown(evaluationReport), 'utf8');

  // Emit a concise console summary for local runs and CI logs.
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${markdownPath}`);
  console.log(
    `layer1=${deterministicStatus} layer2=${perceptualLayer.status} layer3=${crossRendererLayer.status} layer4=${modelLayer.status}`
  );
  console.log(`blocking_pass=${evaluationReport.overall.blockingPass ? 'yes' : 'no'}`);

  if (!evaluationReport.overall.blockingPass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
