(function createEffectRegistry(global) {
  "use strict";

  const handlers = new Map();

  function register(id, handler) {
    if (!id || !handler) throw new Error("Effect registration requires an id and handler.");
    if (handlers.has(id)) throw new Error(`Duplicate effect id: ${id}`);
    handlers.set(id, Object.freeze({...handler}));
  }

  function invoke(id, hook, context) {
    const handler = handlers.get(id);
    const fn = handler && handler[hook];
    return typeof fn === "function" ? fn(context) : undefined;
  }

  function has(id) {
    return handlers.has(id);
  }

  global.GameEffectRegistry = Object.freeze({register, invoke, has});
})(window);
