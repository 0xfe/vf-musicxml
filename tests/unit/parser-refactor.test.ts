import { describe, expect, it } from 'vitest';

import type { EffectiveAttributes } from '../../src/core/score.js';
import { createParseContext } from '../../src/parser/parse-context.js';
import {
  parseAttributeUpdate,
  parseDirection,
  parseDurationTicks,
  parseNoteData
} from '../../src/parser/parse-note.js';
import { parseXmlToAst } from '../../src/parser/xml-ast.js';

describe('parser module refactor wiring', () => {
  it('parses note data with notations and lyrics through extracted helpers', () => {
    const noteNode = parseXmlToAst(`
      <note>
        <pitch><step>C</step><alter>1</alter><octave>4</octave></pitch>
        <accidental parentheses="yes">sharp</accidental>
        <notations>
          <articulations><staccato/></articulations>
          <technical><fingering>2</fingering></technical>
          <ornaments><trill-mark/></ornaments>
          <slur type="start" number="1" placement="above"/>
        </notations>
        <lyric number="1"><text>la</text></lyric>
      </note>
    `);
    const ctx = createParseContext('lenient');

    const parsed = parseNoteData(noteNode, ctx);

    expect(parsed.pitch?.step).toBe('C');
    expect(parsed.pitch?.alter).toBe(1);
    expect(parsed.accidental?.value).toBe('sharp');
    expect(parsed.accidental?.parentheses).toBe(true);
    expect(parsed.articulations?.some((entry) => entry.type === 'staccato')).toBe(true);
    expect(parsed.articulations?.some((entry) => entry.type === 'fingering:2')).toBe(true);
    expect(parsed.ornaments?.some((entry) => entry.type === 'trill-mark')).toBe(true);
    expect(parsed.slurs?.[0]?.type).toBe('start');
    expect(parsed.lyrics?.[0]?.text).toBe('la');
    expect(ctx.diagnostics).toHaveLength(0);
  });

  it('parses direction, attribute updates, and duration ticks via re-exported helpers', () => {
    const directionNode = parseXmlToAst(`
      <direction>
        <direction-type>
          <words>Allegro</words>
          <metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome>
          <wedge type="crescendo" number="1" spread="12"/>
        </direction-type>
      </direction>
    `);
    const parsedDirection = parseDirection(directionNode, 480);
    expect(parsedDirection.offsetTicks).toBe(480);
    expect(parsedDirection.words).toContain('Allegro');
    expect(parsedDirection.words).toContain('quarter=120');
    expect(parsedDirection.wedge?.type).toBe('crescendo');

    const attributesNode = parseXmlToAst(`
      <attributes>
        <divisions>8</divisions>
        <staves>2</staves>
        <time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
    `);
    const ctx = createParseContext('lenient');
    const update = parseAttributeUpdate(attributesNode, ctx);
    expect(update.divisions).toBe(8);
    expect(update.staves).toBe(2);
    expect(update.timeSignature?.symbol).toBe('common');
    expect(update.clefs?.length).toBe(2);

    const durationNode = parseXmlToAst('<note><duration>6</duration></note>');
    const effective: EffectiveAttributes = {
      staves: 1,
      clefs: [{ staff: 1, sign: 'G', line: 2 }],
      divisions: 3
    };
    const duration = parseDurationTicks(durationNode, effective, false, ctx, 'note');
    expect(duration.ticks).toBe(960);
    expect(duration.warnedMissingDivisions).toBe(false);
    expect(ctx.diagnostics).toHaveLength(0);
  });
});
