(function createArchiveSystem(global) {
  "use strict";

  let sequence = 1;

  function ensureSide(side) {
    if (!Array.isArray(side.archiveZone)) side.archiveZone = [];
  }

  function archiveHand(side, instance, wait, targetSnapshot = null) {
    ensureSide(side);
    const handIndex = side.hand.indexOf(instance);
    if (handIndex < 0) return false;
    side.hand.splice(handIndex, 1);
    side.archiveZone.push({
      instance,
      source: "skill",
      remaining: Math.max(0, Math.ceil(wait)),
      speed: 1,
      order: sequence++,
      targetSnapshot
    });
    return true;
  }

  function archiveDiscardBatch(side, instances, waitFor) {
    ensureSide(side);
    const groupId = `singularity-${sequence++}`;
    const archived = [];
    instances.forEach((instance, index) => {
      const discardIndex = side.discard.indexOf(instance);
      if (discardIndex < 0) return;
      side.discard.splice(discardIndex, 1);
      side.archiveZone.push({
        instance,
        source: "singularity",
        groupId,
        groupOrder: index,
        remaining: Math.max(0, Math.ceil(waitFor(instance))),
        speed: 2,
        order: sequence++
      });
      archived.push(instance);
    });
    return archived;
  }

  function entries(side) {
    ensureSide(side);
    return side.archiveZone.map(entry => ({...entry, container: "zone"}))
      .sort((a, b) => a.order - b.order);
  }

  function tick(side) {
    ensureSide(side);
    side.hand.forEach(instance => {
      instance.handTurns = (instance.handTurns || 0) + 1;
    });
    side.archiveZone.forEach(entry => {
      entry.remaining = Math.max(0, entry.remaining - entry.speed);
    });

    const due = entries(side).filter(entry => entry.remaining <= 0);
    const releasedGroups = new Set();
    return due.filter(entry => {
      if (!entry.groupId) return true;
      if (releasedGroups.has(entry.groupId)) return false;
      releasedGroups.add(entry.groupId);
      return true;
    });
  }

  function release(side, dueEntry) {
    ensureSide(side);
    const index = side.archiveZone.findIndex(entry => entry.instance === dueEntry.instance);
    if (index >= 0) side.archiveZone.splice(index, 1);
    return dueEntry.instance;
  }

  global.GameArchiveSystem = Object.freeze({archiveHand, archiveDiscardBatch, entries, tick, release});
})(window);
