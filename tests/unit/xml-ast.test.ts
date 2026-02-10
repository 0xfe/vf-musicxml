import { describe, expect, it } from 'vitest';

import { parseXmlToAst, XmlParseError } from '../../src/parser/xml-ast.js';

describe('xml AST builder', () => {
  it('builds element paths with sibling indexes', () => {
    const ast = parseXmlToAst('<root><child /><child><inner /></child></root>');

    expect(ast.path).toBe('/root[1]');
    expect(ast.children[0]?.path).toBe('/root[1]/child[1]');
    expect(ast.children[1]?.path).toBe('/root[1]/child[2]');
    expect(ast.children[1]?.children[0]?.path).toBe('/root[1]/child[2]/inner[1]');
  });

  it('throws an XmlParseError for malformed XML', () => {
    expect(() => parseXmlToAst('<root><a></root>')).toThrow(XmlParseError);
  });
});
