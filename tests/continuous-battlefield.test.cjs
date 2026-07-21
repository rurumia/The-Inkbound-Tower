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
