(function register20735Effects(global) {
  "use strict";

  const registry = global.GameEffectRegistry;
  const modifiers = global.GameModifierSystem;
  const statuses = global.GameStatusSystem;
  if (!registry || !modifiers || !statuses) {
    throw new Error("20735 effects require the effect, modifier, and status systems.");
  }

  const register = (id, handler) => registry.register(`20735.${id}`, handler);
  const nearbyDrone = (api, unit, radius = 3) => api.units(unit.owner)
    .filter(other => other !== unit && api.hasTag(other, "无人机") &&
      api.distance(unit.cell, other.cell) <= radius)
    .sort((a, b) => api.distance(unit.cell, a.cell) - api.distance(unit.cell, b.cell) || a.birth - b.birth)[0] || null;
  const showNearbyLink = (api, unit, radius = 3) => {
    const partner = nearbyDrone(api, unit, radius);
    if (partner) api.showDroneLink(unit, partner);
    return partner;
  };
  const randomTake = (api, values, count) => {
    const pool = [...values];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(api.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  };

  if (!statuses.has("20735.cooling")) {
    statuses.register("20735.cooling", {
      apply({unit, entry}) {
        entry.data.maxHpBonus = 2;
        unit.maxHp += entry.data.maxHpBonus;
        unit.hp += entry.data.maxHpBonus;
        unit.cooling = true;
      },
      beforeAction({unit, movementBeforeStatus, paintBeforeStatus}) {
        unit.effectMove -= movementBeforeStatus;
        unit.effectPaint -= paintBeforeStatus;
      },
      afterAction({unit, api}) {
        unit.permanentMove = (unit.permanentMove || 0) + 1;
        api.log(`${unit.name}结束冷却，永久获得1移动力。`, "b");
        return {remove: true};
      },
      remove({unit, entry}) {
        unit.maxHp = Math.max(1, unit.maxHp - entry.data.maxHpBonus);
        unit.hp = Math.min(unit.hp, unit.maxHp);
        unit.cooling = false;
      }
    });
  }

  register("maintenance-alpha", {
    turnStart({unit, api}) {
      api.gainInk(unit.owner, api.units(unit.owner).length >= 3 ? 3 : 2, unit.name);
    }
  });

  register("cycle-pump", {
    turnStart({unit, api}) {
      api.gainInk(unit.owner, 3, unit.name);
    },
    turnEnd({unit, side, api}) {
      if (!side.playedAggressive) api.gainInk(unit.owner, 1, "保守协议");
    }
  });

  register("emergency-generator", {
    summon({unit, side, sourceInstance, api}) {
      api.gainInk(unit.owner, 1, unit.name);
      api.discardOther(side, sourceInstance, "应急发电机");
    },
    turnEnd({unit, api}) {
      api.gainInk(unit.owner, 2, unit.name);
    }
  });

  register("scrap-pile", {
    sacrificed({instance, side, api}) {
      api.gainInk(side.owner, 1, "废料回收");
      if ((instance.handTurns || 0) >= 4) {
        api.gainInk(side.owner, 2, "精炼协议");
        side.bonusPlayAfterSacrifice = true;
      }
    }
  });

  register("patrol-a", {
    painted({unit, cell, previousOwner, api}) {
      if (unit.protocolComplete || previousOwner !== api.enemyOwner(unit.owner)) return;
      unit.protocolProgress = (unit.protocolProgress || 0) + 1;
      if (unit.protocolProgress < 6) return;
      unit.protocolComplete = true;
      unit.attack += 1;
      api.neighbors(unit.cell).filter(cell => cell.owner !== unit.owner).slice(0, 3)
        .forEach(cell => api.paint(cell, unit.owner, {source: "protocol"}));
      api.log("标准巡逻兵·A型完成回收协议。", "b");
    }
  });

  register("purifier-mk2", {
    painted({unit, cell, api}) {
      api.protectCell(cell, unit);
    },
    blockedPaint({unit, count, api}) {
      if (unit.protocolComplete) return;
      unit.protocolProgress = (unit.protocolProgress || 0) + count;
      if (unit.protocolProgress < 4) return;
      unit.protocolComplete = true;
      const temporaryBonus = unit.cooling ? 2 : 0;
      const desiredMaxHp = 6 + temporaryBonus;
      const gained = Math.max(0, desiredMaxHp - unit.maxHp);
      unit.maxHp = desiredMaxHp;
      unit.hp += gained;
      api.log("净化单元·Mk-II完成洁净协议，耐久上限变为6。", "b");
    }
  });

  register("mass-drone", {
    statModifiers({unit, api}) {
      return nearbyDrone(api, unit) ? {attack: 1, paint: 1} : null;
    },
    beforeUnitAct({unit, api}) {
      showNearbyLink(api, unit);
    }
  });

  register("interceptor-sigma", {
    statModifiers({unit, api}) {
      return nearbyDrone(api, unit) ? {attack: 1} : null;
    },
    beforeUnitAct({unit, api}) {
      showNearbyLink(api, unit);
    },
    redirectDamage({unit, target, api}) {
      if (target === unit || !api.hasTag(target, "无人机") || api.distance(unit.cell, target.cell) > 1) return null;
      api.showDroneLink(unit, target);
      return unit;
    },
    redirectedDamage({unit, amount, source, api}) {
      unit.protocolProgress = (unit.protocolProgress || 0) + amount;
      if (source && !source.dead && source.owner !== unit.owner) api.dealEffectDamage(source, 1, unit);
      if (!unit.protocolComplete && unit.protocolProgress >= 2) {
        unit.protocolComplete = true;
        unit.maxHp += 2;
        unit.hp += 2;
        api.neighbors(unit.cell).flatMap(cell => [cell.ground, cell.air]).filter(Boolean)
          .filter(other => other.owner === unit.owner && api.hasTag(other, "无人机"))
          .forEach(other => {
            other.permanentMove = (other.permanentMove || 0) + 1;
            api.showDroneLink(unit, other);
          });
        api.log("拦截无人机·Σ型完成护盾协议。", "b");
      }
    }
  });

  register("painting-delta", {
    statModifiers({unit, api}) {
      return nearbyDrone(api, unit) ? {move: 1} : null;
    },
    beforeUnitAct({unit, api}) {
      showNearbyLink(api, unit);
    },
    afterUnitAct({unit, api}) {
      if (!showNearbyLink(api, unit)) return;
      randomTake(api, api.neighbors(unit.cell).filter(cell => cell.owner !== unit.owner), 2)
        .forEach(cell => api.paint(cell, unit.owner, {source: "drone"}));
    }
  });

  register("repair-omega", {
    beforeUnitAct({unit, api}) {
      showNearbyLink(api, unit);
    },
    afterUnitAct({unit, api}) {
      const targets = api.units(unit.owner)
        .filter(other => other !== unit && other.hp < api.baseStats(other).hp && api.distance(unit.cell, other.cell) <= 5)
        .sort((a, b) => Number(api.hasTag(b, "无人机")) - Number(api.hasTag(a, "无人机")) || a.hp - b.hp);
      if (targets[0]) {
        const target = targets[0];
        target.hp = Math.min(api.baseStats(target).hp, target.hp + 1);
        if (api.hasTag(target, "无人机")) api.showDroneLink(unit, target);
      }
    },
    unitDestroyed({unit, destroyed, event, api}) {
      if (event.droneInkClaimed || !api.hasTag(destroyed, "无人机")) return;
      event.droneInkClaimed = true;
      api.showDroneLink(unit, destroyed);
      api.gainInk(unit.owner, 1, "零件回收");
    },
    blockAttack({unit, attacker, api}) {
      return attacker.owner !== unit.owner && !!nearbyDrone(api, unit);
    }
  });

  register("system-maintenance", {
    play({owner, target, sourceInstance, api}) {
      const unit = api.asUnit(target);
      if (unit.resource) {
        unit.duration += 1;
        api.discardOther(api.side(owner), sourceInstance, "系统维护过载");
      } else {
        unit.hp = Math.min(unit.maxHp, unit.hp + 2);
      }
    }
  });

  register("area-purge", {
    play({owner, target, api}) {
      const start = Math.max(0, Math.min(51, target.c - 4));
      const area = api.cells().filter(cell => cell.c >= start && cell.c < start + 10);
      const unitCells = area.filter(cell => !cell.spellBlocked);
      area.forEach(cell => api.neutralize(cell));
      const affected = new Set(unitCells.flatMap(cell => [cell.ground, cell.air]).filter(Boolean));
      affected.forEach(unit => api.pushToHalfEdge(unit));
    }
  });

  register("emergency-cooling", {
    play({owner, target, side, api}) {
      const unit = api.asUnit(target);
      statuses.apply(unit, "20735.cooling", {api});
      side.cooledUnitIds = side.cooledUnitIds || new Set();
      side.cooledUnitIds.add(unit.id);
      if (!side.coolingProtocolComplete && side.cooledUnitIds.size >= 3) {
        side.coolingProtocolComplete = true;
        api.gainInk(owner, 4, "保护协议");
      }
    }
  });

  register("reserve-energy", {
    play({owner, target, api}) {
      const unit = api.asUnit(target);
      if (unit.resource) {
        unit.duration += 1;
        api.gainInk(owner, 2, "备用能源调配");
        if (unit.duration <= 3) unit.doubleNextProduction = true;
      } else {
        unit.hp = Math.min(unit.maxHp, unit.hp + 2);
      }
    }
  });

  register("defense-matrix", {
    play({owner, target, api}) {
      api.createFortification(owner, target);
      if (api.units(owner).filter(unit => api.hasTag(unit, "无人机")).length >= 2) {
        const second = api.neighbors(target).find(cell => api.canPlaceFortification(owner, cell));
        if (second) api.createFortification(owner, second);
      }
    }
  });

  register("efficiency-order", {
    play({owner, target, side, archived, archiveSource, api}) {
      const modifier = {movement: 2, paint: 2, production: 2};
      if (archived) modifiers.queue(side, "20735.efficiency-order", modifier);
      else modifiers.apply(side, "20735.efficiency-order", modifier);
      if (target && target.payOverload && (archiveSource === "skill" || api.payInk(owner, 3))) return;
      side.skipTurns = (side.skipTurns || 0) + 2;
    }
  });

  register("singularity", {
    play({side, target, api}) {
      const instances = target && Array.isArray(target.instances) ? target.instances : [];
      api.archiveDiscardBatch(side, instances);
    }
  });
})(window);
