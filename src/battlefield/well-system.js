(function createContinuousWellSystem(global) {
  "use strict";

  const CAPTURE_RATIO = 0.66;

  function create(options) {
    const field = options.paintField;
    const entities = options.entities;
    const random = options.random || Math.random;
    const wells = [];

    function generate() {
      if (wells.length) return list();
      const ranges = [[5, 18], [22, 38], [42, 55]];
      ranges.forEach(([minX, maxX], index) => {
        let position = null;
        for (let attempt = 0; attempt < 100 && !position; attempt++) {
          const candidate = GameWorldSpace.point(minX + random() * (maxX - minX), 4 + random() * 22);
          if (wells.every(well => GameWorldSpace.distance(well.position, candidate) >= 4)) position = candidate;
        }
        position ||= GameWorldSpace.point((minX + maxX) / 2, 15);
        const entity = entities.spawn({
          kind: "well",
          name: "墨井",
          owner: 0,
          position,
          body: {kind: "circle", radius: 0.45},
          heightLayer: "ground",
          visualProfileId: "battlefield.ink-well"
        });
        wells.push({id: `well-${index + 1}`, entityId: entity.id, position, owner: 0, pendingOwner: 0, innerRadiusU: 0.6, outerRadiusU: 1.6});
      });
      return list();
    }

    function ringControl(well) {
      let player = 0;
      let enemy = 0;
      let samples = 0;
      for (let radial = 0; radial < 4; radial++) {
        for (let index = 0; index < 72; index++) {
          const radius = well.innerRadiusU + (well.outerRadiusU - well.innerRadiusU) * (radial + 0.5) / 4;
          const angle = index * Math.PI * 2 / 72;
          const value = field.sample({x: well.position.x + Math.cos(angle) * radius, y: well.position.y + Math.sin(angle) * radius});
          player += Math.max(value, 0);
          enemy += Math.max(-value, 0);
          samples++;
        }
      }
      return Object.freeze({playerRatio: player / samples, enemyRatio: enemy / samples});
    }

    function update() {
      const events = [];
      for (const well of wells) {
        const control = ringControl(well);
        const surrounded = control.playerRatio + 1e-9 >= CAPTURE_RATIO ? 1 :
          control.enemyRatio + 1e-9 >= CAPTURE_RATIO ? 2 : 0;
        if (!surrounded) {
          well.pendingOwner = 0;
          continue;
        }
        if (well.owner === 0) {
          if (well.pendingOwner === surrounded) {
            well.owner = surrounded;
            well.pendingOwner = 0;
            entities.update(well.entityId, entity => { entity.owner = surrounded; });
            events.push({type: "WellCaptured", wellId: well.id, owner: surrounded});
          } else well.pendingOwner = surrounded;
        } else if (well.owner !== surrounded) {
          well.owner = 0;
          well.pendingOwner = surrounded;
          entities.update(well.entityId, entity => { entity.owner = 0; });
          events.push({type: "WellNeutralized", wellId: well.id, owner: surrounded});
        }
      }
      return events;
    }

    function income(owner) {
      return wells.filter(well => well.owner === owner).length;
    }

    function list() {
      return wells.map(well => structuredClone(well));
    }

    return Object.freeze({generate, ringControl, update, income, list});
  }

  global.GameContinuousWells = Object.freeze({captureRatio: CAPTURE_RATIO, create});
})(window);
