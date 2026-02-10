import type { XmlNode } from './xml-ast.js';

/** Return first child matching `name`, if present. */
export function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) {
    return undefined;
  }

  return node.children.find((child) => child.name === name);
}

/** Return all children matching `name`. */
export function childrenOf(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) {
    return [];
  }

  return node.children.filter((child) => child.name === name);
}

/** Return trimmed node text, or `undefined` when empty/missing. */
export function textOf(node: XmlNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  const text = node.text.trim();
  return text.length > 0 ? text : undefined;
}

/** Read attribute `name` from a node, if available. */
export function attribute(node: XmlNode | undefined, name: string): string | undefined {
  return node?.attributes[name];
}

/** Parse base-10 integer values with `undefined` on failure. */
export function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Parse float values with `undefined` on failure. */
export function parseOptionalFloat(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
