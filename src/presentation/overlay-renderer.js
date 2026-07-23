(function createOverlayRenderer(global) {
  "use strict";

  const WELL_VISUAL_SIZE_U = 2.2;

  function projectedCirclePoints(center, radius, camera, segments = 48) {
    return Array.from({length:segments}, (_, index) => {
      const angle = index / segments * Math.PI * 2;
      return camera.worldToScreen({
        x:center.x + Math.cos(angle) * radius,
        y:center.y + Math.sin(angle) * radius
      });
    });
  }

  function appendProjectedCircle(context, center, radius, camera, segments = 48) {
    const points = projectedCirclePoints(center, radius, camera, segments);
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.closePath();
  }

  function appendShape(context, shape, camera) {
    if (shape.kind === "circle") {
      appendProjectedCircle(context, shape.center, shape.radius, camera);
      return;
    }
    if (shape.kind === "rect") {
      const points = [
        {x: shape.center.x - shape.width / 2, y: shape.center.y - shape.height / 2},
        {x: shape.center.x + shape.width / 2, y: shape.center.y - shape.height / 2},
        {x: shape.center.x + shape.width / 2, y: shape.center.y + shape.height / 2},
        {x: shape.center.x - shape.width / 2, y: shape.center.y + shape.height / 2}
      ].map(camera.worldToScreen);
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
      return;
    }
    if (shape.kind === "brushStamp") {
      const cosine = Math.cos(shape.angle), sine = Math.sin(shape.angle);
      const points = Array.from({length:48}, (_, index) => {
        const angle = index / 48 * Math.PI * 2;
        const localX = Math.cos(angle) * shape.length / 2;
        const localY = Math.sin(angle) * shape.width / 2;
        return camera.worldToScreen({
          x:shape.center.x + localX * cosine - localY * sine,
          y:shape.center.y + localX * sine + localY * cosine
        });
      });
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
      return;
    }
    if (shape.kind === "brushStroke") {
      const points = shape.outline.map(camera.worldToScreen);
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
      return;
    }
    if (shape.kind === "pathStroke") {
      for (const point of shape.points) appendProjectedCircle(context, point, shape.radius, camera, 32);
      for (let index = 1; index < shape.points.length; index++) {
        const from = shape.points[index - 1], to = shape.points[index];
        const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const normal = {x:-(to.y - from.y) / length * shape.radius,y:(to.x - from.x) / length * shape.radius};
        const strip = [
          {x:from.x+normal.x,y:from.y+normal.y},{x:to.x+normal.x,y:to.y+normal.y},
          {x:to.x-normal.x,y:to.y-normal.y},{x:from.x-normal.x,y:from.y-normal.y}
        ].map(camera.worldToScreen);
        context.moveTo(strip[0].x, strip[0].y);
        for (const point of strip.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
      }
      return;
    }
    if (shape.kind === "rasterMask") {
      for (const rect of shape.rects) {
        const left = rect.minColumn / shape.width * global.GameWorldSpace.width;
        const right = (rect.maxColumn + 1) / shape.width * global.GameWorldSpace.width;
        const top = rect.minRow / shape.height * global.GameWorldSpace.height;
        const bottom = (rect.maxRow + 1) / shape.height * global.GameWorldSpace.height;
        const points = [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(camera.worldToScreen);
        context.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
      }
    }
  }

  function traceShape(context, shape, camera) {
    context.beginPath();
    appendShape(context, shape, camera);
  }

  function traceShapes(context, shapes, camera) {
    context.beginPath();
    for (const shape of shapes) appendShape(context, shape, camera);
  }

  function screenBounds(world, camera) {
    const points = [
      {x:world.minX,y:world.minY},{x:world.maxX,y:world.minY},
      {x:world.maxX,y:world.maxY},{x:world.minX,y:world.maxY}
    ].map(camera.worldToScreen);
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return {
      left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys),
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
      centerY: (Math.min(...ys) + Math.max(...ys)) / 2
    };
  }

  function shapeBounds(shape, camera) {
    return screenBounds(global.GameContinuousGeometry.bounds(shape), camera);
  }

  function regionCenter(shape) {
    if (shape.center) return shape.center;
    if (shape.points?.length) return shape.points[Math.floor(shape.points.length / 2)];
    const bounds = global.GameContinuousGeometry.bounds(shape);
    return {x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2};
  }

  function wellStateFrame(well) {
    if ((well.pending ?? well.pendingOwner ?? 0) !== 0) return 3;
    if (well.owner === 1) return 1;
    if (well.owner === 2 || well.owner === -1) return 2;
    return 0;
  }

  function previewTouchesUnit(preview, unit) {
    if (preview?.kind !== "circle" || unit?.dead) return false;
    const bodyRadius = unit.body?.radius ?? .35;
    return global.GameWorldSpace.distance(global.GameBattlefieldAdapter.unitPosition(unit), preview.center)
      <= preview.radiusU + bodyRadius;
  }

  function summonIntentPreview(battle) {
    const intent = battle?.intents?.[0];
    if (intent?.cardTarget !== "summon" || !intent.target) return null;
    const center = global.GameBattlefieldAdapter.cellToWorld(intent.target);
    if (!center || center.x < global.GameWorldSpace.width / 2) return null;
    return Object.freeze({
      center,
      radiusU: .82,
      name: intent.name || "?",
      meaningful: intent.meaningful !== false
    });
  }

  function summonIntentAtPoint(battle, worldPoint) {
    const preview = summonIntentPreview(battle);
    if (!preview || !worldPoint) return null;
    return global.GameWorldSpace.distance(preview.center, worldPoint) <= preview.radiusU
      ? battle.intents[0]
      : null;
  }

  function create(options) {
    const context = options.context;
    const camera = options.camera;
    const effectCache = new Map();
    const wellSprite = global.Image ? new global.Image() : null;
    if (wellSprite) wellSprite.src = "images/ink_well_states_transparent.png";

    function circle(point, radius, fill, stroke = "#fff") {
      const screen = camera.worldToScreen(point);
      context.beginPath(); context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.fillStyle = fill; context.fill();
      context.strokeStyle = stroke; context.lineWidth = 1.5; context.stroke();
      return screen;
    }

    function drawWellFrame(frame, screen, size, alpha) {
      if (!wellSprite?.complete || !wellSprite.naturalWidth || alpha <= 0) return false;
      const frameWidth = wellSprite.naturalWidth / 4;
      context.save();
      context.globalAlpha = alpha;
      context.imageSmoothingEnabled = false;
      context.drawImage(wellSprite, frame * frameWidth, 0, frameWidth, wellSprite.naturalHeight,
        screen.x - size / 2, screen.y - size / 2, size, size);
      context.restore();
      return true;
    }

    function drawWell(well, position, scale) {
      const screen = camera.worldToScreen(position);
      const frame = wellStateFrame(well);
      const size = scale * WELL_VISUAL_SIZE_U;
      const rendered = drawWellFrame(frame, screen, size, 1);
      if (!rendered) circle(position, scale * .45,
        well.owner === 1 ? "#58a9ef" : well.owner === 2 ? "#d65b83" : "#d1ae4e");
      return screen;
    }

    function previewUnitIds(battle) {
      const preview = battle._targetPreview;
      if (preview?.kind !== "circle") return new Set();
      return new Set(battle.units.filter(unit => previewTouchesUnit(preview, unit)).map(unit => unit.id));
    }

    function effectRegions(battle, type, cellFlag) {
      const regionSystem = battle.spatial?.regions;
      if (regionSystem?.list) {
        const version = `${regionSystem.version?.(type) ?? "legacy"}:${type === "study" ? regionSystem.version?.("crystal") ?? "legacy" : 0}`;
        const cached = effectCache.get(type);
        if (cached?.system === regionSystem && cached.version === version) return cached.regions;
        const regions = regionSystem.list(type)
          .map(region => ({shape: region.shape, owner: region.owner ?? 0, id: region.id}));
        effectCache.set(type, {system: regionSystem, version, regions});
        return regions;
      }
      const regions = [];
      for (const cell of battle.cells || []) {
        if (!cell[cellFlag]) continue;
        const center = global.GameBattlefieldAdapter.cellToWorld(cell);
        if (regions.some(region => global.GameContinuousGeometry.containsPoint(region.shape, center))) continue;
        regions.push({
          shape: global.GameContinuousGeometry.circle(center, 0.52),
          owner: cell.owner === 2 ? -1 : cell.owner,
          id: `${type}-${cell.r}-${cell.c}`
        });
      }
      return regions;
    }

    function strokeRegion(shape, color, width, blur = 0) {
      context.save();
      traceShape(context, shape, camera);
      context.strokeStyle = color;
      context.lineWidth = width;
      context.shadowColor = color;
      context.shadowBlur = blur;
      context.stroke();
      context.restore();
    }

    function drawSpellBlockRegions(battle) {
      for (const region of effectRegions(battle, "spellBlock", "spellBlocked")) {
        const scale = camera.scaleAt(regionCenter(region.shape));
        const bounds = shapeBounds(region.shape, camera);
        context.save();
        traceShape(context, region.shape, camera);
        const veil = context.createRadialGradient(
          bounds.centerX, bounds.centerY, 0,
          bounds.centerX, bounds.centerY, Math.max(1, Math.max(bounds.right-bounds.left,bounds.bottom-bounds.top)/2)
        );
        veil.addColorStop(0, "rgba(16,18,28,.34)");
        veil.addColorStop(.72, "rgba(31,24,43,.42)");
        veil.addColorStop(1, "rgba(8,9,16,.56)");
        context.fillStyle = veil;
        context.fill();
        context.setLineDash([Math.max(4,scale*.22),Math.max(3,scale*.14)]);
        context.strokeStyle = "rgba(210,188,230,.78)";
        context.lineWidth = Math.max(1.2,scale*.065);
        context.stroke();
        context.restore();
      }
    }

    function drawStudyRegions(battle, now) {
      for (const region of effectRegions(battle, "study", "studied")) {
        const scale = camera.scaleAt(regionCenter(region.shape));
        const bounds = shapeBounds(region.shape, camera);
        const width = Math.max(1, bounds.right - bounds.left);
        const height = Math.max(1, bounds.bottom - bounds.top);
        const spacing = Math.max(7, scale * 0.34);
        const flow = now * 0.018 % spacing;
        context.save();
        traceShape(context, region.shape, camera);
        context.clip();
        const glow = context.createRadialGradient(
          bounds.centerX, bounds.centerY, 0,
          bounds.centerX, bounds.centerY, Math.max(width, height) * 0.7
        );
        glow.addColorStop(0, "rgba(232,205,111,.28)");
        glow.addColorStop(0.52, "rgba(44,155,142,.2)");
        glow.addColorStop(1, "rgba(12,69,73,.14)");
        context.fillStyle = glow;
        context.fillRect(bounds.left, bounds.top, width, height);

        context.strokeStyle = "rgba(244,220,134,.3)";
        context.lineWidth = Math.max(0.7, scale * 0.035);
        for (let offset = -height; offset < width + height; offset += spacing) {
          context.beginPath();
          context.moveTo(bounds.left + offset + flow, bounds.bottom);
          context.lineTo(bounds.left + offset + height + flow, bounds.top);
          context.stroke();
        }

        context.fillStyle = "rgba(114,232,210,.46)";
        const dotStep = spacing * 1.65;
        for (let y = bounds.top + dotStep / 2; y < bounds.bottom; y += dotStep) {
          for (let x = bounds.left + dotStep / 2 + flow; x < bounds.right; x += dotStep) {
            const radius = Math.max(1, scale * 0.045);
            context.save();
            context.translate(x, y);
            context.rotate(Math.PI / 4 + now * 0.00012);
            context.fillRect(-radius, -radius, radius * 2, radius * 2);
            context.restore();
          }
        }

        context.strokeStyle = "rgba(255,232,157,.42)";
        context.lineWidth = Math.max(0.8, scale * 0.04);
        const pulse = 0.68 + Math.sin(now * 0.0018) * 0.08;
        for (const ratio of [0.28, 0.5, pulse]) {
          context.beginPath();
          context.arc(bounds.centerX, bounds.centerY, Math.min(width, height) * ratio, now * 0.00025, now * 0.00025 + Math.PI * 1.55);
          context.stroke();
        }
        context.restore();
        strokeRegion(region.shape, "rgba(34,127,126,.84)", Math.max(2.4, scale * 0.13), Math.max(4, scale * 0.25));
        strokeRegion(region.shape, "rgba(247,218,125,.92)", Math.max(1, scale * 0.055));
      }
    }

    function draw(battle, size, now = 0) {
      context.clearRect(0, 0, size.width, size.height);
      drawSpellBlockRegions(battle);
      drawStudyRegions(battle, now);
      const highlightedUnits = previewUnitIds(battle);

      const summonPreview = summonIntentPreview(battle);
      if (summonPreview) {
        const screen = camera.worldToScreen(summonPreview.center);
        const scale = camera.scaleAt(summonPreview.center);
        const color = summonPreview.meaningful ? "rgba(223,226,233,.9)" : "rgba(239,126,139,.88)";
        context.save();
        context.setLineDash([Math.max(4, scale * .24), Math.max(3, scale * .18)]);
        context.lineDashOffset = -now / 55;
        context.beginPath();
        appendProjectedCircle(context, summonPreview.center, summonPreview.radiusU, camera, 56);
        context.fillStyle = summonPreview.meaningful ? "rgba(78,82,92,.46)" : "rgba(112,45,57,.4)";
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = Math.max(1.5, scale * .075);
        context.stroke();
        context.setLineDash([]);
        context.font = `bold ${Math.max(9, scale * .4)}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineWidth = Math.max(2, scale * .09);
        context.strokeStyle = "rgba(20,22,28,.85)";
        context.strokeText(summonPreview.name[0], screen.x, screen.y);
        context.fillStyle = color;
        context.fillText(summonPreview.name[0], screen.x, screen.y);
        context.restore();
      }

      if (battle._targetPreview?.kind === "circle") {
        const preview = battle._targetPreview;
        const scale = camera.scaleAt(preview.center);
        context.save();
        context.setLineDash([Math.max(5, scale * 0.3), Math.max(4, scale * 0.22)]);
        context.lineDashOffset = -now / 45;
        context.strokeStyle = preview.valid ? "rgba(94,224,183,.96)" : "rgba(239,91,104,.96)";
        context.fillStyle = preview.valid ? "rgba(94,224,183,.08)" : "rgba(239,91,104,.07)";
        context.lineWidth = Math.max(1.5, scale * 0.07);
        context.beginPath();
        appendProjectedCircle(context, preview.center, preview.radiusU, camera, 64);
        context.fill();
        context.stroke();
        context.restore();
      }

      for (const well of battle.wells) {
        const position = global.GameBattlefieldAdapter.cellToWorld(well.cell);
        const scale = camera.scaleAt(position);
        drawWell(well, position, scale);
      }

      const links = global.GameDroneLinkSystem?.active?.(battle) || [];
      for (const link of links) {
        const fromPosition = global.GameBattlefieldAdapter.unitPosition(link.from);
        const toPosition = global.GameBattlefieldAdapter.unitPosition(link.to);
        const from = camera.worldToScreen(fromPosition);
        const to = camera.worldToScreen(toPosition);
        const lineScale = (camera.scaleAt(fromPosition) + camera.scaleAt(toPosition)) / 2;
        context.save(); context.setLineDash([7, 5]); context.lineDashOffset = -now / 35 % 12;
        context.strokeStyle = "#5aef9b"; context.lineWidth = Math.max(1, lineScale * .07); context.beginPath();
        context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); context.restore();
      }

      for (const unit of battle.units.filter(unit => !unit.dead)) {
        const position = global.GameBattlefieldAdapter.unitPosition(unit);
        const screen = camera.worldToScreen(position);
        const scale = camera.scaleAt(position);
        const radius = scale * (unit.body?.radius ?? .62);
        const highlighted = highlightedUnits.has(unit.id);
        context.save();
        if (highlighted) {
          context.fillStyle = "rgba(255,231,112,.28)";
          context.strokeStyle = "rgba(255,246,184,.98)";
          context.lineWidth = Math.max(1.5, scale * .1);
          context.shadowColor = "rgba(255,220,84,.95)";
          context.shadowBlur = scale * .55;
          context.beginPath(); appendProjectedCircle(context, position, (unit.body?.radius ?? .62) + .28, camera);
          context.fill(); context.stroke();
        }
        context.shadowBlur = 0;
        context.strokeStyle = highlighted ? "#fff1a8" : unit.owner === 1 ? "#8fd2ff" : "#ff9cb4";
        context.lineWidth = Math.max(.8, scale * .065);
        context.beginPath(); appendProjectedCircle(context, position, unit.body?.radius ?? .62, camera); context.stroke();
        if (unit.shield > 0) {
          context.strokeStyle = "#65e2ff";
          context.beginPath(); appendProjectedCircle(context, position, (unit.body?.radius ?? .62) + .18, camera); context.stroke();
        }
        context.restore();
        context.fillStyle = "#f04f5d"; context.font = `bold ${Math.max(8, scale * 0.36)}px sans-serif`;
        context.textAlign = "center"; context.fillText(`${global.attackFor?.(unit) ?? unit.attack}/${unit.hp}`, screen.x, screen.y + radius + 10);
      }
    }

    return Object.freeze({draw});
  }

  global.GameContinuousOverlayRenderer = Object.freeze({
    traceShape, traceShapes, projectedCirclePoints, wellStateFrame, previewTouchesUnit,
    summonIntentPreview, summonIntentAtPoint,
    wellSpriteUrl:"images/ink_well_states_transparent.png",
    wellVisualSizeU:WELL_VISUAL_SIZE_U,
    wellBillboard:true,
    wellStateTransition:false,
    crystalOverlayAnimated: false, create
  });
})(window);
