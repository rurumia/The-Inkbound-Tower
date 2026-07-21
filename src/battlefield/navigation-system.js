(function createContinuousNavigationSystem(global) {
  "use strict";

  function create(options) {
    const collision = options.collision;

    function clipPath(points, budget) {
      if (budget <= 0 || points.length < 2) return [points[0]];
      const result = [points[0]];
      let remaining = budget;
      for (let index = 1; index < points.length; index++) {
        const from = result[result.length - 1];
        const to = points[index];
        const length = GameWorldSpace.distance(from, to);
        if (length <= remaining) {
          result.push(to);
          remaining -= length;
          continue;
        }
        const ratio = remaining / length;
        result.push(GameWorldSpace.point(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio));
        break;
      }
      return result;
    }

    function tangentPoints(point, center, radius) {
      const distance = GameWorldSpace.distance(point, center);
      if (distance <= radius) return [];
      const base = Math.atan2(point.y - center.y, point.x - center.x);
      const offset = Math.acos(radius / distance);
      return [base + offset, base - offset].map(angle => ({
        point: GameWorldSpace.point(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius),
        angle
      }));
    }

    function arcPoints(center, radius, startAngle, endAngle, direction) {
      let delta = endAngle - startAngle;
      if (direction > 0) while (delta < 0) delta += Math.PI * 2;
      else while (delta > 0) delta -= Math.PI * 2;
      const count = Math.max(2, Math.ceil(Math.abs(delta) * radius / 0.25));
      return Array.from({length: count}, (_, index) => {
        const angle = startAngle + delta * (index + 1) / count;
        return GameWorldSpace.point(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
      });
    }

    function validSegments(mover, points) {
      for (let index = 1; index < points.length; index++) {
        if (collision.sweep(mover, points[index - 1], points[index])) return false;
      }
      return true;
    }

    function detourAround(mover, start, target, obstacle) {
      const radius = collision.radiusOf(mover) + collision.radiusOf(obstacle) + 2 / GameWorldSpace.fixedScale;
      const fromTangents = tangentPoints(start, obstacle.position, radius);
      const toTangents = tangentPoints(target, obstacle.position, radius);
      const candidates = [];
      for (const from of fromTangents) {
        for (const to of toTangents) {
          for (const direction of [-1, 1]) {
            const around = arcPoints(obstacle.position, radius, from.angle, to.angle, direction);
            const path = [start, from.point, ...around, target];
            if (!path.every(point => GameWorldSpace.containsPoint(point, collision.radiusOf(mover)))) continue;
            if (!validSegments(mover, path)) continue;
            candidates.push(path);
          }
        }
      }
      candidates.sort((a, b) => GameWorldSpace.pathLength(a) - GameWorldSpace.pathLength(b));
      return candidates[0] || null;
    }

    function plan(mover, destination, options = {}) {
      const start = GameWorldSpace.point(mover.position.x, mover.position.y);
      const budget = Math.max(0, options.budget ?? mover.movementU ?? mover.move ?? 0);
      if (options.rooted || budget === 0) return Object.freeze({path: [start], length: 0, reached: false, reason: options.rooted ? "rooted" : "no-budget"});
      const target = GameWorldSpace.clampPoint(destination, collision.radiusOf(mover));
      const directHit = collision.sweep(mover, start, target);
      let fullPath;
      let reason = "direct";
      if (!directHit) fullPath = [start, target];
      else {
        fullPath = detourAround(mover, start, target, directHit.entity);
        if (fullPath) reason = "detour";
        else {
          fullPath = [start, directHit.safePoint];
          reason = "collision";
        }
      }
      const path = clipPath(fullPath, budget);
      const length = GameWorldSpace.pathLength(path);
      const end = path[path.length - 1];
      return Object.freeze({
        path: Object.freeze(path),
        length,
        reached: GameWorldSpace.distance(end, target) <= 1 / GameWorldSpace.fixedScale,
        reason,
        collisionId: reason === "collision" ? directHit.entity.id : null
      });
    }

    return Object.freeze({plan, clipPath});
  }

  global.GameContinuousNavigation = Object.freeze({create});
})(window);
