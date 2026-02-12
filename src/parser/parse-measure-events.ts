import type {
  BarlineEndingInfo,
  BarlineInfo,
  BarlineRepeatInfo,
  ClefInfo,
  EffectiveAttributes,
  HarmonyEvent,
  TimeSignatureSymbol
} from '../core/score.js';
import { TICKS_PER_QUARTER } from './parse-constants.js';
import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, parseOptionalInt, textOf } from './xml-utils.js';

/** Label describing where a duration is being interpreted. */
export type DurationContextLabel = 'note' | 'backup' | 'forward';

/** Result payload when converting MusicXML duration units to ticks. */
export interface DurationTicksResult {
  ticks: number;
  warnedMissingDivisions: boolean;
}

/** Parse barline metadata while preserving only supported location tokens. */
export function parseBarline(barlineNode: XmlNode): BarlineInfo {
  const location = attribute(barlineNode, 'location');
  const style = textOf(firstChild(barlineNode, 'bar-style'));
  const resolvedLocation = location === 'left' || location === 'right' || location === 'middle' ? location : 'right';
  const repeatDirection = attribute(firstChild(barlineNode, 'repeat'), 'direction');
  const endingNode = firstChild(barlineNode, 'ending');

  const parsed: BarlineInfo = {
    location: resolvedLocation,
    style
  };

  if (repeatDirection === 'forward' || repeatDirection === 'backward') {
    const repeats: BarlineRepeatInfo[] = [
      {
        location: resolvedLocation,
        direction: repeatDirection
      }
    ];
    parsed.repeats = repeats;
  }

  if (endingNode) {
    const endingType = attribute(endingNode, 'type');
    if (
      endingType === 'start' ||
      endingType === 'stop' ||
      endingType === 'discontinue' ||
      endingType === 'continue'
    ) {
      const endings: BarlineEndingInfo[] = [
        {
          location: resolvedLocation,
          type: endingType,
          number: attribute(endingNode, 'number') ?? undefined,
          text: textOf(endingNode) ?? undefined
        }
      ];
      parsed.endings = endings;
    }
  }

  return parsed;
}

/** Parse one `<harmony>` node into an anchored harmony token. */
export function parseHarmony(harmonyNode: XmlNode, offsetTicks: number): HarmonyEvent {
  const rootNode = firstChild(harmonyNode, 'root');
  const rootStep = textOf(firstChild(rootNode, 'root-step')) ?? undefined;
  const rootAlterText = textOf(firstChild(rootNode, 'root-alter'));
  const rootAlter = rootAlterText ? Number.parseFloat(rootAlterText) : undefined;
  const kindNode = firstChild(harmonyNode, 'kind');
  const kind = textOf(kindNode) ?? undefined;
  const staff = parseOptionalInt(textOf(firstChild(harmonyNode, 'staff')));

  return {
    offsetTicks,
    rootStep,
    rootAlter: Number.isFinite(rootAlter) ? rootAlter : undefined,
    kind,
    text: kindNode ? attribute(kindNode, 'text') ?? undefined : undefined,
    staff
  };
}

/** Parse an `<attributes>` block into an incremental update record. */
export function parseAttributeUpdate(node: XmlNode, ctx: ParseContext): Partial<EffectiveAttributes> {
  const update: Partial<EffectiveAttributes> = {};

  const divisionsText = textOf(firstChild(node, 'divisions'));
  if (divisionsText !== undefined) {
    const divisions = parseOptionalInt(divisionsText);
    if (divisions && divisions > 0) {
      update.divisions = divisions;
    } else {
      addDiagnostic(
        ctx,
        'DIVISIONS_INVALID',
        'warning',
        `Invalid divisions value '${divisionsText}', expected positive integer.`,
        firstChild(node, 'divisions')
      );
    }
  }

  const stavesText = textOf(firstChild(node, 'staves'));
  if (stavesText !== undefined) {
    const staves = parseOptionalInt(stavesText);
    if (staves && staves > 0) {
      update.staves = staves;
    } else {
      addDiagnostic(ctx, 'STAVES_INVALID', 'warning', `Invalid staves value '${stavesText}'.`, firstChild(node, 'staves'));
    }
  }

  const keyNode = firstChild(node, 'key');
  if (keyNode) {
    const fifthsText = textOf(firstChild(keyNode, 'fifths'));
    if (fifthsText !== undefined) {
      const fifths = parseOptionalInt(fifthsText);
      if (fifths !== undefined) {
        update.keySignature = {
          fifths,
          mode: textOf(firstChild(keyNode, 'mode'))
        };
      }
    }
  }

  const timeNode = firstChild(node, 'time');
  if (timeNode) {
    const beats = parseOptionalInt(textOf(firstChild(timeNode, 'beats')));
    const beatType = parseOptionalInt(textOf(firstChild(timeNode, 'beat-type')));
    const symbol = normalizeTimeSignatureSymbol(attribute(timeNode, 'symbol'));
    if (beats && beatType) {
      update.timeSignature = { beats, beatType, symbol };
    } else {
      addDiagnostic(
        ctx,
        'TIME_SIGNATURE_INVALID',
        'warning',
        'Invalid <time> signature; expected integer beats and beat-type.',
        timeNode
      );
    }
  }

  const clefNodes = childrenOf(node, 'clef');
  if (clefNodes.length > 0) {
    const clefs: ClefInfo[] = [];
    for (let clefIndex = 0; clefIndex < clefNodes.length; clefIndex += 1) {
      const clefNode = clefNodes[clefIndex];
      if (!clefNode) {
        continue;
      }
      const sign = textOf(firstChild(clefNode, 'sign'));
      if (!sign) {
        continue;
      }

      // MusicXML encodes clef staff assignment as `<clef number="N">`.
      // Some real-world scores serialize clefs out of staff order; using the
      // attribute (instead of a non-existent `<number>` child) preserves the
      // authored staff mapping and avoids clef/register swaps.
      // When `number` is omitted and multiple clefs are present, we map by
      // source order (`1..N`) to avoid collapsing all clefs onto staff 1.
      const fallbackStaff = clefNodes.length > 1 ? clefIndex + 1 : 1;
      const staff = parseOptionalInt(attribute(clefNode, 'number')) ?? fallbackStaff;
      const line = parseOptionalInt(textOf(firstChild(clefNode, 'line')));
      clefs.push({
        staff,
        sign,
        line
      });
    }

    if (clefs.length > 0) {
      update.clefs = clefs;
    }
  }

  return update;
}

/** Normalize MusicXML `<time symbol>` tokens into score-model enum values. */
function normalizeTimeSignatureSymbol(value: string | undefined): TimeSignatureSymbol | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'normal' ||
    normalized === 'common' ||
    normalized === 'cut' ||
    normalized === 'single-number' ||
    normalized === 'note'
  ) {
    return normalized;
  }

  return undefined;
}

/** Convert MusicXML duration units into canonical ticks with lenient fallbacks. */
export function parseDurationTicks(
  node: XmlNode,
  effectiveAttributes: EffectiveAttributes,
  warnedMissingDivisions: boolean,
  ctx: ParseContext,
  contextLabel: DurationContextLabel
): DurationTicksResult {
  const durationNode = firstChild(node, 'duration');
  if (!durationNode) {
    return {
      ticks: 0,
      warnedMissingDivisions
    };
  }

  const durationText = textOf(durationNode);
  const duration = parseOptionalInt(durationText);
  if (duration === undefined || duration < 0) {
    addDiagnostic(
      ctx,
      'DURATION_INVALID',
      'warning',
      `Invalid ${contextLabel} duration '${durationText ?? ''}'.`,
      durationNode
    );
    return {
      ticks: 0,
      warnedMissingDivisions
    };
  }

  let divisions = effectiveAttributes.divisions;
  let warned = warnedMissingDivisions;

  if (!divisions || divisions <= 0) {
    divisions = 1;
    if (!warnedMissingDivisions) {
      addDiagnostic(
        ctx,
        'MISSING_DIVISIONS',
        'warning',
        'Missing <divisions>; defaulting to 1 in lenient timing conversion.',
        node
      );
      warned = true;
    }
  }

  const ticks = Math.round((duration / divisions) * TICKS_PER_QUARTER);
  return {
    ticks,
    warnedMissingDivisions: warned
  };
}
