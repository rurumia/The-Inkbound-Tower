(function createPaintFieldSystem(global) {
  "use strict";

  const CONTROL_SCALE = 256;
  const DEFAULT_WIDTH = 1920;
  const DEFAULT_HEIGHT = 960;

  function create(options = {}) {
    const width = options.width || DEFAULT_WIDTH;
    const height = options.height || DEFAULT_HEIGHT;
    const regions = options.regions || null;
    const values = new Int16Array(width * height);
    const sampleArea = GameWorldSpace.width * GameWorldSpace.height / values.length;
    let dirtyBounds = null;
    let playerControlTotal = 0;
    let enemyControlTotal = 0;

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

    function sampleRaster(column, row, rasterWidth, rasterHeight) {
      if (rasterWidth === width && rasterHeight === height && Number.isInteger(column) && Number.isInteger(row) &&
          column >= 0 && column < width && row >= 0 && row < height) {
        return values[row * width + column] / CONTROL_SCALE;
      }
      const sourceColumn = Math.max(0, Math.min(width - 1, Math.floor((column + 0.5) / rasterWidth * width)));
      const sourceRow = Math.max(0, Math.min(height - 1, Math.floor((row + 0.5) / rasterHeight * height)));
      return values[sourceRow * width + sourceColumn] / CONTROL_SCALE;
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

    function markDirty(box) {
      if (!dirtyBounds) {
        dirtyBounds = {...box};
        return;
      }
      dirtyBounds.minColumn = Math.min(dirtyBounds.minColumn, box.minColumn);
      dirtyBounds.maxColumn = Math.max(dirtyBounds.maxColumn, box.maxColumn);
      dirtyBounds.minRow = Math.min(dirtyBounds.minRow, box.minRow);
      dirtyBounds.maxRow = Math.max(dirtyBounds.maxRow, box.maxRow);
    }

    function consumeDirtyBounds() {
      if (!dirtyBounds) return null;
      const result = Object.freeze({...dirtyBounds});
      dirtyBounds = null;
      return result;
    }

    function apply(operation) {
      if (!operation?.shape) throw new TypeError("Paint operation shape is required.");
      if (operation.mode !== "neutralize" && operation.owner !== 1 && operation.owner !== -1) throw new RangeError("Paint owner must be 1 or -1.");
      const box = sampleBounds(operation.shape);
      const strength = Math.max(0, Math.min(CONTROL_SCALE, Math.round((operation.strength ?? 1) * CONTROL_SCALE)));
      const operationBounds = GameContinuousGeometry.bounds(operation.shape);
      const regionCandidates = regions && !operation.skipRegionChecks && regions.candidates
        ? regions.candidates(operationBounds)
        : null;
      const checkRegions = !!regions && !operation.skipRegionChecks && (!regionCandidates || regionCandidates.length > 0);
      let changedSamples = 0;
      let ownAreaAdded = 0;
      let enemyAreaRemoved = 0;

      function applySample(column, row) {
        if (checkRegions && !regions.permits(pointAt(column, row), operation, regionCandidates)) return;
        const index = row * width + column;
        const before = values[index];
        const target = operation.owner * CONTROL_SCALE;
        const after = operation.mode === "neutralize" ? 0 : Math.round(before + (target - before) * strength / CONTROL_SCALE);
        if (after === before) return;
        values[index] = after;
        playerControlTotal += Math.max(after, 0) - Math.max(before, 0);
        enemyControlTotal += Math.max(-after, 0) - Math.max(-before, 0);
        changedSamples++;
        if (operation.owner === 1) {
          ownAreaAdded += Math.max(after, 0) - Math.max(before, 0);
          enemyAreaRemoved += Math.max(-before, 0) - Math.max(-after, 0);
        } else if (operation.owner === -1) {
          ownAreaAdded += Math.max(-after, 0) - Math.max(-before, 0);
          enemyAreaRemoved += Math.max(before, 0) - Math.max(after, 0);
        }
      }

      const directMask = operation.shape.kind === "rasterMask"
        && operation.shape.width === width && operation.shape.height === height;
      if (directMask) {
        for (let row = operation.shape.minRow; row <= operation.shape.maxRow; row++) {
          const spans = operation.shape.rows[row - operation.shape.minRow];
          for (let index = 0; index < spans.length; index += 2) {
            for (let column = spans[index]; column <= spans[index + 1]; column++) applySample(column, row);
          }
        }
      } else {
        for (let row = box.minRow; row <= box.maxRow; row++) {
          for (let column = box.minColumn; column <= box.maxColumn; column++) {
            const point = pointAt(column, row);
            if (!GameContinuousGeometry.containsPoint(operation.shape, point)) continue;
            applySample(column, row);
          }
        }
      }
      if (changedSamples) markDirty(box);
      return Object.freeze({
        changedSamples,
        ownAreaAdded: ownAreaAdded / CONTROL_SCALE * sampleArea,
        enemyAreaRemoved: enemyAreaRemoved / CONTROL_SCALE * sampleArea
      });
    }

    function measure() {
      const player = playerControlTotal / CONTROL_SCALE * sampleArea;
      const enemy = enemyControlTotal / CONTROL_SCALE * sampleArea;
      return Object.freeze({player, enemy, neutral: 1800 - player - enemy, total: 1800});
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

    function touchesCircle(center, radius, owner) {
      const samplePadding = Math.hypot(GameWorldSpace.width / width, GameWorldSpace.height / height) / 2;
      return analyze(GameContinuousGeometry.circle(center, radius + samplePadding), owner).friendlyArea > 0;
    }

    function captureMask(boundary = null, options = {}) {
      const box = boundary ? sampleBounds(boundary) : {
        minColumn: 0, maxColumn: width - 1, minRow: 0, maxRow: height - 1
      };
      const owner = options.owner === -1 ? -1 : options.owner === 1 ? 1 : 0;
      const threshold = Math.max(1, Math.round((options.threshold ?? 1 / CONTROL_SCALE) * CONTROL_SCALE));
      const rows = [];
      let firstColumn = width - 1;
      let lastColumn = 0;
      let firstRow = null;
      let lastRow = null;
      for (let row = box.minRow; row <= box.maxRow; row++) {
        const spans = [];
        let start = null;
        for (let column = box.minColumn; column <= box.maxColumn; column++) {
          const point = pointAt(column, row);
          const raw = values[row * width + column];
          const matchesOwner = owner === 1 ? raw >= threshold : owner === -1 ? raw <= -threshold : Math.abs(raw) >= threshold;
          const included = matchesOwner
            && (!boundary || GameContinuousGeometry.containsPoint(boundary, point))
            && (!options.excludeCrystal || !regions?.has("crystal", point));
          if (included && start == null) start = column;
          if ((!included || column === box.maxColumn) && start != null) {
            const end = included && column === box.maxColumn ? column : column - 1;
            spans.push(start, end);
            firstColumn = Math.min(firstColumn, start);
            lastColumn = Math.max(lastColumn, end);
            firstRow ??= row;
            lastRow = row;
            start = null;
          }
        }
        rows.push(spans);
      }
      if (firstRow == null) return null;
      return GameContinuousGeometry.rasterMask({
        width, height,
        minColumn: firstColumn,
        maxColumn: lastColumn,
        minRow: firstRow,
        maxRow: lastRow,
        rows: rows.slice(firstRow - box.minRow, lastRow - box.minRow + 1)
      });
    }

    function largestComponentMask(boundary = null, options = {}) {
      const box = boundary ? sampleBounds(boundary) : {
        minColumn: 0, maxColumn: width - 1, minRow: 0, maxRow: height - 1
      };
      const owner = options.owner === -1 ? -1 : 1;
      const threshold = Math.max(1, Math.round((options.threshold ?? 1 / CONTROL_SCALE) * CONTROL_SCALE));
      const areaWidth = box.maxColumn - box.minColumn + 1;
      const areaHeight = box.maxRow - box.minRow + 1;
      const labels = new Int32Array(areaWidth * areaHeight);
      const queue = new Int32Array(areaWidth * areaHeight);
      let component = 0;
      let largestLabel = 0;
      let largestSize = 0;
      const matches = localIndex => {
        const localRow = Math.floor(localIndex / areaWidth);
        const localColumn = localIndex - localRow * areaWidth;
        const column = box.minColumn + localColumn;
        const row = box.minRow + localRow;
        const point = pointAt(column, row);
        return (!boundary || boundary.kind === "rect" || GameContinuousGeometry.containsPoint(boundary, point))
          && values[row * width + column] * owner >= threshold;
      };
      for (let start = 0; start < labels.length; start++) {
        if (labels[start] || !matches(start)) continue;
        component++;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        labels[start] = component;
        while (head < tail) {
          const current = queue[head++];
          const row = Math.floor(current / areaWidth);
          const column = current - row * areaWidth;
          const candidates = [
            column > 0 ? current - 1 : -1,
            column + 1 < areaWidth ? current + 1 : -1,
            row > 0 ? current - areaWidth : -1,
            row + 1 < areaHeight ? current + areaWidth : -1
          ];
          for (const next of candidates) {
            if (next < 0 || labels[next] || !matches(next)) continue;
            labels[next] = component;
            queue[tail++] = next;
          }
        }
        if (tail > largestSize) {
          largestSize = tail;
          largestLabel = component;
        }
      }
      if (!largestLabel) return null;
      const rows = [];
      let firstColumn = width - 1;
      let lastColumn = 0;
      let firstRow = null;
      let lastRow = null;
      for (let localRow = 0; localRow < areaHeight; localRow++) {
        const spans = [];
        let start = null;
        for (let localColumn = 0; localColumn < areaWidth; localColumn++) {
          const included = labels[localRow * areaWidth + localColumn] === largestLabel;
          if (included && start == null) start = box.minColumn + localColumn;
          if ((!included || localColumn === areaWidth - 1) && start != null) {
            const end = included && localColumn === areaWidth - 1 ? box.minColumn + localColumn : box.minColumn + localColumn - 1;
            spans.push(start, end);
            firstColumn = Math.min(firstColumn, start);
            lastColumn = Math.max(lastColumn, end);
            firstRow ??= box.minRow + localRow;
            lastRow = box.minRow + localRow;
            start = null;
          }
        }
        rows.push(spans);
      }
      return GameContinuousGeometry.rasterMask({
        width, height, minColumn:firstColumn, maxColumn:lastColumn, minRow:firstRow, maxRow:lastRow,
        rows:rows.slice(firstRow-box.minRow,lastRow-box.minRow+1)
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

    return Object.freeze({
      width, height, sample, sampleRaster, apply, measure, analyze, touchesCircle,
      captureMask, largestComponentMask, hash, snapshot, consumeDirtyBounds
    });
  }

  global.GamePaintField = Object.freeze({
    controlScale: CONTROL_SCALE,
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    create
  });
})(window);
