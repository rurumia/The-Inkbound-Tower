(function createTerrainRenderer(global) {
  "use strict";

  function appendProjectedCircle(context, center, radius, camera, segments = 40) {
    for (let index = 0; index < segments; index++) {
      const angle = index / segments * Math.PI * 2;
      const point = camera.worldToScreen({
        x:center.x + Math.cos(angle) * radius,
        y:center.y + Math.sin(angle) * radius
      });
      if (!index) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
  }

  const RENDER_WIDTH = 960;
  const RENDER_HEIGHT = 480;
  const CRYSTAL_OVERFLOW_U = 0.12;
  const BACKGROUND_URL = "images/battle_scroll_field.webp";
  const BACKGROUND_WIDTH_SCALE = 1.36;
  const BACKGROUND_HEIGHT_SCALE = 1.16;
  const BACKGROUND_VISUAL_SCALE = 1.15;
  const BACKGROUND_OFFSET_Y_U = -0.5;
  const INK_EDGE_FEATHER_U = 1.25;
  const INK_TEXTURE_WIDTH = 1024;
  const INK_TEXTURE_HEIGHT = 512;
  const BACKGROUND_STRIP_COUNT = 96;
  const MATERIAL_STRIP_HEIGHT_PX = 2;
  const crystalGroupCache = new WeakMap();

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function hash2D(x, y) {
    let value = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967295;
  }

  function smoothstep(value) {
    const normalized = clamp01(value);
    return normalized * normalized * (3 - 2 * normalized);
  }

  function noise1D(value, seed) {
    const left = Math.floor(value);
    const progress = smoothstep(value - left);
    const first = hash2D(left, seed);
    return first + (hash2D(left + 1, seed) - first) * progress;
  }

  function inkDensity(player, worldX, worldY) {
    const seed = player ? 311 : 733;
    const bloom = noise1D(worldX * .46 + worldY * .19, seed);
    const flow = noise1D(worldY * 2.65 - worldX * .13, seed + 97);
    const grain = hash2D(Math.floor(worldX * 32), Math.floor(worldY * 32) + seed);
    return clamp01(.72 + bloom * .2 + flow * .08 + (grain - .5) * .08);
  }

  function inkTextureSample(control, worldX = 0, worldY = 0) {
    const player = control >= 0;
    const density = inkDensity(player, worldX, worldY);
    const base = player ? [22, 55, 83] : [98, 31, 52];
    const diluted = (1 - density) * 26;
    return {
      red: Math.round(base[0] + diluted),
      green: Math.round(base[1] + diluted * .82),
      blue: Math.round(base[2] + diluted * .68),
      alpha: Math.round(202 + density * 42),
      density
    };
  }

  function buildInkDensityTexture() {
    const texture = new Uint8Array(INK_TEXTURE_WIDTH * INK_TEXTURE_HEIGHT);
    for (let y = 0; y < INK_TEXTURE_HEIGHT; y++) {
      for (let x = 0; x < INK_TEXTURE_WIDTH; x++) {
        texture[y * INK_TEXTURE_WIDTH + x] = Math.round(inkDensity(true, x / 32, y / 32) * 255);
      }
    }
    return texture;
  }

  function singleEdgeAlpha(distance, tangent, seed) {
    const edgeJitter = .12 + noise1D(tangent * 1.7, seed) * .25 + noise1D(tangent * 5.1, seed + 149) * .1;
    return smoothstep((distance - edgeJitter) / INK_EDGE_FEATHER_U);
  }

  function inkEdgeAlpha(worldX, worldY) {
    let alpha = 1;
    const edgeLimit = INK_EDGE_FEATHER_U + .45;
    if (worldX < edgeLimit) alpha = Math.min(alpha, singleEdgeAlpha(worldX, worldY, 17));
    const rightDistance = global.GameWorldSpace.width - worldX;
    if (rightDistance < edgeLimit) alpha = Math.min(alpha, singleEdgeAlpha(rightDistance, worldY, 43));
    if (worldY < edgeLimit) alpha = Math.min(alpha, singleEdgeAlpha(worldY, worldX, 71));
    const bottomDistance = global.GameWorldSpace.height - worldY;
    if (bottomDistance < edgeLimit) alpha = Math.min(alpha, singleEdgeAlpha(bottomDistance, worldX, 101));
    return alpha;
  }

  function pack(red, green, blue) {
    return (Math.max(0, Math.min(255, Math.round(red))) << 16)
      | (Math.max(0, Math.min(255, Math.round(green))) << 8)
      | Math.max(0, Math.min(255, Math.round(blue)));
  }

  function shadeInk(control, worldX = 0, worldY = 0) {
    const coverage = clamp01(Math.abs(control));
    const paperRed = 229;
    const paperGreen = 213;
    const paperBlue = 167;
    const pigment = inkTextureSample(control, worldX, worldY);
    const opacity = coverage * pigment.alpha / 255;
    return pack(
      paperRed + (pigment.red - paperRed) * opacity,
      paperGreen + (pigment.green - paperGreen) * opacity,
      paperBlue + (pigment.blue - paperBlue) * opacity
    );
  }

  function shapeCenter(shape) {
    if (shape.center) return shape.center;
    if (shape.points?.length) return shape.points[Math.floor(shape.points.length / 2)];
    const bounds = global.GameContinuousGeometry.bounds(shape);
    return {x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2};
  }

  function crystalGroups(battle) {
    const regionSystem = battle.spatial?.regions;
    const cacheKey = regionSystem || battle;
    const version = regionSystem?.version?.("crystal") ?? null;
    const cached = crystalGroupCache.get(cacheKey);
    if (version != null && cached?.version === version) return cached.groups;
    const entries = regionSystem?.list
      ? regionSystem.list("crystal").map(region => ({id: region.id, owner: region.owner || 0, shape: region.shape}))
      : (battle.cells || []).filter(cell => cell.crystal).map(cell => ({
        id: `crystal-${cell.r}-${cell.c}`,
        owner: cell.owner === 2 ? -1 : cell.owner,
        shape: global.GameContinuousGeometry.circle(global.GameBattlefieldAdapter.cellToWorld(cell), 0.52)
      }));
    const parents = entries.map((_, index) => index);
    const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
    const unite = (left, right) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    const bridges = [];
    for (let left = 0; left < entries.length; left++) {
      const first = entries[left];
      for (let right = left + 1; right < entries.length; right++) {
        const second = entries[right];
        if (first.owner !== second.owner) continue;
        if (first.shape.kind === "circle" && second.shape.kind === "circle") {
          const distance = global.GameWorldSpace.distance(first.shape.center, second.shape.center);
          if (distance > first.shape.radius + second.shape.radius + 0.2) continue;
          unite(left, right);
          bridges.push({
            left,
            right,
            shape: global.GameContinuousGeometry.pathStroke(
              [first.shape.center, second.shape.center],
              Math.min(first.shape.radius, second.shape.radius) * 0.9
            )
          });
          continue;
        }
        const firstBounds = global.GameContinuousGeometry.bounds(first.shape);
        const secondBounds = global.GameContinuousGeometry.bounds(second.shape);
        const gapX = Math.max(0, firstBounds.minX - secondBounds.maxX, secondBounds.minX - firstBounds.maxX);
        const gapY = Math.max(0, firstBounds.minY - secondBounds.maxY, secondBounds.minY - firstBounds.maxY);
        if (Math.hypot(gapX, gapY) <= 1 / 32) unite(left, right);
      }
    }
    const grouped = new Map();
    entries.forEach((entry, index) => {
      const root = find(index);
      if (!grouped.has(root)) grouped.set(root, {id: entry.id, owner: entry.owner, shapes: []});
      grouped.get(root).shapes.push(entry.shape);
    });
    for (const bridge of bridges) grouped.get(find(bridge.left)).shapes.push(bridge.shape);
    const groups = [...grouped.values()].map(group => {
      const boxes = group.shapes.map(shape => global.GameContinuousGeometry.bounds(shape));
      const bounds = {
        minX: Math.min(...boxes.map(box => box.minX)),
        maxX: Math.max(...boxes.map(box => box.maxX)),
        minY: Math.min(...boxes.map(box => box.minY)),
        maxY: Math.max(...boxes.map(box => box.maxY))
      };
      return Object.freeze({...group, shapes: Object.freeze(group.shapes), bounds: Object.freeze(bounds)});
    });
    const frozen = Object.freeze(groups);
    crystalGroupCache.set(cacheKey, {version, groups: frozen});
    return frozen;
  }

  function shadeCrystal(owner, worldX, worldY, group = null) {
    const x = Math.floor(worldX * 5);
    const y = Math.floor(worldY * 5);
    const variation = hash2D(x, y) * 0.24 - 0.1;
    const seam = ((x + y * 3) & 7) === 0 ? 34 : 0;
    const base = owner === 0 ? [229, 213, 167] : owner > 0 ? [67, 164, 202] : [174, 82, 140];
    return pack(
      base[0] * (0.9 + variation) + seam,
      base[1] * (0.9 + variation) + seam,
      base[2] * (0.92 + variation) + seam
    );
  }

  function create(options) {
    const context = options.context;
    const camera = options.camera;
    let sourceCanvas = null;
    let sourceContext = null;
    let inkCanvas = null;
    let inkContext = null;
    let crystalCanvas = null;
    let crystalContext = null;
    let maskCanvas = null;
    let maskContext = null;
    let groupCanvas = null;
    let groupContext = null;
    let backgroundImage = null;
    let backgroundReady = false;
    let backgroundFailed = false;
    let sourceReady = false;
    let renderedCrystalVersion = null;
    const inkDensityTexture = buildInkDensityTexture();
    const renderStats = {
      fullRedraws: 0, partialRedraws: 0, crystalRebuilds: 0, backgroundDraws: 0,
      lastMode: "none", lastRasterPixels: 0, lastRenderMs: 0
    };

    function makeCanvas(documentRef) {
      const canvas = documentRef.createElement("canvas");
      return {canvas, context: canvas.getContext("2d")};
    }

    function requestBackground(documentRef) {
      if (backgroundImage || backgroundFailed) return;
      const ImageConstructor = global.Image;
      backgroundImage = ImageConstructor ? new ImageConstructor() : documentRef.createElement?.("img");
      if (!backgroundImage) {
        backgroundFailed = true;
        return;
      }
      backgroundImage.onload = () => {
        backgroundReady = true;
        sourceReady = false;
        if (typeof options.onInvalidate === "function") {
          (global.requestAnimationFrame || (callback => callback()))(() => options.onInvalidate());
        }
      };
      backgroundImage.onerror = () => {
        backgroundFailed = true;
        backgroundImage = null;
      };
      backgroundImage.src = BACKGROUND_URL;
    }

    function ensureSource(documentRef, width = RENDER_WIDTH, height = RENDER_HEIGHT) {
      if (!sourceCanvas) {
        ({canvas: sourceCanvas, context: sourceContext} = makeCanvas(documentRef));
        ({canvas: inkCanvas, context: inkContext} = makeCanvas(documentRef));
        ({canvas: crystalCanvas, context: crystalContext} = makeCanvas(documentRef));
        ({canvas: maskCanvas, context: maskContext} = makeCanvas(documentRef));
        ({canvas: groupCanvas, context: groupContext} = makeCanvas(documentRef));
        requestBackground(documentRef);
      }
      if (sourceCanvas.width === width && sourceCanvas.height === height) return false;
      for (const canvas of [sourceCanvas, inkCanvas, crystalCanvas, maskCanvas, groupCanvas]) {
        canvas.width = width;
        canvas.height = height;
      }
      sourceReady = false;
      renderedCrystalVersion = null;
      return true;
    }

    function rasterPoint(point, width, height) {
      return {x: point.x / global.GameWorldSpace.width * width, y: point.y / global.GameWorldSpace.height * height};
    }

    function drawShapeMask(target, shape, width, height, overflowU = 0) {
      const scaleX = width / global.GameWorldSpace.width;
      const scaleY = height / global.GameWorldSpace.height;
      target.fillStyle = "#fff";
      target.strokeStyle = "#fff";
      target.lineCap = "round";
      target.lineJoin = "miter";
      if (shape.kind === "circle") {
        const center = rasterPoint(shape.center, width, height);
        const radiusX = (shape.radius + overflowU) * scaleX;
        const radiusY = (shape.radius + overflowU) * scaleY;
        target.beginPath();
        for (let index = 0; index < 24; index++) {
          const angle = index / 24 * Math.PI * 2;
          const shard = overflowU ? 0.82 + hash2D(index, Math.floor(shape.center.x * 11 + shape.center.y * 17)) * 0.3 : 1;
          const x = center.x + Math.cos(angle) * radiusX * shard;
          const y = center.y + Math.sin(angle) * radiusY * shard;
          if (!index) target.moveTo(x, y); else target.lineTo(x, y);
        }
        target.closePath();
        target.fill();
        return;
      }
      if (shape.kind === "rect") {
        const center = rasterPoint(shape.center, width, height);
        const left = center.x - (shape.width / 2 + overflowU) * scaleX;
        const right = center.x + (shape.width / 2 + overflowU) * scaleX;
        const top = center.y - (shape.height / 2 + overflowU) * scaleY;
        const bottom = center.y + (shape.height / 2 + overflowU) * scaleY;
        const jitterX = overflowU * scaleX * 0.45;
        const jitterY = overflowU * scaleY * 0.45;
        const seed = Math.floor(shape.center.x * 13 + shape.center.y * 29);
        target.beginPath();
        for (let index = 0; index <= 6; index++) {
          const x = left + (right - left) * index / 6;
          const y = top + (overflowU ? (hash2D(index, seed) - .5) * jitterY : 0);
          if (!index) target.moveTo(x, y); else target.lineTo(x, y);
        }
        for (let index = 1; index <= 4; index++) target.lineTo(
          right + (overflowU ? (hash2D(seed, index) - .5) * jitterX : 0), top + (bottom - top) * index / 4);
        for (let index = 1; index <= 6; index++) target.lineTo(
          right - (right - left) * index / 6, bottom + (overflowU ? (hash2D(index + 7, seed) - .5) * jitterY : 0));
        for (let index = 1; index <= 4; index++) target.lineTo(
          left + (overflowU ? (hash2D(seed, index + 7) - .5) * jitterX : 0), bottom - (bottom - top) * index / 4);
        target.closePath(); target.fill();
        return;
      }
      if (shape.kind === "brushStamp") {
        const center = rasterPoint(shape.center, width, height);
        target.beginPath();
        target.ellipse(center.x, center.y,
          (shape.length / 2 + overflowU) * scaleX,
          (shape.width / 2 + overflowU) * scaleY,
          shape.angle, 0, Math.PI * 2);
        target.fill();
        return;
      }
      if (shape.kind === "brushStroke") {
        const points = shape.outline.map(point => rasterPoint(point, width, height));
        target.beginPath();
        target.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) target.lineTo(point.x, point.y);
        target.closePath();
        target.fill();
        return;
      }
      if (shape.kind === "pathStroke") {
        const points = shape.points.map(point => rasterPoint(point, width, height));
        target.beginPath();
        target.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) target.lineTo(point.x, point.y);
        target.lineWidth = (shape.radius + overflowU) * (scaleX + scaleY);
        target.stroke();
        return;
      }
      if (shape.kind === "rasterMask") {
        const growX = overflowU * scaleX;
        const growY = overflowU * scaleY;
        for (const rect of shape.rects) {
          const x = rect.minColumn / shape.width * width;
          const y = rect.minRow / shape.height * height;
          const right = (rect.maxColumn + 1) / shape.width * width;
          const bottom = (rect.maxRow + 1) / shape.height * height;
          target.fillRect(x - growX, y - growY, right - x + growX * 2, bottom - y + growY * 2);
        }
      }
    }

    function crystalPalette(owner) {
      if (owner === 0) return {base:[229,213,167], dark:[185,166,124], light:[255,244,204]};
      if (owner > 0) return {base:[67,164,202], dark:[30,103,151], light:[170,237,255]};
      return {base:[174,82,140], dark:[112,43,105], light:[255,181,225]};
    }

    function rgba(color, alpha = 1) {
      return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
    }

    function rebuildCrystalLayer(battle, width, height) {
      crystalContext.clearRect(0, 0, width, height);
      const scaleX = width / global.GameWorldSpace.width;
      const scaleY = height / global.GameWorldSpace.height;
      for (const group of crystalGroups(battle)) {
        maskContext.clearRect(0, 0, width, height);
        groupContext.clearRect(0, 0, width, height);
        for (const shape of group.shapes) drawShapeMask(maskContext, shape, width, height, CRYSTAL_OVERFLOW_U);

        const box = group.bounds;
        const left = Math.max(0, Math.floor((box.minX - CRYSTAL_OVERFLOW_U) * scaleX));
        const right = Math.min(width, Math.ceil((box.maxX + CRYSTAL_OVERFLOW_U) * scaleX));
        const top = Math.max(0, Math.floor((box.minY - CRYSTAL_OVERFLOW_U) * scaleY));
        const bottom = Math.min(height, Math.ceil((box.maxY + CRYSTAL_OVERFLOW_U) * scaleY));
        const palette = crystalPalette(group.owner);
        groupContext.fillStyle = rgba(palette.base, 0.96);
        groupContext.fillRect(left, top, right - left, bottom - top);

        const facet = Math.max(12, Math.round(scaleX * 0.9));
        for (let y = top - facet; y < bottom + facet; y += facet) {
          for (let x = left - facet; x < right + facet; x += facet) {
            const column = Math.floor(x / facet);
            const row = Math.floor(y / facet);
            const diagonal = hash2D(column * 3, row * 5) > .5;
            const firstLight = hash2D(column, row) > .52;
            const secondLight = hash2D(column + 19, row - 11) > .58;
            groupContext.fillStyle = rgba(firstLight ? palette.light : palette.dark, firstLight ? 0.3 : 0.22);
            groupContext.beginPath();
            if (diagonal) {
              groupContext.moveTo(x, y); groupContext.lineTo(x + facet, y); groupContext.lineTo(x, y + facet);
            } else {
              groupContext.moveTo(x + facet, y); groupContext.lineTo(x + facet, y + facet); groupContext.lineTo(x, y + facet);
            }
            groupContext.closePath(); groupContext.fill();
            groupContext.fillStyle = rgba(secondLight ? palette.light : palette.dark, secondLight ? 0.2 : 0.14);
            groupContext.beginPath();
            if (diagonal) {
              groupContext.moveTo(x + facet, y); groupContext.lineTo(x + facet, y + facet); groupContext.lineTo(x, y + facet);
            } else {
              groupContext.moveTo(x, y); groupContext.lineTo(x + facet, y); groupContext.lineTo(x, y + facet);
            }
            groupContext.closePath(); groupContext.fill();
            groupContext.strokeStyle = rgba(palette.light, 0.24);
            groupContext.lineWidth = 1;
            groupContext.stroke();
          }
        }
        groupContext.globalCompositeOperation = "destination-in";
        groupContext.drawImage(maskCanvas, 0, 0);
        groupContext.globalCompositeOperation = "source-over";
        crystalContext.drawImage(groupCanvas, 0, 0);
      }
      renderStats.crystalRebuilds++;
    }

    function renderInkArea(paintField, width, height, area) {
      const started = global.performance?.now?.() ?? Date.now();
      const areaWidth = area.maxX - area.minX + 1;
      const areaHeight = area.maxY - area.minY + 1;
      const image = inkContext.createImageData(areaWidth, areaHeight);
      const data = image.data;
      const edgeBandX = (INK_EDGE_FEATHER_U + .45) / global.GameWorldSpace.width * width;
      const edgeBandY = (INK_EDGE_FEATHER_U + .45) / global.GameWorldSpace.height * height;
      for (let y = area.minY; y <= area.maxY; y++) {
        for (let x = area.minX; x <= area.maxX; x++) {
          const control = paintField.sampleRaster(x, y, width, height);
          const coverage = clamp01(Math.abs(control));
          const nearEdge = x < edgeBandX || x >= width - edgeBandX || y < edgeBandY || y >= height - edgeBandY;
          const edgeAlpha = coverage && nearEdge ? inkEdgeAlpha(
            (x + .5) / width * global.GameWorldSpace.width,
            (y + .5) / height * global.GameWorldSpace.height
          ) : 1;
          const index = ((y - area.minY) * areaWidth + x - area.minX) * 4;
          if (!coverage) {
            data[index + 3] = 0;
            continue;
          }
          const worldX = (x + .5) / width * global.GameWorldSpace.width;
          const worldY = (y + .5) / height * global.GameWorldSpace.height;
          const player = control >= 0;
          const textureX = (x + (player ? 0 : 389)) & (INK_TEXTURE_WIDTH - 1);
          const textureY = (y + (player ? 0 : 137)) & (INK_TEXTURE_HEIGHT - 1);
          const density = inkDensityTexture[textureY * INK_TEXTURE_WIDTH + textureX] / 255;
          const diluted = (1 - density) * 26;
          data[index] = Math.round((player ? 22 : 98) + diluted);
          data[index + 1] = Math.round((player ? 55 : 31) + diluted * .82);
          data[index + 2] = Math.round((player ? 83 : 52) + diluted * .68);
          data[index + 3] = Math.round(coverage * edgeAlpha * (202 + density * 42));
        }
      }
      inkContext.putImageData(image, area.minX, area.minY);
      const full = areaWidth === width && areaHeight === height;
      renderStats.fullRedraws += full ? 1 : 0;
      renderStats.partialRedraws += full ? 0 : 1;
      renderStats.lastMode = full ? "full" : "partial";
      renderStats.lastRasterPixels = areaWidth * areaHeight;
      renderStats.lastRenderMs = (global.performance?.now?.() ?? Date.now()) - started;
    }

    function composeArea(area, width, height) {
      const areaWidth = area.maxX - area.minX + 1;
      const areaHeight = area.maxY - area.minY + 1;
      sourceContext.clearRect(area.minX, area.minY, areaWidth, areaHeight);
      sourceContext.drawImage(inkCanvas, area.minX, area.minY, areaWidth, areaHeight,
        area.minX, area.minY, areaWidth, areaHeight);
      sourceContext.drawImage(crystalCanvas, area.minX, area.minY, areaWidth, areaHeight,
        area.minX, area.minY, areaWidth, areaHeight);
      sourceReady = true;
    }

    function draw(battle, size, documentRef = global.document) {
      const paintField = battle.spatial?.paint;
      const widthLimit = paintField?.width || global.GamePaintField?.defaultWidth || RENDER_WIDTH;
      const desiredWidth = Math.min(widthLimit, Math.max(RENDER_WIDTH, Math.round(size.physicalWidth || size.width)));
      const heightLimit = paintField?.height || global.GamePaintField?.defaultHeight || RENDER_HEIGHT;
      const desiredHeight = Math.min(heightLimit, Math.max(RENDER_HEIGHT, Math.round(desiredWidth / 2)));
      const resized = ensureSource(documentRef, desiredWidth, desiredHeight);
      const width = sourceCanvas.width;
      const height = sourceCanvas.height;
      const dirty = paintField?.consumeDirtyBounds?.() || null;
      const crystalVersion = battle.spatial?.regions?.version?.("crystal") ?? 0;
      const crystalChanged = renderedCrystalVersion !== crystalVersion;
      if (crystalChanged) rebuildCrystalLayer(battle, width, height);
      const forceFull = resized || !sourceReady || !paintField || crystalChanged;
      let area = null;
      if (forceFull) area = {minX: 0, minY: 0, maxX: width - 1, maxY: height - 1};
      else if (dirty) area = {
        minX: Math.max(0, Math.floor(dirty.minColumn / paintField.width * width) - 3),
        maxX: Math.min(width - 1, Math.ceil((dirty.maxColumn + 1) / paintField.width * width) + 3),
        minY: Math.max(0, Math.floor(dirty.minRow / paintField.height * height) - 3),
        maxY: Math.min(height - 1, Math.ceil((dirty.maxRow + 1) / paintField.height * height) + 3)
      };
      if (area) {
        renderInkArea(paintField, width, height, area);
        composeArea(area, width, height);
      }
      else {
        renderStats.lastMode = "cached";
        renderStats.lastRasterPixels = 0;
        renderStats.lastRenderMs = 0;
      }
      renderedCrystalVersion = crystalVersion;

      context.clearRect(0, 0, size.width, size.height);
      context.fillStyle = "#171716";
      context.fillRect(0, 0, size.width, size.height);
      context.save();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      if (backgroundReady && backgroundImage?.naturalWidth) {
        renderStats.backgroundDraws++;
        const worldWidth = global.GameWorldSpace.width * BACKGROUND_WIDTH_SCALE * BACKGROUND_VISUAL_SCALE;
        const worldHeight = worldWidth * backgroundImage.naturalHeight / backgroundImage.naturalWidth;
        const worldLeft = (global.GameWorldSpace.width - worldWidth) / 2;
        const worldTop = (global.GameWorldSpace.height - worldHeight) / 2 + BACKGROUND_OFFSET_Y_U;
        for (let strip = 0; strip < BACKGROUND_STRIP_COUNT; strip++) {
          const sourceY = strip / BACKGROUND_STRIP_COUNT * backgroundImage.naturalHeight;
          const sourceBottom = (strip + 1) / BACKGROUND_STRIP_COUNT * backgroundImage.naturalHeight;
          const topY = worldTop + strip / BACKGROUND_STRIP_COUNT * worldHeight;
          const bottomY = worldTop + (strip + 1) / BACKGROUND_STRIP_COUNT * worldHeight;
          const middleY = (topY + bottomY) / 2;
          const left = camera.worldToScreen({x: worldLeft, y: middleY});
          const right = camera.worldToScreen({x: worldLeft + worldWidth, y: middleY});
          const screenTop = camera.worldToScreen({x: global.GameWorldSpace.width / 2, y: topY}).y;
          const screenBottom = camera.worldToScreen({x: global.GameWorldSpace.width / 2, y: bottomY}).y;
          context.drawImage(backgroundImage, 0, sourceY, backgroundImage.naturalWidth, sourceBottom - sourceY,
            left.x, screenTop, right.x - left.x, screenBottom - screenTop + 0.5);
        }
      }
      const materialTop = camera.worldToScreen({x:global.GameWorldSpace.width / 2,y:0}).y;
      const materialBottom = camera.worldToScreen({x:global.GameWorldSpace.width / 2,y:global.GameWorldSpace.height}).y;
      const firstScreenRow = Math.floor(materialTop);
      const lastScreenRow = Math.ceil(materialBottom);
      const centerScreenX = camera.worldToScreen({x:global.GameWorldSpace.width / 2,y:0}).x;
      for (let screenRow = firstScreenRow; screenRow < lastScreenRow; screenRow += MATERIAL_STRIP_HEIGHT_PX) {
        const screenTop = Math.max(materialTop, screenRow);
        const screenBottom = Math.min(materialBottom, screenRow + MATERIAL_STRIP_HEIGHT_PX);
        if (screenBottom <= screenTop) continue;
        const sourceY = camera.screenToWorld({x:centerScreenX,y:screenTop}).y /
          global.GameWorldSpace.height * height;
        const sourceBottom = camera.screenToWorld({x:centerScreenX,y:screenBottom}).y /
          global.GameWorldSpace.height * height;
        const middleY = camera.screenToWorld({x:centerScreenX,y:(screenTop + screenBottom) / 2}).y;
        const left = camera.worldToScreen({x: 0, y: middleY});
        const right = camera.worldToScreen({x: global.GameWorldSpace.width, y: middleY});
        context.drawImage(sourceCanvas, 0, sourceY, width, sourceBottom - sourceY,
          left.x, screenTop, right.x - left.x, screenBottom - screenTop);
      }
      for (const cell of battle.cells) {
        if (!cell.purified) continue;
        const position = global.GameBattlefieldAdapter.cellToWorld(cell);
        context.fillStyle = "rgba(82,224,161,.22)";
        context.beginPath(); appendProjectedCircle(context, position, .48, camera); context.fill();
      }
      context.restore();
    }

    return Object.freeze({
      draw,
      resolution: () => Object.freeze({width: sourceCanvas?.width || RENDER_WIDTH, height: sourceCanvas?.height || RENDER_HEIGHT}),
      diagnostics: () => Object.freeze({
        ...renderStats, backgroundReady, backgroundUrl: BACKGROUND_URL,
        backgroundWidthScale: BACKGROUND_WIDTH_SCALE,
        backgroundHeightScale: BACKGROUND_HEIGHT_SCALE,
        backgroundVisualScale: BACKGROUND_VISUAL_SCALE,
        backgroundOffsetYU: BACKGROUND_OFFSET_Y_U,
        backgroundStripCount: BACKGROUND_STRIP_COUNT,
        materialStripHeightPx: MATERIAL_STRIP_HEIGHT_PX,
        inkEdgeMode: "brush-soft",
        inkEdgeFeatherU: INK_EDGE_FEATHER_U,
        inkTextureLookup: true,
        battlefieldOutline: false
      })
    });
  }

  global.GameContinuousTerrainRenderer = Object.freeze({
    renderWidth: RENDER_WIDTH,
    renderHeight: RENDER_HEIGHT,
    materialVersion: 5,
    inkMode: "fibered-wash",
    inkEdgeMode: "brush-soft",
    inkEdgeFeatherU: INK_EDGE_FEATHER_U,
    battlefieldOutline: false,
    backgroundUrl: BACKGROUND_URL,
    backgroundWidthScale: BACKGROUND_WIDTH_SCALE,
    backgroundHeightScale: BACKGROUND_HEIGHT_SCALE,
    backgroundVisualScale: BACKGROUND_VISUAL_SCALE,
    backgroundOffsetYU: BACKGROUND_OFFSET_Y_U,
    backgroundStripCount: BACKGROUND_STRIP_COUNT,
    materialStripHeightPx: MATERIAL_STRIP_HEIGHT_PX,
    crystalOverflowU: CRYSTAL_OVERFLOW_U,
    hash2D,
    inkTextureSample,
    inkEdgeAlpha,
    shadeInk,
    shadeCrystal,
    crystalGroups,
    create
  });
})(window);
