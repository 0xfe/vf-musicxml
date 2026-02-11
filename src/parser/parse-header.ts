import type { PartDefinition, Score, ScoreDefaults } from '../core/score.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalFloat, parseOptionalInt, textOf } from './xml-utils.js';

/** Active part-group state while iterating `<part-list>` in document order. */
interface ActivePartGroup {
  number: string;
  symbol: string;
}

/** Normalized `<credit-words>` payload used for metadata fallback heuristics. */
interface CreditWordCandidate {
  text: string;
  justify?: string;
  valign?: string;
  fontSize?: number;
  defaultX?: number;
  defaultY?: number;
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
  const millimeters = parseOptionalFloat(textOf(firstChild(scalingNode, 'millimeters')));
  const tenths = parseOptionalFloat(textOf(firstChild(scalingNode, 'tenths')));
  const pageLayoutNode = firstChild(defaultsNode, 'page-layout');
  const pageWidth = parseOptionalFloat(textOf(firstChild(pageLayoutNode, 'page-width')));
  const pageHeight = parseOptionalFloat(textOf(firstChild(pageLayoutNode, 'page-height')));
  const pageMargins = parsePageMargins(pageLayoutNode);
  const systemLayoutNode = firstChild(defaultsNode, 'system-layout');
  const systemMargins = parseSystemMargins(systemLayoutNode);
  const systemDistance = parseOptionalFloat(textOf(firstChild(systemLayoutNode, 'system-distance')));
  const topSystemDistance = parseOptionalFloat(textOf(firstChild(systemLayoutNode, 'top-system-distance')));
  const staffLayoutNode = firstChild(defaultsNode, 'staff-layout');
  const staffDistance = parseOptionalFloat(textOf(firstChild(staffLayoutNode, 'staff-distance')));

  if (
    millimeters === undefined &&
    tenths === undefined &&
    pageWidth === undefined &&
    pageHeight === undefined &&
    pageMargins === undefined &&
    systemMargins === undefined &&
    systemDistance === undefined &&
    topSystemDistance === undefined &&
    staffDistance === undefined
  ) {
    return undefined;
  }

  return {
    scalingMillimeters: millimeters,
    scalingTenths: tenths,
    pageWidth,
    pageHeight,
    pageMargins,
    systemMargins,
    systemDistance,
    topSystemDistance,
    staffDistance
  };
}

/** Parse score-level textual metadata fields. */
export function parseMetadata(root: XmlNode, defaults: ScoreDefaults | undefined): Score['metadata'] {
  const explicitWorkTitle = textOf(firstChild(firstChild(root, 'work'), 'work-title'));
  const explicitMovementTitle = textOf(firstChild(root, 'movement-title'));
  const credits = collectCreditWordCandidates(root);
  const titleCandidate = explicitWorkTitle ? undefined : selectCreditTitleCandidate(credits);
  const workTitle = explicitWorkTitle ?? titleCandidate?.text;
  const movementTitle = explicitMovementTitle;
  const usedTexts = new Set<string>();
  if (workTitle) {
    usedTexts.add(workTitle);
  }
  if (movementTitle) {
    usedTexts.add(movementTitle);
  }

  const headerLeft = selectHeaderCredit(credits, 'left', usedTexts, defaults?.pageWidth);
  if (headerLeft) {
    usedTexts.add(headerLeft);
  }
  const headerRight = selectHeaderCredit(credits, 'right', usedTexts, defaults?.pageWidth);

  if (!workTitle && !movementTitle && !headerLeft && !headerRight) {
    return undefined;
  }

  return {
    workTitle,
    movementTitle,
    headerLeft,
    headerRight
  };
}

/** Read all `<credit-words>` entries into normalized selection candidates. */
function collectCreditWordCandidates(root: XmlNode): CreditWordCandidate[] {
  const candidates: CreditWordCandidate[] = [];

  for (const creditNode of childrenOf(root, 'credit')) {
    for (const creditWordsNode of childrenOf(creditNode, 'credit-words')) {
      const raw = textOf(creditWordsNode);
      const text = normalizeCreditText(raw);
      if (!text) {
        continue;
      }

      candidates.push({
        text,
        justify: attribute(creditWordsNode, 'justify') ?? undefined,
        valign: attribute(creditWordsNode, 'valign') ?? undefined,
        fontSize: parseOptionalFloat(attribute(creditWordsNode, 'font-size')),
        defaultX: parseOptionalFloat(attribute(creditWordsNode, 'default-x')),
        defaultY: parseOptionalFloat(attribute(creditWordsNode, 'default-y'))
      });
    }
  }

  return candidates;
}

/** Select a title fallback candidate when explicit work metadata is absent. */
function selectCreditTitleCandidate(candidates: CreditWordCandidate[]): CreditWordCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  // Prefer centered top credits because they most commonly carry score titles.
  const centered = candidates.filter((candidate) => candidate.justify === 'center');
  const pool = centered.length > 0 ? centered : candidates;
  const ranked = [...pool].sort(compareCreditTitleCandidates);
  return ranked[0];
}

/** Select top-of-page side-header credits (typically arranger/composer/source info). */
function selectHeaderCredit(
  candidates: CreditWordCandidate[],
  justify: 'left' | 'right',
  excludedTexts: Set<string>,
  pageWidth: number | undefined
): string | undefined {
  const scoped = candidates
    .filter((candidate) => classifyHeaderSide(candidate, pageWidth) === justify)
    .filter((candidate) => !excludedTexts.has(candidate.text));
  if (scoped.length === 0) {
    return undefined;
  }

  const maxY = scoped.reduce(
    (currentMax, candidate) =>
      Math.max(currentMax, Number.isFinite(candidate.defaultY) ? (candidate.defaultY ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY
  );
  const topBandCandidates =
    Number.isFinite(maxY) && maxY > Number.NEGATIVE_INFINITY
      ? scoped.filter((candidate) => (candidate.defaultY ?? Number.NEGATIVE_INFINITY) >= maxY - 260)
      : scoped;
  const ranked = [...topBandCandidates].sort(compareHeaderCreditCandidates);
  return ranked[0]?.text;
}

/** Classify one credit candidate as left/right/center using justify and fallback x-position. */
function classifyHeaderSide(
  candidate: CreditWordCandidate,
  pageWidth: number | undefined
): 'left' | 'right' | 'center' | undefined {
  if (candidate.justify === 'left' || candidate.justify === 'right' || candidate.justify === 'center') {
    return candidate.justify;
  }

  if (!Number.isFinite(candidate.defaultX) || !Number.isFinite(pageWidth) || (pageWidth ?? 0) <= 0) {
    return undefined;
  }

  const xRatio = (candidate.defaultX ?? 0) / (pageWidth ?? 1);
  if (xRatio <= 0.38) {
    return 'left';
  }
  if (xRatio >= 0.62) {
    return 'right';
  }

  return 'center';
}

/** Rank credit candidates by typographic prominence and page-top positioning. */
function compareCreditTitleCandidates(left: CreditWordCandidate, right: CreditWordCandidate): number {
  const leftFont = left.fontSize ?? 0;
  const rightFont = right.fontSize ?? 0;
  if (leftFont !== rightFont) {
    return rightFont - leftFont;
  }

  const leftY = left.defaultY ?? 0;
  const rightY = right.defaultY ?? 0;
  if (leftY !== rightY) {
    return rightY - leftY;
  }

  return right.text.length - left.text.length;
}

/** Rank side-header candidates by top positioning and typographic prominence. */
function compareHeaderCreditCandidates(left: CreditWordCandidate, right: CreditWordCandidate): number {
  const leftY = left.defaultY ?? Number.NEGATIVE_INFINITY;
  const rightY = right.defaultY ?? Number.NEGATIVE_INFINITY;
  if (leftY !== rightY) {
    return rightY - leftY;
  }

  const leftFont = left.fontSize ?? 0;
  const rightFont = right.fontSize ?? 0;
  if (leftFont !== rightFont) {
    return rightFont - leftFont;
  }

  return right.text.length - left.text.length;
}

/** Normalize credit text whitespace so metadata output remains deterministic. */
function normalizeCreditText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  // Preserve explicit line breaks from source credits (for example publisher
  // blocks), while still normalizing intra-line whitespace deterministically.
  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  if (normalizedLines.length === 0) {
    return undefined;
  }

  return normalizedLines.join('\n');
}

/** Parse one `<page-margins>` block from defaults page-layout data. */
function parsePageMargins(pageLayoutNode: XmlNode | undefined): ScoreDefaults['pageMargins'] {
  if (!pageLayoutNode) {
    return undefined;
  }

  const marginNodes = childrenOf(pageLayoutNode, 'page-margins');
  if (marginNodes.length === 0) {
    return undefined;
  }

  const preferred =
    marginNodes.find((node) => (attribute(node, 'type') ?? '').toLowerCase() === 'both') ??
    marginNodes[0];
  if (!preferred) {
    return undefined;
  }

  const left = parseOptionalFloat(textOf(firstChild(preferred, 'left-margin')));
  const right = parseOptionalFloat(textOf(firstChild(preferred, 'right-margin')));
  const top = parseOptionalFloat(textOf(firstChild(preferred, 'top-margin')));
  const bottom = parseOptionalFloat(textOf(firstChild(preferred, 'bottom-margin')));
  if (left === undefined && right === undefined && top === undefined && bottom === undefined) {
    return undefined;
  }

  return {
    left,
    right,
    top,
    bottom
  };
}

/** Parse `<system-layout><system-margins>` when present in defaults. */
function parseSystemMargins(systemLayoutNode: XmlNode | undefined): ScoreDefaults['systemMargins'] {
  if (!systemLayoutNode) {
    return undefined;
  }

  const marginsNode = firstChild(systemLayoutNode, 'system-margins');
  if (!marginsNode) {
    return undefined;
  }

  const left = parseOptionalFloat(textOf(firstChild(marginsNode, 'left-margin')));
  const right = parseOptionalFloat(textOf(firstChild(marginsNode, 'right-margin')));
  if (left === undefined && right === undefined) {
    return undefined;
  }

  return {
    left,
    right
  };
}
