(function createMapRulesSystem(global) {
  "use strict";

  function create() {
    const mechanics = [];

    function register(mechanic) {
      if (!mechanic || !mechanic.id) throw new Error("Map mechanic registration requires an id.");
      if (mechanics.some(current => current.id === mechanic.id)) {
        throw new Error(`Duplicate map mechanic id: ${mechanic.id}`);
      }
      mechanics.push(Object.freeze({...mechanic}));
    }

    function ownerChange(cell, toOwner, context = {}) {
      if (!cell) return {allowed: false, reason: "missing"};
      if (cell.owner === toOwner) return {allowed: false, reason: "unchanged"};
      for (const mechanic of mechanics) {
        const reason = mechanic.blockOwnerChange?.(cell, toOwner, context);
        if (reason) return {allowed: false, reason: mechanic.id};
      }
      return {allowed: true, reason: null};
    }

    function cellEffect(cell, effect, context = {}) {
      if (!cell) return {allowed: false, reason: "missing"};
      for (const mechanic of mechanics) {
        const reason = mechanic.blockCellEffect?.(cell, effect, context);
        if (reason) return {allowed: false, reason: mechanic.id};
      }
      return {allowed: true, reason: null};
    }

    function inspectOwnerChanges(cells, toOwner, context = {}) {
      const result = {changeable: [], blocked: [], unchanged: [], territory: 0};
      [...new Set(cells.filter(Boolean))].forEach(cell => {
        const verdict = ownerChange(cell, toOwner, context);
        if (verdict.allowed) {
          result.changeable.push(cell);
          result.territory += toOwner === 0 ? 1 : cell.owner === 0 ? 1 : 2;
        } else if (verdict.reason === "unchanged") result.unchanged.push(cell);
        else result.blocked.push(cell);
      });
      return result;
    }

    function tryChangeOwner(cell, toOwner, context = {}) {
      if (!ownerChange(cell, toOwner, context).allowed) return false;
      cell.owner = toOwner;
      return true;
    }

    function tryCellEffect(cell, effect, mutate, context = {}) {
      if (!cellEffect(cell, effect, context).allowed) return false;
      mutate(cell);
      return true;
    }

    function inspectCrystallize(cells, context = {}) {
      const result = {changeable: [], blocked: [], unchanged: []};
      [...new Set(cells.filter(Boolean))].forEach(cell => {
        if (cell.crystal) {
          result.unchanged.push(cell);
          return;
        }
        (cellEffect(cell, "crystallize", context).allowed
          ? result.changeable
          : result.blocked).push(cell);
      });
      return result;
    }

    return Object.freeze({
      register,
      ownerChange,
      cellEffect,
      inspectOwnerChanges,
      tryChangeOwner,
      tryCellEffect,
      inspectCrystallize
    });
  }

  function createDefault() {
    const rules = create();
    rules.register({
      id: "crystal",
      blockOwnerChange(cell) {
        return cell.crystal ? "crystal" : null;
      },
      blockCellEffect(cell, effect, context) {
        return cell.crystal ? "crystal" : null;
      }
    });
    rules.register({
      id: "spell-block",
      blockOwnerChange(cell, toOwner, context) {
        return cell.spellBlocked && (context.source === "card" || context.source === "skill")
          ? "spell-block"
          : null;
      },
      blockCellEffect(cell, effect, context) {
        return cell.spellBlocked && (context.source === "card" || context.source === "skill")
          ? "spell-block"
          : null;
      }
    });
    return rules;
  }

  global.GameMapRulesSystem = Object.freeze({create, createDefault});
})(window);
