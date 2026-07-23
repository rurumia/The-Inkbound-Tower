(function createContinuousGeometry(global) {
  "use strict";

  function circle(center, radius) {
    if (!(radius >= 0)) throw new RangeError("Circle radius must be non-negative.");
    return Object.freeze({kind: "circle", center: GameWorldSpace.point(center.x, center.y), radius: GameWorldSpace.quantize(radius)});
  }

  function rect(center, width, height) {
    if (!(width >= 0 && height >= 0)) throw new RangeError("Rectangle dimensions must be non-negative.");
    return Object.freeze({kind: "rect", center: GameWorldSpace.point(center.x, center.y), width: GameWorldSpace.quantize(width), height: GameWorldSpace.quantize(height)});
  }

  function pathStroke(points, radius) {
    if (!Array.isArray(points) || !points.length) throw new TypeError("Path stroke requires at least one point.");
    return Object.freeze({kind: "pathStroke", points: points.map(point => GameWorldSpace.point(point.x, point.y)), radius: GameWorldSpace.quantize(radius)});
  }

  function brushStamp(center, style, length, width, angle = 0) {
    if (!(length >= 0 && width >= 0)) throw new RangeError("Brush stamp dimensions must be non-negative.");
    return Object.freeze({
      kind: "brushStamp",
      center: GameWorldSpace.point(center.x, center.y),
      style: style || "round",
      length: GameWorldSpace.quantize(length),
      width: GameWorldSpace.quantize(width),
      angle: Math.round((Number(angle) || 0) * 1e6) / 1e6
    });
  }

  function brushStroke(outline, definition = {}) {
    if (!Array.isArray(outline) || outline.length < 3) throw new TypeError("Brush stroke requires an outline polygon.");
    return Object.freeze({
      kind: "brushStroke",
      outline: Object.freeze(outline.map(point => GameWorldSpace.point(point.x, point.y))),
      style: definition.style || "round",
      length: GameWorldSpace.quantize(Math.max(0, definition.length || 0)),
      width: GameWorldSpace.quantize(Math.max(0, definition.width || 0)),
      angle: Math.round((Number(definition.angle) || 0) * 1e6) / 1e6
    });
  }

  function rasterMask(definition) {
    const width = Math.max(1, Math.floor(definition.width));
    const height = Math.max(1, Math.floor(definition.height));
    const minColumn = Math.max(0, Math.floor(definition.minColumn));
    const maxColumn = Math.min(width - 1, Math.floor(definition.maxColumn));
    const minRow = Math.max(0, Math.floor(definition.minRow));
    const maxRow = Math.min(height - 1, Math.floor(definition.maxRow));
    if (maxColumn < minColumn || maxRow < minRow) throw new RangeError("Raster mask bounds must contain samples.");
    const rows = Array.from({length: maxRow - minRow + 1}, (_, index) =>
      Object.freeze([...(definition.rows?.[index] || [])])
    );
    const active = new Map();
    const rects = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const globalRow = minRow + rowIndex;
      const current = new Set();
      const spans = rows[rowIndex];
      for (let index = 0; index < spans.length; index += 2) {
        const key = `${spans[index]}:${spans[index + 1]}`;
        current.add(key);
        if (!active.has(key)) active.set(key, {minColumn: spans[index], maxColumn: spans[index + 1], minRow: globalRow, maxRow: globalRow});
        else active.get(key).maxRow = globalRow;
      }
      for (const [key, rect] of active) {
        if (!current.has(key)) {
          rects.push(Object.freeze({...rect}));
          active.delete(key);
        }
      }
    }
    for (const rect of active.values()) rects.push(Object.freeze({...rect}));
    return Object.freeze({
      kind: "rasterMask", width, height, minColumn, maxColumn, minRow, maxRow,
      rows: Object.freeze(rows), rects: Object.freeze(rects)
    });
  }

  function brushLocal(shape, point) {
    const dx = point.x - shape.center.x;
    const dy = point.y - shape.center.y;
    const cosine = Math.cos(shape.angle);
    const sine = Math.sin(shape.angle);
    return {
      x: dx * cosine + dy * sine,
      y: -dx * sine + dy * cosine
    };
  }

  function brushContains(shape, point) {
    if (shape.length === 0 || shape.width === 0) return false;
    const local = brushLocal(shape, point);
    const x = local.x / (shape.length / 2);
    const y = local.y / (shape.width / 2);
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (ax > 1 || ay > 1) return false;

    if (shape.style === "feather") {
      const vane = Math.max(0.08, 1 - x * x);
      const split = x < 0.45 || Math.abs(y) > 0.12 || x < 0;
      return ay <= vane && split;
    }
    if (shape.style === "crystal") return ax + ay <= 1;
    if (shape.style === "page") return ax <= 1 && ay <= 0.88 && x + y < 1.55;
    if (shape.style === "roller") {
      const straight = ax <= 0.72 && ay <= 1;
      const cap = (ax - 0.72) ** 2 / 0.28 ** 2 + y * y <= 1;
      return straight || cap;
    }
    if (shape.style === "gear") {
      const radius = Math.hypot(x, y);
      const limit = 0.82 + 0.14 * Math.cos(Math.atan2(y, x) * 8);
      return radius <= limit;
    }
    if (shape.style === "droplet") {
      const taper = x < 0 ? Math.sqrt(Math.max(0, 1 - x * x)) : Math.max(0.05, (1 - x) * 0.82);
      return ay <= taper;
    }
    if (shape.style === "blade") return ax + ay * 1.45 <= 1;
    if (shape.style === "fan") {
      const widthAtX = 0.22 + 0.72 * (x + 1) / 2;
      return ay <= widthAtX && x <= 0.92 - y * y * 0.08;
    }
    return x * x + y * y <= 1;
  }

  function distanceToSegment(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return GameWorldSpace.distance(point, from);
    const progress = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    return GameWorldSpace.distance(point, {x: from.x + dx * progress, y: from.y + dy * progress});
  }

  function polygonContains(outline, point) {
    let inside = false;
    for (let current = 0, previous = outline.length - 1; current < outline.length; previous = current++) {
      const from = outline[previous];
      const to = outline[current];
      if (distanceToSegment(point, from, to) <= 1e-9) return true;
      const crosses = (to.y > point.y) !== (from.y > point.y)
        && point.x < (from.x - to.x) * (point.y - to.y) / (from.y - to.y) + to.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function containsPoint(shape, point) {
    if (!shape || !point) return false;
    if (shape.kind === "circle") return GameWorldSpace.distanceSquared(shape.center, point) <= shape.radius ** 2;
    if (shape.kind === "rect") return Math.abs(point.x - shape.center.x) <= shape.width / 2 && Math.abs(point.y - shape.center.y) <= shape.height / 2;
    if (shape.kind === "pathStroke") {
      if (shape.points.length === 1) return GameWorldSpace.distance(shape.points[0], point) <= shape.radius;
      for (let index = 1; index < shape.points.length; index++) {
        if (distanceToSegment(point, shape.points[index - 1], shape.points[index]) <= shape.radius) return true;
      }
      return false;
    }
    if (shape.kind === "brushStamp") return brushContains(shape, point);
    if (shape.kind === "brushStroke") return polygonContains(shape.outline, point);
    if (shape.kind === "rasterMask") {
      const column = Math.max(0, Math.min(shape.width - 1, Math.floor(point.x / GameWorldSpace.width * shape.width)));
      const row = Math.max(0, Math.min(shape.height - 1, Math.floor(point.y / GameWorldSpace.height * shape.height)));
      if (column < shape.minColumn || column > shape.maxColumn || row < shape.minRow || row > shape.maxRow) return false;
      const spans = shape.rows[row - shape.minRow];
      for (let index = 0; index < spans.length; index += 2) {
        if (column >= spans[index] && column <= spans[index + 1]) return true;
      }
      return false;
    }
    throw new TypeError(`Unknown continuous shape: ${shape.kind}`);
  }

  function bounds(shape) {
    if (shape.kind === "circle") return {
      minX: shape.center.x - shape.radius,
      maxX: shape.center.x + shape.radius,
      minY: shape.center.y - shape.radius,
      maxY: shape.center.y + shape.radius
    };
    if (shape.kind === "rect") return {
      minX: shape.center.x - shape.width / 2,
      maxX: shape.center.x + shape.width / 2,
      minY: shape.center.y - shape.height / 2,
      maxY: shape.center.y + shape.height / 2
    };
    if (shape.kind === "pathStroke") {
      const xs = shape.points.map(point => point.x);
      const ys = shape.points.map(point => point.y);
      return {
        minX: Math.min(...xs) - shape.radius,
        maxX: Math.max(...xs) + shape.radius,
        minY: Math.min(...ys) - shape.radius,
        maxY: Math.max(...ys) + shape.radius
      };
    }
    if (shape.kind === "brushStamp") {
      const cosine = Math.abs(Math.cos(shape.angle));
      const sine = Math.abs(Math.sin(shape.angle));
      const halfWidth = cosine * shape.length / 2 + sine * shape.width / 2;
      const halfHeight = sine * shape.length / 2 + cosine * shape.width / 2;
      return {
        minX: shape.center.x - halfWidth,
        maxX: shape.center.x + halfWidth,
        minY: shape.center.y - halfHeight,
        maxY: shape.center.y + halfHeight
      };
    }
    if (shape.kind === "brushStroke") {
      const xs = shape.outline.map(point => point.x);
      const ys = shape.outline.map(point => point.y);
      return {minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
    }
    if (shape.kind === "rasterMask") return {
      minX: shape.minColumn / shape.width * GameWorldSpace.width,
      maxX: (shape.maxColumn + 1) / shape.width * GameWorldSpace.width,
      minY: shape.minRow / shape.height * GameWorldSpace.height,
      maxY: (shape.maxRow + 1) / shape.height * GameWorldSpace.height
    };
    throw new TypeError(`Unknown continuous shape: ${shape.kind}`);
  }

  function intersectsCircle(shape, center, radius) {
    if (shape.kind === "circle") return GameWorldSpace.distance(shape.center, center) <= shape.radius + radius;
    if (shape.kind === "rect") {
      const x = Math.max(shape.center.x - shape.width / 2, Math.min(center.x, shape.center.x + shape.width / 2));
      const y = Math.max(shape.center.y - shape.height / 2, Math.min(center.y, shape.center.y + shape.height / 2));
      return GameWorldSpace.distanceSquared(center, {x, y}) <= radius * radius;
    }
    if (shape.kind === "pathStroke") {
      if (shape.points.length === 1) return GameWorldSpace.distance(shape.points[0], center) <= shape.radius + radius;
      return shape.points.slice(1).some((point, index) => distanceToSegment(center, shape.points[index], point) <= shape.radius + radius);
    }
    if (shape.kind === "brushStamp") {
      if (brushContains(shape, center)) return true;
      return GameWorldSpace.distance(shape.center, center) <= Math.max(shape.length, shape.width) / 2 + radius;
    }
    if (shape.kind === "brushStroke") {
      if (polygonContains(shape.outline, center)) return true;
      return shape.outline.some((point, index) =>
        distanceToSegment(center, point, shape.outline[(index + 1) % shape.outline.length]) <= radius
      );
    }
    if (shape.kind === "rasterMask") {
      const box = bounds(shape);
      if (!intersectsCircle({kind:"rect",center:{x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2},width:box.maxX-box.minX,height:box.maxY-box.minY}, center, radius)) return false;
      const minRow = Math.max(shape.minRow, Math.floor((center.y - radius) / GameWorldSpace.height * shape.height));
      const maxRow = Math.min(shape.maxRow, Math.ceil((center.y + radius) / GameWorldSpace.height * shape.height));
      for (let row = minRow; row <= maxRow; row++) {
        const y = (row + 0.5) / shape.height * GameWorldSpace.height;
        const halfWidth = Math.sqrt(Math.max(0, radius * radius - (y - center.y) ** 2));
        const minColumn = Math.floor((center.x - halfWidth) / GameWorldSpace.width * shape.width);
        const maxColumn = Math.ceil((center.x + halfWidth) / GameWorldSpace.width * shape.width);
        const spans = shape.rows[row - shape.minRow];
        for (let index = 0; index < spans.length; index += 2) {
          if (spans[index] <= maxColumn && spans[index + 1] >= minColumn) return true;
        }
      }
      return false;
    }
    return false;
  }

  function dilateRasterMask(shape, distanceU) {
    if (shape.kind !== "rasterMask") throw new TypeError("Only raster masks can be dilated.");
    const distance = Math.max(0, Number(distanceU) || 0);
    if (!distance) return shape;
    const rowRadius = Math.ceil(distance / GameWorldSpace.height * shape.height);
    const intervals = new Map();
    for (let rowIndex = 0; rowIndex < shape.rows.length; rowIndex++) {
      const sourceRow = shape.minRow + rowIndex;
      const spans = shape.rows[rowIndex];
      for (let rowOffset = -rowRadius; rowOffset <= rowRadius; rowOffset++) {
        const targetRow = sourceRow + rowOffset;
        if (targetRow < 0 || targetRow >= shape.height) continue;
        const verticalU = Math.abs(rowOffset) / shape.height * GameWorldSpace.height;
        const horizontalU = Math.sqrt(Math.max(0, distance * distance - verticalU * verticalU));
        const columnRadius = Math.ceil(horizontalU / GameWorldSpace.width * shape.width);
        if (!intervals.has(targetRow)) intervals.set(targetRow, []);
        const target = intervals.get(targetRow);
        for (let index = 0; index < spans.length; index += 2) {
          target.push([
            Math.max(0, spans[index] - columnRadius),
            Math.min(shape.width - 1, spans[index + 1] + columnRadius)
          ]);
        }
      }
    }
    const rowNumbers = [...intervals.keys()].sort((a, b) => a - b);
    const minRow = rowNumbers[0];
    const maxRow = rowNumbers.at(-1);
    let minColumn = shape.width - 1;
    let maxColumn = 0;
    const rows = [];
    for (let row = minRow; row <= maxRow; row++) {
      const source = (intervals.get(row) || []).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of source) {
        const previous = merged.at(-1);
        if (previous && interval[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], interval[1]);
        else merged.push(interval.slice());
      }
      const flat = merged.flat();
      if (flat.length) {
        minColumn = Math.min(minColumn, flat[0]);
        maxColumn = Math.max(maxColumn, flat.at(-1));
      }
      rows.push(flat);
    }
    return rasterMask({width:shape.width,height:shape.height,minColumn,maxColumn,minRow,maxRow,rows});
  }

  function shapeInsideWorld(shape) {
    const box = bounds(shape);
    return box.minX >= 0 && box.minY >= 0 && box.maxX <= GameWorldSpace.width && box.maxY <= GameWorldSpace.height;
  }

  global.GameContinuousGeometry = Object.freeze({
    circle, rect, pathStroke, brushStamp, brushStroke, rasterMask, dilateRasterMask,
    distanceToSegment, containsPoint, intersectsCircle, bounds, shapeInsideWorld
  });
})(window);
