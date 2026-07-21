(function createDroneLinkSystem(global) {
  "use strict";

  function ensure(battle) {
    if (!Array.isArray(battle.droneLinks)) battle.droneLinks = [];
    return battle.droneLinks;
  }

  function active(battle, now = Date.now()) {
    if (!battle) return [];
    battle.droneLinks = ensure(battle).filter(link => link.expiresAt > now);
    return battle.droneLinks;
  }

  function trigger(battle, from, to, requestDraw = () => {}, duration = 700) {
    if (!battle || !from || !to || from === to) return false;
    const now = Date.now();
    const pair = [from.id, to.id].sort((a, b) => a - b).join(":");
    const links = active(battle, now);
    const existing = links.find(link => link.pair === pair);
    if (existing) {
      existing.from = from;
      existing.to = to;
      existing.startedAt = now;
      existing.expiresAt = now + duration;
    } else {
      links.push({pair, from, to, startedAt: now, expiresAt: now + duration});
    }

    if (typeof global.requestAnimationFrame !== "function") {
      requestDraw();
      return true;
    }
    const animate = () => {
      requestDraw();
      if (active(battle).some(link => link.pair === pair)) global.requestAnimationFrame(animate);
      else requestDraw();
    };
    global.requestAnimationFrame(animate);
    return true;
  }

  global.GameDroneLinkSystem = Object.freeze({active, trigger});
})(window);
