import type {
  ArticulationInfo,
  LyricInfo,
  OrnamentInfo,
  SlurEndpoint,
  TupletEndpoint,
  TupletTimeModification
} from '../core/score.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalInt, textOf } from './xml-utils.js';

/** Parse articulation tokens nested under `<notations><articulations>`. */
export function parseArticulations(noteNode: XmlNode): ArticulationInfo[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const articulations: ArticulationInfo[] = [];
  for (const notationsNode of notationsNodes) {
    for (const articulationsNode of childrenOf(notationsNode, 'articulations')) {
      for (const articulationNode of articulationsNode.children) {
        articulations.push({ type: articulationNode.name });
      }
    }

    // MusicXML allows fermatas as direct `<notations>` children.
    // We normalize fermata variants into articulation-like tokens so the renderer
    // can route them through VexFlow Articulation glyphs.
    for (const fermataNode of childrenOf(notationsNode, 'fermata')) {
      const fermataType = attribute(fermataNode, 'type');
      const fermataShape = textOf(fermataNode);
      if (fermataType === 'inverted') {
        articulations.push({ type: 'fermata-inverted' });
        continue;
      }

      if (fermataShape === 'angled') {
        articulations.push({ type: 'fermata-angled' });
        continue;
      }
      if (fermataShape === 'square') {
        articulations.push({ type: 'fermata-square' });
        continue;
      }

      articulations.push({ type: 'fermata' });
    }

    // Technical markings frequently live under category-32 fixtures and map to
    // articulation-style symbols (up/down bow, snap pizzicato, harmonics, etc.).
    for (const technicalNode of childrenOf(notationsNode, 'technical')) {
      for (const technicalChild of technicalNode.children) {
        const technicalText = textOf(technicalChild);
        if (
          technicalText &&
          (technicalChild.name === 'fingering' ||
            technicalChild.name === 'pluck' ||
            technicalChild.name === 'fret' ||
            technicalChild.name === 'string' ||
            technicalChild.name === 'tap')
        ) {
          articulations.push({ type: `${technicalChild.name}:${technicalText}` });
          continue;
        }
        articulations.push({ type: technicalChild.name });
      }
    }
  }

  return articulations.length > 0 ? articulations : undefined;
}

/** Parse ornament tokens nested under `<notations><ornaments>`. */
export function parseOrnaments(noteNode: XmlNode): OrnamentInfo[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const ornaments: OrnamentInfo[] = [];

  for (const notationsNode of notationsNodes) {
    for (const ornamentsNode of childrenOf(notationsNode, 'ornaments')) {
      for (const ornamentNode of ornamentsNode.children) {
        if (ornamentNode.name === 'wavy-line') {
          const wavyLineType = attribute(ornamentNode, 'type');
          ornaments.push({
            type: wavyLineType ? `wavy-line-${wavyLineType}` : 'wavy-line'
          });
          continue;
        }
        if (ornamentNode.name === 'accidental-mark') {
          const accidentalText = textOf(ornamentNode);
          ornaments.push({
            type: accidentalText ? `accidental-mark:${accidentalText}` : 'accidental-mark'
          });
          continue;
        }
        if (ornamentNode.name === 'tremolo') {
          const tremoloMarks = textOf(ornamentNode);
          ornaments.push({
            type: tremoloMarks ? `tremolo:${tremoloMarks}` : 'tremolo'
          });
          continue;
        }
        ornaments.push({ type: ornamentNode.name });
      }
    }

    // Arpeggiation markings are siblings of `<ornaments>` under `<notations>`.
    // We keep them in the ornament token channel so the renderer can attach
    // stroke/vibrato modifiers without widening core score types.
    for (const arpeggiateNode of childrenOf(notationsNode, 'arpeggiate')) {
      const direction = attribute(arpeggiateNode, 'direction');
      if (direction === 'up') {
        ornaments.push({ type: 'arpeggiate-up' });
        continue;
      }
      if (direction === 'down') {
        ornaments.push({ type: 'arpeggiate-down' });
        continue;
      }
      ornaments.push({ type: 'arpeggiate' });
    }

    for (const nonArpeggiateNode of childrenOf(notationsNode, 'non-arpeggiate')) {
      const type = attribute(nonArpeggiateNode, 'type');
      ornaments.push({
        type: type ? `non-arpeggiate-${type}` : 'non-arpeggiate'
      });
    }
  }

  return ornaments.length > 0 ? ornaments : undefined;
}

/** Parse slur endpoints nested under `<notations><slur>`. */
export function parseSlurs(noteNode: XmlNode): SlurEndpoint[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const slurs: SlurEndpoint[] = [];
  for (const notationsNode of notationsNodes) {
    for (const slurNode of childrenOf(notationsNode, 'slur')) {
      const type = attribute(slurNode, 'type');
      if (type !== 'start' && type !== 'stop') {
        continue;
      }

      const slur: SlurEndpoint = {
        type
      };

      const number = attribute(slurNode, 'number');
      if (number) {
        slur.number = number;
      }

      const placement = attribute(slurNode, 'placement');
      if (placement) {
        slur.placement = placement;
      }

      const lineType = attribute(slurNode, 'line-type');
      if (lineType) {
        slur.lineType = lineType;
      }

      slurs.push(slur);
    }
  }

  return slurs.length > 0 ? slurs : undefined;
}

/** Parse lyric payloads nested under `<note><lyric>`. */
export function parseLyrics(noteNode: XmlNode): LyricInfo[] | undefined {
  const lyrics: LyricInfo[] = [];
  for (const lyricNode of childrenOf(noteNode, 'lyric')) {
    const lyric: LyricInfo = {
      number: attribute(lyricNode, 'number') ?? undefined,
      syllabic: textOf(firstChild(lyricNode, 'syllabic')) ?? undefined,
      text: textOf(firstChild(lyricNode, 'text')) ?? undefined,
      extend: !!firstChild(lyricNode, 'extend')
    };

    if (!lyric.text && !lyric.extend) {
      continue;
    }

    lyrics.push(lyric);
  }

  return lyrics.length > 0 ? lyrics : undefined;
}

/** Parse tuplet endpoint records from `<notations><tuplet ...>`. */
export function parseTuplets(noteNode: XmlNode): TupletEndpoint[] | undefined {
  const notationsNodes = childrenOf(noteNode, 'notations');
  if (notationsNodes.length === 0) {
    return undefined;
  }

  const tuplets: TupletEndpoint[] = [];
  for (const notationsNode of notationsNodes) {
    for (const tupletNode of childrenOf(notationsNode, 'tuplet')) {
      const type = attribute(tupletNode, 'type');
      if (type !== 'start' && type !== 'stop') {
        continue;
      }

      tuplets.push({
        type,
        number: attribute(tupletNode, 'number') ?? undefined,
        bracket: parseYesNo(attribute(tupletNode, 'bracket')),
        showNumber: attribute(tupletNode, 'show-number') ?? undefined,
        placement: attribute(tupletNode, 'placement') ?? undefined
      });
    }
  }

  return tuplets.length > 0 ? tuplets : undefined;
}

/** Parse tuplet ratio metadata from `<time-modification>`. */
export function parseTimeModification(noteNode: XmlNode): TupletTimeModification | undefined {
  const modificationNode = firstChild(noteNode, 'time-modification');
  if (!modificationNode) {
    return undefined;
  }

  const actualNotes = parseOptionalInt(textOf(firstChild(modificationNode, 'actual-notes')));
  const normalNotes = parseOptionalInt(textOf(firstChild(modificationNode, 'normal-notes')));
  if (!actualNotes || !normalNotes) {
    return undefined;
  }

  return {
    actualNotes,
    normalNotes,
    actualType: textOf(firstChild(modificationNode, 'actual-type')) ?? undefined,
    normalType: textOf(firstChild(modificationNode, 'normal-type')) ?? undefined
  };
}

/** Parse MusicXML yes/no attributes into boolean values. */
function parseYesNo(value: string | undefined): boolean | undefined {
  if (value === 'yes') {
    return true;
  }
  if (value === 'no') {
    return false;
  }
  return undefined;
}
