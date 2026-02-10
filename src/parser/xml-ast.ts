import { SaxesParser, type SaxesAttribute, type SaxesTag } from 'saxes';

/** Line and column origin for diagnostics and traceability. */
export interface XmlLocation {
  line: number;
  column: number;
}

/** Minimal immutable XML node shape consumed by parser transforms. */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
  location: XmlLocation;
  path: string;
}

/** Parse failure wrapper that keeps source coordinates when available. */
export class XmlParseError extends Error {
  readonly source?: XmlLocation;

  constructor(message: string, source?: XmlLocation) {
    super(message);
    this.name = 'XmlParseError';
    this.source = source;
  }
}

/** Mutable node used while SAX callbacks are still building the tree. */
interface MutableXmlNode {
  name: string;
  attributes: Record<string, string>;
  children: MutableXmlNode[];
  text: string;
  location: XmlLocation;
  path: string;
  childNameCount: Map<string, number>;
}

/** Snapshot of parser coordinates captured at open-tag start. */
interface OpenTagLocation {
  line: number;
  column: number;
}

/**
 * Parse XML into a lightweight AST with location and stable XPath-like paths.
 * This keeps diagnostics precise while avoiding a full DOM dependency.
 */
export function parseXmlToAst(xmlText: string, sourceName?: string): XmlNode {
  const parser = new SaxesParser({
    xmlns: true,
    position: true,
    fileName: sourceName
  });

  let root: MutableXmlNode | undefined;
  const stack: MutableXmlNode[] = [];
  const openTagLocations: OpenTagLocation[] = [];
  let parseError: XmlParseError | undefined;

  parser.on('error', (error) => {
    if (!parseError) {
      parseError = new XmlParseError(error.message, {
        line: parser.line,
        column: parser.column + 1
      });
    }
  });

  parser.on('opentagstart', () => {
    openTagLocations.push({
      line: parser.line,
      column: parser.column + 1
    });
  });

  parser.on('opentag', (tag) => {
    const start = openTagLocations.pop() ?? { line: parser.line, column: parser.column + 1 };
    const parent = stack.at(-1);
    const name = getNodeName(tag);

    const path = buildPath(parent, name);
    const node: MutableXmlNode = {
      name,
      attributes: toAttributeMap(tag),
      children: [],
      text: '',
      location: start,
      path,
      childNameCount: new Map<string, number>()
    };

    if (parent) {
      parent.children.push(node);
    } else {
      root = node;
    }

    stack.push(node);
  });

  parser.on('text', (text) => {
    const current = stack.at(-1);
    if (current) {
      current.text += text;
    }
  });

  parser.on('cdata', (text) => {
    const current = stack.at(-1);
    if (current) {
      current.text += text;
    }
  });

  parser.on('closetag', () => {
    stack.pop();
  });

  parser.write(xmlText).close();

  if (parseError) {
    throw parseError;
  }

  if (!root) {
    throw new XmlParseError('No XML root element found');
  }

  return freezeNode(root);
}

/** Prefer namespace-local names so downstream logic can stay prefix-agnostic. */
function getNodeName(tag: SaxesTag): string {
  if (tag.local && tag.local.length > 0) {
    return tag.local;
  }

  const name = tag.name;
  const index = name.indexOf(':');
  return index === -1 ? name : name.slice(index + 1);
}

/**
 * Normalize SAX attribute payload into string values.
 * We keep multiple aliases to support both fully qualified and local lookups.
 */
function toAttributeMap(tag: SaxesTag): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(tag.attributes)) {
    if (typeof value === 'string') {
      out[key] = value;
      continue;
    }

    setAttributeAlias(out, value, key);
  }

  return out;
}

/** Store all commonly-used keys for a single SAX attribute token. */
function setAttributeAlias(out: Record<string, string>, attribute: SaxesAttribute, key: string): void {
  out[key] = attribute.value;

  if ('local' in attribute) {
    out[attribute.local] = attribute.value;
    if (attribute.prefix) {
      out[`${attribute.prefix}:${attribute.local}`] = attribute.value;
    }
    out[attribute.name] = attribute.value;
  }
}

/** Build deterministic node paths with sibling indexes (for diagnostics). */
function buildPath(parent: MutableXmlNode | undefined, name: string): string {
  if (!parent) {
    return `/${name}[1]`;
  }

  const next = (parent.childNameCount.get(name) ?? 0) + 1;
  parent.childNameCount.set(name, next);
  return `${parent.path}/${name}[${next}]`;
}

/** Freeze mutable builder nodes into immutable AST nodes. */
function freezeNode(node: MutableXmlNode): XmlNode {
  return {
    name: node.name,
    attributes: node.attributes,
    children: node.children.map(freezeNode),
    text: node.text,
    location: node.location,
    path: node.path
  };
}
