(function createContinuousRegionSystem(global) {
  "use strict";

  const PRIORITY = Object.freeze({crystal: 100, spellBlock: 80, purification: 60, study: 20});

  function create() {
    const regions = [];
    const boundsCache = new WeakMap();
    const versions = Object.fromEntries(Object.keys(PRIORITY).map(type => [type, 0]));
    let sequence = 1;
    let revision = 0;

    function add(definition) {
      if (!PRIORITY[definition.type]) throw new TypeError(`Unknown region type: ${definition.type}`);
      if (!definition.shape) throw new TypeError("Region shape is required.");
      const id = definition.id || `region-${sequence++}`;
      const region = Object.freeze({
        ...definition,
        id,
        owner: definition.owner ?? 0,
        permanent: definition.permanent !== false,
        expiresAt: definition.expiresAt ?? null
      });
      regions.push(region);
      regions.sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type] || a.id.localeCompare(b.id));
      versions[region.type]++;
      revision++;
      return region;
    }

    function queryPoint(point) {
      return regions.filter(region => GameContinuousGeometry.containsPoint(region.shape, point));
    }

    function candidates(bounds) {
      if (!bounds) return regions.slice();
      return regions.filter(region => {
        let box = boundsCache.get(region);
        if (!box) {
          box = GameContinuousGeometry.bounds(region.shape);
          boundsCache.set(region, box);
        }
        return box.minX <= bounds.maxX && box.maxX >= bounds.minX
          && box.minY <= bounds.maxY && box.maxY >= bounds.minY;
      });
    }

    function has(type, point) {
      const matches = queryPoint(point);
      const crystalBlocked = type !== "crystal" && matches.some(region => region.type === "crystal");
      return matches.some(region => region.type === type && (!crystalBlocked || region.allowCrystal));
    }

    function permits(point, operation = {}, candidateRegions = null) {
      const matches = (candidateRegions || regions)
        .filter(region => GameContinuousGeometry.containsPoint(region.shape, point));
      if (matches.some(region => region.type === "crystal")) return false;
      if ((operation.source === "card" || operation.source === "skill") && matches.some(region => region.type === "spellBlock")) return false;
      if (operation.kind === "paint" && matches.some(region => region.type === "purification" && region.owner !== operation.owner)) return false;
      return true;
    }

    function expire(turn) {
      for (let index = regions.length - 1; index >= 0; index--) {
        const region = regions[index];
        if (!region.permanent && region.expiresAt != null && region.expiresAt <= turn && region.type !== "crystal") {
          regions.splice(index, 1);
          versions[region.type]++;
          revision++;
        }
      }
    }

    function list(type = null) {
      return regions.filter(region => !type || region.type === type).slice();
    }

    function remove(match) {
      const predicate = typeof match === "function" ? match : region => region.id === match;
      const removed = [];
      for (let index = regions.length - 1; index >= 0; index--) {
        const region = regions[index];
        if (!predicate(region)) continue;
        regions.splice(index, 1);
        versions[region.type]++;
        revision++;
        removed.push(region);
      }
      return removed.reverse();
    }

    function version(type = null) {
      return type ? versions[type] || 0 : revision;
    }

    return Object.freeze({add, remove, queryPoint, candidates, has, permits, expire, list, version});
  }

  global.GameContinuousRegions = Object.freeze({create});
})(window);
