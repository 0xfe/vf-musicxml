import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Default cache root used by script-level render loops. */
export const DEFAULT_FIXTURE_RENDER_CACHE_DIR = path.resolve('artifacts/.cache/fixture-render');
/** Renderer entrypoint fingerprint source used to invalidate stale cache rows. */
const DEFAULT_RENDERER_FINGERPRINT_PATH = path.resolve('dist/public/api.js');
/** Cache schema version to invalidate stale serialization formats. */
const CACHE_SCHEMA_VERSION = 1;

/**
 * Build a tiny script-level cache handle used by golden/headless/inspect loops.
 * The cache stores already-rendered page 0 SVG/PNG payloads keyed by fixture
 * file metadata + renderer fingerprint to avoid repeated parse/render work.
 */
export function createFixtureRenderCache(options = {}) {
  const cacheDir = options.cacheDir ? path.resolve(options.cacheDir) : DEFAULT_FIXTURE_RENDER_CACHE_DIR;
  const rendererFingerprintPath = options.rendererFingerprintPath
    ? path.resolve(options.rendererFingerprintPath)
    : DEFAULT_RENDERER_FINGERPRINT_PATH;
  const enabled = options.enabled !== false;

  return {
    enabled,
    cacheDir,
    rendererFingerprintPath,
    async read(params) {
      if (!enabled) {
        return undefined;
      }

      const cachePath = await resolveCachePath(cacheDir, rendererFingerprintPath, params);
      if (!cachePath) {
        return undefined;
      }

      try {
        const raw = await readFile(cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
          return undefined;
        }
        if (typeof parsed.svgMarkup !== 'string' || typeof parsed.pngBase64 !== 'string') {
          return undefined;
        }

        return {
          svgMarkup: parsed.svgMarkup,
          png: Buffer.from(parsed.pngBase64, 'base64'),
          width: Number(parsed.width),
          height: Number(parsed.height),
          parseDiagnostics: Array.isArray(parsed.parseDiagnostics) ? parsed.parseDiagnostics : [],
          renderDiagnostics: Array.isArray(parsed.renderDiagnostics) ? parsed.renderDiagnostics : [],
          pageCount: Number.isFinite(parsed.pageCount) ? Number(parsed.pageCount) : 1
        };
      } catch {
        return undefined;
      }
    },
    async write(params, payload) {
      if (!enabled) {
        return;
      }

      const cachePath = await resolveCachePath(cacheDir, rendererFingerprintPath, params);
      if (!cachePath) {
        return;
      }

      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(
        cachePath,
        `${JSON.stringify(
          {
            schemaVersion: CACHE_SCHEMA_VERSION,
            savedAt: new Date().toISOString(),
            id: params.id,
            fixturePath: params.fixturePath,
            format: params.format,
            pageIndex: params.pageIndex ?? 0,
            width: payload.width,
            height: payload.height,
            pageCount: payload.pageCount ?? 1,
            parseDiagnostics: payload.parseDiagnostics ?? [],
            renderDiagnostics: payload.renderDiagnostics ?? [],
            svgMarkup: payload.svgMarkup,
            pngBase64: payload.png.toString('base64')
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    }
  };
}

/**
 * Resolve one deterministic cache file path for a fixture render request.
 * If file metadata cannot be read, cache lookup/write is skipped.
 */
async function resolveCachePath(cacheDir, rendererFingerprintPath, params) {
  try {
    const fixtureStats = await stat(path.resolve(params.fixturePath));
    const rendererStats = await stat(rendererFingerprintPath);
    const keyInput = JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      id: params.id,
      fixturePath: path.resolve(params.fixturePath),
      format: params.format,
      pageIndex: params.pageIndex ?? 0,
      fixtureSize: fixtureStats.size,
      fixtureMtimeMs: Math.round(fixtureStats.mtimeMs),
      rendererSize: rendererStats.size,
      rendererMtimeMs: Math.round(rendererStats.mtimeMs)
    });
    const key = createHash('sha1').update(keyInput).digest('hex');
    return path.join(cacheDir, `${key}.json`);
  } catch {
    return undefined;
  }
}
