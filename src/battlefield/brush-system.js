(function createContinuousBrushSystem(global) {
  "use strict";

  const DEFAULT_SPACING_U = 1 / 16;

  function define(profile = {}) {
    const widthU = Math.max(0, GameWorldSpace.quantize(profile.widthU ?? 0.75));
    return Object.freeze({
      id: profile.id || "round-075",
      enabled: profile.enabled !== false && widthU > 0,
      shape: profile.shape || "round",
      widthU,
      hardness: Math.max(0, Math.min(1, profile.hardness ?? 0.8)),
      flow: Math.max(0, Math.min(1, profile.flow ?? 1)),
      offset: GameWorldSpace.quantize(profile.offset ?? 0),
      rotationMode: profile.rotationMode || "path",
      stationaryStamp: profile.stationaryStamp !== false,
      trailEffectId: profile.trailEffectId || null
    });
  }

  function pointAtDistance(path, targetDistance) {
    let traversed = 0;
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1];
      const to = path[index];
      const length = GameWorldSpace.distance(from, to);
      if (traversed + length >= targetDistance) {
        const ratio = length ? (targetDistance - traversed) / length : 0;
        return GameWorldSpace.point(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
      }
      traversed += length;
    }
    return path[path.length - 1];
  }

  function samplePath(path, spacingU = DEFAULT_SPACING_U) {
    if (!Array.isArray(path) || !path.length) return [];
    const length = GameWorldSpace.pathLength(path);
    if (length === 0) return [GameWorldSpace.point(path[0].x, path[0].y)];
    const samples = [];
    for (let distance = 0; distance < length; distance += spacingU) samples.push(pointAtDistance(path, distance));
    samples.push(GameWorldSpace.point(path[path.length - 1].x, path[path.length - 1].y));
    return samples.filter((point, index) => index === 0 || point.x !== samples[index - 1].x || point.y !== samples[index - 1].y);
  }

  function operations(profile, path, owner, options = {}) {
    const brush = define(profile);
    if (!brush.enabled || !path?.length) return [];
    const pathLength = GameWorldSpace.pathLength(path);
    if (pathLength === 0 && !brush.stationaryStamp) return [];
    const coverageMultiplier = Math.max(0, options.coverageMultiplier ?? 1);
    const radius = brush.widthU / 2 * Math.sqrt(coverageMultiplier);
    return samplePath(path, options.spacingU || DEFAULT_SPACING_U).map((point, index) => Object.freeze({
      sequence: index,
      progress: pathLength ? Math.min(1, index * (options.spacingU || DEFAULT_SPACING_U) / pathLength) : 1,
      shape: GameContinuousGeometry.circle(point, radius),
      owner,
      kind: "paint",
      source: "unit",
      strength: brush.flow
    }));
  }

  function apply(field, profile, path, owner, options = {}) {
    const stamps = operations(profile, path, owner, options);
    const total = {changedSamples: 0, ownAreaAdded: 0, enemyAreaRemoved: 0};
    for (const operation of stamps) {
      const result = field.apply(operation);
      total.changedSamples += result.changedSamples;
      total.ownAreaAdded += result.ownAreaAdded;
      total.enemyAreaRemoved += result.enemyAreaRemoved;
    }
    return Object.freeze({operations: Object.freeze(stamps), result: Object.freeze(total)});
  }

  global.GameContinuousBrushes = Object.freeze({defaultSpacingU: DEFAULT_SPACING_U, define, samplePath, operations, apply});
})(window);
