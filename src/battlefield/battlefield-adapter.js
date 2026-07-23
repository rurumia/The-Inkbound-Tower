(function createBattlefieldAdapter(global) {
  "use strict";

  function cellToWorld(cell) {
    if (!cell) return null;
    const rowOffset = cell.r % 2 ? -0.5 : 0;
    return GameWorldSpace.point(
      (cell.c + 0.5 + rowOffset) * GameWorldSpace.width / 60,
      (cell.r + 0.5) * GameWorldSpace.height / 30
    );
  }

  function worldToCell(point, cells) {
    if (!point || !cells?.length) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const cell of cells) {
      const distance = GameWorldSpace.distance(point, cellToWorld(cell));
      if (distance < bestDistance) {
        best = cell;
        bestDistance = distance;
      }
    }
    return bestDistance <= 0.9 ? best : null;
  }

  function visualProfileId(unit) {
    const initial = {Spreader: "initial.spreader", Resource: "initial.resource", Fighter: "initial.fighter"};
    return initial[unit?.name]
      || global.GameSpiritVisualProfiles?.getByName(unit?.name)?.id
      || "initial.spreader";
  }

  function unitPosition(unit) {
    return unit?._displayPosition || cellToWorld(unit?.cell);
  }

  function snapshot(battle) {
    const ownerCounts = {player: 0, enemy: 0, neutral: 0};
    for (const cell of battle?.cells || []) {
      if (cell.owner === 1) ownerCounts.player++;
      else if (cell.owner === 2) ownerCounts.enemy++;
      else ownerCounts.neutral++;
    }
    const total = Math.max(1, ownerCounts.player + ownerCounts.enemy + ownerCounts.neutral);
    return Object.freeze({
      territory: Object.freeze({
        player: ownerCounts.player / total * 1800,
        enemy: ownerCounts.enemy / total * 1800,
        neutral: ownerCounts.neutral / total * 1800,
        total: 1800
      }),
      units: (battle?.units || []).filter(unit => !unit.dead).map(unit => Object.freeze({
        id: unit.id,
        owner: unit.owner,
        name: unit.name,
        position: unitPosition(unit),
        profileId: visualProfileId(unit),
        heightLayer: unit.height === 2 ? "air" : "ground"
      })),
      wells: (battle?.wells || []).map(well => Object.freeze({...well, position: cellToWorld(well.cell)}))
    });
  }

  global.GameBattlefieldAdapter = Object.freeze({cellToWorld, worldToCell, visualProfileId, unitPosition, snapshot});
})(window);
