/* global process */

import { JSDOM } from 'jsdom';

/**
 * Standalone page-quality probe used by integration tests.
 *
 * The probe runs in a separate Node process so long-form page sweeps can
 * evaluate one rendered SVG at a time without accumulating JSDOM objects in
 * the parent test process.
 */

const PATH_COMMAND_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

function extractSvg(pageMarkup) {
  const start = pageMarkup.indexOf('<svg');
  const end = pageMarkup.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) {
    return '';
  }
  return pageMarkup.slice(start, end + '</svg>'.length);
}

function analyzePageQuality(pageMarkup) {
  const svgMarkup = extractSvg(pageMarkup);
  if (!svgMarkup) {
    return {
      hasSvg: false,
      weakestSpacingRatio: null,
      evaluatedBandRatios: [],
      compressedBandCount: 0,
      extremeCurveCount: 0
    };
  }

  const dom = new JSDOM(svgMarkup, { contentType: 'image/svg+xml' });
  const document = dom.window.document;
  const geometry = collectNotationGeometry(document);
  const spacingSummary = summarizeMeasureSpacingByBarlines(geometry);
  const evaluatedBandRatios = spacingSummary.bandSummaries
    .map((band) => band.firstToMedianOtherEstimatedWidthRatio ?? band.firstToMedianOtherGapRatio)
    .filter((ratio) => ratio !== null);

  const extremes = detectExtremeCurvePaths(document, {
    minVerticalDelta: 100,
    minHorizontalSpan: 70,
    minSlopeRatio: 0.5
  });
  dom.window.close();

  return {
    hasSvg: true,
    weakestSpacingRatio:
      evaluatedBandRatios.length > 0 ? Math.min(...evaluatedBandRatios) : null,
    evaluatedBandRatios,
    compressedBandCount: evaluatedBandRatios.filter((ratio) => ratio < 0.75).length,
    extremeCurveCount: extremes.length
  };
}

function collectNotationGeometry(document) {
  return {
    noteheads: extractSvgElementBounds(document, { selector: '.vf-notehead' }),
    barlines: extractSvgElementBounds(document, { selector: '.vf-stavebarline' })
  };
}

function detectExtremeCurvePaths(document, options = {}) {
  const minVerticalDelta = options.minVerticalDelta ?? 80;
  const minHorizontalSpan = options.minHorizontalSpan ?? 60;
  const minSlopeRatio = options.minSlopeRatio ?? 0.5;
  const extremes = [];
  const candidates = [...document.querySelectorAll('path[d]')];

  for (let pathIndex = 0; pathIndex < candidates.length; pathIndex += 1) {
    const candidate = candidates[pathIndex];
    if (!candidate) {
      continue;
    }

    const stroke = candidate.getAttribute('stroke');
    const fill = candidate.getAttribute('fill');
    if (stroke === null && fill !== 'none') {
      continue;
    }
    if (stroke === 'none' && fill !== 'none') {
      continue;
    }

    const d = candidate.getAttribute('d');
    if (!d || (!d.includes('C') && !d.includes('c'))) {
      continue;
    }

    const anchors = parseFirstCubicCurveAnchors(d);
    if (!anchors) {
      continue;
    }

    const deltaX = Math.abs(anchors.endX - anchors.startX);
    const deltaY = Math.abs(anchors.endY - anchors.startY);
    if (deltaY < minVerticalDelta || deltaX < minHorizontalSpan) {
      continue;
    }

    const slopeRatio = deltaY / Math.max(1, deltaX);
    if (slopeRatio < minSlopeRatio) {
      continue;
    }

    extremes.push({
      pathIndex,
      startX: anchors.startX,
      startY: anchors.startY,
      endX: anchors.endX,
      endY: anchors.endY,
      deltaX,
      deltaY
    });
  }

  return extremes;
}

function parseFirstCubicCurveAnchors(d) {
  const tokens = d.match(/[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }

  let command = '';
  let index = 0;
  let currentX = 0;
  let currentY = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      break;
    }

    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index += 1;
      continue;
    }

    if (command === 'M' || command === 'L') {
      const x = Number(tokens[index]);
      const y = Number(tokens[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return undefined;
      }
      currentX = x;
      currentY = y;
      index += 2;
      if (command === 'M') {
        command = 'L';
      }
      continue;
    }

    if (command === 'm' || command === 'l') {
      const dx = Number(tokens[index]);
      const dy = Number(tokens[index + 1]);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return undefined;
      }
      currentX += dx;
      currentY += dy;
      index += 2;
      if (command === 'm') {
        command = 'l';
      }
      continue;
    }

    if (command === 'C' || command === 'c') {
      const x3 = Number(tokens[index + 4]);
      const y3 = Number(tokens[index + 5]);
      if (!Number.isFinite(x3) || !Number.isFinite(y3)) {
        return undefined;
      }

      const startX = currentX;
      const startY = currentY;
      const endX = command === 'c' ? currentX + x3 : x3;
      const endY = command === 'c' ? currentY + y3 : y3;
      if (![startX, startY, endX, endY].every(Number.isFinite)) {
        return undefined;
      }

      return { startX, startY, endX, endY };
    }

    index += 1;
  }

  return undefined;
}

function summarizeMeasureSpacingByBarlines(geometry, options = {}) {
  const barlineMergeTolerance = options.barlineMergeTolerance ?? 1.5;
  const noteheadMergeTolerance = options.noteheadMergeTolerance ?? 0.75;
  const bandMergeTolerance = options.bandMergeTolerance ?? 18;
  const noteheadBandMargin = options.noteheadBandMargin ?? 12;
  const minNotesPerMeasureForGap = options.minNotesPerMeasureForGap ?? 2;
  const barlineBands = clusterElementsByVerticalCenter(geometry.barlines, bandMergeTolerance);

  const bandSummaries = [];
  if (barlineBands.length === 0) {
    return { bandSummaries };
  }

  for (let bandIndex = 0; bandIndex < barlineBands.length; bandIndex += 1) {
    const bandBarlines = barlineBands[bandIndex];
    if (!bandBarlines || bandBarlines.length === 0) {
      continue;
    }

    const barlineCenters = collapseCenters(
      bandBarlines.map((barline) => barline.bounds.x + barline.bounds.width / 2),
      barlineMergeTolerance
    );
    if (barlineCenters.length < 2) {
      continue;
    }

    const bandTop = Math.min(...bandBarlines.map((barline) => barline.bounds.y));
    const bandBottom = Math.max(
      ...bandBarlines.map((barline) => barline.bounds.y + barline.bounds.height)
    );
    const bandNoteCenters = collapseCenters(
      geometry.noteheads
        .filter((notehead) => {
          const centerY = notehead.bounds.y + notehead.bounds.height / 2;
          return centerY >= bandTop - noteheadBandMargin && centerY <= bandBottom + noteheadBandMargin;
        })
        .map((notehead) => notehead.bounds.x + notehead.bounds.width / 2),
      noteheadMergeTolerance
    );

    const bandSamples = buildMeasureSpacingSamples(barlineCenters, bandNoteCenters);
    const firstMeasureSample = bandSamples.find(
      (sample) => sample.noteheadCount >= minNotesPerMeasureForGap
    );
    const firstMeasureAverageGap = firstMeasureSample?.averageGap ?? null;
    const firstMeasureNoteheadCount = firstMeasureSample?.noteheadCount ?? null;
    const laterSamples = bandSamples
      .slice(1)
      .filter((sample) => sample.noteheadCount >= minNotesPerMeasureForGap);
    const medianOtherMeasuresAverageGap = median(
      laterSamples
        .map((sample) => sample.averageGap)
        .filter((value) => value !== null)
        .sort((left, right) => left - right)
    );
    const medianOtherMeasuresNoteheadCount = median(
      laterSamples
        .map((sample) => sample.noteheadCount)
        .sort((left, right) => left - right)
    );
    const firstToMedianOtherGapRatio =
      firstMeasureAverageGap !== null &&
      medianOtherMeasuresAverageGap !== null &&
      medianOtherMeasuresAverageGap > 0
        ? Number((firstMeasureAverageGap / medianOtherMeasuresAverageGap).toFixed(4))
        : null;
    const firstToMedianOtherEstimatedWidthRatio =
      firstToMedianOtherGapRatio !== null &&
      firstMeasureNoteheadCount !== null &&
      medianOtherMeasuresNoteheadCount !== null &&
      firstMeasureNoteheadCount > 1 &&
      medianOtherMeasuresNoteheadCount > 1
        ? Number(
            (
              firstToMedianOtherGapRatio *
              (firstMeasureNoteheadCount >= medianOtherMeasuresNoteheadCount
                ? (firstMeasureNoteheadCount - 1) / (medianOtherMeasuresNoteheadCount - 1)
                : 1)
            ).toFixed(4)
          )
        : null;

    bandSummaries.push({
      bandIndex,
      barlineCount: barlineCenters.length,
      noteheadCount: bandNoteCenters.length,
      firstMeasureNoteheadCount,
      medianOtherMeasuresNoteheadCount,
      firstMeasureAverageGap,
      medianOtherMeasuresAverageGap,
      firstToMedianOtherGapRatio,
      firstToMedianOtherEstimatedWidthRatio
    });
  }

  return { bandSummaries };
}

function buildMeasureSpacingSamples(barlineCenters, noteCenters) {
  const samples = [];

  for (let index = 0; index + 1 < barlineCenters.length; index += 1) {
    const leftBoundary = barlineCenters[index];
    const rightBoundary = barlineCenters[index + 1];
    if (leftBoundary === undefined || rightBoundary === undefined) {
      continue;
    }

    const centersInMeasure = noteCenters.filter(
      (center) => center >= leftBoundary && center < rightBoundary
    );
    const gaps = buildAdjacentGaps(centersInMeasure);

    samples.push({
      measureIndex: index,
      noteheadCount: centersInMeasure.length,
      averageGap: gaps.length > 0 ? average(gaps) : null,
      minimumGap: gaps.length > 0 ? Math.min(...gaps) : null,
      maximumGap: gaps.length > 0 ? Math.max(...gaps) : null
    });
  }

  return samples;
}

function clusterElementsByVerticalCenter(elements, tolerance) {
  if (elements.length === 0) {
    return [];
  }

  const sorted = [...elements].sort((left, right) => {
    const leftCenter = left.bounds.y + left.bounds.height / 2;
    const rightCenter = right.bounds.y + right.bounds.height / 2;
    return leftCenter - rightCenter;
  });
  const groups = [];
  const groupCenters = [];

  for (const element of sorted) {
    const center = element.bounds.y + element.bounds.height / 2;
    const lastGroupCenter = groupCenters[groupCenters.length - 1];
    if (lastGroupCenter === undefined || Math.abs(center - lastGroupCenter) > tolerance) {
      groups.push([element]);
      groupCenters.push(center);
      continue;
    }

    const group = groups[groups.length - 1];
    if (!group) {
      continue;
    }

    group.push(element);
    groupCenters[groupCenters.length - 1] =
      (lastGroupCenter * (group.length - 1) + center) / group.length;
  }

  return groups;
}

function collapseCenters(values, tolerance) {
  if (values.length === 0) {
    return [];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const collapsed = [];

  for (const value of sorted) {
    const previous = collapsed[collapsed.length - 1];
    if (previous === undefined || Math.abs(value - previous) > tolerance) {
      collapsed.push(value);
    }
  }

  return collapsed;
}

function buildAdjacentGaps(values) {
  const gaps = [];

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    gaps.push(current - previous);
  }

  return gaps;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  return Number((sum / values.length).toFixed(4));
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const middleIndex = Math.floor(values.length / 2);
  const middle = values[middleIndex];
  if (middle === undefined) {
    return null;
  }

  if (values.length % 2 === 1) {
    return Number(middle.toFixed(4));
  }

  const previous = values[middleIndex - 1];
  if (previous === undefined) {
    return Number(middle.toFixed(4));
  }

  return Number(((previous + middle) / 2).toFixed(4));
}

function extractSvgElementBounds(document, options) {
  const elements = [...document.querySelectorAll(options.selector)];

  const results = [];

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
  return results;
}

function computeElementBounds(element) {
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

function boundsFromChildren(element) {
  let aggregate;
  for (const child of [...element.children]) {
    const childBounds = computeElementBounds(child);
    if (!childBounds) {
      continue;
    }
    aggregate = aggregate ? unionBounds(aggregate, childBounds) : childBounds;
  }

  return aggregate;
}

function boundsFromRect(element) {
  const x = readNumber(element.getAttribute('x')) ?? 0;
  const y = readNumber(element.getAttribute('y')) ?? 0;
  const width = readNumber(element.getAttribute('width'));
  const height = readNumber(element.getAttribute('height'));
  if (width === undefined || height === undefined) {
    return undefined;
  }

  return { x, y, width, height };
}

function boundsFromLine(element) {
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

function boundsFromCircle(element) {
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

function boundsFromEllipse(element) {
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

function boundsFromPoints(points) {
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

function boundsFromPathData(pathData) {
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

  const includePoint = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  const readValue = () => {
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

function unionBounds(left, right) {
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

function readNumber(value) {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function tokenizeNumbers(input) {
  const tokens = input.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) {
    return [];
  }
  return tokens
    .map((token) => Number.parseFloat(token))
    .filter((value) => Number.isFinite(value));
}

function isCommandToken(token) {
  return /^[AaCcHhLlMmQqSsTtVvZz]$/.test(token);
}

async function main() {
  const payloadText = await readStdin();
  const payload = JSON.parse(payloadText);
  if (!payload || typeof payload.pageMarkup !== 'string') {
    throw new Error('Expected JSON payload with string field: pageMarkup');
  }

  const result = analyzePageQuality(payload.pageMarkup);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
