(function createContinuousBrushSystem(global) {
  "use strict";

  const DEFAULT_SPACING_U = 1 / 16;
  const NORMAL_SPACING_U = 1 / 8;

  function define(profile = {}) {
    const widthU = Math.max(0, GameWorldSpace.quantize(profile.widthU ?? 0.75));
    return Object.freeze({
      id: profile.id || "round-075",
      enabled: profile.enabled !== false && widthU > 0,
      shape: profile.shape || profile.style || "round",
      widthU,
      lengthRatio: Math.max(0.1, Number(profile.lengthRatio) || 1),
      widthRatio: Math.max(0.1, Number(profile.widthRatio) || 1),
      angleOffset: Number(profile.angleOffset) || 0,
      spacingU: Math.max(DEFAULT_SPACING_U, GameWorldSpace.quantize(profile.spacingU ?? DEFAULT_SPACING_U)),
      pressure: profile.pressure !== false,
      pressureMin: Math.max(0.05, Math.min(0.8, Number(profile.pressureMin) || 0.22)),
      hardness: Math.max(0, Math.min(1, profile.hardness ?? 0.8)),
      flow: Math.max(0, Math.min(1, profile.flow ?? 1)),
      offsetU: GameWorldSpace.quantize(profile.offsetU ?? 0),
      lateralOffsetU: GameWorldSpace.quantize(profile.lateralOffsetU ?? 0),
      rotationMode: profile.rotationMode || "path",
      stationaryStamp: profile.stationaryStamp !== false,
      trailEffectId: profile.trailEffectId || null
    });
  }

  function progressAt(index, sampleCount, spacingU, pathLength) {
    if (sampleCount <= 1 || !pathLength) return 1;
    if (index === sampleCount - 1) return 1;
    return Math.min(1, index * spacingU / pathLength);
  }

  function pressurePeakFor(samples, spacingU, pathLength) {
    if (samples.length < 3 || !pathLength) return 0.5;
    let bestProgress = 0.5;
    let bestScore = -Infinity;
    for (let index = 1; index < samples.length - 1; index++) {
      const previous = samples[index - 1];
      const point = samples[index];
      const next = samples[index + 1];
      const incoming = {x: point.x - previous.x, y: point.y - previous.y};
      const outgoing = {x: next.x - point.x, y: next.y - point.y};
      const incomingLength = Math.hypot(incoming.x, incoming.y);
      const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
      if (!incomingLength || !outgoingLength) continue;
      const turn = Math.abs(Math.atan2(
        incoming.x * outgoing.y - incoming.y * outgoing.x,
        incoming.x * outgoing.x + incoming.y * outgoing.y
      ));
      const curvature = turn / ((incomingLength + outgoingLength) / 2);
      const progress = progressAt(index, samples.length, spacingU, pathLength);
      if (progress < 0.2 || progress > 0.8) continue;
      const interiorWeight = Math.sin(progress * Math.PI);
      const score = curvature * (0.35 + interiorWeight * 0.65) + interiorWeight * 0.02;
      if (score > bestScore || score === bestScore && Math.abs(progress - 0.5) < Math.abs(bestProgress - 0.5)) {
        bestScore = score;
        bestProgress = progress;
      }
    }
    return Math.max(0.2, Math.min(0.8, bestProgress));
  }

  function pressureAt(progress, peak, minimum) {
    if (progress <= peak) return minimum + (1 - minimum) * progress / Math.max(peak, 1e-9);
    return minimum + (1 - minimum) * (1 - progress) / Math.max(1 - peak, 1e-9);
  }

  function pressureSamples(path, spacingU, pathLength, peak, minimum) {
    if (!pathLength) return [{point: GameWorldSpace.point(path[0].x, path[0].y), progress: 1}];
    const result = [{point: pointAtDistance(path, 0), progress: 0}];
    const peakDistance = pathLength * peak;
    let distance = 0;
    while (distance < pathLength) {
      const progress = distance / pathLength;
      const spacing = Math.max(DEFAULT_SPACING_U, spacingU * pressureAt(progress, peak, minimum));
      let nextDistance = Math.min(pathLength, distance + spacing);
      if (distance < peakDistance && nextDistance > peakDistance) nextDistance = peakDistance;
      if (nextDistance <= distance) break;
      distance = nextDistance;
      result.push({point: pointAtDistance(path, distance), progress: distance >= pathLength ? 1 : distance / pathLength});
    }
    return result.filter((entry, index) => index === 0 || entry.point.x !== result[index - 1].point.x || entry.point.y !== result[index - 1].point.y);
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

  function seedFor(value) {
    let hash = 2166136261;
    for (const character of String(value || "brush")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
  }

  function tangentAt(samples, index, fallbackAngle = 0) {
    const previous = samples[Math.max(0, index - 1)].point;
    const next = samples[Math.min(samples.length - 1, index + 1)].point;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    return length
      ? {x:dx / length,y:dy / length,angle:Math.atan2(dy, dx)}
      : {x:Math.cos(fallbackAngle),y:Math.sin(fallbackAngle),angle:fallbackAngle};
  }

  function styleEnvelope(style, progress, phase) {
    const body = Math.sin(progress * Math.PI);
    const slowLeft = Math.sin(progress * Math.PI * 2 + phase * Math.PI * 2);
    const slowRight = Math.sin(progress * Math.PI * 1.5 + phase * Math.PI * 2 + 1.7);
    if (style === "feather") return {left:1 + body * slowLeft * .07,right:.9 + body * slowRight * .06};
    if (style === "blade") return {left:.72 + body * slowLeft * .025,right:1.08 + body * slowRight * .025};
    if (style === "fan") return {left:.9 + body * slowLeft * .05,right:1.08 + body * slowRight * .055};
    if (style === "droplet") return {left:.94 + body * slowLeft * .035,right:1.02 + body * slowRight * .035};
    if (style === "crystal") return {left:.97 + body * slowLeft * .015,right:.97 + body * slowRight * .015};
    if (style === "roller") return {left:.98,right:.98};
    return {left:.96 + body * slowLeft * .025,right:.98 + body * slowRight * .025};
  }

  function crossSections(brush, samples, size, pathLength, pressurePeak, options) {
    const phase = seedFor(brush.id);
    const fallbackAngle = Number(options.facingAngle) || 0;
    return samples.map((sample, index) => {
      const tangent = tangentAt(samples, index, fallbackAngle);
      const pathNormal = {x:-tangent.y,y:tangent.x};
      const progress = sample.progress;
      const pressure = brush.pressure && pathLength ? pressureAt(progress, pressurePeak, brush.pressureMin) : 1;
      const stampLength = size * pressure * brush.lengthRatio;
      const stampWidth = size * pressure * brush.widthRatio;
      const brushAngle = brush.rotationMode === "normal" ? tangent.angle + Math.PI / 2
        : brush.rotationMode === "fixed" ? 0 : tangent.angle;
      const crossAngle = brush.rotationMode === "normal" ? brushAngle + brush.angleOffset : tangent.angle + Math.PI / 2;
      const crossAxis = {x:Math.cos(crossAngle),y:Math.sin(crossAngle)};
      const transverseWidth = brush.rotationMode === "normal" ? stampLength : stampWidth;
      const envelope = styleEnvelope(brush.shape, progress, phase);
      const driftStrength = brush.shape === "roller" || brush.shape === "crystal" ? .012 : .04;
      const drift = size * driftStrength * Math.sin(progress * Math.PI)
        * (Math.sin(progress * Math.PI * 2 + phase * Math.PI * 2) * .7
          + Math.sin(progress * Math.PI * 4.5 + phase * 3.1) * .3);
      const offsetU = brush.offsetU * pressure * pressure;
      const lateralOffsetU = brush.lateralOffsetU * pressure + drift;
      const center = GameWorldSpace.point(
        sample.point.x + tangent.x * offsetU + pathNormal.x * lateralOffsetU,
        sample.point.y + tangent.y * offsetU + pathNormal.y * lateralOffsetU
      );
      const leftWidth = transverseWidth / 2 * envelope.left;
      const rightWidth = transverseWidth / 2 * envelope.right;
      return Object.freeze({
        center,tangent,crossAxis,progress,pressure,pressurePeak,
        stampLength,stampWidth,
        left:GameWorldSpace.point(center.x+crossAxis.x*leftWidth,center.y+crossAxis.y*leftWidth),
        right:GameWorldSpace.point(center.x-crossAxis.x*rightWidth,center.y-crossAxis.y*rightWidth),
        angle:brushAngle+brush.angleOffset
      });
    });
  }

  function midpointBoundary(left, right) {
    return Object.freeze({
      center:GameWorldSpace.point((left.center.x+right.center.x)/2,(left.center.y+right.center.y)/2),
      left:GameWorldSpace.point((left.left.x+right.left.x)/2,(left.left.y+right.left.y)/2),
      right:GameWorldSpace.point((left.right.x+right.right.x)/2,(left.right.y+right.right.y)/2)
    });
  }

  function capBoundary(section, direction) {
    const reach = section.stampWidth * .42;
    const center = GameWorldSpace.point(
      section.center.x + section.tangent.x * reach * direction,
      section.center.y + section.tangent.y * reach * direction
    );
    const leftWidth = GameWorldSpace.distance(section.center, section.left) * .18;
    const rightWidth = GameWorldSpace.distance(section.center, section.right) * .18;
    return Object.freeze({
      center,
      left:GameWorldSpace.point(center.x+section.crossAxis.x*leftWidth,center.y+section.crossAxis.y*leftWidth),
      right:GameWorldSpace.point(center.x-section.crossAxis.x*rightWidth,center.y-section.crossAxis.y*rightWidth)
    });
  }

  function operations(profile, path, owner, options = {}) {
    const brush = define(profile);
    if (!brush.enabled || !path?.length) return [];
    const pathLength = GameWorldSpace.pathLength(path);
    if (pathLength === 0 && !brush.stationaryStamp) return [];
    const coverageMultiplier = Math.max(0, options.coverageMultiplier ?? 1);
    const size = brush.widthU * Math.sqrt(coverageMultiplier);
    const requestedSpacing = options.spacingU ?? brush.spacingU;
    const spacingU = brush.rotationMode === "normal"
      ? Math.min(requestedSpacing, NORMAL_SPACING_U)
      : requestedSpacing;
    const baseSamples = samplePath(path, spacingU);
    const pressurePeak = brush.pressure && pathLength ? pressurePeakFor(baseSamples, spacingU, pathLength) : 0.5;
    const samples = brush.pressure
      ? pressureSamples(path, spacingU, pathLength, pressurePeak, brush.pressureMin)
      : baseSamples.map((point, index) => ({point, progress: progressAt(index, baseSamples.length, spacingU, pathLength)}));
    if (!pathLength) {
      const angle = Number(options.facingAngle) || 0;
      return [Object.freeze({
        sequence:0,progress:1,pressure:1,pressurePeak,
        shape:GameContinuousGeometry.brushStamp(
          samples[0].point,brush.shape,size*brush.lengthRatio,size*brush.widthRatio,
          (brush.rotationMode==="normal"?angle+Math.PI/2:angle)+brush.angleOffset
        ),
        owner,kind:"paint",source:"unit",strength:brush.flow
      })];
    }
    const sections = crossSections(brush,samples,size,pathLength,pressurePeak,options);
    const boundaries = [capBoundary(sections[0],-1)];
    for(let index=1;index<sections.length;index++)boundaries.push(midpointBoundary(sections[index-1],sections[index]));
    boundaries.push(capBoundary(sections.at(-1),1));
    return sections.map((section,index)=>Object.freeze({
      sequence:index,
      progress:section.progress,
      pressure:section.pressure,
      pressurePeak,
      shape:GameContinuousGeometry.brushStroke([
        boundaries[index].left,boundaries[index+1].left,
        boundaries[index+1].right,boundaries[index].right
      ],{
        style:brush.shape,length:section.stampLength,width:section.stampWidth,angle:section.angle
      }),
      owner,kind:"paint",source:"unit",strength:brush.flow
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

  global.GameContinuousBrushes = Object.freeze({
    defaultSpacingU: DEFAULT_SPACING_U,
    normalSpacingU: NORMAL_SPACING_U,
    pressurePeakFor,
    pressureAt,
    define,
    samplePath,
    operations,
    apply
  });
})(window);
