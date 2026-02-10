import type { ParseContext } from './parse-context.js';
import { addDiagnostic } from './parse-context.js';
import type { XmlNode } from './xml-ast.js';
import { attribute, childrenOf, firstChild } from './xml-utils.js';

/** Normalize a `score-timewise` root into an equivalent `score-partwise` root. */
export function normalizeTimewiseToPartwise(root: XmlNode, ctx: ParseContext): XmlNode {
  const partListNode = firstChild(root, 'part-list');
  const measureNodes = childrenOf(root, 'measure');
  const orderedPartIds = collectOrderedPartIds(partListNode, measureNodes, ctx);

  const partNodes = orderedPartIds.map((partId, partIndex) =>
    buildPartNode(partId, partIndex, measureNodes, root.location)
  );

  addDiagnostic(
    ctx,
    'SCORE_TIMEWISE_NORMALIZED',
    'info',
    `Normalized score-timewise to score-partwise for ${orderedPartIds.length} part(s).`,
    root
  );

  return {
    ...root,
    name: 'score-partwise',
    text: '',
    path: '/score-partwise[1]',
    children: partListNode ? [partListNode, ...partNodes] : partNodes
  };
}

/** Determine part ordering from `<part-list>` plus any ad-hoc part ids in measures. */
function collectOrderedPartIds(
  partListNode: XmlNode | undefined,
  measureNodes: XmlNode[],
  ctx: ParseContext
): string[] {
  const orderedPartIds: string[] = [];
  const seenPartIds = new Set<string>();

  if (partListNode) {
    for (const scorePart of childrenOf(partListNode, 'score-part')) {
      const id = attribute(scorePart, 'id');
      if (!id) {
        addDiagnostic(ctx, 'MISSING_PART_ID', 'warning', '<score-part> is missing required id attribute.', scorePart);
        continue;
      }
      if (!seenPartIds.has(id)) {
        seenPartIds.add(id);
        orderedPartIds.push(id);
      }
    }
  }

  for (const measureNode of measureNodes) {
    for (const partNode of childrenOf(measureNode, 'part')) {
      const id = attribute(partNode, 'id');
      if (!id) {
        addDiagnostic(
          ctx,
          'MISSING_PART_ID',
          'warning',
          '<score-timewise><measure><part> is missing required id attribute.',
          partNode
        );
        continue;
      }
      if (!seenPartIds.has(id)) {
        seenPartIds.add(id);
        orderedPartIds.push(id);
      }
    }
  }

  return orderedPartIds;
}

/** Build one partwise `<part>` node by collecting this part's measure payloads. */
function buildPartNode(
  partId: string,
  partIndex: number,
  measureNodes: XmlNode[],
  fallbackLocation: XmlNode['location']
): XmlNode {
  const partPath = `/score-partwise[1]/part[${partIndex + 1}]`;
  const partMeasures: XmlNode[] = [];
  let partLocation = fallbackLocation;

  for (let measureIndex = 0; measureIndex < measureNodes.length; measureIndex += 1) {
    const measureNode = measureNodes[measureIndex];
    if (!measureNode) {
      continue;
    }

    const timewisePartNode = childrenOf(measureNode, 'part').find((node) => attribute(node, 'id') === partId);
    const measurePath = `${partPath}/measure[${measureIndex + 1}]`;
    const measureLocation = timewisePartNode?.location ?? measureNode.location;
    partLocation = measureLocation;

    partMeasures.push({
      name: 'measure',
      attributes: { ...measureNode.attributes },
      children: timewisePartNode?.children ?? [],
      text: timewisePartNode?.text ?? '',
      location: measureLocation,
      path: measurePath
    });
  }

  return {
    name: 'part',
    attributes: { id: partId },
    children: partMeasures,
    text: '',
    location: partLocation,
    path: partPath
  };
}
