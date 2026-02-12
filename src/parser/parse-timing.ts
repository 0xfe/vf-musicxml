import type { EffectiveAttributes, TimeSignatureInfo, TimedEvent, VoiceTimeline } from '../core/score.js';

/** Apply incremental attribute updates to the current effective state. */
export function applyAttributeUpdate(
  effectiveAttributes: EffectiveAttributes,
  update: Partial<EffectiveAttributes>
): void {
  if (update.divisions !== undefined) {
    effectiveAttributes.divisions = update.divisions;
  }
  if (update.staves !== undefined) {
    effectiveAttributes.staves = update.staves;
  }
  if (update.keySignature !== undefined) {
    effectiveAttributes.keySignature = update.keySignature;
  }
  if (update.timeSignature !== undefined) {
    effectiveAttributes.timeSignature = update.timeSignature;
  }
  if (update.clefs !== undefined) {
    // MusicXML can update only one staff clef inside `<attributes>` (for example
    // changing staff 2 while staff 1 remains unchanged). Replacing the full clef
    // array with a partial update causes staff-clef leakage and wrong-register
    // rendering. Merge updates by staff index so unchanged staves persist.
    effectiveAttributes.clefs = mergeClefUpdates(effectiveAttributes.clefs, update.clefs);
  }
}

/**
 * Merge clef updates by `staff`, preserving existing assignments for staves that
 * are not mentioned in the current `<attributes>` payload.
 */
function mergeClefUpdates(
  existingClefs: EffectiveAttributes['clefs'],
  incomingClefs: EffectiveAttributes['clefs']
): EffectiveAttributes['clefs'] {
  const clefByStaff = new Map<number, EffectiveAttributes['clefs'][number]>();

  for (const clef of existingClefs) {
    clefByStaff.set(clef.staff, { ...clef });
  }

  for (const clef of incomingClefs) {
    clefByStaff.set(clef.staff, { ...clef });
  }

  return [...clefByStaff.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, clef]) => clef);
}

/** Fast check for whether a parsed attribute update has any fields set. */
export function hasAttributeUpdate(update: Partial<EffectiveAttributes>): boolean {
  return (
    update.divisions !== undefined ||
    update.staves !== undefined ||
    update.keySignature !== undefined ||
    update.timeSignature !== undefined ||
    update.clefs !== undefined
  );
}

/** Compute expected measure length in ticks from the active time signature. */
export function expectedMeasureDuration(
  timeSignature: TimeSignatureInfo | undefined,
  ticksPerQuarter: number
): number {
  if (!timeSignature || timeSignature.beatType <= 0) {
    return 0;
  }

  return Math.round((timeSignature.beats * 4 * ticksPerQuarter) / timeSignature.beatType);
}

/** Compute the maximum event end tick across all voices in a measure. */
export function maxVoiceEnd(voices: VoiceTimeline[]): number {
  let max = 0;
  for (const voice of voices) {
    for (const event of voice.events) {
      max = Math.max(max, event.offsetTicks + event.durationTicks);
    }
  }
  return max;
}

/** Truncate events so they do not exceed the measure boundary in lenient mode. */
export function truncateEventsToMeasure(events: TimedEvent[], maxTicks: number): TimedEvent[] {
  const truncated: TimedEvent[] = [];

  for (const event of events) {
    if (event.offsetTicks >= maxTicks) {
      continue;
    }

    const eventEnd = event.offsetTicks + event.durationTicks;
    if (eventEnd <= maxTicks) {
      truncated.push(event);
      continue;
    }

    truncated.push({
      ...event,
      durationTicks: Math.max(0, maxTicks - event.offsetTicks)
    });
  }

  return truncated;
}

/** Default measure attributes used before the first `<attributes>` block appears. */
export function defaultAttributes(): EffectiveAttributes {
  return {
    staves: 1,
    clefs: [{ staff: 1, sign: 'G', line: 2 }],
    divisions: undefined,
    keySignature: undefined,
    timeSignature: undefined
  };
}

/** Clone effective attributes for safe inheritance between measure parses. */
export function cloneAttributes(attributes: EffectiveAttributes): EffectiveAttributes {
  return {
    staves: attributes.staves,
    clefs: attributes.clefs.map((clef) => ({ ...clef })),
    keySignature: attributes.keySignature ? { ...attributes.keySignature } : undefined,
    timeSignature: attributes.timeSignature ? { ...attributes.timeSignature } : undefined,
    divisions: attributes.divisions
  };
}
