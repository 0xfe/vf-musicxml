import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** Shared path to the M8C proof-point manifest. */
const PROOFPOINT_MANIFEST_PATH = path.resolve('fixtures/evaluation/golden-proofpoints.json');

/** Supported crop units for proof-point configuration. */
const VALID_CROP_UNITS = new Set(['pixels', 'ratio']);

describe('golden proof-point manifest', () => {
  it('contains valid fixtures with existing score/reference assets', async () => {
    const raw = await readFile(PROOFPOINT_MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number;
      fixtures?: Array<{
        id?: string;
        fixturePath?: string;
        format?: string;
        referenceImagePath?: string;
        blocking?: boolean;
        cropActual?: {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          unit?: string;
        };
        cropReference?: {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          unit?: string;
        };
      }>;
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(Array.isArray(parsed.fixtures)).toBe(true);
    expect(parsed.fixtures?.length ?? 0).toBeGreaterThan(0);

    for (const fixture of parsed.fixtures ?? []) {
      expect(fixture.id).toBeTruthy();
      expect(fixture.fixturePath).toBeTruthy();
      expect(fixture.referenceImagePath).toBeTruthy();
      expect(fixture.format === 'xml' || fixture.format === 'mxl').toBe(true);
      expect(typeof fixture.blocking).toBe('boolean');

      await access(path.resolve(fixture.fixturePath ?? ''));
      await access(path.resolve(fixture.referenceImagePath ?? ''));

      assertCropRegion(fixture.cropActual);
      assertCropRegion(fixture.cropReference);
    }
  });
});

/** Assert one optional crop region payload is structurally valid. */
function assertCropRegion(
  region:
    | {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        unit?: string;
      }
    | undefined
): void {
  if (!region) {
    return;
  }

  expect(Number.isFinite(region.x)).toBe(true);
  expect(Number.isFinite(region.y)).toBe(true);
  expect(Number.isFinite(region.width)).toBe(true);
  expect(Number.isFinite(region.height)).toBe(true);
  expect((region.width ?? 0) > 0).toBe(true);
  expect((region.height ?? 0) > 0).toBe(true);
  expect(VALID_CROP_UNITS.has(region.unit ?? 'pixels')).toBe(true);

  if ((region.unit ?? 'pixels') === 'ratio') {
    expect((region.x ?? 0) >= 0).toBe(true);
    expect((region.y ?? 0) >= 0).toBe(true);
    expect((region.width ?? 0) > 0 && (region.width ?? 0) <= 1).toBe(true);
    expect((region.height ?? 0) > 0 && (region.height ?? 0) <= 1).toBe(true);
  }
}
