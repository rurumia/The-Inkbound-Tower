(function createContinuousBattlefieldState(global) {
  "use strict";

  const INITIAL_TEMPLATES = Object.freeze([
    Object.freeze({templateId: "initial.spreader", name: "Spreader", attack: 1, hp: 3, move: 2, paint: 2, ai: "avoid", brush: {id: "initial.spreader.brush", shape: "round", widthU: 1.5}}),
    Object.freeze({templateId: "initial.resource", name: "Resource", attack: 1, hp: 4, move: 2, paint: 1, ai: "expand", brush: {id: "initial.resource.brush", shape: "round", widthU: 0.75}}),
    Object.freeze({templateId: "initial.fighter", name: "Fighter", attack: 3, hp: 2, move: 2, paint: 1, ai: "aggressive", brush: {id: "initial.fighter.brush", shape: "round", widthU: 0.75}})
  ]);

  function create(options = {}) {
    const random = options.random || Math.random;
    const regions = GameContinuousRegions.create();
    const paintField = GamePaintField.create({width: options.paintWidth || 960, height: options.paintHeight || 480, regions});
    const entities = GameContinuousEntities.create();
    const collision = GameContinuousCollision.create({entities: () => entities.list()});
    const navigation = GameContinuousNavigation.create({collision});
    const wells = GameContinuousWells.create({paintField, entities, random});
    const committedPlans = new Set();
    let actionSequence = 1;

    function spawnInitialSpirits() {
      if (entities.list(entity => entity.kind === "spirit").length) return;
      for (const [owner, x] of [[1, 4], [2, 56]]) {
        INITIAL_TEMPLATES.forEach((template, index) => entities.spawn({
          kind: "spirit",
          templateId: template.templateId,
          visualProfileId: template.templateId,
          name: template.name,
          owner,
          position: {x, y: 11 + index * 4},
          body: {kind: "circle", radius: 0.35},
          heightLayer: "ground",
          facing: {x: owner === 1 ? 1 : -1, y: 0},
          baseStats: {attack: template.attack, hp: template.hp, move: template.move, paint: template.paint},
          currentStats: {attack: template.attack, hp: template.hp, maxHp: template.hp, move: template.move, paint: template.paint},
          brush: GameContinuousBrushes.define(template.brush),
          ai: template.ai,
          statuses: []
        }));
      }
    }

    function setup() {
      wells.generate();
      spawnInitialSpirits();
      return snapshot();
    }

    function planMove(entityId, destination, options = {}) {
      const entity = entities.get(entityId);
      if (!entity || entity.kind !== "spirit") throw new Error(`Unknown continuous spirit: ${entityId}`);
      const movement = navigation.plan(entity, destination, {
        budget: options.budget ?? entity.currentStats.move,
        rooted: options.rooted || entity.statuses.includes("rooted")
      });
      const ownerSign = entity.owner === 1 ? 1 : -1;
      const paintOperations = entity.heightLayer === "ground"
        ? GameContinuousBrushes.operations(entity.brush, movement.path, ownerSign, {coverageMultiplier: options.brushCoverageMultiplier ?? 1})
        : [];
      return Object.freeze({
        id: `unit-action-${actionSequence++}`,
        entityId,
        owner: entity.owner,
        start: structuredClone(entity.position),
        end: structuredClone(movement.path.at(-1)),
        path: movement.path,
        pathLengthU: movement.length,
        reached: movement.reached,
        reason: movement.reason,
        collisionId: movement.collisionId,
        paintOperations: Object.freeze(paintOperations)
      });
    }

    function commitMove(plan) {
      if (committedPlans.has(plan.id)) throw new Error(`Continuous action already committed: ${plan.id}`);
      const entity = entities.get(plan.entityId);
      if (!entity) throw new Error(`Continuous action entity is no longer alive: ${plan.entityId}`);
      if (entity.position.x !== plan.start.x || entity.position.y !== plan.start.y) throw new Error("Continuous action start no longer matches world state.");
      for (const operation of plan.paintOperations) paintField.apply(operation);
      entities.update(plan.entityId, current => {
        current.position = plan.end;
        if (plan.path.length > 1) {
          const before = plan.path.at(-2);
          const dx = plan.end.x - before.x;
          const dy = plan.end.y - before.y;
          const length = Math.hypot(dx, dy);
          if (length) current.facing = {x: dx / length, y: dy / length};
        }
      });
      committedPlans.add(plan.id);
      return Object.freeze({entity: structuredClone(entities.get(plan.entityId)), territory: paintField.measure()});
    }

    function executeMove(entityId, destination, options = {}) {
      const plan = planMove(entityId, destination, options);
      return Object.freeze({plan, result: commitMove(plan)});
    }

    function resolveMapEnd() {
      const infiltration = GameContinuousInfiltration.resolve(paintField);
      const wellEvents = wells.update();
      return Object.freeze({infiltration, wellEvents: Object.freeze(wellEvents)});
    }

    function snapshot() {
      return Object.freeze({
        schemaVersion: 2,
        world: {width: GameWorldSpace.width, height: GameWorldSpace.height},
        territory: paintField.measure(),
        paintHash: paintField.hash(),
        wells: wells.list(),
        entities: entities.snapshot(),
        regions: regions.list().map(region => structuredClone(region))
      });
    }

    return Object.freeze({regions, paintField, entities, collision, navigation, wells, setup, planMove, commitMove, executeMove, resolveMapEnd, snapshot});
  }

  global.GameContinuousBattlefield = Object.freeze({initialTemplates: INITIAL_TEMPLATES, create});
})(window);
