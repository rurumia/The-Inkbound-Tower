(function createActionSequencer(global) {
  "use strict";

  function durationFor(plan, playbackSpeed = 1) {
    const raw = (plan.pathLengthU || 0) / 5 / Math.max(0.01, playbackSpeed);
    return Math.max(0.35 / playbackSpeed, Math.min(1.4 / playbackSpeed, raw));
  }

  function positionAt(path, progress) {
    if (!path?.length) return null;
    if (path.length === 1 || progress <= 0) return structuredClone(path[0]);
    if (progress >= 1) return structuredClone(path[path.length - 1]);
    const total = GameWorldSpace.pathLength(path);
    const target = total * progress;
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
    return structuredClone(path[path.length - 1]);
  }

  function frameFor(plan, progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    const visiblePaintCount = plan.paintOperations.filter(operation => operation.progress <= clamped).length;
    return Object.freeze({
      progress: clamped,
      position: positionAt(plan.path, clamped),
      visiblePaintCount,
      complete: clamped >= 1
    });
  }

  function create(options = {}) {
    const now = options.now || (() => performance.now());
    const requestFrame = options.requestFrame || requestAnimationFrame;

    function play(plan, view, settings = {}) {
      const playbackSpeed = settings.playbackSpeed || 1;
      const durationMs = durationFor(plan, playbackSpeed) * 1000;
      let shownPaint = 0;
      view.setAnimation?.("move", true);
      const startedAt = now();

      return new Promise(resolve => {
        function tick(timestamp) {
          const frame = frameFor(plan, durationMs ? (timestamp - startedAt) / durationMs : 1);
          view.setPosition?.(frame.position);
          while (shownPaint < frame.visiblePaintCount) view.revealPaint?.(plan.paintOperations[shownPaint++]);
          if (frame.complete) {
            view.setAnimation?.("idle", true);
            resolve(frame);
          } else requestFrame(tick);
        }
        requestFrame(tick);
      });
    }

    return Object.freeze({play});
  }

  global.GameActionSequencer = Object.freeze({durationFor, positionAt, frameFor, create});
})(window);
