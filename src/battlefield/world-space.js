(function createWorldSpaceSystem(global) {
  "use strict";

  const WIDTH_U = 60;
  const HEIGHT_U = 30;
  const FIXED_SCALE = 256;

  function toFixed(value) {
    if (!Number.isFinite(value)) throw new TypeError("World coordinate must be finite.");
    return Math.round(value * FIXED_SCALE);
  }

  function fromFixed(value) {
    return value / FIXED_SCALE;
  }

  function quantize(value) {
    return fromFixed(toFixed(value));
  }

  function point(x, y) {
    return Object.freeze({x: quantize(x), y: quantize(y)});
  }

  function clampPoint(value, margin = 0) {
    const safeMargin = Math.max(0, quantize(margin));
    return point(
      Math.max(safeMargin, Math.min(WIDTH_U - safeMargin, value.x)),
      Math.max(safeMargin, Math.min(HEIGHT_U - safeMargin, value.y))
    );
  }

  function containsPoint(value, margin = 0) {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) &&
      value.x >= margin && value.x <= WIDTH_U - margin &&
      value.y >= margin && value.y <= HEIGHT_U - margin;
  }

  function distanceSquared(a, b) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }

  function distance(a, b) {
    return Math.sqrt(distanceSquared(a, b));
  }

  function pathLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index++) total += distance(points[index - 1], points[index]);
    return quantize(total);
  }

  global.GameWorldSpace = Object.freeze({
    width: WIDTH_U,
    height: HEIGHT_U,
    fixedScale: FIXED_SCALE,
    toFixed,
    fromFixed,
    quantize,
    point,
    clampPoint,
    containsPoint,
    distanceSquared,
    distance,
    pathLength
  });
})(window);
