(function createContinuousCamera(global) {
  "use strict";

  function create(options = {}) {
    const state = {scale: 1, offsetX: 0, offsetY: 0};
    const viewport = {width: options.width || 1, height: options.height || 1};
    const padding = options.padding ?? 18;
    const fitWidthScale = Math.max(1, options.fitWidthScale ?? 1);
    const fitHeightScale = Math.max(1, options.fitHeightScale ?? 1);
    const farScale = Math.max(0.4, Math.min(1, options.farScale ?? 0.7));
    const centerX = GameWorldSpace.width / 2;
    const centerY = GameWorldSpace.height / 2;
    const perspectiveStrength = 1 - farScale;

    function normalizedY(value) {
      const y = typeof value === "number" ? value : value?.y ?? 0;
      return y / GameWorldSpace.height;
    }

    function denominatorAt(value) {
      return 1 - perspectiveStrength * normalizedY(value);
    }

    function depthAt(value) {
      return farScale / denominatorAt(value);
    }

    function projectedX(point) {
      return centerX + (point.x - centerX) * depthAt(point);
    }

    function projectedY(point) {
      const projectedDepth = farScale * normalizedY(point) / denominatorAt(point);
      return centerY + GameWorldSpace.height * farScale * (projectedDepth - 0.5);
    }

    function unprojectedY(projected) {
      const projectedDepth = (projected - centerY) / (GameWorldSpace.height * farScale) + 0.5;
      return GameWorldSpace.height * projectedDepth /
        (farScale + perspectiveStrength * projectedDepth);
    }

    function resize(width, height) {
      viewport.width = Math.max(1, width);
      viewport.height = Math.max(1, height);
    }

    function fit() {
      state.scale = Math.min(
        (viewport.width - padding * 2) / (GameWorldSpace.width * fitWidthScale),
        (viewport.height - padding * 2) / (GameWorldSpace.height * fitHeightScale)
      );
      state.offsetX = (viewport.width - GameWorldSpace.width * state.scale) / 2;
      state.offsetY = (viewport.height - GameWorldSpace.height * state.scale) / 2;
      return snapshot();
    }

    function worldToScreen(point) {
      return {x: projectedX(point) * state.scale + state.offsetX, y: projectedY(point) * state.scale + state.offsetY};
    }

    function screenToWorld(point) {
      const y = unprojectedY((point.y - state.offsetY) / state.scale);
      const projected = (point.x - state.offsetX) / state.scale;
      return GameWorldSpace.point(centerX + (projected - centerX) / depthAt(y), y);
    }

    function scaleAt(point) {
      return state.scale * depthAt(point);
    }

    function pan(dx, dy) {
      state.offsetX += dx;
      state.offsetY += dy;
      return snapshot();
    }

    function zoomAt(screenPoint, factor) {
      const before = screenToWorld(screenPoint);
      state.scale = Math.max(0.25, Math.min(64, state.scale * factor));
      state.offsetX = screenPoint.x - projectedX(before) * state.scale;
      state.offsetY = screenPoint.y - projectedY(before) * state.scale;
      return snapshot();
    }

    function snapshot() {
      return Object.freeze({...state, farScale, fitWidthScale, fitHeightScale, viewport: {...viewport}});
    }

    return Object.freeze({resize, fit, worldToScreen, screenToWorld, scaleAt, depthAt, pan, zoomAt, snapshot});
  }

  global.GameContinuousCamera = Object.freeze({create});
})(window);
