(function createContinuousRegionSystem(global) {
  "use strict";

  const PRIORITY = Object.freeze({crystal: 100, spellBlock: 80, purification: 60, study: 20});

  function create() {
    const regions = [];
    let sequence = 1;

    function add(definition) {
      if (!PRIORITY[definition.type]) throw new TypeError(`Unknown region type: ${definition.type}`);
      if (!definition.shape) throw new TypeError("Region shape is required.");
      const region = Object.freeze({
        id: definition.id || `region-${sequence++}`,
        owner: definition.owner || 0,
        permanent: definition.permanent !== false,
        expiresAt: definition.expiresAt ?? null,
        ...definition
      });
      regions.push(region);
      regions.sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type] || a.id.localeCompare(b.id));
      return region;
    }

    function queryPoint(point) {
      return regions.filter(region => GameContinuousGeometry.containsPoint(region.shape, point));
    }

    function has(type, point) {
      const matches = queryPoint(point);
      if (type !== "crystal" && matches.some(region => region.type === "crystal")) return false;
      return matches.some(region => region.type === type);
    }

    function permits(point, operation = {}) {
      const matches = queryPoint(point);
      if (matches.some(region => region.type === "crystal")) return false;
      if ((operation.source === "card" || operation.source === "skill") && matches.some(region => region.type === "spellBlock")) return false;
      if (operation.kind === "paint" && matches.some(region => region.type === "purification" && region.owner !== operation.owner)) return false;
      return true;
    }

    function expire(turn) {
      for (let index = regions.length - 1; index >= 0; index--) {
        const region = regions[index];
        if (!region.permanent && region.expiresAt != null && region.expiresAt <= turn && region.type !== "crystal") regions.splice(index, 1);
      }
    }

    function list(type = null) {
      return regions.filter(region => !type || region.type === type).slice();
    }

    return Object.freeze({add, queryPoint, has, permits, expire, list});
  }

  global.GameContinuousRegions = Object.freeze({create});
})(window);
