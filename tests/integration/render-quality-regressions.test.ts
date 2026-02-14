import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Score } from '../../src/core/score.js';
import { parseMusicXML, parseMusicXMLAsync, renderToSVGPages } from '../../src/public/index.js';
import {
  collectNotationGeometry,
  detectExtremeCurvePaths,
  detectNoteheadBarlineIntrusions,
  type NotationGeometrySnapshot,
  summarizeMeasureSpacingByBarlines
} from '../../src/testkit/notation-geometry.js';
import { detectSvgOverlaps, extractSvgElementBounds } from '../../src/testkit/svg-collision.js';

const pageQualityProbeScriptPath = path.resolve('scripts/probe-page-quality.mjs');

/** Trim wrapper markup and return the first SVG payload for geometry audits. */
function extractSvg(pageMarkup: string): string {
  const start = pageMarkup.indexOf('<svg');
  const end = pageMarkup.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) {
    return '';
  }

  return pageMarkup.slice(start, end + '</svg>'.length);
}

/** Aggregate notation geometry across all rendered pages. */
function collectGeometryAcrossPages(pageMarkup: string[]): NotationGeometrySnapshot {
  const combined: NotationGeometrySnapshot = {
    noteheads: [],
    stems: [],
    beams: [],
    flags: [],
    barlines: []
  };

  for (const markup of pageMarkup) {
    const svg = extractSvg(markup);
    const geometry = collectNotationGeometry(svg);
    combined.noteheads.push(...geometry.noteheads);
    combined.stems.push(...geometry.stems);
    combined.beams.push(...geometry.beams);
    combined.flags.push(...geometry.flags);
    combined.barlines.push(...geometry.barlines);
  }

  return combined;
}

/** Normalize spacing-band compression ratio using density-aware width hints when available. */
function resolveBandCompressionRatio(
  band: ReturnType<typeof summarizeMeasureSpacingByBarlines>['bandSummaries'][number]
): number | null {
  return band.firstToMedianOtherEstimatedWidthRatio ?? band.firstToMedianOtherGapRatio;
}

/** Collect per-segment vertical gaps for aligned paired staves (e.g., grand-staff rows). */
function collectAlignedStaffPairGaps(svgMarkup: string): number[] {
  const staves = extractSvgElementBounds(svgMarkup, { selector: '.vf-stave' }).map((entry) => entry.bounds);
  const gaps: number[] = [];
  for (let upperIndex = 0; upperIndex < staves.length; upperIndex += 1) {
    for (let lowerIndex = upperIndex + 1; lowerIndex < staves.length; lowerIndex += 1) {
      const upper = staves[upperIndex];
      const lower = staves[lowerIndex];
      if (!upper || !lower) {
        continue;
      }
      if (Math.abs(upper.x - lower.x) > 0.5 || Math.abs(upper.width - lower.width) > 0.5) {
        continue;
      }
      const gap = lower.y - (upper.y + upper.height);
      if (gap >= 0 && gap <= 220) {
        gaps.push(gap);
      }
    }
  }
  return gaps;
}

/** Count note-level non-arpeggiate ornaments preserved in parsed score data. */
function countNonArpeggiateMarkers(score: Score): number {
  let markerCount = 0;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!event || event.kind !== 'note') {
            continue;
          }
          for (const note of event.notes) {
            markerCount += (note.ornaments ?? []).filter((ornament) => ornament.type.startsWith('non-arpeggiate')).length;
          }
        }
      }
    }
  }
  return markerCount;
}

/** Count distinct note events that contain any non-arpeggiate markers. */
function countNonArpeggiateAnchorEvents(score: Score): number {
  let eventCount = 0;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!event || event.kind !== 'note') {
            continue;
          }
          const hasNonArpeggiate = event.notes.some((note) =>
            (note.ornaments ?? []).some((ornament) => ornament.type.startsWith('non-arpeggiate'))
          );
          if (hasNonArpeggiate) {
            eventCount += 1;
          }
        }
      }
    }
  }
  return eventCount;
}

interface OutOfProcessPageProbeResult {
  hasSvg: boolean;
  weakestSpacingRatio: number | null;
  evaluatedBandRatios: number[];
  compressedBandCount: number;
  extremeCurveCount: number;
}

/**
 * Probe one page in a separate Node process to avoid long-form memory growth
 * when sweeping hundreds of SVG/JSDOM page analyses in one test worker.
 */
async function probePageQualityOutOfProcess(pageMarkup: string): Promise<OutOfProcessPageProbeResult> {
  const stdout = execFileSync(process.execPath, [pageQualityProbeScriptPath], {
    input: JSON.stringify({ pageMarkup }),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(stdout) as OutOfProcessPageProbeResult;
}

describe('renderer quality regressions', () => {
  it('prevents noteheads from intruding through barlines in lilypond-01a-pitches-pitches', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/01a-pitches-pitches.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/01a-pitches-pitches.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const geometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    const intrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });
    const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);

    expect(geometry.noteheads.length).toBeGreaterThan(8);
    expect(intrusions.length).toBe(0);
    expect(
      rendered.diagnostics.some((diagnostic) => diagnostic.code === 'MEASURE_LAYOUT_OVERFLOW')
    ).toBe(false);
    expect(spacingSummary.firstMeasureAverageGap).not.toBeNull();
    expect(spacingSummary.medianOtherMeasuresAverageGap).not.toBeNull();
    expect(spacingSummary.firstToMedianOtherGapRatio).not.toBeNull();
    expect(spacingSummary.firstToMedianOtherGapRatio ?? 0).toBeGreaterThan(0.7);
  });

  it('renders beam groups for realworld-music21-bach-bwv1-6', async () => {
    const fixturePath = path.resolve('fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl');
    const archive = await readFile(fixturePath);

    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(archive),
        format: 'mxl'
      },
      {
        sourceName: 'fixtures/conformance/realworld/realworld-music21-bach-bwv1-6.mxl',
        mode: 'lenient'
      }
    );
    expect(parsed.score).toBeDefined();
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(0);
    expect(rendered.pages.every((page) => page.includes('class="mx-page-background"'))).toBe(true);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(
      rendered.diagnostics.some((diagnostic) => diagnostic.code === 'SPANNER_ANCHOR_NOT_RENDERED')
    ).toBe(false);

    const geometry = collectGeometryAcrossPages(rendered.pages);
    const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);
    expect(geometry.noteheads.length).toBeGreaterThan(100);
    expect(geometry.beams.length).toBeGreaterThan(20);
    expect(geometry.flags.length).toBe(0);
    expect(spacingSummary.firstToMedianOtherGapRatio).not.toBeNull();
    // Guard against first-measure squeeze regressions in system starts.
    expect(spacingSummary.firstToMedianOtherGapRatio ?? 0).toBeGreaterThan(0.85);
  });

  it('respects authored MusicXML beam groups when source beam markers are present', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">begin</beam>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">continue</beam>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">continue</beam>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">end</beam>
      </note>
      <note><rest/><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);

    const geometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    expect(geometry.beams.length).toBe(1);
    expect(geometry.flags.length).toBe(0);
  });

  it('does not draw cross-staff slurs that would cut through unrelated systems', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <staff>1</staff>
        <notations><slur type="start" number="1" placement="above"/></notations>
      </note>
      <backup><duration>1</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <staff>2</staff>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    expect((parsed.score?.spanners ?? []).filter((spanner) => spanner.type === 'slur')).toHaveLength(0);

    const rendered = renderToSVGPages(parsed.score!, {
      layout: {
        scale: 1
      }
    });
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'SLUR_CROSS_STAFF_UNSUPPORTED')).toBe(false);
  });

  it('suppresses mixed-stem slurs with extreme anchor deltas that cut through staff content', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>up</stem>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note>
        <pitch><step>E</step><octave>6</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>down</stem>
        <notations><slur type="stop" number="1"/></notations>
      </note>
      <note><rest/><duration>2</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const rendered = renderToSVGPages(parsed.score!);

    expect(rendered.pages.length).toBe(1);
    expect(
      rendered.diagnostics.some((diagnostic) => diagnostic.code === 'SLUR_MIXED_STEM_DELTA_UNSUPPORTED')
    ).toBe(true);
  });

  it('suppresses same-stem slurs with extreme anchor deltas that indicate unstable routing', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>up</stem>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>6</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <stem>up</stem>
        <notations><slur type="stop" number="1"/></notations>
      </note>
      <note><rest/><duration>2</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml, { mode: 'lenient' });
    expect(parsed.score).toBeDefined();
    const rendered = renderToSVGPages(parsed.score!);

    expect(rendered.pages.length).toBe(1);
    expect(
      rendered.diagnostics.some((diagnostic) => diagnostic.code === 'SLUR_EXTREME_ANCHOR_DELTA_UNSUPPORTED')
    ).toBe(true);
  });

  it('does not emit extreme diagonal curve paths for op18 proof-point rendering', async () => {
    const fixturePath = path.resolve('fixtures/conformance/realworld/realworld-music21-beethoven-op18no1-m1.mxl');
    const archive = await readFile(fixturePath);
    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(archive),
        format: 'mxl'
      },
      {
        sourceName: 'fixtures/conformance/realworld/realworld-music21-beethoven-op18no1-m1.mxl',
        mode: 'lenient'
      }
    );
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    const svg = extractSvg(rendered.pages[0] ?? '');
    const extremes = detectExtremeCurvePaths(svg, {
      minVerticalDelta: 100,
      minHorizontalSpan: 70,
      minSlopeRatio: 0.5
    });
    const unstableCurveDiagnostics = rendered.diagnostics.filter((diagnostic) =>
      [
        'TIE_EXTREME_ANCHOR_DELTA_UNSUPPORTED',
        'SLUR_MIXED_STEM_DELTA_UNSUPPORTED',
        'SLUR_EXTREME_ANCHOR_DELTA_UNSUPPORTED'
      ].includes(diagnostic.code)
    );
    const spacingSummary = summarizeMeasureSpacingByBarlines(collectNotationGeometry(svg));
    const evaluatedBandRatios = spacingSummary.bandSummaries
      .map((band) => resolveBandCompressionRatio(band))
      .filter((ratio): ratio is number => ratio !== null);

    expect(extremes.length).toBe(0);
    expect(unstableCurveDiagnostics.length).toBe(0);
    expect(evaluatedBandRatios.length).toBeGreaterThan(0);
    expect(Math.min(...evaluatedBandRatios)).toBeGreaterThan(0.5);
  });

  it('avoids lyric-text overlaps in lilypond-61b-multiplelyrics', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/61b-multiplelyrics.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/61b-multiplelyrics.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'LYRIC_TEXT_RENDERED')).toBe(true);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 4 });
    expect(textBounds.length).toBeGreaterThan(10);
    expect(overlaps.length).toBe(0);
  });

  it('emits unsupported-duration skip diagnostics for lilypond-03a-rhythm-durations', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/03a-rhythm-durations.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/03a-rhythm-durations.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(
      rendered.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_DURATION_TYPE_SKIPPED')
    ).toBe(true);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_DURATION')).toBe(false);

    const geometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    const intrusions = detectNoteheadBarlineIntrusions(geometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });
    const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);
    expect(intrusions.length).toBe(0);
    expect(spacingSummary.bandSummaries.length).toBeGreaterThan(0);
    for (const band of spacingSummary.bandSummaries) {
      if (band.firstToMedianOtherGapRatio === null) {
        continue;
      }
      expect(band.firstToMedianOtherGapRatio).toBeGreaterThan(0.75);
    }
  });

  it('keeps Schumann proof-point pages stable for sparse-page spacing and curve routing', async () => {
    const fixturePath = path.resolve('fixtures/conformance/realworld/realworld-music21-schumann-clara-polonaise-op1n1.mxl');
    const archive = await readFile(fixturePath);

    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(archive),
        format: 'mxl'
      },
      {
        sourceName: 'fixtures/conformance/realworld/realworld-music21-schumann-clara-polonaise-op1n1.mxl',
        mode: 'lenient'
      }
    );
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(
      rendered.diagnostics.some((diagnostic) =>
        ['TIE_EXTREME_ANCHOR_DELTA_UNSUPPORTED', 'SLUR_MIXED_STEM_DELTA_UNSUPPORTED', 'SLUR_EXTREME_ANCHOR_DELTA_UNSUPPORTED'].includes(
          diagnostic.code
        )
      )
    ).toBe(false);

    let weakestSpacingRatio = Number.POSITIVE_INFINITY;
    for (const pageMarkup of rendered.pages) {
      const svg = extractSvg(pageMarkup);
      const geometry = collectNotationGeometry(svg);
      const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);
      const evaluatedBandRatios = spacingSummary.bandSummaries
        .map((band) => resolveBandCompressionRatio(band))
        .filter((ratio): ratio is number => ratio !== null);

      if (evaluatedBandRatios.length > 0) {
        const pageMin = Math.min(...evaluatedBandRatios);
        weakestSpacingRatio = Math.min(weakestSpacingRatio, pageMin);
        expect(evaluatedBandRatios.filter((ratio) => ratio < 0.75)).toHaveLength(0);
      }

      const extremes = detectExtremeCurvePaths(svg, {
        minVerticalDelta: 100,
        minHorizontalSpan: 70,
        minSlopeRatio: 0.5
      });
      expect(extremes).toHaveLength(0);
    }

    expect(weakestSpacingRatio).toBeGreaterThan(0.8);
  });

  it('keeps additional multi-page proof-points stable for sparse-page spacing and curve routing', async () => {
    const fixtures = [
      {
        file: 'realworld-music21-bach-bwv244-10.mxl',
        minPages: 3,
        minWeakestSpacingRatio: 0.9
      },
      {
        file: 'realworld-music21-bach-bwv1-6.mxl',
        minPages: 2,
        minWeakestSpacingRatio: 0.87
      },
      {
        file: 'realworld-music21-mozart-k545-exposition.mxl',
        minPages: 3,
        minWeakestSpacingRatio: 0.79
      },
      {
        file: 'realworld-music21-berlin-alexanders-ragtime.mxl',
        minPages: 2,
        minWeakestSpacingRatio: 0.9
      }
    ];

    for (const fixture of fixtures) {
      const fixturePath = path.resolve(`fixtures/conformance/realworld/${fixture.file}`);
      const archive = await readFile(fixturePath);
      const parsed = await parseMusicXMLAsync(
        {
          data: new Uint8Array(archive),
          format: 'mxl'
        },
        {
          sourceName: `fixtures/conformance/realworld/${fixture.file}`,
          mode: 'lenient'
        }
      );
      expect(parsed.score).toBeDefined();

      const rendered = renderToSVGPages(parsed.score!);
      expect(rendered.pages.length).toBeGreaterThanOrEqual(fixture.minPages);
      expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
      expect(
        rendered.diagnostics.some((diagnostic) =>
          ['TIE_EXTREME_ANCHOR_DELTA_UNSUPPORTED', 'SLUR_MIXED_STEM_DELTA_UNSUPPORTED', 'SLUR_EXTREME_ANCHOR_DELTA_UNSUPPORTED'].includes(
            diagnostic.code
          )
        )
      ).toBe(false);

      let weakestSpacingRatio = Number.POSITIVE_INFINITY;
      for (const pageMarkup of rendered.pages) {
        const svg = extractSvg(pageMarkup);
        const geometry = collectNotationGeometry(svg);
        const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);
        const evaluatedBandRatios = spacingSummary.bandSummaries
          .map((band) => resolveBandCompressionRatio(band))
          .filter((ratio): ratio is number => ratio !== null);

        if (evaluatedBandRatios.length > 0) {
          const pageMin = Math.min(...evaluatedBandRatios);
          weakestSpacingRatio = Math.min(weakestSpacingRatio, pageMin);
          expect(evaluatedBandRatios.filter((ratio) => ratio < 0.75)).toHaveLength(0);
        }

        const extremes = detectExtremeCurvePaths(svg, {
          minVerticalDelta: 100,
          minHorizontalSpan: 70,
          minSlopeRatio: 0.5
        });
        expect(extremes).toHaveLength(0);
      }

      expect(weakestSpacingRatio).toBeGreaterThan(fixture.minWeakestSpacingRatio);
    }
  });

  it('keeps additional real-world sparse compaction envelopes bounded', async () => {
    const fixtures = [
      {
        file: 'realworld-music21-mozart-k545-exposition.mxl',
        minPages: 3,
        maxCompressedBands: 0,
        maxOverstretchedBands: 3,
        maxBandRatio: 4.5
      },
      {
        file: 'realworld-music21-berlin-alexanders-ragtime.mxl',
        minPages: 2,
        maxCompressedBands: 0,
        maxOverstretchedBands: 0,
        maxBandRatio: 2
      }
    ];

    for (const fixture of fixtures) {
      const fixturePath = path.resolve(`fixtures/conformance/realworld/${fixture.file}`);
      const archive = await readFile(fixturePath);
      const parsed = await parseMusicXMLAsync(
        {
          data: new Uint8Array(archive),
          format: 'mxl'
        },
        {
          sourceName: `fixtures/conformance/realworld/${fixture.file}`,
          mode: 'lenient'
        }
      );
      expect(parsed.score).toBeDefined();

      const rendered = renderToSVGPages(parsed.score!);
      expect(rendered.pages.length).toBeGreaterThanOrEqual(fixture.minPages);
      expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

      let compressedBandCount = 0;
      let overstretchedBandCount = 0;
      let maxBandRatio = 0;
      for (const pageMarkup of rendered.pages) {
        const svg = extractSvg(pageMarkup);
        const geometry = collectNotationGeometry(svg);
        const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);
        const evaluatedBandRatios = spacingSummary.bandSummaries
          .map((band) => resolveBandCompressionRatio(band))
          .filter((ratio): ratio is number => ratio !== null);
        compressedBandCount += evaluatedBandRatios.filter((ratio) => ratio < 0.75).length;
        overstretchedBandCount += evaluatedBandRatios.filter((ratio) => ratio > 2.5).length;
        if (evaluatedBandRatios.length > 0) {
          maxBandRatio = Math.max(maxBandRatio, Math.max(...evaluatedBandRatios));
        }
      }

      expect(compressedBandCount).toBeLessThanOrEqual(fixture.maxCompressedBands);
      expect(overstretchedBandCount).toBeLessThanOrEqual(fixture.maxOverstretchedBands);
      expect(maxBandRatio).toBeLessThanOrEqual(fixture.maxBandRatio);
    }
  });

  it('keeps real-world grand-staff vertical gaps bounded under compaction policies', async () => {
    const fixtures = [
      {
        file: 'realworld-music21-schumann-clara-polonaise-op1n1.mxl',
        minPages: 6,
        minPairGap: 150,
        maxPairGap: 160
      },
      {
        file: 'realworld-openscore-lieder-just-for-today.mxl',
        minPages: 5,
        minPairGap: 110,
        maxPairGap: 155
      }
    ];

    for (const fixture of fixtures) {
      const fixturePath = path.resolve(`fixtures/conformance/realworld/${fixture.file}`);
      const archive = await readFile(fixturePath);
      const parsed = await parseMusicXMLAsync(
        {
          data: new Uint8Array(archive),
          format: 'mxl'
        },
        {
          sourceName: `fixtures/conformance/realworld/${fixture.file}`,
          mode: 'lenient'
        }
      );
      expect(parsed.score).toBeDefined();

      const rendered = renderToSVGPages(parsed.score!);
      expect(rendered.pages.length).toBeGreaterThanOrEqual(fixture.minPages);
      expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

      const pairGaps = rendered.pages.flatMap((pageMarkup) => collectAlignedStaffPairGaps(pageMarkup));
      expect(pairGaps.length).toBeGreaterThan(0);
      expect(Math.min(...pairGaps)).toBeGreaterThanOrEqual(fixture.minPairGap);
      expect(Math.max(...pairGaps)).toBeLessThanOrEqual(fixture.maxPairGap);
    }
  });

  it(
    'keeps op133-class long-form fixtures stable with out-of-process full-page gates',
    async () => {
      const fixtures = [
        {
          file: 'realworld-music21-beethoven-op133-longform.mxl',
          minPages: 120,
          minWeakestSpacingRatio: 0.35,
          maxCompressedBandCount: 16,
          maxCompressedPageCount: 14
        },
        {
          file: 'realworld-music21-bach-bwv248-42-4.mxl',
          minPages: 20,
          minWeakestSpacingRatio: 0.35,
          maxCompressedBandCount: 20,
          maxCompressedPageCount: 6
        },
        {
          file: 'realworld-openscore-lieder-just-for-today.mxl',
          minPages: 5,
          minWeakestSpacingRatio: 0.06,
          maxCompressedBandCount: 6,
          maxCompressedPageCount: 3
        }
      ];

      for (const fixture of fixtures) {
        const fixturePath = path.resolve(`fixtures/conformance/realworld/${fixture.file}`);
        const archive = await readFile(fixturePath);
        const parsed = await parseMusicXMLAsync(
          {
            data: new Uint8Array(archive),
            format: 'mxl'
          },
          {
            sourceName: `fixtures/conformance/realworld/${fixture.file}`,
            mode: 'lenient'
          }
        );
        expect(parsed.score).toBeDefined();

        const rendered = renderToSVGPages(parsed.score!);
        expect(rendered.pages.length).toBeGreaterThanOrEqual(fixture.minPages);
        expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
        expect(
          rendered.diagnostics.some((diagnostic) =>
            ['TIE_EXTREME_ANCHOR_DELTA_UNSUPPORTED', 'SLUR_MIXED_STEM_DELTA_UNSUPPORTED', 'SLUR_EXTREME_ANCHOR_DELTA_UNSUPPORTED'].includes(
              diagnostic.code
            )
          )
        ).toBe(false);

        let weakestSpacingRatio = Number.POSITIVE_INFINITY;
        let compressedBandCount = 0;
        let compressedPageCount = 0;
        for (const pageMarkup of rendered.pages) {
          const probe = await probePageQualityOutOfProcess(pageMarkup);
          expect(probe.hasSvg).toBe(true);
          expect(probe.extremeCurveCount).toBe(0);
          compressedBandCount += probe.compressedBandCount;
          if (probe.compressedBandCount > 0) {
            compressedPageCount += 1;
          }

          if (probe.evaluatedBandRatios.length === 0) {
            continue;
          }
          if (probe.weakestSpacingRatio !== null) {
            weakestSpacingRatio = Math.min(weakestSpacingRatio, probe.weakestSpacingRatio);
          }
        }

        expect(weakestSpacingRatio).toBeGreaterThan(fixture.minWeakestSpacingRatio);
        expect(compressedBandCount).toBeLessThanOrEqual(fixture.maxCompressedBandCount);
        expect(compressedPageCount).toBeLessThanOrEqual(fixture.maxCompressedPageCount);
      }
    },
    240_000
  );

  it('bounds first-system left-bar compression in realworld-music21-mozart-k458-m1', async () => {
    const fixturePath = path.resolve('fixtures/conformance/realworld/realworld-music21-mozart-k458-m1.mxl');
    const archive = await readFile(fixturePath);

    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(archive),
        format: 'mxl'
      },
      {
        sourceName: 'fixtures/conformance/realworld/realworld-music21-mozart-k458-m1.mxl',
        mode: 'lenient'
      }
    );
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(0);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const firstPageGeometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    const spacingSummary = summarizeMeasureSpacingByBarlines(firstPageGeometry);
    const intrusions = detectNoteheadBarlineIntrusions(firstPageGeometry, {
      minHorizontalOverlap: 0.75,
      minVerticalOverlap: 3
    });
    const evaluatedBandRatios = spacingSummary.bandSummaries
      .map((band) => resolveBandCompressionRatio(band))
      .filter((ratio): ratio is number => ratio !== null);
    const compressedBandCount = evaluatedBandRatios.filter((ratio) => ratio < 0.75).length;

    // Keep left-edge pressure bounded on this dense proof-point while we
    // continue M10D/M11 tuning. Current baseline has no intrusion events.
    expect(intrusions.length).toBeLessThanOrEqual(0);
    expect(evaluatedBandRatios.length).toBeGreaterThan(0);
    expect(Math.min(...evaluatedBandRatios)).toBeGreaterThan(0.8);
    expect(compressedBandCount).toBeLessThanOrEqual(0);
  });

  it('keeps first-system opening spacing readable in realworld-music21-bach-bwv244-10', async () => {
    const fixturePath = path.resolve('fixtures/conformance/realworld/realworld-music21-bach-bwv244-10.mxl');
    const archive = await readFile(fixturePath);

    const parsed = await parseMusicXMLAsync(
      {
        data: new Uint8Array(archive),
        format: 'mxl'
      },
      {
        sourceName: 'fixtures/conformance/realworld/realworld-music21-bach-bwv244-10.mxl',
        mode: 'lenient'
      }
    );
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(0);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const firstPageGeometry = collectNotationGeometry(extractSvg(rendered.pages[0] ?? ''));
    const spacingSummary = summarizeMeasureSpacingByBarlines(firstPageGeometry);
    const evaluatedBandRatios = spacingSummary.bandSummaries
      .map((band) => resolveBandCompressionRatio(band))
      .filter((ratio): ratio is number => ratio !== null);
    const compressedBandCount = evaluatedBandRatios.filter((ratio) => ratio < 0.75).length;

    expect(evaluatedBandRatios.length).toBeGreaterThan(0);
    expect(Math.min(...evaluatedBandRatios)).toBeGreaterThan(0.75);
    expect(compressedBandCount).toBe(0);
  });

  it('keeps chord-name labels non-overlapping in lilypond-71g-multiplechordnames', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/71g-multiplechordnames.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/71g-multiplechordnames.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 6 });
    expect(textBounds.length).toBeGreaterThanOrEqual(3);
    expect(overlaps.length).toBe(0);
  });

  it('keeps category-71f all-chord-type labels within bounded overlap budget', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/71f-allchordtypes.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/71f-allchordtypes.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 4 });

    expect(textBounds.length).toBeGreaterThan(40);
    expect(overlaps.length).toBeLessThanOrEqual(1);
  });

  it('keeps category-31 direction text readable without heavy overlap', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/31a-Directions.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/31a-Directions.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 4 });

    expect(textBounds.length).toBeGreaterThan(40);
    // Category 31 intentionally packs dense labels; keep overlaps tightly
    // bounded so symbols/labels remain readable while we continue M11 layout work.
    expect(overlaps.length).toBeLessThanOrEqual(2);
  });

  it('keeps category-31d compound direction text readable with bounded overlap', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/31d-directions-compounds.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/31d-directions-compounds.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 4 });

    expect(textBounds.length).toBeGreaterThan(20);
    expect(overlaps.length).toBeLessThanOrEqual(2);
  });

  it('keeps a broader category-31/71 sweep inside tight text-overlap budgets', async () => {
    const fixtureBudgets = [
      { file: '31b-directions-order.musicxml', minTextCount: 2, maxOverlaps: 0 },
      { file: '31c-metronomemarks.musicxml', minTextCount: 2, maxOverlaps: 0 },
      { file: '31f-direction-multiline-compounds.musicxml', minTextCount: 2, maxOverlaps: 0 },
      { file: '71a-chordnames.musicxml', minTextCount: 6, maxOverlaps: 0 },
      { file: '71c-chordsfrets.musicxml', minTextCount: 6, maxOverlaps: 0 },
      { file: '71d-chordsfrets-multistaff.musicxml', minTextCount: 6, maxOverlaps: 0 },
      { file: '71e-tabstaves.musicxml', minTextCount: 20, maxOverlaps: 0 }
    ];

    for (const fixture of fixtureBudgets) {
      const fixturePath = path.resolve(`fixtures/conformance/lilypond/${fixture.file}`);
      const xml = await readFile(fixturePath, 'utf8');
      const parsed = parseMusicXML(xml, {
        sourceName: `fixtures/conformance/lilypond/${fixture.file}`,
        mode: 'lenient'
      });
      expect(parsed.score).toBeDefined();

      const rendered = renderToSVGPages(parsed.score!);
      expect(rendered.pages.length).toBeGreaterThan(0);
      expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

      let textCount = 0;
      let overlapCount = 0;
      for (const pageMarkup of rendered.pages) {
        const svg = extractSvg(pageMarkup);
        const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
        const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 4 });
        textCount += textBounds.length;
        overlapCount += overlaps.length;
      }

      expect(textCount).toBeGreaterThanOrEqual(fixture.minTextCount);
      expect(overlapCount).toBeLessThanOrEqual(fixture.maxOverlaps);
    }
  });

  it('keeps category-31 dynamics glyph runs separated from nearby text labels', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/31a-Directions.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/31a-Directions.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBe(1);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const dynamicsBounds = extractSvgElementBounds(svg, { selector: 'g[class*="dynamics-text"]' });
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const combinedOverlaps = detectSvgOverlaps([...dynamicsBounds, ...textBounds], { minOverlapArea: 4 });
    const dynamicsToTextOverlaps = combinedOverlaps.filter((overlap) => {
      const leftIsDynamics = overlap.left.className?.includes('vf-dynamics-text') ?? false;
      const rightIsDynamics = overlap.right.className?.includes('vf-dynamics-text') ?? false;
      return leftIsDynamics !== rightIsDynamics;
    });

    expect(dynamicsBounds.length).toBeGreaterThanOrEqual(8);
    expect(dynamicsToTextOverlaps.length).toBeLessThanOrEqual(2);
  });

  it('keeps category-32 notation labels bounded and maps non-arpeggiate with an explicit fallback', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/32a-Notations.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/32a-Notations.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();
    const expectedFallbackMarkerCount = countNonArpeggiateMarkers(parsed.score!);
    const expectedBracketAnchorCount = countNonArpeggiateAnchorEvents(parsed.score!);
    expect(expectedFallbackMarkerCount).toBeGreaterThan(0);
    expect(expectedBracketAnchorCount).toBeGreaterThan(0);

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(0);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ARTICULATION')).toBe(false);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_ORNAMENT')).toBe(false);

    const nonArpeggiateFallbackDiagnostics = rendered.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'NON_ARPEGGIATE_FALLBACK_RENDERED'
    );
    expect(nonArpeggiateFallbackDiagnostics).toHaveLength(expectedFallbackMarkerCount);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'NON_ARPEGGIATE_UNSUPPORTED')).toBe(false);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const bracketCount = (svg.match(/vf-non-arpeggiate-bracket/g) ?? []).length;
    expect(bracketCount).toBe(expectedBracketAnchorCount);
    const textBounds = extractSvgElementBounds(svg, { selector: 'text' });
    const overlaps = detectSvgOverlaps(textBounds, { minOverlapArea: 4 });

    expect(textBounds.length).toBeGreaterThan(80);
    expect(overlaps.length).toBeLessThanOrEqual(4);
  });

  it('renders bracket-style non-arpeggiate fallback marks in lilypond-32d-arpeggio', async () => {
    const fixturePath = path.resolve('fixtures/conformance/lilypond/32d-arpeggio.musicxml');
    const xml = await readFile(fixturePath, 'utf8');

    const parsed = parseMusicXML(xml, {
      sourceName: 'fixtures/conformance/lilypond/32d-arpeggio.musicxml',
      mode: 'lenient'
    });
    expect(parsed.score).toBeDefined();
    const expectedFallbackMarkerCount = countNonArpeggiateMarkers(parsed.score!);
    const expectedBracketAnchorCount = countNonArpeggiateAnchorEvents(parsed.score!);
    expect(expectedFallbackMarkerCount).toBeGreaterThan(0);
    expect(expectedBracketAnchorCount).toBeGreaterThan(0);

    const rendered = renderToSVGPages(parsed.score!);
    expect(rendered.pages.length).toBeGreaterThan(0);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(rendered.diagnostics.some((diagnostic) => diagnostic.code === 'NON_ARPEGGIATE_UNSUPPORTED')).toBe(false);
    expect(
      rendered.diagnostics.filter((diagnostic) => diagnostic.code === 'NON_ARPEGGIATE_FALLBACK_RENDERED')
    ).toHaveLength(expectedFallbackMarkerCount);

    const svg = extractSvg(rendered.pages[0] ?? '');
    const bracketCount = (svg.match(/vf-non-arpeggiate-bracket/g) ?? []).length;
    expect(bracketCount).toBe(expectedBracketAnchorCount);
  });

});
