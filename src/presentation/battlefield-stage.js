(function createContinuousBattlefieldStage(global) {
  "use strict";

  const LAYERS = Object.freeze(["terrain", "spine", "overlay"]);

  function positive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function create(options = {}) {
    const documentRef = options.document || global.document;
    const container = options.container;
    const camera = options.camera;
    if (!documentRef?.createElement) throw new Error("Battlefield stage requires a document.");
    if (!container?.appendChild) throw new Error("Battlefield stage requires a container.");
    if (!camera?.resize || !camera?.worldToScreen || !camera?.screenToWorld) {
      throw new Error("Battlefield stage requires a Camera2D instance.");
    }

    const canvases = {};
    const contexts = {};
    if (!container.style.position) container.style.position = "relative";
    container.style.overflow = "hidden";

    for (const layer of LAYERS) {
      const canvas = options.canvases?.[layer] || documentRef.createElement("canvas");
      canvas.dataset.battlefieldLayer = layer;
      canvas.setAttribute?.("aria-hidden", "true");
      Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        display: "block",
        width: "100%",
        height: "100%",
        pointerEvents: layer === "overlay" ? "auto" : "none"
      });
      if (!canvas.parentElement) container.appendChild(canvas);
      canvases[layer] = canvas;
    }

    contexts.terrain = options.terrainContext || canvases.terrain.getContext("2d");
    contexts.overlay = options.overlayContext || canvases.overlay.getContext("2d");
    contexts.spine = options.spineContext
      || canvases.spine.getContext("webgl2", {alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true})
      || canvases.spine.getContext("webgl", {alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true});
    if (!contexts.terrain || !contexts.overlay) throw new Error("Battlefield stage requires 2D canvas support.");
    if (!contexts.spine) throw new Error("Battlefield stage requires WebGL support for Spine.");

    let size = Object.freeze({width: 1, height: 1, pixelRatio: 1, physicalWidth: 1, physicalHeight: 1});

    function resize(width = container.clientWidth, height = container.clientHeight, settings = {}) {
      const cssWidth = positive(width, 1);
      const cssHeight = positive(height, 1);
      const defaultRatio = typeof options.pixelRatio === "function"
        ? options.pixelRatio()
        : options.pixelRatio ?? global.devicePixelRatio ?? 1;
      const pixelRatio = positive(settings.pixelRatio, positive(defaultRatio, 1));
      const physicalWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const physicalHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

      for (const canvas of Object.values(canvases)) {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }
      contexts.terrain.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      contexts.overlay.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      contexts.spine.viewport(0, 0, physicalWidth, physicalHeight);
      camera.resize(cssWidth, cssHeight);
      if (settings.fit) camera.fit?.();
      size = Object.freeze({width: cssWidth, height: cssHeight, pixelRatio, physicalWidth, physicalHeight});
      return size;
    }

    function clear(layer) {
      if (layer === "terrain" || layer === "overlay") {
        contexts[layer].clearRect(0, 0, size.width, size.height);
        return;
      }
      if (layer === "spine") {
        const gl = contexts.spine;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      throw new Error(`Unknown battlefield layer: ${layer}`);
    }

    function pointerToWorld(clientPoint) {
      const rect = canvases.overlay.getBoundingClientRect();
      const width = positive(rect.width, size.width);
      const height = positive(rect.height, size.height);
      return camera.screenToWorld({
        x: (clientPoint.x - rect.left) * size.width / width,
        y: (clientPoint.y - rect.top) * size.height / height
      });
    }

    function getLayer(layer) {
      if (!LAYERS.includes(layer)) throw new Error(`Unknown battlefield layer: ${layer}`);
      return Object.freeze({canvas: canvases[layer], context: contexts[layer]});
    }

    function snapshot() {
      return Object.freeze({
        ...size,
        camera: camera.snapshot?.() || null,
        layers: LAYERS.slice()
      });
    }

    function destroy() {
      for (const canvas of Object.values(canvases)) canvas.remove?.();
    }

    resize(options.width, options.height, {pixelRatio: options.initialPixelRatio, fit: options.fit !== false});

    return Object.freeze({resize, clear, pointerToWorld, getLayer, snapshot, destroy});
  }

  global.GameContinuousBattlefieldStage = Object.freeze({layers: LAYERS, create});
})(window);
