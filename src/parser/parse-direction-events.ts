import type { DirectionEvent } from '../core/score.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild, textOf } from './xml-utils.js';

/** Parse a direction node into words/tempo metadata anchored at an offset. */
export function parseDirection(directionNode: XmlNode, offsetTicks: number): DirectionEvent {
  const directionTypeNodes = childrenOf(directionNode, 'direction-type');
  const words = parseDirectionWords(directionTypeNodes);
  const soundNode = firstChild(directionNode, 'sound');
  const tempoRaw = soundNode ? attribute(soundNode, 'tempo') : undefined;
  const tempo = tempoRaw ? Number(tempoRaw) : undefined;
  const dynamics = parseDirectionDynamics(directionTypeNodes);
  const wedge = parseDirectionWedge(directionTypeNodes);

  const direction: DirectionEvent = {
    offsetTicks,
    words,
    tempo: Number.isFinite(tempo) ? tempo : undefined
  };

  if (dynamics.length > 0) {
    direction.dynamics = dynamics;
  }
  if (wedge) {
    direction.wedge = wedge;
  }

  return direction;
}

/** Parse `<direction-type><dynamics>` tokens into ordered dynamic markers. */
function parseDirectionDynamics(directionTypeNodes: XmlNode[]): string[] {
  const dynamics: string[] = [];
  for (const directionTypeNode of directionTypeNodes) {
    for (const dynamicsNode of childrenOf(directionTypeNode, 'dynamics')) {
      for (const dynamicNode of dynamicsNode.children) {
        if (dynamicNode.name === 'other-dynamics') {
          const value = textOf(dynamicNode);
          if (value) {
            dynamics.push(value);
          }
          continue;
        }
        dynamics.push(dynamicNode.name);
      }
    }
  }

  return dynamics;
}

/** Parse `<direction-type><wedge>` attributes into a normalized wedge event token. */
function parseDirectionWedge(directionTypeNodes: XmlNode[]): DirectionEvent['wedge'] {
  for (const directionTypeNode of directionTypeNodes) {
    const wedgeNode = firstChild(directionTypeNode, 'wedge');
    if (!wedgeNode) {
      continue;
    }

    const type = attribute(wedgeNode, 'type');
    if (type !== 'crescendo' && type !== 'diminuendo' && type !== 'stop') {
      continue;
    }

    const spreadText = attribute(wedgeNode, 'spread');
    const spread = spreadText ? Number.parseFloat(spreadText) : undefined;

    return {
      type,
      number: attribute(wedgeNode, 'number') ?? undefined,
      spread: Number.isFinite(spread) ? spread : undefined
    };
  }

  return undefined;
}

/**
 * Parse all displayable direction words from one `<direction>` node.
 * This flattens compound direction-type entries into one string so renderers
 * can preserve authored ordering without widening score-core types.
 */
function parseDirectionWords(directionTypeNodes: XmlNode[]): string | undefined {
  const chunks: string[] = [];
  for (const directionTypeNode of directionTypeNodes) {
    const word = textOf(firstChild(directionTypeNode, 'words'));
    if (word) {
      chunks.push(word);
    }

    const metronomeNode = firstChild(directionTypeNode, 'metronome');
    if (metronomeNode) {
      const metronomeText = formatMetronomeDirection(metronomeNode);
      if (metronomeText) {
        chunks.push(metronomeText);
      }
    }

    if (firstChild(directionTypeNode, 'segno')) {
      chunks.push('segno');
    }
    if (firstChild(directionTypeNode, 'coda')) {
      chunks.push('coda');
    }
    if (firstChild(directionTypeNode, 'damp')) {
      chunks.push('damp');
    }
    if (firstChild(directionTypeNode, 'damp-all')) {
      chunks.push('damp all');
    }
    if (firstChild(directionTypeNode, 'eyeglasses')) {
      chunks.push('eyeglasses');
    }

    const stringMuteNode = firstChild(directionTypeNode, 'string-mute');
    if (stringMuteNode) {
      const muteType = attribute(stringMuteNode, 'type');
      if (muteType === 'on') {
        chunks.push('con sord.');
      } else if (muteType === 'off') {
        chunks.push('senza sord.');
      } else {
        chunks.push('string mute');
      }
    }

    if (firstChild(directionTypeNode, 'pedal')) {
      chunks.push('ped.');
    }
    if (firstChild(directionTypeNode, 'octave-shift')) {
      chunks.push('8va');
    }
  }

  return chunks.length > 0 ? chunks.join(' ') : undefined;
}

/** Convert one metronome direction node into compact readable words. */
function formatMetronomeDirection(metronomeNode: XmlNode): string | undefined {
  const beatUnit = textOf(firstChild(metronomeNode, 'beat-unit'));
  const beatUnitDotCount = childrenOf(metronomeNode, 'beat-unit-dot').length;
  const perMinute = textOf(firstChild(metronomeNode, 'per-minute'));
  const relation = textOf(firstChild(metronomeNode, 'metronome-relation'));

  if (beatUnit && perMinute) {
    const dotted = beatUnitDotCount > 0 ? '.'.repeat(beatUnitDotCount) : '';
    return `${beatUnit}${dotted}=${perMinute}`;
  }
  if (beatUnit && relation) {
    return `${beatUnit} ${relation}`;
  }
  if (perMinute) {
    return `q=${perMinute}`;
  }

  return undefined;
}
