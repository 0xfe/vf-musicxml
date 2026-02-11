import { describe, expect, it } from 'vitest';

import {
  parseMusicXML,
  parseMusicXMLAsync,
  renderToSVGPages,
  type Score
} from '../../src/public/index.js';
import { collectNotationGeometry } from '../../src/testkit/notation-geometry.js';
import { extractSvgElementBounds } from '../../src/testkit/svg-collision.js';

const MINIMAL_PARTWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Music</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

const MINIMAL_TIMEWISE = `<?xml version="1.0" encoding="UTF-8"?>
<score-timewise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Music</part-name>
    </score-part>
  </part-list>
  <measure number="1">
    <part id="P1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
      </note>
    </part>
  </measure>
</score-timewise>`;

const MXL_CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml" />
  </rootfiles>
</container>`;

describe('public API parser', () => {
  it('parses a minimal score-partwise document', () => {
    const result = parseMusicXML(MINIMAL_PARTWISE, { sourceName: 'minimal.musicxml' });

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(result.score).toBeDefined();
    expect(result.score?.ticksPerQuarter).toBe(480);
    expect(result.score?.partList[0]?.id).toBe('P1');
    expect(result.score?.parts[0]?.measures[0]?.voices[0]?.events[0]?.kind).toBe('note');
  });

  it('returns a strict-mode failure when divisions are missing', () => {
    const noDivisions = MINIMAL_PARTWISE.replace('<divisions>1</divisions>', '');
    const result = parseMusicXML(noDivisions, { mode: 'strict' });

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'MISSING_DIVISIONS' && d.severity === 'error')).toBe(
      true
    );
  });

  it('normalizes score-timewise input to a partwise-compatible score model', () => {
    const result = parseMusicXML(MINIMAL_TIMEWISE, { sourceName: 'minimal.timewise.musicxml' });

    expect(result.score).toBeDefined();
    expect(result.score?.parts).toHaveLength(1);
    expect(result.score?.parts[0]?.id).toBe('P1');
    expect(result.score?.parts[0]?.measures).toHaveLength(1);
    expect(result.score?.parts[0]?.measures[0]?.voices[0]?.events[0]?.kind).toBe('note');
    expect(result.diagnostics.some((d) => d.code === 'SCORE_TIMEWISE_NORMALIZED')).toBe(true);
  });

  it('rejects unsupported XML root elements', () => {
    const result = parseMusicXML('<not-a-score />');

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'UNSUPPORTED_ROOT')).toBe(true);
  });

  it('surfaces malformed XML parsing diagnostics', () => {
    const result = parseMusicXML('<score-partwise><part></score-partwise>');

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'XML_NOT_WELL_FORMED')).toBe(true);
  });

  it('parses MXL binary input through container.xml rootfile resolution', async () => {
    const mxl = createStoredZip([
      { name: 'META-INF/container.xml', data: MXL_CONTAINER_XML },
      { name: 'score.xml', data: MINIMAL_PARTWISE }
    ]);

    const result = await parseMusicXMLAsync({ data: mxl, format: 'auto' });

    expect(result.score).toBeDefined();
    expect(result.score?.parts).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('falls back to first score XML entry when container.xml is missing', async () => {
    const mxl = createStoredZip([{ name: 'music/score.musicxml', data: MINIMAL_PARTWISE }]);

    const result = await parseMusicXMLAsync({ data: mxl, format: 'mxl' });

    expect(result.score).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_CONTAINER_MISSING')).toBe(true);
  });

  it('treats MXL fallback warnings as errors in strict mode', async () => {
    const mxl = createStoredZip([{ name: 'music/score.musicxml', data: MINIMAL_PARTWISE }]);

    const result = await parseMusicXMLAsync({ data: mxl, format: 'mxl' }, { mode: 'strict' });

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_CONTAINER_MISSING' && d.severity === 'error')).toBe(
      true
    );
  });

  it('reports invalid MXL archives with extraction diagnostics', async () => {
    const result = await parseMusicXMLAsync({
      data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      format: 'mxl'
    });

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_INVALID_ARCHIVE')).toBe(true);
  });

  it('reports missing score payload when container.xml points at a non-existent rootfile', async () => {
    const mxl = createStoredZip([
      {
        name: 'META-INF/container.xml',
        data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="missing-score.xml" media-type="application/vnd.recordare.musicxml+xml" />
  </rootfiles>
</container>`
      },
      { name: 'score.xml', data: MINIMAL_PARTWISE }
    ]);

    const result = await parseMusicXMLAsync({ data: mxl, format: 'mxl' });

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_SCORE_FILE_NOT_FOUND')).toBe(true);
  });

  it('falls back to XML score discovery when container.xml is malformed', async () => {
    const mxl = createStoredZip([
      {
        name: 'META-INF/container.xml',
        data: '<container><rootfiles><rootfile full-path="score.xml"></container>'
      },
      { name: 'score.xml', data: MINIMAL_PARTWISE }
    ]);

    const result = await parseMusicXMLAsync({ data: mxl, format: 'mxl' });

    expect(result.score).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_CONTAINER_INVALID')).toBe(true);
  });

  it('reports score read failures when MXL entry compression method is unsupported', async () => {
    const mxl = createStoredZip([
      { name: 'META-INF/container.xml', data: MXL_CONTAINER_XML },
      {
        name: 'score.xml',
        data: MINIMAL_PARTWISE,
        compressionMethod: 99
      }
    ]);

    const result = await parseMusicXMLAsync({ data: mxl, format: 'mxl' });

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_SCORE_FILE_READ_FAILED')).toBe(true);
  });

  it('reports invalid archive when MXL central directory is truncated', async () => {
    const valid = createStoredZip([{ name: 'score.musicxml', data: MINIMAL_PARTWISE }]);
    const truncated = valid.subarray(0, valid.length - 8);

    const result = await parseMusicXMLAsync({ data: truncated, format: 'mxl' });

    expect(result.score).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === 'MXL_INVALID_ARCHIVE')).toBe(true);
  });

  it('parses XML bytes via async parser path', async () => {
    const encoder = new TextEncoder();
    const result = await parseMusicXMLAsync({
      data: encoder.encode(MINIMAL_PARTWISE),
      format: 'xml'
    });

    expect(result.score).toBeDefined();
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});

interface ZipFixtureEntry {
  name: string;
  data: string | Uint8Array;
  compressionMethod?: number;
}

/** Build a minimal ZIP archive with stored (uncompressed) entries for test fixtures. */
function createStoredZip(entries: ZipFixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localBytes: number[] = [];
  const centralBytes: number[] = [];
  const centralEntries: number[] = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const compressionMethod = entry.compressionMethod ?? 0;
    const localOffset = localBytes.length;

    // Local file header.
    pushU32(localBytes, 0x04034b50);
    pushU16(localBytes, 20); // version needed
    pushU16(localBytes, 0); // flags
    pushU16(localBytes, compressionMethod);
    pushU16(localBytes, 0); // mod time
    pushU16(localBytes, 0); // mod date
    pushU32(localBytes, 0); // crc32 (unused by parser)
    pushU32(localBytes, dataBytes.length); // compressed size
    pushU32(localBytes, dataBytes.length); // uncompressed size
    pushU16(localBytes, nameBytes.length);
    pushU16(localBytes, 0); // extra length
    localBytes.push(...nameBytes);
    localBytes.push(...dataBytes);

    const centralRecord: number[] = [];
    pushU32(centralRecord, 0x02014b50);
    pushU16(centralRecord, 20); // version made by
    pushU16(centralRecord, 20); // version needed
    pushU16(centralRecord, 0); // flags
    pushU16(centralRecord, compressionMethod);
    pushU16(centralRecord, 0); // mod time
    pushU16(centralRecord, 0); // mod date
    pushU32(centralRecord, 0); // crc32
    pushU32(centralRecord, dataBytes.length);
    pushU32(centralRecord, dataBytes.length);
    pushU16(centralRecord, nameBytes.length);
    pushU16(centralRecord, 0); // extra length
    pushU16(centralRecord, 0); // comment length
    pushU16(centralRecord, 0); // disk number start
    pushU16(centralRecord, 0); // internal attributes
    pushU32(centralRecord, 0); // external attributes
    pushU32(centralRecord, localOffset);
    centralRecord.push(...nameBytes);
    centralEntries.push(...centralRecord);
  }

  const centralOffset = localBytes.length;
  centralBytes.push(...centralEntries);
  const centralSize = centralBytes.length;

  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0); // disk number
  pushU16(eocd, 0); // central directory start disk
  pushU16(eocd, entries.length);
  pushU16(eocd, entries.length);
  pushU32(eocd, centralSize);
  pushU32(eocd, centralOffset);
  pushU16(eocd, 0); // comment length

  return new Uint8Array([...localBytes, ...centralBytes, ...eocd]);
}

/** Push a 16-bit little-endian value into an output byte array. */
function pushU16(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

/** Push a 32-bit little-endian value into an output byte array. */
function pushU32(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

describe('public API renderer placeholder', () => {
  it('renders baseline SVG output for a simple score', () => {
    const score: Score = {
      id: 'stub',
      ticksPerQuarter: 480,
      partList: [{ id: 'P1', name: 'Music' }],
      parts: [
        {
          id: 'P1',
          measures: [
            {
              index: 0,
              effectiveAttributes: {
                staves: 1,
                clefs: [{ staff: 1, sign: 'G', line: 2 }],
                timeSignature: { beats: 4, beatType: 4 },
                keySignature: { fifths: 0 },
                divisions: 1
              },
              attributeChanges: [],
              directions: [],
              voices: [
                {
                  id: '1',
                  events: [
                    {
                      kind: 'note',
                      voice: '1',
                      offsetTicks: 0,
                      durationTicks: 480,
                      notes: [{ pitch: { step: 'C', octave: 4 } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score);
    expect(result.pages.length).toBe(1);
    expect(result.pages[0]).toContain('<svg');
    expect(result.pages[0]).toContain('class="mx-page-background"');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('renders multi-part and multi-staff scores without multi-part fallback warnings', () => {
    const score: Score = {
      id: 'multipart-stub',
      ticksPerQuarter: 480,
      partList: [
        { id: 'P1', name: 'Piano' },
        { id: 'P2', name: 'Violin' }
      ],
      parts: [
        {
          id: 'P1',
          measures: [
            {
              index: 0,
              effectiveAttributes: {
                staves: 2,
                clefs: [
                  { staff: 1, sign: 'G', line: 2 },
                  { staff: 2, sign: 'F', line: 4 }
                ],
                timeSignature: { beats: 4, beatType: 4 },
                keySignature: { fifths: 0 },
                divisions: 1
              },
              attributeChanges: [],
              directions: [],
              voices: [
                {
                  id: '1',
                  events: [
                    {
                      kind: 'note',
                      voice: '1',
                      staff: 1,
                      offsetTicks: 0,
                      durationTicks: 480,
                      notes: [{ pitch: { step: 'C', octave: 5 } }]
                    }
                  ]
                },
                {
                  id: '2',
                  events: [
                    {
                      kind: 'note',
                      voice: '2',
                      staff: 2,
                      offsetTicks: 0,
                      durationTicks: 480,
                      notes: [{ pitch: { step: 'C', octave: 3 } }]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          id: 'P2',
          measures: [
            {
              index: 0,
              effectiveAttributes: {
                staves: 1,
                clefs: [{ staff: 1, sign: 'G', line: 2 }],
                timeSignature: { beats: 4, beatType: 4 },
                keySignature: { fifths: 0 },
                divisions: 1
              },
              attributeChanges: [],
              directions: [],
              voices: [
                {
                  id: '1',
                  events: [
                    {
                      kind: 'note',
                      voice: '1',
                      staff: 1,
                      offsetTicks: 0,
                      durationTicks: 480,
                      notes: [{ pitch: { step: 'G', octave: 4 } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score);
    expect(result.pages.length).toBe(1);
    expect(result.pages[0]).toContain('class="mx-page-background"');
    expect(result.pages[0]).toContain('width="3"');
    expect(result.diagnostics.some((d) => d.code === 'MULTI_PART_NOT_SUPPORTED_IN_M2')).toBe(false);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('supports paginated headers, page numbers, and system labels via layout options', () => {
    const measures = Array.from({ length: 4 }, (_, index) => ({
      index,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: 'C' as const, octave: 4 } }]
            }
          ]
        }
      ]
    }));

    const score: Score = {
      id: 'paginated-layout-stub',
      ticksPerQuarter: 480,
      metadata: {
        workTitle: 'Pagination Test'
      },
      partList: [{ id: 'P1', name: 'Music' }],
      parts: [
        {
          id: 'P1',
          measures
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        page: {
          width: 680,
          height: 240
        },
        system: {
          targetMeasuresPerSystem: 1,
          minSystemGap: 24
        },
        labels: {
          showPartNames: true,
          showPartAbbreviations: true,
          repeatOnSystemBreak: true
        },
        headerFooter: {
          showTitle: true,
          showPageNumber: true
        }
      }
    });

    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.pages.every((page) => page.includes('class="mx-page-background"'))).toBe(true);
    expect(result.pages[0]).toContain('Pagination Test');
    expect(result.pages[0]).toContain('Music');
    expect(result.pages[0]).toContain('1 /');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('uses score metadata header fields when explicit header options are omitted', () => {
    const score: Score = {
      id: 'metadata-header-defaults',
      ticksPerQuarter: 480,
      metadata: {
        workTitle: 'Metadata Header Title',
        headerLeft: 'Harmonized by J.S. Bach',
        headerRight: 'jsbchorales.net'
      },
      partList: [{ id: 'P1', name: 'Music' }],
      parts: [
        {
          id: 'P1',
          measures: [
            {
              index: 0,
              effectiveAttributes: {
                staves: 1,
                clefs: [{ staff: 1, sign: 'G', line: 2 }],
                timeSignature: { beats: 4, beatType: 4 },
                keySignature: { fifths: 0 },
                divisions: 1
              },
              attributeChanges: [],
              directions: [],
              voices: [
                {
                  id: '1',
                  events: [
                    {
                      kind: 'note',
                      voice: '1',
                      offsetTicks: 0,
                      durationTicks: 480,
                      notes: [{ pitch: { step: 'C', octave: 4 } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        page: {
          width: 700,
          height: 260
        }
      }
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]).toContain('Harmonized by J.S. Bach');
    expect(result.pages[0]).toContain('jsbchorales.net');
    expect(result.pages[0]).toContain('Metadata Header Title');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('renders multiline header metadata as separate lines', () => {
    const score: Score = {
      id: 'multiline-header-defaults',
      ticksPerQuarter: 480,
      metadata: {
        workTitle: 'Metadata Header Title',
        headerRight: 'Line One\nLine Two'
      },
      partList: [{ id: 'P1', name: 'Music' }],
      parts: [
        {
          id: 'P1',
          measures: [
            {
              index: 0,
              effectiveAttributes: {
                staves: 1,
                clefs: [{ staff: 1, sign: 'G', line: 2 }],
                timeSignature: { beats: 4, beatType: 4 },
                keySignature: { fifths: 0 },
                divisions: 1
              },
              attributeChanges: [],
              directions: [],
              voices: [
                {
                  id: '1',
                  events: [
                    {
                      kind: 'note',
                      voice: '1',
                      offsetTicks: 0,
                      durationTicks: 480,
                      notes: [{ pitch: { step: 'C', octave: 4 } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        page: {
          width: 700,
          height: 320
        }
      }
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]).toContain('Line One');
    expect(result.pages[0]).toContain('Line Two');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('honors MusicXML print new-page directives when planning paginated output', () => {
    const buildMeasure = (index: number, print?: { newPage?: boolean }) => ({
      index,
      print,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: 'C' as const, octave: 4 } }]
            }
          ]
        }
      ]
    });

    const score: Score = {
      id: 'forced-page-break-stub',
      ticksPerQuarter: 480,
      partList: [{ id: 'P1', name: 'Music', abbreviation: 'M' }],
      parts: [
        {
          id: 'P1',
          measures: [buildMeasure(0), buildMeasure(1, { newPage: true }), buildMeasure(2)]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        page: {
          width: 900,
          height: 700
        },
        system: {
          targetMeasuresPerSystem: 3
        },
        labels: {
          showPartNames: true,
          showPartAbbreviations: true,
          repeatOnSystemBreak: true
        }
      }
    });

    expect(result.pages.length).toBe(2);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('uses initial print page-layout dimensions when explicit layout page options are absent', () => {
    const buildMeasure = (index: number, print?: { pageWidth?: number; pageHeight?: number }) => ({
      index,
      print,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: 'C' as const, octave: 4 } }]
            }
          ]
        }
      ]
    });

    const score: Score = {
      id: 'print-page-layout-override-stub',
      ticksPerQuarter: 480,
      partList: [{ id: 'P1', name: 'Music', abbreviation: 'M' }],
      parts: [
        {
          id: 'P1',
          measures: [buildMeasure(0, { pageWidth: 710, pageHeight: 360 }), buildMeasure(1), buildMeasure(2)]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated'
      }
    });

    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages[0]).toContain('width="710"');
    expect(result.pages[0]).toContain('height="360"');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('applies adaptive vertical spacing when source staff-distance is very tight', () => {
    const buildMeasure = (index: number, pitchStep: 'C' | 'D') => ({
      index,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: pitchStep, octave: 5 } }]
            }
          ]
        }
      ]
    });

    const score: Score = {
      id: 'adaptive-spacing-stub',
      ticksPerQuarter: 480,
      defaults: {
        pageWidth: 900,
        pageHeight: 500,
        pageMargins: { left: 60, right: 60, top: 40, bottom: 40 },
        staffDistance: 48
      },
      partList: [
        { id: 'P1', name: 'Upper Voice' },
        { id: 'P2', name: 'Lower Voice' }
      ],
      parts: [
        { id: 'P1', measures: [buildMeasure(0, 'C')] },
        { id: 'P2', measures: [buildMeasure(0, 'D')] }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        scale: 1
      }
    });

    const staves = extractSvgElementBounds(result.pages[0] ?? '', { selector: '.vf-stave' })
      .map((entry) => entry.bounds)
      .sort((left, right) => left.y - right.y);

    expect(staves.length).toBeGreaterThanOrEqual(2);
    const first = staves[0];
    const second = staves[1];
    const interStaffGap = first && second ? second.y - (first.y + first.height) : 0;
    expect(interStaffGap).toBeGreaterThanOrEqual(24);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('keeps long part labels inside page bounds when source system margins are present', () => {
    const buildMeasure = (index: number) => ({
      index,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: 'C' as const, octave: 4 } }]
            }
          ]
        }
      ]
    });

    const score: Score = {
      id: 'label-overflow-stub',
      ticksPerQuarter: 480,
      defaults: {
        pageWidth: 900,
        pageHeight: 420,
        pageMargins: { left: 100, right: 80, top: 40, bottom: 40 },
        systemMargins: { left: 12, right: 8 }
      },
      partList: [
        {
          id: 'P1',
          name: 'Extremely Long Instrument Name That Should Not Be Clipped At The Left Edge',
          abbreviation: 'Ext. Inst.'
        }
      ],
      parts: [{ id: 'P1', measures: [buildMeasure(0), buildMeasure(1)] }],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        labels: {
          showPartNames: true,
          showPartAbbreviations: true,
          repeatOnSystemBreak: true
        },
        scale: 1
      }
    });

    const texts = extractSvgElementBounds(result.pages[0] ?? '', { selector: 'text' });
    const minTextX = Math.min(...texts.map((entry) => entry.bounds.x));

    expect(texts.length).toBeGreaterThan(0);
    expect(minTextX).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('expands inter-part gap for dense adjacent parts to reduce cross-part overlap risk', () => {
    const buildMeasure = (
      index: number,
      step: 'C' | 'D' | 'E',
      noteType: 'quarter' | '16th',
      withBeamMarkers: boolean
    ) => ({
      index,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 120,
              noteType,
              beams: withBeamMarkers ? [{ number: 1 as const, value: 'begin' as const }] : undefined,
              notes: [{ pitch: { step, octave: 5 }, slurs: [{ type: 'start' as const }] }]
            },
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 120,
              durationTicks: 120,
              noteType,
              beams: withBeamMarkers ? [{ number: 1 as const, value: 'end' as const }] : undefined,
              notes: [{ pitch: { step, octave: 5 }, slurs: [{ type: 'stop' as const }] }]
            }
          ]
        }
      ]
    });

    const sparseScore: Score = {
      id: 'inter-part-gap-sparse',
      ticksPerQuarter: 480,
      defaults: {
        pageWidth: 900,
        pageHeight: 520,
        pageMargins: { left: 80, right: 80, top: 40, bottom: 40 }
      },
      partList: [
        { id: 'P1', name: 'Top' },
        { id: 'P2', name: 'Bottom' }
      ],
      parts: [
        { id: 'P1', measures: [buildMeasure(0, 'C', 'quarter', false)] },
        { id: 'P2', measures: [buildMeasure(0, 'D', 'quarter', false)] }
      ],
      spanners: []
    };

    const denseScore: Score = {
      id: 'inter-part-gap-dense',
      ticksPerQuarter: 480,
      defaults: {
        pageWidth: 900,
        pageHeight: 520,
        pageMargins: { left: 80, right: 80, top: 40, bottom: 40 }
      },
      partList: [
        { id: 'P1', name: 'Top Dense' },
        { id: 'P2', name: 'Bottom Dense' }
      ],
      parts: [
        { id: 'P1', measures: [buildMeasure(0, 'E', '16th', true)] },
        { id: 'P2', measures: [buildMeasure(0, 'D', '16th', true)] }
      ],
      spanners: []
    };

    const sparse = renderToSVGPages(sparseScore, { layout: { mode: 'paginated', scale: 1 } });
    const dense = renderToSVGPages(denseScore, { layout: { mode: 'paginated', scale: 1 } });

    const sparseStaves = extractSvgElementBounds(sparse.pages[0] ?? '', { selector: '.vf-stave' })
      .map((entry) => entry.bounds)
      .sort((left, right) => left.y - right.y);
    const denseStaves = extractSvgElementBounds(dense.pages[0] ?? '', { selector: '.vf-stave' })
      .map((entry) => entry.bounds)
      .sort((left, right) => left.y - right.y);

    expect(sparseStaves.length).toBeGreaterThanOrEqual(2);
    expect(denseStaves.length).toBeGreaterThanOrEqual(2);

    const sparseGap =
      sparseStaves[1] && sparseStaves[0] ? sparseStaves[1].y - (sparseStaves[0].y + sparseStaves[0].height) : 0;
    const denseGap =
      denseStaves[1] && denseStaves[0] ? denseStaves[1].y - (denseStaves[0].y + denseStaves[0].height) : 0;

    expect(denseGap).toBeGreaterThan(sparseGap);
    expect(denseGap).toBeGreaterThanOrEqual(24);
    expect(dense.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('respects defaults system margins without shrinking content for label columns', () => {
    const buildMeasure = (index: number) => ({
      index,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: 'C' as const, octave: 4 } }]
            }
          ]
        }
      ]
    });

    const score: Score = {
      id: 'system-margin-layout-stub',
      ticksPerQuarter: 480,
      defaults: {
        pageWidth: 900,
        pageHeight: 420,
        pageMargins: { left: 100, right: 80, top: 40, bottom: 40 },
        systemMargins: { left: 12, right: 8 }
      },
      partList: [{ id: 'P1', name: 'Music', abbreviation: 'M' }],
      parts: [{ id: 'P1', measures: [buildMeasure(0), buildMeasure(1)] }],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        system: {
          targetMeasuresPerSystem: 2
        },
        labels: {
          showPartNames: true,
          showPartAbbreviations: true,
          repeatOnSystemBreak: true,
          labelWidth: 120
        }
      }
    });

    const geometry = collectNotationGeometry(result.pages[0] ?? '');
    const barlineCenters = [...new Set(
      geometry.barlines
        .map((barline) => Math.round((barline.bounds.x + barline.bounds.width / 2) * 100) / 100)
    )].sort((left, right) => left - right);

    expect(barlineCenters.length).toBeGreaterThanOrEqual(2);
    const contentSpan = (barlineCenters[barlineCenters.length - 1] ?? 0) - (barlineCenters[0] ?? 0);
    // 900 - 100 - 80 - 12 - 8 = 700 expected content width.
    expect(contentSpan).toBeGreaterThan(695);
    expect(contentSpan).toBeLessThan(705);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('uses MusicXML measure width hints to weight paginated system columns', () => {
    const xml = `
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" width="120">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2" width="360">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

    const parsed = parseMusicXML(xml);
    expect(parsed.score).toBeDefined();

    const result = renderToSVGPages(parsed.score as Score, {
      layout: {
        mode: 'paginated',
        page: {
          width: 900,
          height: 420
        },
        system: {
          targetMeasuresPerSystem: 2
        }
      }
    });

    const geometry = collectNotationGeometry(result.pages[0] ?? '');
    const barlineCenters = [...new Set(
      geometry.barlines
        .map((barline) => Math.round((barline.bounds.x + barline.bounds.width / 2) * 100) / 100)
    )].sort((left, right) => left - right);

    expect(barlineCenters.length).toBeGreaterThanOrEqual(3);
    const firstMeasureWidth = (barlineCenters[1] ?? 0) - (barlineCenters[0] ?? 0);
    const secondMeasureWidth = (barlineCenters[2] ?? 0) - (barlineCenters[1] ?? 0);
    expect(secondMeasureWidth).toBeGreaterThan(firstMeasureWidth * 1.6);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('honors MusicXML print new-system directives within a page', () => {
    const buildMeasure = (index: number, print?: { newSystem?: boolean }) => ({
      index,
      print,
      effectiveAttributes: {
        staves: 1,
        clefs: [{ staff: 1, sign: 'G' as const, line: 2 }],
        timeSignature: { beats: 4, beatType: 4 },
        keySignature: { fifths: 0 },
        divisions: 1
      },
      attributeChanges: [],
      directions: [],
      voices: [
        {
          id: '1',
          events: [
            {
              kind: 'note' as const,
              voice: '1',
              offsetTicks: 0,
              durationTicks: 480,
              notes: [{ pitch: { step: 'C' as const, octave: 4 } }]
            }
          ]
        }
      ]
    });

    const score: Score = {
      id: 'forced-system-break-stub',
      ticksPerQuarter: 480,
      partList: [{ id: 'P1', name: 'Music', abbreviation: 'M' }],
      parts: [
        {
          id: 'P1',
          measures: [buildMeasure(0), buildMeasure(1, { newSystem: true }), buildMeasure(2)]
        }
      ],
      spanners: []
    };

    const result = renderToSVGPages(score, {
      layout: {
        mode: 'paginated',
        page: {
          width: 900,
          height: 700
        },
        system: {
          targetMeasuresPerSystem: 3
        },
        labels: {
          showPartNames: true,
          showPartAbbreviations: true,
          repeatOnSystemBreak: true
        }
      }
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]).toContain('>Music<');
    expect(result.pages[0]).toContain('>M<');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });
});
