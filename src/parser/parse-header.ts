import type { PartDefinition, Score } from '../core/score.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalFloat, parseOptionalInt, textOf } from './xml-utils.js';

/** Parse `<part-list>` definitions into canonical `PartDefinition` records. */
export function parsePartList(partListNode: XmlNode | undefined, ctx: ParseContext): PartDefinition[] {
  if (!partListNode) {
    addDiagnostic(ctx, 'MISSING_PART_LIST', 'warning', 'score-partwise does not include <part-list>.');
    return [];
  }

  const definitions: PartDefinition[] = [];

  for (const scorePart of childrenOf(partListNode, 'score-part')) {
    const id = attribute(scorePart, 'id');
    if (!id) {
      addDiagnostic(ctx, 'MISSING_PART_ID', 'warning', '<score-part> is missing required id attribute.', scorePart);
      continue;
    }

    const partDef: PartDefinition = {
      id,
      name: textOf(firstChild(scorePart, 'part-name')),
      abbreviation: textOf(firstChild(scorePart, 'part-abbreviation'))
    };

    const midiInstrument = firstChild(scorePart, 'midi-instrument');
    if (midiInstrument) {
      const channel = parseOptionalInt(textOf(firstChild(midiInstrument, 'midi-channel')));
      const program = parseOptionalInt(textOf(firstChild(midiInstrument, 'midi-program')));
      const unpitched = parseOptionalInt(textOf(firstChild(midiInstrument, 'midi-unpitched')));
      if (channel !== undefined || program !== undefined || unpitched !== undefined) {
        partDef.midi = { channel, program, unpitched };
      }
    }

    definitions.push(partDef);
  }

  return definitions;
}

/** Parse `<defaults><scaling>` values when present. */
export function parseDefaults(root: XmlNode): Score['defaults'] {
  const defaultsNode = firstChild(root, 'defaults');
  if (!defaultsNode) {
    return undefined;
  }

  const scalingNode = firstChild(defaultsNode, 'scaling');
  if (!scalingNode) {
    return undefined;
  }

  const millimeters = parseOptionalFloat(textOf(firstChild(scalingNode, 'millimeters')));
  const tenths = parseOptionalFloat(textOf(firstChild(scalingNode, 'tenths')));

  if (millimeters === undefined && tenths === undefined) {
    return undefined;
  }

  return {
    scalingMillimeters: millimeters,
    scalingTenths: tenths
  };
}

/** Parse score-level textual metadata fields. */
export function parseMetadata(root: XmlNode): Score['metadata'] {
  const workTitle = textOf(firstChild(firstChild(root, 'work'), 'work-title'));
  const movementTitle = textOf(firstChild(root, 'movement-title'));

  if (!workTitle && !movementTitle) {
    return undefined;
  }

  return {
    workTitle,
    movementTitle
  };
}
