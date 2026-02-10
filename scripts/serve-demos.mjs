/* global URL, console, process */

import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute repository root path resolved from this script location. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Static demo site directory built by `scripts/build-demos.mjs`. */
const SITE_DIR = path.join(ROOT_DIR, 'demos', 'site');
/** Local server port used for demo viewing. */
const PORT = Number.parseInt(process.env.DEMO_PORT ?? '4173', 10);

/** Minimal content-type map for demo static assets. */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

/** Resolve URL path to a safe in-site file path. */
function resolveRequestPath(urlPathname) {
  const normalized = urlPathname === '/' ? '/index.html' : urlPathname;
  const cleaned = normalized.replaceAll('\\', '/');
  const requested = path.join(SITE_DIR, cleaned);
  const relative = path.relative(SITE_DIR, requested);
  if (relative.startsWith('..')) {
    return undefined;
  }
  return requested;
}

/** Read and respond with a static file from the demo site directory. */
async function respondWithFile(filePath, response) {
  try {
    await access(filePath);
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

/** Start the local HTTP server for static demo pages. */
function startServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const filePath = resolveRequestPath(url.pathname);
    if (!filePath) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    await respondWithFile(filePath, response);
  });

  server.listen(PORT, () => {
    console.log(`Demo server running at http://localhost:${PORT}/`);
  });
}

startServer();
