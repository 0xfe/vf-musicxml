import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

/**
 * Resolve a repo-local Chromium executable across architecture variants.
 * This avoids arm64/x64 mismatch failures when multiple runtimes execute tests.
 */
function resolveLocalChromiumExecutable(): string | undefined {
  const roots = new Set<string>();
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    roots.add(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  roots.add(path.resolve('.playwright'));

  for (const root of roots) {
    const executable = resolveFromRoot(root);
    if (executable) {
      return executable;
    }
  }

  return undefined;
}

/** Resolve an executable path from one Playwright browser cache root. */
function resolveFromRoot(root: string): string | undefined {
  if (!existsSync(root)) {
    return undefined;
  }

  const entries = readdirSync(root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  const headlessDirs = directories
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => b.localeCompare(a));
  for (const directory of headlessDirs) {
    const executable = firstExisting([
      path.join(root, directory, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      path.join(root, directory, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
      path.join(root, directory, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      path.join(root, directory, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
    ]);
    if (executable) {
      return executable;
    }
  }

  const chromiumDirs = directories
    .filter((name) => name.startsWith('chromium-'))
    .sort((a, b) => b.localeCompare(a));
  for (const directory of chromiumDirs) {
    const executable = firstExisting([
      path.join(
        root,
        directory,
        'chrome-mac-arm64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing'
      ),
      path.join(
        root,
        directory,
        'chrome-mac-x64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing'
      ),
      path.join(root, directory, 'chrome-linux', 'chrome'),
      path.join(root, directory, 'chrome-win', 'chrome.exe')
    ]);
    if (executable) {
      return executable;
    }
  }

  return undefined;
}

/** Return the first path that exists on disk. */
function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => existsSync(candidate));
}

const localChromiumExecutable = resolveLocalChromiumExecutable();

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 960, height: 320 },
    launchOptions: localChromiumExecutable ? { executablePath: localChromiumExecutable } : undefined
  }
});
