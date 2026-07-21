(function createOpponentSelection(global) {
  "use strict";

  function available(roleIds, cardsByRole) {
    return roleIds.filter(id => Array.isArray(cardsByRole[id]) && cardsByRole[id].length > 0);
  }

  function resolve(playerRole, selectedRole, roleIds, cardsByRole) {
    const roles = available(roleIds, cardsByRole);
    if (roles.includes(selectedRole)) return selectedRole;
    return roles.find(id => id !== playerRole) || roles[0] || playerRole;
  }

  global.GameOpponentSelection = Object.freeze({available, resolve});
})(window);
