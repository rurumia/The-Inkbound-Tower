(function createContinuousCamera(global) {
  "use strict";

  function create(options = {}) {
    const state = {scale: 1, offsetX: 0, offsetY: 0};
    const viewport = {width: options.width || 1, height: options.height || 1};
    const padding = options.padding ?? 18;

    function resize(width, height) {
      viewport.width = Math.max(1, width);
      viewport.height = Math.max(1, height);
    }

    function fit() {
      state.scale = Math.min(
        (viewport.width - padding * 2) / GameWorldSpace.width,
        (viewport.height - padding * 2) / GameWorldSpace.height
      );
      state.offsetX = (viewport.width - GameWorldSpace.width * state.scale) / 2;
      state.offsetY = (viewport.height - GameWorldSpace.height * state.scale) / 2;
      return snapshot();
    }

    function worldToScreen(point) {
      return {x: point.x * state.scale + state.offsetX, y: point.y * state.scale + state.offsetY};
    }

    function screenToWorld(point) {
      return GameWorldSpace.point((point.x - state.offsetX) / state.scale, (point.y - state.offsetY) / state.scale);
    }

    function pan(dx, dy) {
      state.offsetX += dx;
      state.offsetY += dy;
      return snapshot();
    }

    function zoomAt(screenPoint, factor) {
      const before = screenToWorld(screenPoint);
      state.scale = Math.max(0.25, Math.min(64, state.scale * factor));
      state.offsetX = screenPoint.x - before.x * state.scale;
      state.offsetY = screenPoint.y - before.y * state.scale;
      return snapshot();
    }

    function snapshot() {
      return Object.freeze({...state, viewport: {...viewport}});
    }

    return Object.freeze({resize, fit, worldToScreen, screenToWorld, pan, zoomAt, snapshot});
  }

  global.GameContinuousCamera = Object.freeze({create});
})(window);
