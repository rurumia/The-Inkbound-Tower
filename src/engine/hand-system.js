(function createHandSystem(global) {
  "use strict";

  function activeCards(side) {
    return side.hand.filter(instance => !instance.archive);
  }

  function activeCount(side) {
    return activeCards(side).length;
  }

  function refill(side, targetSize, drawOne) {
    let drawn = 0;
    while (activeCount(side) < targetSize) {
      if (!drawOne(side)) break;
      drawn++;
    }
    return drawn;
  }

  global.GameHandSystem = Object.freeze({activeCards, activeCount, refill});
})(window);
