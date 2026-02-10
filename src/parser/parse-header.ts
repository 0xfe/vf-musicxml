import type { PartDefinition, Score } from '../core/score.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, firstChild, parseOptionalFloat, parseOptionalInt, textOf } from './xml-utils.js';

/** Active part-group state while iterating `<part-list>` in document order. */
interface ActivePartGroup {
  number: string;
  symbol: string;
}

/** Parse `<part-list>` definitions into canonical `PartDefinition` records. */
export function parsePartList(partListNode: XmlNode | undefined, ctx: ParseContext): PartDefinition[] {
  if (!partListNode) {
    addDiagnostic(ctx, 'MISSING_PART_LIST', 'warning', 'score-partwise does not include <part-list>.');
    return [];
  }

  const definitions: PartDefinition[] = [];
  const activeGroups: ActivePartGroup[] = [];

  for (const child of partListNode.children) {
    if (child.name === 'part-group') {
      const type = attribute(child, 'type');
      const number = attribute(child, 'number') ?? '1';

      if (type === 'start') {
        activeGroups.push({
          number,
          symbol: normalizeGroupSymbol(textOf(firstChild(child, 'group-symbol')))
        });
      } else if (type === 'stop') {
        const groupIndex = findLastGroupByNumber(activeGroups, number);
        if (groupIndex >= 0) {
          activeGroups.splice(groupIndex, 1);
        } else {
          addDiagnostic(
            ctx,
            'PART_GROUP_STOP_WITHOUT_START',
            'warning',
            `Encountered <part-group type="stop"> for group '${number}' without matching start.`,
            child
          );
        }
      }

      continue;
    }

    if (child.name !== 'score-part') {
      continue;
    }

    const id = attribute(child, 'id');
    if (!id) {
      addDiagnostic(ctx, 'MISSING_PART_ID', 'warning', '<score-part> is missing required id attribute.', child);
      continue;
    }

    const partDef: PartDefinition = {
      id,
      name: textOf(firstChild(child, 'part-name')),
      abbreviation: textOf(firstChild(child, 'part-abbreviation'))
    };

    if (activeGroups.length > 0) {
      partDef.groupPath = activeGroups.map((group) => `${group.number}:${group.symbol}`);
    }

    const midiInstrument = firstChild(child, 'midi-instrument');
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

/** Locate the latest active part-group by group number token. */
function findLastGroupByNumber(groups: ActivePartGroup[], number: string): number {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index]?.number === number) {
      return index;
    }
  }

  return -1;
}

/** Normalize MusicXML group-symbol tokens to renderer-facing connector labels. */
function normalizeGroupSymbol(symbol: string | undefined): string {
  if (!symbol) {
    return 'bracket';
  }

  const lowered = symbol.toLowerCase();
  if (lowered === 'brace' || lowered === 'bracket' || lowered === 'line' || lowered === 'none') {
    return lowered;
  }

  return 'bracket';
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
