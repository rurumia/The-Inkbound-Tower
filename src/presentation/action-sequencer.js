(function createActionSequencer(global) {
  "use strict";

  function durationFor(plan, playbackSpeed = 1) {
    const speed = Number.isFinite(playbackSpeed) && playbackSpeed > 0 ? playbackSpeed : 1;
    const raw = (plan.pathLengthU || 0) / 5 / speed;
    return Math.max(0.35 / speed, Math.min(1.4 / speed, raw));
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
    const visiblePaintCount = (plan.paintOperations || []).filter(operation => operation.progress <= clamped).length;
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
    let queue = Promise.resolve();

    function play(plan, view, settings = {}) {
      const playbackSpeed = settings.playbackSpeed ?? 1;
      const durationMs = durationFor(plan, playbackSpeed) * 1000;
      const paintOperations = plan.paintOperations || [];
      let shownPaint = 0;
      view.beginAction?.(plan);
      view.setAnimation?.("move", true);
      const initial = frameFor(plan, 0);
      view.setPosition?.(initial.position);
      while (shownPaint < initial.visiblePaintCount) view.revealPaint?.(paintOperations[shownPaint++]);
      const startedAt = now();

      return new Promise((resolve, reject) => {
        function tick(timestamp) {
          try {
            const frame = frameFor(plan, durationMs ? (timestamp - startedAt) / durationMs : 1);
            view.setPosition?.(frame.position);
            while (shownPaint < frame.visiblePaintCount) view.revealPaint?.(paintOperations[shownPaint++]);
            if (frame.complete) {
              view.setAnimation?.("idle", true);
              view.endAction?.(plan, frame);
              resolve(frame);
            } else requestFrame(tick);
          } catch (error) {
            reject(error);
          }
        }
        requestFrame(tick);
      });
    }

    function enqueue(plan, view, settings = {}) {
      const scheduled = queue.then(() => play(plan, view, settings));
      queue = scheduled.catch(() => undefined);
      return scheduled;
    }

    function whenIdle() {
      return queue;
    }

    return Object.freeze({play, enqueue, whenIdle});
  }

  global.GameActionSequencer = Object.freeze({durationFor, positionAt, frameFor, create});
})(window);
