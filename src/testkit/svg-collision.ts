import { JSDOM } from 'jsdom';

/** Axis-aligned bounds in SVG coordinate space. */
export interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parsed element bounds with metadata useful for audit reports. */
export interface SvgElementBounds {
  index: number;
  tagName: string;
  className?: string;
  id?: string;
  bounds: SvgBounds;
}

/** Pairwise overlap report between two bounded elements. */
export interface SvgOverlap {
  left: SvgElementBounds;
  right: SvgElementBounds;
  intersection: SvgBounds;
  area: number;
}

/** Options for converting SVG markup into auditable element bounds. */
export interface ExtractSvgBoundsOptions {
  selector: string;
}

/** Options for overlap detection thresholds and tolerance. */
export interface DetectSvgOverlapsOptions {
  padding?: number;
  minOverlapArea?: number;
}

/** Supported SVG path command letters used by our lightweight parser. */
const PATH_COMMAND_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

/** Extract approximate axis-aligned bounds for all elements that match `selector`. */
export function extractSvgElementBounds(
  svgMarkup: string,
  options: ExtractSvgBoundsOptions
): SvgElementBounds[] {
  const dom = new JSDOM(svgMarkup, { contentType: 'image/svg+xml' });
  const document = dom.window.document;
  const elements = [...document.querySelectorAll(options.selector)];

  const results: SvgElementBounds[] = [];

  elements.forEach((element, index) => {
    const bounds = computeElementBounds(element);
    if (!bounds) {
      return;
    }

    results.push({
      index,
      tagName: element.tagName.toLowerCase(),
      className: element.getAttribute('class') ?? undefined,
      id: element.getAttribute('id') ?? undefined,
      bounds
    });
  });

  dom.window.close();
  return results;
}

/** Detect pairwise overlaps between element bounds using optional padding/area thresholds. */
export function detectSvgOverlaps(
  elements: SvgElementBounds[],
  options: DetectSvgOverlapsOptions = {}
): SvgOverlap[] {
  const padding = options.padding ?? 0;
  const minOverlapArea = options.minOverlapArea ?? 0;
  const overlaps: SvgOverlap[] = [];

  for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
    const left = elements[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
      const right = elements[rightIndex];
      if (!right) {
        continue;
      }

      const intersection = intersectBounds(left.bounds, right.bounds, padding);
      if (!intersection) {
        continue;
      }

      const area = intersection.width * intersection.height;
      if (area <= minOverlapArea) {
        continue;
      }

      overlaps.push({
        left,
        right,
        intersection,
        area
      });
    }
  }

  return overlaps;
}

/** Compute best-effort bounds for one SVG element. */
function computeElementBounds(element: Element): SvgBounds | undefined {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'rect':
      return boundsFromRect(element);
    case 'line':
      return boundsFromLine(element);
    case 'circle':
      return boundsFromCircle(element);
    case 'ellipse':
      return boundsFromEllipse(element);
    case 'polygon':
    case 'polyline':
      return boundsFromPoints(element.getAttribute('points'));
    case 'path':
      return boundsFromPathData(element.getAttribute('d'));
    case 'g':
    case 'svg':
      return boundsFromChildren(element);
    default:
      return undefined;
  }
}

/** Compute group bounds by unioning child element bounds recursively. */
function boundsFromChildren(element: Element): SvgBounds | undefined {
  let aggregate: SvgBounds | undefined;
  for (const child of [...element.children]) {
    const childBounds = computeElementBounds(child);
    if (!childBounds) {
      continue;
    }
    aggregate = aggregate ? unionBounds(aggregate, childBounds) : childBounds;
  }

  return aggregate;
}

/** Compute bounds for `<rect>`. */
function boundsFromRect(element: Element): SvgBounds | undefined {
  const x = readNumber(element.getAttribute('x')) ?? 0;
  const y = readNumber(element.getAttribute('y')) ?? 0;
  const width = readNumber(element.getAttribute('width'));
  const height = readNumber(element.getAttribute('height'));
  if (width === undefined || height === undefined) {
    return undefined;
  }

  return { x, y, width, height };
}

/** Compute bounds for `<line>`. */
function boundsFromLine(element: Element): SvgBounds | undefined {
  const x1 = readNumber(element.getAttribute('x1'));
  const y1 = readNumber(element.getAttribute('y1'));
  const x2 = readNumber(element.getAttribute('x2'));
  const y2 = readNumber(element.getAttribute('y2'));
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

/** Compute bounds for `<circle>`. */
function boundsFromCircle(element: Element): SvgBounds | undefined {
  const cx = readNumber(element.getAttribute('cx'));
  const cy = readNumber(element.getAttribute('cy'));
  const r = readNumber(element.getAttribute('r'));
  if (cx === undefined || cy === undefined || r === undefined) {
    return undefined;
  }

  return {
    x: cx - r,
    y: cy - r,
    width: r * 2,
    height: r * 2
  };
}

/** Compute bounds for `<ellipse>`. */
function boundsFromEllipse(element: Element): SvgBounds | undefined {
  const cx = readNumber(element.getAttribute('cx'));
  const cy = readNumber(element.getAttribute('cy'));
  const rx = readNumber(element.getAttribute('rx'));
  const ry = readNumber(element.getAttribute('ry'));
  if (cx === undefined || cy === undefined || rx === undefined || ry === undefined) {
    return undefined;
  }

  return {
    x: cx - rx,
    y: cy - ry,
    width: rx * 2,
    height: ry * 2
  };
}

/** Compute bounds from a polygon/polyline `points` attribute. */
function boundsFromPoints(points: string | null): SvgBounds | undefined {
  if (!points) {
    return undefined;
  }

  const values = tokenizeNumbers(points);
  if (values.length < 2) {
    return undefined;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x === undefined || y === undefined) {
      continue;
    }

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return undefined;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

/**
 * Compute best-effort bounds from SVG path data.
 * This approximates curve bounds by including control and endpoint coordinates.
 */
function boundsFromPathData(pathData: string | null): SvgBounds | undefined {
  if (!pathData) {
    return undefined;
  }

  const tokens = pathData.match(PATH_COMMAND_PATTERN);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }

  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let index = 0;
  let command = '';

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  const readValue = (): number | undefined => {
    const token = tokens[index];
    if (!token || isCommandToken(token)) {
      return undefined;
    }
    index += 1;
    return Number.parseFloat(token);
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      break;
    }

    if (isCommandToken(token)) {
      command = token;
      index += 1;
    } else if (!command) {
      // Malformed data with no leading command.
      break;
    }

    switch (command) {
      case 'M':
      case 'm': {
        const relative = command === 'm';
        const x = readValue();
        const y = readValue();
        if (x === undefined || y === undefined) {
          break;
        }
        cursorX = relative ? cursorX + x : x;
        cursorY = relative ? cursorY + y : y;
        startX = cursorX;
        startY = cursorY;
        includePoint(cursorX, cursorY);

        while (true) {
          const lx = readValue();
          const ly = readValue();
          if (lx === undefined || ly === undefined) {
            break;
          }
          cursorX = relative ? cursorX + lx : lx;
          cursorY = relative ? cursorY + ly : ly;
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'L':
      case 'l': {
        const relative = command === 'l';
        while (true) {
          const x = readValue();
          const y = readValue();
          if (x === undefined || y === undefined) {
            break;
          }
          cursorX = relative ? cursorX + x : x;
          cursorY = relative ? cursorY + y : y;
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'H':
      case 'h': {
        const relative = command === 'h';
        while (true) {
          const x = readValue();
          if (x === undefined) {
            break;
          }
          cursorX = relative ? cursorX + x : x;
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'V':
      case 'v': {
        const relative = command === 'v';
        while (true) {
          const y = readValue();
          if (y === undefined) {
            break;
          }
          cursorY = relative ? cursorY + y : y;
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'C':
      case 'c': {
        const relative = command === 'c';
        while (true) {
          const x1 = readValue();
          const y1 = readValue();
          const x2 = readValue();
          const y2 = readValue();
          const x = readValue();
          const y = readValue();
          if (
            x1 === undefined ||
            y1 === undefined ||
            x2 === undefined ||
            y2 === undefined ||
            x === undefined ||
            y === undefined
          ) {
            break;
          }

          const c1x = relative ? cursorX + x1 : x1;
          const c1y = relative ? cursorY + y1 : y1;
          const c2x = relative ? cursorX + x2 : x2;
          const c2y = relative ? cursorY + y2 : y2;
          cursorX = relative ? cursorX + x : x;
          cursorY = relative ? cursorY + y : y;
          includePoint(c1x, c1y);
          includePoint(c2x, c2y);
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'S':
      case 's': {
        const relative = command === 's';
        while (true) {
          const x2 = readValue();
          const y2 = readValue();
          const x = readValue();
          const y = readValue();
          if (x2 === undefined || y2 === undefined || x === undefined || y === undefined) {
            break;
          }

          const c2x = relative ? cursorX + x2 : x2;
          const c2y = relative ? cursorY + y2 : y2;
          cursorX = relative ? cursorX + x : x;
          cursorY = relative ? cursorY + y : y;
          includePoint(c2x, c2y);
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'Q':
      case 'q': {
        const relative = command === 'q';
        while (true) {
          const x1 = readValue();
          const y1 = readValue();
          const x = readValue();
          const y = readValue();
          if (x1 === undefined || y1 === undefined || x === undefined || y === undefined) {
            break;
          }

          const c1x = relative ? cursorX + x1 : x1;
          const c1y = relative ? cursorY + y1 : y1;
          cursorX = relative ? cursorX + x : x;
          cursorY = relative ? cursorY + y : y;
          includePoint(c1x, c1y);
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'T':
      case 't': {
        const relative = command === 't';
        while (true) {
          const x = readValue();
          const y = readValue();
          if (x === undefined || y === undefined) {
            break;
          }
          cursorX = relative ? cursorX + x : x;
          cursorY = relative ? cursorY + y : y;
          includePoint(cursorX, cursorY);
        }
        break;
      }
      case 'A':
      case 'a': {
        const relative = command === 'a';
        while (true) {
          const rx = readValue();
          const ry = readValue();
          const rotation = readValue();
          const largeArc = readValue();
          const sweep = readValue();
          const x = readValue();
          const y = readValue();
          if (
            rx === undefined ||
            ry === undefined ||
            rotation === undefined ||
            largeArc === undefined ||
            sweep === undefined ||
            x === undefined ||
            y === undefined
          ) {
            break;
          }

          const endpointX = relative ? cursorX + x : x;
          const endpointY = relative ? cursorY + y : y;
          // We approximate arc bounds by endpoint plus radii envelope.
          includePoint(endpointX, endpointY);
          includePoint(endpointX - Math.abs(rx), endpointY - Math.abs(ry));
          includePoint(endpointX + Math.abs(rx), endpointY + Math.abs(ry));
          cursorX = endpointX;
          cursorY = endpointY;
        }
        break;
      }
      case 'Z':
      case 'z': {
        cursorX = startX;
        cursorY = startY;
        includePoint(cursorX, cursorY);
        break;
      }
      default:
        break;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return undefined;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

/** Return axis-aligned intersection with optional expansion padding. */
function intersectBounds(left: SvgBounds, right: SvgBounds, padding: number): SvgBounds | undefined {
  const leftX = left.x - padding;
  const leftY = left.y - padding;
  const leftRight = left.x + left.width + padding;
  const leftBottom = left.y + left.height + padding;

  const rightX = right.x - padding;
  const rightY = right.y - padding;
  const rightRight = right.x + right.width + padding;
  const rightBottom = right.y + right.height + padding;

  const x1 = Math.max(leftX, rightX);
  const y1 = Math.max(leftY, rightY);
  const x2 = Math.min(leftRight, rightRight);
  const y2 = Math.min(leftBottom, rightBottom);

  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1
  };
}

/** Create a bounding-box union for two rectangles. */
function unionBounds(left: SvgBounds, right: SvgBounds): SvgBounds {
  const x1 = Math.min(left.x, right.x);
  const y1 = Math.min(left.y, right.y);
  const x2 = Math.max(left.x + left.width, right.x + right.width);
  const y2 = Math.max(left.y + left.height, right.y + right.height);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1
  };
}

/** Parse one numeric attribute, returning undefined on invalid values. */
function readNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Convert any numeric text sequence into an array of parsed floats. */
function tokenizeNumbers(input: string): number[] {
  const tokens = input.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) {
    return [];
  }
  return tokens
    .map((token) => Number.parseFloat(token))
    .filter((value) => Number.isFinite(value));
}

/** Return true when token is an SVG path command letter. */
function isCommandToken(token: string): boolean {
  return /^[AaCcHhLlMmQqSsTtVvZz]$/.test(token);
}
