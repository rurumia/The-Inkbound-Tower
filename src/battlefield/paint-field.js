(function createPaintFieldSystem(global) {
  "use strict";

  const CONTROL_SCALE = 256;

  function create(options = {}) {
    const width = options.width || 960;
    const height = options.height || 480;
    const regions = options.regions || null;
    const values = new Int16Array(width * height);
    const sampleArea = GameWorldSpace.width * GameWorldSpace.height / values.length;

    function pointAt(column, row) {
      return {
        x: (column + 0.5) * GameWorldSpace.width / width,
        y: (row + 0.5) * GameWorldSpace.height / height
      };
    }

    function indexAt(point) {
      const column = Math.max(0, Math.min(width - 1, Math.floor(point.x / GameWorldSpace.width * width)));
      const row = Math.max(0, Math.min(height - 1, Math.floor(point.y / GameWorldSpace.height * height)));
      return row * width + column;
    }

    function sample(point) {
      return values[indexAt(point)] / CONTROL_SCALE;
    }

    function sampleBounds(shape) {
      const box = GameContinuousGeometry.bounds(shape);
      return {
        minColumn: Math.max(0, Math.floor(box.minX / GameWorldSpace.width * width)),
        maxColumn: Math.min(width - 1, Math.ceil(box.maxX / GameWorldSpace.width * width)),
        minRow: Math.max(0, Math.floor(box.minY / GameWorldSpace.height * height)),
        maxRow: Math.min(height - 1, Math.ceil(box.maxY / GameWorldSpace.height * height))
      };
    }

    function apply(operation) {
      if (!operation?.shape) throw new TypeError("Paint operation shape is required.");
      if (operation.mode !== "neutralize" && operation.owner !== 1 && operation.owner !== -1) throw new RangeError("Paint owner must be 1 or -1.");
      const box = sampleBounds(operation.shape);
      const strength = Math.max(0, Math.min(CONTROL_SCALE, Math.round((operation.strength ?? 1) * CONTROL_SCALE)));
      let changedSamples = 0;
      let ownAreaAdded = 0;
      let enemyAreaRemoved = 0;

      for (let row = box.minRow; row <= box.maxRow; row++) {
        for (let column = box.minColumn; column <= box.maxColumn; column++) {
          const point = pointAt(column, row);
          if (!GameContinuousGeometry.containsPoint(operation.shape, point)) continue;
          if (regions && !regions.permits(point, operation)) continue;
          const index = row * width + column;
          const before = values[index];
          const target = operation.owner * CONTROL_SCALE;
          const after = operation.mode === "neutralize" ? 0 : Math.round(before + (target - before) * strength / CONTROL_SCALE);
          if (after === before) continue;
          values[index] = after;
          changedSamples++;
          if (operation.owner === 1) {
            ownAreaAdded += Math.max(after, 0) - Math.max(before, 0);
            enemyAreaRemoved += Math.max(-before, 0) - Math.max(-after, 0);
          } else if (operation.owner === -1) {
            ownAreaAdded += Math.max(-after, 0) - Math.max(-before, 0);
            enemyAreaRemoved += Math.max(before, 0) - Math.max(after, 0);
          }
        }
      }
      return Object.freeze({
        changedSamples,
        ownAreaAdded: ownAreaAdded / CONTROL_SCALE * sampleArea,
        enemyAreaRemoved: enemyAreaRemoved / CONTROL_SCALE * sampleArea
      });
    }

    function measure() {
      let player = 0;
      let enemy = 0;
      let neutral = 0;
      for (const raw of values) {
        const value = raw / CONTROL_SCALE;
        player += Math.max(value, 0);
        enemy += Math.max(-value, 0);
        neutral += 1 - Math.abs(value);
      }
      return Object.freeze({player: player * sampleArea, enemy: enemy * sampleArea, neutral: neutral * sampleArea, total: 1800});
    }

    function analyze(shape, owner) {
      const box = sampleBounds(shape);
      let samples = 0;
      let friendlyStrong = 0;
      let enemyStrong = 0;
      let friendlyWeight = 0;
      for (let row = box.minRow; row <= box.maxRow; row++) {
        for (let column = box.minColumn; column <= box.maxColumn; column++) {
          const point = pointAt(column, row);
          if (!GameContinuousGeometry.containsPoint(shape, point)) continue;
          const value = values[row * width + column] / CONTROL_SCALE * owner;
          samples++;
          if (value >= 0.5) friendlyStrong++;
          if (value <= -0.5) enemyStrong++;
          friendlyWeight += Math.max(0, value);
        }
      }
      return Object.freeze({
        samples,
        friendlyStrongRatio: samples ? friendlyStrong / samples : 0,
        enemyStrongRatio: samples ? enemyStrong / samples : 0,
        friendlyArea: friendlyWeight * sampleArea
      });
    }

    function hash() {
      let value = 2166136261;
      for (const sample of values) {
        value ^= sample & 0xff;
        value = Math.imul(value, 16777619);
        value ^= sample >>> 8 & 0xff;
        value = Math.imul(value, 16777619);
      }
      return (value >>> 0).toString(16).padStart(8, "0");
    }

    function snapshot() {
      return Object.freeze({schemaVersion: 2, width, height, values: Array.from(values)});
    }

    return Object.freeze({width, height, sample, apply, measure, analyze, hash, snapshot});
  }

  global.GamePaintField = Object.freeze({controlScale: CONTROL_SCALE, create});
})(window);
