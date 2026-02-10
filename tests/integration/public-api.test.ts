import { describe, expect, it } from 'vitest';

import {
  parseMusicXML,
  parseMusicXMLAsync,
  renderToSVGPages,
  type Score
} from '../../src/public/index.js';

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
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });
});
