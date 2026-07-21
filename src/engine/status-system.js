(function createStatusSystem(global) {
  "use strict";

  const handlers = new Map();

  function ensure(unit) {
    if (!(unit.statuses instanceof Map)) unit.statuses = new Map();
    return unit.statuses;
  }

  function register(id, handler) {
    if (!id || !handler) throw new Error("Status registration requires an id and handler.");
    if (handlers.has(id)) throw new Error(`Duplicate status id: ${id}`);
    handlers.set(id, Object.freeze({...handler}));
  }

  function has(unitOrId, optionalId) {
    if (typeof unitOrId === "string") return handlers.has(unitOrId);
    return ensure(unitOrId).has(optionalId);
  }

  function apply(unit, id, context = {}) {
    const handler = handlers.get(id);
    if (!handler) throw new Error(`Unknown status id: ${id}`);
    const statuses = ensure(unit);
    if (statuses.has(id)) return false;
    const entry = {id, data: {}};
    statuses.set(id, entry);
    if (typeof handler.apply === "function") handler.apply({unit, entry, ...context});
    return true;
  }

  function remove(unit, id, context = {}) {
    const statuses = ensure(unit);
    const entry = statuses.get(id);
    if (!entry) return false;
    const handler = handlers.get(id);
    if (handler && typeof handler.remove === "function") handler.remove({unit, entry, ...context});
    statuses.delete(id);
    return true;
  }

  function invoke(unit, hook, context = {}) {
    [...ensure(unit).values()].forEach(entry => {
      const handler = handlers.get(entry.id);
      const result = handler && typeof handler[hook] === "function"
        ? handler[hook]({unit, entry, ...context})
        : null;
      if (result && result.remove) remove(unit, entry.id, context);
    });
  }

  global.GameStatusSystem = Object.freeze({register, has, apply, remove, invoke});
})(window);
