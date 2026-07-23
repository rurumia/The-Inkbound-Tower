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
load("src/content/spirit-visual-profiles.js");
load("src/battlefield/battlefield-adapter.js");
load("src/content/brush-profiles.js");
load("src/content/spatial-effect-profiles.js");

test("all 51 cards and three role skills have one continuous spatial contract", () => {
  const cards = GameSpatialEffectProfiles.cards();
  assert.equal(cards.length, 51);
  assert.equal(new Set(cards.map(profile => profile.name)).size, 51);
  assert.deepEqual(GameSpatialEffectProfiles.skills().map(skill => skill.id), ["tailwind", "closeReading", "archive"]);
  assert.ok(cards.every(profile => profile.target && profile.shape && profile.animation));
});

test("key area effects use exact continuous world dimensions", () => {
  const quiet = GameSpatialEffectProfiles.geometry("噤声", {x: 20, y: 12});
  assert.deepEqual({kind: quiet.kind, radius: quiet.radius}, {kind: "circle", radius: 2.5});
  const purge = GameSpatialEffectProfiles.geometry("区域净化协议", {x: 28, y: 3});
  assert.deepEqual({center: purge.center, width: purge.width, height: purge.height}, {center: {x: 28, y: 15}, width: 10, height: 30});
  const study = GameSpatialEffectProfiles.geometry(GameSpatialEffectProfiles.getSkill("closeReading"), {x: 10, y: 10});
  assert.equal(study.radius, 1.5);
  assert.equal(GameSpatialEffectProfiles.get("真理之墙").radiusU, 3);
  assert.equal(GameSpatialEffectProfiles.get("最终论文：永恒结晶").radiusU, 2.5);
  assert.equal(GameSpatialEffectProfiles.get("墨水凝固者").radiusU, 1.5);
  assert.equal(GameSpatialEffectProfiles.validPlacement("噤声", {x: 1, y: 1}), false);
  assert.equal(GameSpatialEffectProfiles.validPlacement("噤声", {x: 10, y: 10}), true);
});

test("all 33 spirit templates have deterministic brush profiles", () => {
  const profiles = GameBrushProfiles.all();
  assert.equal(profiles.length, 33);
  assert.equal(new Set(profiles.map(profile => profile.id)).size, 33);
  assert.equal(GameBrushProfiles.get("initial.spreader").widthU, 2);
  assert.equal(GameBrushProfiles.get("fine.wall-of-truth").widthU, 0);
  assert.equal(GameBrushProfiles.widthForPaint(3), 3);
  assert.equal(GameBrushProfiles.get("sina.charging-sparrow").shape, "feather");
  assert.equal(GameBrushProfiles.get("fine.ink-solidifier").shape, "crystal");
  assert.equal(GameBrushProfiles.get("20735.patrol-a").shape, "gear");
  assert.equal(GameBrushProfiles.get("20735.cycle-pump").shape, "roller");
});
