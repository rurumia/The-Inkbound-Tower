(function createContinuousTerritoryAi(global) {
  "use strict";

  function create(options) {
    const paintField = options.paintField;
    const navigation = options.navigation;
    const wells = options.wells;

    function ownerSign(entity) {
      return entity.owner === 1 ? 1 : -1;
    }

    function detectionRadius(entity) {
      return Math.max(6, (entity.currentStats?.move ?? entity.move ?? 0) * 2);
    }

    function localFullyFriendly(entity) {
      const sign = ownerSign(entity);
      const radius = detectionRadius(entity);
      for (let ring = 0; ring <= radius; ring += 0.5) {
        const samples = ring === 0 ? 1 : Math.max(8, Math.ceil(Math.PI * 2 * ring / 0.5));
        for (let index = 0; index < samples; index++) {
          const angle = index * Math.PI * 2 / samples;
          const point = {
            x: entity.position.x + Math.cos(angle) * ring,
            y: entity.position.y + Math.sin(angle) * ring
          };
          if (!GameWorldSpace.containsPoint(point)) continue;
          if (paintField.sample(point) * sign < 0.5) return false;
        }
      }
      return true;
    }

    function frontierCandidates(entity, globalSearch) {
      const sign = ownerSign(entity);
      const radius = detectionRadius(entity);
      const candidates = [];
      for (let y = 0.25; y < GameWorldSpace.height; y += 0.5) {
        for (let x = 0.25; x < GameWorldSpace.width; x += 0.5) {
          const point = {x, y};
          const distance = GameWorldSpace.distance(entity.position, point);
          if (!globalSearch && distance > radius) continue;
          const control = paintField.sample(point) * sign;
          if (control >= 0.5) continue;
          candidates.push({point: GameWorldSpace.point(x, y), distance, control});
        }
      }
      candidates.sort((a, b) => a.distance - b.distance || a.control - b.control || a.point.x - b.point.x || a.point.y - b.point.y);
      return candidates.slice(0, 48);
    }

    function scorePlan(entity, candidate, plan) {
      const sign = ownerSign(entity);
      const end = plan.path.at(-1);
      const control = paintField.sample(end) * sign;
      const hostileValue = Math.max(0, -control);
      const neutralValue = Math.max(0, 1 - Math.abs(control));
      const nearbyWell = wells?.list().filter(well => well.owner !== entity.owner)
        .reduce((best, well) => Math.min(best, GameWorldSpace.distance(end, well.position)), Infinity) ?? Infinity;
      const wellValue = Number.isFinite(nearbyWell) ? Math.max(0, 5 - nearbyWell) : 0;
      const reachValue = plan.reached ? 2 : 0;
      if (entity.ai === "aggressive") return [hostileValue, reachValue, -plan.length, -candidate.point.x * sign];
      if (entity.ai === "avoid") return [wellValue, neutralValue, hostileValue, reachValue, -plan.length];
      if (entity.ai === "guard") return [wellValue, hostileValue, neutralValue, reachValue, -plan.length];
      return [hostileValue + neutralValue, wellValue, reachValue, -plan.length];
    }

    function compareScores(a, b) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index++) {
        const difference = (b[index] || 0) - (a[index] || 0);
        if (difference) return difference;
      }
      return 0;
    }

    function chooseDestination(entity) {
      const globalSearch = localFullyFriendly(entity);
      const candidates = frontierCandidates(entity, globalSearch);
      const budget = entity.currentStats?.move ?? entity.move ?? 0;
      const plans = candidates.map(candidate => {
        const plan = navigation.plan(entity, candidate.point, {budget});
        return {candidate, plan, score: scorePlan(entity, candidate, plan)};
      });
      plans.sort((a, b) => compareScores(a.score, b.score) ||
        a.candidate.point.x - b.candidate.point.x || a.candidate.point.y - b.candidate.point.y);
      return plans[0]?.candidate.point || entity.position;
    }

    return Object.freeze({detectionRadius, localFullyFriendly, frontierCandidates, chooseDestination});
  }

  global.GameContinuousTerritoryAI = Object.freeze({create});
})(window);
