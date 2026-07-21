(function createModifierSystem(global) {
  "use strict";

  function ensure(side) {
    side.modifiers = side.modifiers || {active: new Map(), queued: new Map()};
    return side.modifiers;
  }

  function apply(side, id, modifier) {
    ensure(side).active.set(id, Object.freeze({...modifier}));
  }

  function queue(side, id, modifier) {
    ensure(side).queued.set(id, Object.freeze({...modifier}));
  }

  function startTurn(side) {
    const modifiers = ensure(side);
    modifiers.active.clear();
    modifiers.queued.forEach((modifier, id) => modifiers.active.set(id, modifier));
    modifiers.queued.clear();
  }

  function multiplier(side, property) {
    let value = 1;
    ensure(side).active.forEach(modifier => {
      value *= modifier[property] || 1;
    });
    return value;
  }

  global.GameModifierSystem = Object.freeze({apply, queue, startTurn, multiplier});
})(window);
