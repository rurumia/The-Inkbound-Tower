(function createArchiveCastSystem(global) {
  "use strict";

  function sortedCandidates(side) {
    return [...side.hand].sort((a, b) => a.priority - b.priority || a.order - b.order);
  }

  function createAiPlan(side, context) {
    for (const instance of sortedCandidates(side)) {
      const def = context.getDef(instance);
      const target = def.target === "none" ? null : context.findTarget(def, side.owner);
      if (def.target !== "none" && !context.validateTarget(def, side.owner, target)) continue;
      return {
        instance,
        def,
        target,
        targetSnapshot: context.captureTarget(def, target)
      };
    }
    return null;
  }

  function waitTurns(def, targetSnapshot = null) {
    let turns = def.cost / 2;
    const option = def.archiveDelayOption;
    if (option && targetSnapshot?.kind === option.snapshotKind &&
      targetSnapshot.payload?.[option.field] === option.value) {
      turns += option.extraTurns;
    }
    return turns;
  }

  global.GameArchiveCastSystem = Object.freeze({sortedCandidates, createAiPlan, waitTurns});
})(window);
