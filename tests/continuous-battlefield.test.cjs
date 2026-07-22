const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;

function load(relativePath) {
  const target = path.join(__dirname, "..", relativePath);
  delete require.cache[require.resolve(target)];
  require(target);
}

load("src/battlefield/world-space.js");
load("src/battlefield/geometry.js");
load("src/battlefield/region-system.js");
load("src/battlefield/paint-field.js");
load("src/battlefield/collision-system.js");
load("src/battlefield/navigation-system.js");
load("src/battlefield/brush-system.js");
load("src/battlefield/entity-store.js");
load("src/battlefield/well-system.js");
load("src/battlefield/infiltration-system.js");
load("src/battlefield/territory-ai.js");
load("src/battlefield/battlefield-state.js");
load("src/presentation/action-sequencer.js");
load("src/presentation/camera-2d.js");
load("src/content/spirit-visual-profiles.js");

test("continuous world is 60U by 30U and quantizes commands to 1/256U", () => {
  assert.equal(GameWorldSpace.width, 60);
  assert.equal(GameWorldSpace.height, 30);
  assert.equal(GameWorldSpace.quantize(1 / 300), 1 / 256);
  assert.deepEqual(GameWorldSpace.clampPoint({x: -4, y: 40}, 0.35), {x: 0.3515625, y: 29.6484375});
});

test("a new continuous battlefield is completely neutral", () => {
  const field = GamePaintField.create({width: 120, height: 60});
  assert.deepEqual(field.measure(), {player: 0, enemy: 0, neutral: 1800, total: 1800});
});

test("continuous paint is deterministic and territory always totals 1800U2", () => {
  const shape = GameContinuousGeometry.pathStroke([{x: 2, y: 10}, {x: 18, y: 10}], 0.75);
  const first = GamePaintField.create({width: 240, height: 120});
  const second = GamePaintField.create({width: 240, height: 120});
  first.apply({shape, owner: 1, kind: "paint", strength: 1});
  second.apply({shape, owner: 1, kind: "paint", strength: 1});
  assert.equal(first.hash(), second.hash());
  assert.ok(first.measure().player > 20);
  const measured = first.measure();
  assert.ok(Math.abs(measured.player + measured.enemy + measured.neutral - 1800) < 1e-8);
});

test("crystal regions reject paint, neutralize, skill, and later region effects", () => {
  const regions = GameContinuousRegions.create();
  const crystal = GameContinuousGeometry.circle({x: 10, y: 10}, 2);
  const field = GamePaintField.create({width: 240, height: 120, regions});
  field.apply({shape: crystal, owner: -1, kind: "paint", strength: 1});
  regions.add({type: "crystal", shape: crystal, owner: -1, permanent: true});
  const before = field.hash();
  field.apply({shape: crystal, owner: 1, kind: "paint", source: "unit", strength: 1});
  field.apply({shape: crystal, owner: 0, kind: "effect", source: "card", mode: "neutralize"});
  assert.equal(field.hash(), before);
  assert.equal(regions.permits({x: 10, y: 10}, {kind: "effect", source: "skill"}), false);
  regions.add({type: "study", shape: crystal, owner: 1});
  assert.equal(regions.has("study", {x: 10, y: 10}), false);
  assert.equal(regions.has("crystal", {x: 10, y: 10}), true);
});

test("spell block stops cards and skills but not ordinary unit paint", () => {
  const regions = GameContinuousRegions.create();
  const shape = GameContinuousGeometry.rect({x: 20, y: 15}, 5, 5);
  regions.add({type: "spellBlock", shape, owner: 1});
  assert.equal(regions.permits({x: 20, y: 15}, {kind: "effect", source: "card", owner: -1}), false);
  assert.equal(regions.permits({x: 20, y: 15}, {kind: "paint", source: "unit", owner: -1}), true);
});

test("continuous navigation obeys path budget and stops before a same-layer body", () => {
  const mover = {id: "mover", position: {x: 2, y: 5}, body: {radius: 0.35}, heightLayer: "ground", movementU: 8};
  const blocker = {id: "blocker", position: {x: 5, y: 5}, body: {radius: 0.35}, heightLayer: "ground", alive: true};
  const collision = GameContinuousCollision.create({entities: [mover, blocker]});
  const navigation = GameContinuousNavigation.create({collision});
  const plan = navigation.plan(mover, {x: 10, y: 5}, {budget: 2});
  assert.ok(plan.length <= 2 + 1 / 256);
  assert.ok(plan.path.at(-1).x < blocker.position.x - 0.69);
});

test("ground and flying entities can pass through each other", () => {
  const mover = {id: "air", position: {x: 2, y: 5}, body: {radius: 0.35}, heightLayer: "air", movementU: 8};
  const ground = {id: "ground", position: {x: 5, y: 5}, body: {radius: 0.35}, heightLayer: "ground", alive: true};
  const collision = GameContinuousCollision.create({entities: [mover, ground]});
  const navigation = GameContinuousNavigation.create({collision});
  const plan = navigation.plan(mover, {x: 8, y: 5}, {budget: 8});
  assert.equal(plan.reached, true);
  assert.equal(plan.reason, "direct");
});

test("brush stamps are sampled by arc length and ignore animation frame count", () => {
  const profile = GameContinuousBrushes.define({id: "test-brush", widthU: 0.75, flow: 1});
  const path = [{x: 2, y: 8}, {x: 6, y: 8}, {x: 10, y: 12}];
  const firstField = GamePaintField.create({width: 240, height: 120});
  const secondField = GamePaintField.create({width: 240, height: 120});
  const first = GameContinuousBrushes.apply(firstField, profile, path, 1);
  const second = GameContinuousBrushes.apply(secondField, profile, path, 1);
  assert.equal(firstField.hash(), secondField.hash());
  assert.equal(first.operations.length, second.operations.length);
  assert.ok(first.operations.length > 100);
  assert.equal(first.operations.at(-1).progress, 1);
});

test("nearby drone distance includes exactly 3U", () => {
  assert.equal(GameWorldSpace.distance({x: 10, y: 10}, {x: 13, y: 10}), 3);
  assert.equal(GameWorldSpace.distance({x: 10, y: 10}, {x: 13, y: 10}) <= 3, true);
});

test("continuous battle setup starts neutral with three wells and six initial spirits", () => {
  let value = 0;
  const battlefield = GameContinuousBattlefield.create({paintWidth: 120, paintHeight: 60, random: () => (value = (value + 0.173) % 1)});
  const state = battlefield.setup();
  assert.deepEqual(state.territory, {player: 0, enemy: 0, neutral: 1800, total: 1800});
  assert.equal(state.wells.length, 3);
  assert.ok(state.wells.every(well => well.owner === 0));
  assert.equal(state.entities.filter(entity => entity.kind === "spirit" && entity.owner === 1).length, 3);
  assert.equal(state.entities.filter(entity => entity.kind === "spirit" && entity.owner === 2).length, 3);
  assert.equal(new Set(state.entities.filter(entity => entity.kind === "spirit").map(entity => entity.visualProfileId)).size, 3);
});

test("a planned initial spirit action is continuous, deterministic, and committed once", () => {
  const battlefield = GameContinuousBattlefield.create({paintWidth: 240, paintHeight: 120, random: () => 0.5});
  battlefield.setup();
  const spirit = battlefield.entities.list(entity => entity.kind === "spirit" && entity.owner === 1)[0];
  const before = battlefield.snapshot();
  const plan = battlefield.planMove(spirit.id, {x: 12, y: spirit.position.y});
  assert.ok(plan.pathLengthU <= spirit.currentStats.move + 1 / 256);
  assert.ok(plan.path.length >= 2);
  assert.ok(plan.paintOperations.length > 1);
  assert.equal(battlefield.snapshot().paintHash, before.paintHash);
  const committed = battlefield.commitMove(plan);
  assert.ok(committed.territory.player > 0);
  assert.throws(() => battlefield.commitMove(plan), /already committed/);
});

test("continuous infiltration fills a neutral hole from a pre-resolution snapshot", () => {
  const field = GamePaintField.create({width: 240, height: 120});
  field.apply({shape: GameContinuousGeometry.circle({x: 20, y: 15}, 3), owner: 1, kind: "paint", strength: 1});
  field.apply({shape: GameContinuousGeometry.circle({x: 20, y: 15}, 0.35), owner: 0, kind: "effect", source: "test", mode: "neutralize"});
  assert.equal(field.sample({x: 20, y: 15}), 0);
  const changes = GameContinuousInfiltration.resolve(field, {spacingU: 0.5});
  assert.ok(changes.length > 0);
  assert.ok(field.sample({x: 20, y: 15}) > 0);
});

test("a neutral well requires two consecutive qualifying surrounds", () => {
  const entities = GameContinuousEntities.create();
  const field = GamePaintField.create({width: 240, height: 120});
  const wells = GameContinuousWells.create({paintField: field, entities, random: () => 0.5});
  const well = wells.generate()[0];
  field.apply({shape: GameContinuousGeometry.circle(well.position, well.outerRadiusU), owner: 1, kind: "paint", strength: 1});
  field.apply({shape: GameContinuousGeometry.circle(well.position, well.innerRadiusU), owner: 0, kind: "effect", mode: "neutralize"});
  assert.equal(wells.update().length, 0);
  assert.equal(wells.list()[0].owner, 0);
  const events = wells.update();
  assert.equal(events[0].type, "WellCaptured");
  assert.equal(wells.list()[0].owner, 1);
  assert.equal(wells.income(1), 1);
});

test("action sequencing follows path arc length without mutating the action plan", () => {
  const plan = Object.freeze({
    pathLengthU: 10,
    path: Object.freeze([{x: 0, y: 0}, {x: 6, y: 0}, {x: 6, y: 4}]),
    paintOperations: Object.freeze([{progress: 0}, {progress: 0.25}, {progress: 0.75}, {progress: 1}])
  });
  const middle = GameActionSequencer.frameFor(plan, 0.5);
  assert.deepEqual(middle.position, {x: 5, y: 0});
  assert.equal(middle.visiblePaintCount, 2);
  assert.equal(middle.complete, false);
  assert.deepEqual(GameActionSequencer.frameFor(plan, 1).position, {x: 6, y: 4});
});

test("all 33 spirit templates have independent Spine asset contracts", () => {
  const profiles = GameSpiritVisualProfiles.all();
  assert.equal(profiles.length, 33);
  assert.equal(new Set(profiles.map(profile => profile.id)).size, 33);
  assert.equal(new Set(profiles.map(profile => profile.assetRoot)).size, 33);
  for (const profile of profiles) {
    assert.ok(GameSpiritVisualProfiles.baseAnimations.every(animation => profile.requiredAnimations.includes(animation)), profile.id);
    assert.ok(profile.requiredSlots.includes("brush_anchor"), profile.id);
    assert.ok(profile.requiredSlots.includes("hit_anchor"), profile.id);
    assert.ok(profile.requiredBones.includes("root"), profile.id);
  }
});

test("continuous territory AI seeks a distant frontier when its local area is fully friendly", () => {
  const field = GamePaintField.create({width: 240, height: 120});
  field.apply({shape: GameContinuousGeometry.rect({x: 30, y: 15}, 60, 30), owner: 1, kind: "paint", strength: 1});
  field.apply({shape: GameContinuousGeometry.circle({x: 50, y: 15}, 1), owner: 0, kind: "effect", mode: "neutralize"});
  const unit = {id: "seeker", owner: 1, position: {x: 4, y: 15}, body: {radius: 0.35}, heightLayer: "ground", currentStats: {move: 3}, ai: "expand"};
  const collision = GameContinuousCollision.create({entities: [unit]});
  const navigation = GameContinuousNavigation.create({collision});
  const ai = GameContinuousTerritoryAI.create({paintField: field, navigation});
  assert.equal(ai.localFullyFriendly(unit), true);
  assert.ok(ai.chooseDestination(unit).x > 45);
});

test("continuous camera round-trips points through fit, pan, and zoom", () => {
  const camera = GameContinuousCamera.create({width: 1200, height: 600, padding: 0});
  camera.fit();
  camera.pan(15, -8);
  camera.zoomAt({x: 400, y: 220}, 1.4);
  const source = {x: 18.25, y: 9.75};
  const restored = camera.screenToWorld(camera.worldToScreen(source));
  assert.ok(GameWorldSpace.distance(source, restored) <= 1 / 256);
});
