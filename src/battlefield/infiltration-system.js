(function createContinuousInfiltrationSystem(global) {
  "use strict";

  function resolve(paintField, options = {}) {
    const spacingU = options.spacingU || 0.5;
    const radiusU = options.radiusU || 1;
    const threshold = options.threshold || 5 / 6;
    const operations = [];

    for (let y = spacingU / 2; y < GameWorldSpace.height; y += spacingU) {
      for (let x = spacingU / 2; x < GameWorldSpace.width; x += spacingU) {
        const point = {x, y};
        const current = paintField.sample(point);
        if (Math.abs(current) >= 0.5) continue;
        let player = 0;
        let enemy = 0;
        const samples = 12;
        for (let index = 0; index < samples; index++) {
          const angle = index * Math.PI * 2 / samples;
          const value = paintField.sample({x: x + Math.cos(angle) * radiusU, y: y + Math.sin(angle) * radiusU});
          player += Math.max(value, 0);
          enemy += Math.max(-value, 0);
        }
        if (player / samples >= threshold) operations.push({point: GameWorldSpace.point(x, y), owner: 1});
        else if (enemy / samples >= threshold) operations.push({point: GameWorldSpace.point(x, y), owner: -1});
      }
    }

    for (const operation of operations) {
      paintField.apply({
        shape: GameContinuousGeometry.circle(operation.point, spacingU * 1.1),
        owner: operation.owner,
        kind: "infiltration",
        source: "map",
        strength: 0.5
      });
    }
    return Object.freeze(operations);
  }

  global.GameContinuousInfiltration = Object.freeze({resolve});
})(window);
