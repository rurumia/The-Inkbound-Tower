(function createContinuousCollisionSystem(global) {
  "use strict";

  function create(options = {}) {
    const entitySource = options.entities || [];

    function entities() {
      return typeof entitySource === "function" ? entitySource() : entitySource;
    }

    function radiusOf(entity) {
      return entity?.body?.radius ?? 0.35;
    }

    function sameLayer(a, b) {
      return (a.heightLayer || "ground") === (b.heightLayer || "ground");
    }

    function blockersFor(mover, ignoredIds = new Set()) {
      return entities().filter(entity => entity && entity.alive !== false && entity.id !== mover.id && !ignoredIds.has(entity.id) && sameLayer(mover, entity));
    }

    function canOccupy(mover, point, ignoredIds = new Set()) {
      if (!GameWorldSpace.containsPoint(point, radiusOf(mover))) return false;
      return blockersFor(mover, ignoredIds).every(entity =>
        GameWorldSpace.distance(point, entity.position) >= radiusOf(mover) + radiusOf(entity));
    }

    function segmentCircleHit(from, to, center, radius) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const fx = from.x - center.x;
      const fy = from.y - center.y;
      const a = dx * dx + dy * dy;
      if (a === 0) return null;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - radius * radius;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) return null;
      const root = Math.sqrt(discriminant);
      const near = (-b - root) / (2 * a);
      const far = (-b + root) / (2 * a);
      if (near >= 0 && near <= 1) return near;
      if (far >= 0 && far <= 1 && c <= 0) return 0;
      return null;
    }

    function sweep(mover, from, to, ignoredIds = new Set()) {
      let hit = null;
      for (const entity of blockersFor(mover, ignoredIds)) {
        const progress = segmentCircleHit(from, to, entity.position, radiusOf(mover) + radiusOf(entity));
        if (progress == null || hit && progress >= hit.progress) continue;
        hit = {entity, progress};
      }
      if (!hit) return null;
      const length = GameWorldSpace.distance(from, to);
      const safeProgress = Math.max(0, hit.progress - (length ? 1 / GameWorldSpace.fixedScale / length : 0));
      return Object.freeze({
        entity: hit.entity,
        progress: hit.progress,
        safePoint: GameWorldSpace.point(
          from.x + (to.x - from.x) * safeProgress,
          from.y + (to.y - from.y) * safeProgress
        )
      });
    }

    return Object.freeze({radiusOf, canOccupy, sweep, segmentCircleHit});
  }

  global.GameContinuousCollision = Object.freeze({create});
})(window);
