(function createTargetResolver(global) {
  "use strict";

  function firstLegal(candidates, validate) {
    return candidates.find(candidate => validate(candidate)) || null;
  }

  function bestLegal(candidates, validate, compare) {
    return candidates.filter(candidate => validate(candidate)).sort(compare)[0] || null;
  }

  global.GameTargetResolver = Object.freeze({firstLegal, bestLegal});
})(window);
