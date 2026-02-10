/**
 * Temporarily installs DOM globals expected by VexFlow while rendering.
 * This keeps Node/JSDOM and browser paths aligned.
 */
export function ensureDomGlobals(ownerDocument: Document): () => void {
  const g = globalThis as Record<string, unknown>;
  const previousDocument = g.document;
  const previousWindow = g.window;
  const previousHTMLElement = g.HTMLElement;
  const previousSVGElement = g.SVGElement;
  const previousNode = g.Node;

  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) {
    return () => {
      // No-op when owner window is missing.
    };
  }

  g.document = ownerDocument;
  g.window = ownerWindow;
  g.HTMLElement = ownerWindow.HTMLElement;
  g.SVGElement = ownerWindow.SVGElement;
  g.Node = ownerWindow.Node;

  return () => {
    restoreGlobal(g, 'document', previousDocument);
    restoreGlobal(g, 'window', previousWindow);
    restoreGlobal(g, 'HTMLElement', previousHTMLElement);
    restoreGlobal(g, 'SVGElement', previousSVGElement);
    restoreGlobal(g, 'Node', previousNode);
  };
}

/** Restore one global binding to its previous state. */
function restoreGlobal(target: Record<string, unknown>, key: string, previous: unknown): void {
  if (previous === undefined) {
    delete target[key];
    return;
  }

  target[key] = previous;
}
