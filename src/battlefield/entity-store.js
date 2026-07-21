(function createContinuousEntityStore(global) {
  "use strict";

  function create() {
    const entities = new Map();
    let sequence = 1;
    let birth = 1;

    function spawn(definition) {
      const id = definition.id || `world-entity-${sequence++}`;
      if (entities.has(id)) throw new Error(`Duplicate continuous entity id: ${id}`);
      const entity = {
        alive: true,
        birth: birth++,
        body: {kind: "circle", radius: 0.35},
        heightLayer: "ground",
        facing: {x: definition.owner === 2 ? -1 : 1, y: 0},
        ...structuredClone(definition),
        id
      };
      entity.position = GameWorldSpace.point(entity.position.x, entity.position.y);
      entities.set(id, entity);
      return entity;
    }

    function get(id) {
      const entity = entities.get(id);
      return entity?.alive === false ? null : entity || null;
    }

    function update(id, mutate) {
      const entity = get(id);
      if (!entity) return null;
      mutate(entity);
      if (entity.position) entity.position = GameWorldSpace.point(entity.position.x, entity.position.y);
      return entity;
    }

    function remove(id) {
      const entity = get(id);
      if (!entity) return false;
      entity.alive = false;
      return true;
    }

    function list(predicate = () => true) {
      return [...entities.values()].filter(entity => entity.alive !== false && predicate(entity)).sort((a, b) => a.birth - b.birth);
    }

    function snapshot() {
      return list().map(entity => structuredClone(entity));
    }

    return Object.freeze({spawn, get, update, remove, list, snapshot});
  }

  global.GameContinuousEntities = Object.freeze({create});
})(window);
