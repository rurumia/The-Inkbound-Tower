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

  function distanceToSegment(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return GameWorldSpace.distance(point, from);
    const progress = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    return GameWorldSpace.distance(point, {x: from.x + dx * progress, y: from.y + dy * progress});
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
    throw new TypeError(`Unknown continuous shape: ${shape.kind}`);
  }

  function shapeInsideWorld(shape) {
    const box = bounds(shape);
    return box.minX >= 0 && box.minY >= 0 && box.maxX <= GameWorldSpace.width && box.maxY <= GameWorldSpace.height;
  }

  global.GameContinuousGeometry = Object.freeze({circle, rect, pathStroke, distanceToSegment, containsPoint, bounds, shapeInsideWorld});
})(window);
