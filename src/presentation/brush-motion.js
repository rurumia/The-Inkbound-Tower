(function createBrushMotion(global) {
  "use strict";

  const TYPES = Object.freeze(["arc", "sweep", "flow"]);
  const SAMPLE_STEP_U = 1 / 12;

  function hashSeed(value) {
    const text = String(value ?? "brush-motion");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function typeFor(seed) {
    return TYPES[hashSeed(seed) % TYPES.length];
  }

  function tangentAt(guides, index, type, seed) {
    const point = guides[index];
    const previous = guides[Math.max(0, index - 1)];
    const next = guides[Math.min(guides.length - 1, index + 1)];
    const endpoint = index === 0 || index === guides.length - 1;
    const baseX = endpoint ? next.x - previous.x : (next.x - previous.x) / 2;
    const baseY = endpoint ? next.y - previous.y : (next.y - previous.y) / 2;
    const magnitude = Math.hypot(baseX, baseY) || 1;
    const normalX = -baseY / magnitude;
    const normalY = baseX / magnitude;
    const progress = guides.length === 1 ? 0 : index / (guides.length - 1);
    const handedness = hashSeed(seed) % 2 ? 1 : -1;
    const amplitude = Math.min(0.28, Math.max(0.1, magnitude * 0.16));
    let gesture;
    if (type === "arc") gesture = Math.cos(progress * Math.PI);
    else if (type === "sweep") gesture = Math.cos(progress * Math.PI * 2);
    else gesture = Math.sin(progress * Math.PI * 2 + Math.PI / 3);
    return {
      x: baseX + normalX * amplitude * gesture * handedness,
      y: baseY + normalY * amplitude * gesture * handedness
    };
  }

  function hermite(from, to, fromTangent, toTangent, progress) {
    const t2 = progress * progress;
    const t3 = t2 * progress;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + progress;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return GameWorldSpace.clampPoint({
      x: h00 * from.x + h10 * fromTangent.x + h01 * to.x + h11 * toTangent.x,
      y: h00 * from.y + h10 * fromTangent.y + h01 * to.y + h11 * toTangent.y
    });
  }

  function create(guidePoints, options = {}) {
    if (!Array.isArray(guidePoints) || !guidePoints.length) throw new TypeError("Brush motion requires guide points.");
    const guides = guidePoints.map(point => GameWorldSpace.point(point.x, point.y));
    const type = TYPES.includes(options.type) ? options.type : typeFor(options.seed);
    if (guides.length === 1) {
      const segment = Object.freeze({index: 0, points: Object.freeze([guides[0]]), length: 0});
      return Object.freeze({type, guides: Object.freeze(guides), segments: Object.freeze([segment]), points: segment.points, length: 0});
    }
    const tangents = guides.map((_, index) => tangentAt(guides, index, type, options.seed));
    const segments = [];
    const allPoints = [];
    for (let index = 0; index < guides.length - 1; index++) {
      const directLength = GameWorldSpace.distance(guides[index], guides[index + 1]);
      const sampleCount = Math.max(6, Math.ceil(directLength / SAMPLE_STEP_U));
      const points = [];
      for (let sample = 0; sample <= sampleCount; sample++) {
        points.push(hermite(guides[index], guides[index + 1], tangents[index], tangents[index + 1], sample / sampleCount));
      }
      const unique = points.filter((point, pointIndex) => pointIndex === 0 ||
        point.x !== points[pointIndex - 1].x || point.y !== points[pointIndex - 1].y);
      const frozenPoints = Object.freeze(unique);
      segments.push(Object.freeze({index, points: frozenPoints, length: GameWorldSpace.pathLength(frozenPoints)}));
      allPoints.push(...(index ? unique.slice(1) : unique));
    }
    return Object.freeze({
      type,
      guides: Object.freeze(guides),
      segments: Object.freeze(segments),
      points: Object.freeze(allPoints),
      length: GameWorldSpace.pathLength(allPoints)
    });
  }

  function pointAt(path, progress) {
    if (!path?.length) return null;
    if (path.length === 1 || progress <= 0) return path[0];
    if (progress >= 1) return path[path.length - 1];
    const target = GameWorldSpace.pathLength(path) * progress;
    let traversed = 0;
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1];
      const to = path[index];
      const length = GameWorldSpace.distance(from, to);
      if (traversed + length >= target) {
        const ratio = length ? (target - traversed) / length : 0;
        return GameWorldSpace.point(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
      }
      traversed += length;
    }
    return path[path.length - 1];
  }

  global.GameBrushMotion = Object.freeze({types: TYPES, sampleStepU: SAMPLE_STEP_U, typeFor, create, pointAt});
})(window);
