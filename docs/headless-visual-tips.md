# Headless Visual Tips

## Purpose
Fast path for rendering and visual analysis without launching a browser. Use this first for CI/headless servers and high-volume fixture triage.

## Core commands
```bash
# refresh baseline PNG snapshots
npm run test:visual:headless:update

# compare current render output against baselines
npm run test:visual:headless

# compare rendered fixtures against external golden references
npm run test:golden
```

## Focused fixture run
```bash
npm run test:visual:headless -- --fixtures=lilypond-01a-pitches-pitches,realworld-music21-bach-bwv1-6
```

## One-score fast triage (no manifest required)
```bash
npm run inspect:score -- --input=fixtures/conformance/lilypond/01a-pitches-pitches.musicxml
npm run inspect:score -- --input=fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl
```

Useful options:
```bash
# inspect a specific page from multi-page render output
npm run inspect:score -- --input=fixtures/conformance/realworld/realworld-music21-beethoven-op133-longform.mxl --page=1

# compare one score against an explicit baseline PNG
npm run inspect:score -- --input=fixtures/conformance/lilypond/01a-pitches-pitches.musicxml --reference-png=tests/visual-headless/baselines/lilypond-01a-pitches-pitches.png
```

`inspect:score` report highlights:
- `geometrySummary.noteheadBarlineIntrusionCount`: fast containment sanity check.
- `spacingSummary.firstToMedianOtherGapRatio`: opening-measure spacing consistency signal.

## Golden proof-point auto-crop (system-aware)
Use `autoCropActual.systems` in `/Users/mo/git/musicxml/fixtures/evaluation/golden-proofpoints.json` when comparing to excerpt references (for example first N systems of a page). This is more stable than ratio crops.

Example:
```json
{
  "id": "realworld-music21-bach-bwv1-6-8bars",
  "autoCropActual": {
    "systems": {
      "stavesPerSystem": 5,
      "startSystemIndex": 0,
      "systemCount": 2,
      "includeFullWidth": true,
      "headerPadding": 120,
      "paddingBottom": 14
    }
  }
}
```

## Golden comparison alignment controls
Use proof-point `normalization` options when the same excerpt is globally shifted but otherwise comparable.

Example:
```json
{
  "id": "realworld-music21-bach-bwv1-6-8bars",
  "normalization": {
    "trimWhitespace": true,
    "trimThreshold": 248,
    "trimPadding": 10,
    "resizeActualToReference": true,
    "resizeMode": "fit",
    "alignByInkCentroid": true,
    "maxAlignmentShift": 24,
    "alignmentAxis": "x"
  }
}
```

Notes:
- `alignmentAxis: "x"` is recommended for multi-system score excerpts to avoid over-correcting vertical spacing.
- Golden report rows include `alignmentShiftX` / `alignmentShiftY` for fast triage.

## How it works
- Parse + render with repo code (`parseMusicXMLAsync`, `renderToSVGPages`).
- Extract root SVG from renderer page markup.
- Rasterize SVG with `@resvg/resvg-js`.
- Compare against baseline PNGs via:
  - pixel mismatch (`pixelmatch`)
  - SSIM structural similarity (`ssim.js`)
- Emit triage artifacts:
  - `tests/visual-headless/baselines/*.png`
  - `artifacts/visual-headless/*.actual.png`
  - `artifacts/visual-headless/*.diff.png` (when failing)
  - `artifacts/visual-headless/report.json`
  - `artifacts/visual-headless/report.md`
  - `artifacts/score-inspection/<score-id>/*` (one-score SVG/PNG/report from `inspect:score`)

## Thresholds
- Default max mismatch ratio: `0.004`
- Default min SSIM: `0.985`
- Golden reports also include `structuralMismatchRatio` (ink-mask tolerant metric) for triage when glyph/font style differs between sources.

Override example:
```bash
npm run test:visual:headless -- --max-mismatch-ratio=0.006 --min-ssim=0.98
```

## Related tooling
- Script entrypoint:
  - `/Users/mo/git/musicxml/scripts/run-headless-visual-regression.mjs`
  - `/Users/mo/git/musicxml/scripts/run-golden-comparison.mjs`
- Shared helper API:
  - `/Users/mo/git/musicxml/src/testkit/headless-visual.ts`
- Sentinel fixture manifest:
  - `/Users/mo/git/musicxml/fixtures/evaluation/headless-visual-sentinels.json`
  - `/Users/mo/git/musicxml/fixtures/evaluation/golden-proofpoints.json`

## When to use Playwright/MCP instead
- Browser-specific rendering behavior investigation.
- Interactive debugging of one problematic fixture page.
- Screenshot parity checks that must match browser text/layout exactly.
