import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMusicXML, parseMusicXMLAsync, renderToSVGPages } from '../../src/public/index.js';
import {
  collectNotationGeometry,
  detectExtremeCurvePaths,
  detectNoteheadBarlineIntrusions,
  type NotationGeometrySnapshot,
  summarizeMeasureSpacingByBarlines
} from '../../src/testkit/notation-geometry.js';

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

    expect(extremes.length).toBe(0);
  });

});
