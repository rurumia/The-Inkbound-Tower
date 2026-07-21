const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;

function load(relativePath) {
  const target = path.join(__dirname, "..", relativePath);
  delete require.cache[require.resolve(target)];
  require(target);
}

load("src/engine/effect-registry.js");
load("src/engine/archive-system.js");
load("src/engine/archive-target-snapshot.js");
load("src/engine/archive-cast-system.js");
load("src/engine/hand-system.js");
load("src/engine/modifier-system.js");
load("src/engine/status-system.js");
load("src/engine/drone-link-system.js");
load("src/engine/target-resolver.js");
load("src/engine/opponent-selection.js");
load("src/engine/map-rules.js");
load("src/content/character-20735.js");
load("src/content/effects-20735.js");

test("crystal tiles reject ownership changes and every later cell effect", () => {
  const rules = GameMapRulesSystem.createDefault();
  const cell = {owner: 2, crystal: true, studied: false, spellBlocked: false};
  assert.equal(rules.tryChangeOwner(cell, 0, {source: "card"}), false);
  assert.equal(rules.tryCellEffect(cell, "neutralize", current => { current.owner = 0; }, {source: "card"}), false);
  assert.equal(rules.tryCellEffect(cell, "studied", current => { current.studied = true; }, {source: "skill"}), false);
  assert.equal(rules.tryCellEffect(cell, "studied", current => { current.studied = true; }, {sourceCleanup: true}), false);
  assert.equal(rules.tryCellEffect(cell, "spell-block", current => { current.spellBlocked = true; }, {source: "card"}), false);
  assert.deepEqual(cell, {owner: 2, crystal: true, studied: false, spellBlocked: false});
});

test("non-crystal tiles still accept normal cell effects", () => {
  const rules = GameMapRulesSystem.createDefault();
  const cell = {owner: 2, crystal: false, studied: false, spellBlocked: false};
  assert.equal(rules.tryCellEffect(cell, "neutralize", current => { current.owner = 0; }, {source: "card"}), true);
  assert.equal(rules.tryCellEffect(cell, "studied", current => { current.studied = true; }, {source: "skill"}), true);
  assert.equal(cell.owner, 0);
  assert.equal(cell.studied, true);
});

test("area purge preserves crystal tiles while still pushing units standing on them", () => {
  const rules = GameMapRulesSystem.createDefault();
  const crystalUnit = {id: 1};
  const normalUnit = {id: 2};
  const crystal = {c: 4, owner: 2, crystal: true, spellBlocked: false, ground: crystalUnit, air: null};
  const normal = {c: 5, owner: 2, crystal: false, spellBlocked: false, ground: normalUnit, air: null};
  const pushed = [];
  const api = {
    cells: () => [crystal, normal],
    neutralize: cell => rules.tryCellEffect(cell, "neutralize", current => { current.owner = 0; }, {source: "card"}),
    pushToHalfEdge: unit => pushed.push(unit)
  };
  GameEffectRegistry.invoke("20735.area-purge", "play", {owner: 1, target: {c: 5}, api});
  assert.equal(crystal.owner, 2);
  assert.equal(crystal.crystal, true);
  assert.equal(normal.owner, 0);
  assert.deepEqual(pushed, [crystalUnit, normalUnit]);
});

test("20735 registers one character and a complete 17-card deck", () => {
  const module = GameContentModules.characters.find(entry => entry.role.id === "20735");
  assert.ok(module);
  assert.equal(module.cards.length, 17);
  assert.equal(new Set(module.cards.map(card => card.name)).size, 17);
  assert.equal(module.cards.filter(card => card.type === "资源书灵").length, 4);
  assert.equal(module.cards.at(-1).name, "超维归档：奇点");
  module.cards.forEach(card => assert.ok(GameEffectRegistry.has(card.effectId), card.effectId));
});

test("skill archive moves a card into the independent zone and preserves its target", () => {
  const instance = {name: "测试牌", handTurns: 0};
  const side = {hand: [instance], discard: [], archiveZone: []};
  const snapshot = {kind: "cell", r: 4, c: 7};
  assert.equal(GameArchiveSystem.archiveHand(side, instance, 2, snapshot), true);
  assert.equal(side.hand.length, 0);
  assert.equal(side.archiveZone.length, 1);
  assert.deepEqual(side.archiveZone[0].targetSnapshot, snapshot);
  assert.equal(GameArchiveSystem.tick(side).length, 0);
  const due = GameArchiveSystem.tick(side);
  assert.equal(due.length, 1);
  assert.equal(GameArchiveSystem.release(side, due[0]), instance);
  assert.equal(side.archiveZone.length, 0);
  assert.equal(side.discard.length, 0);
});

test("cards in the independent archive zone do not prevent refilling the hand", () => {
  const side = {
    hand: [],
    archiveZone: [{instance: {name: "归档牌"}, remaining: 2}],
    draw: Array.from({length: 5}, (_, index) => ({name: `补牌${index + 1}`}))
  };
  const drawn = GameHandSystem.refill(side, 5, current => {
    const instance = current.draw.pop();
    if (!instance) return null;
    current.hand.push(instance);
    return instance;
  });
  assert.equal(drawn, 5);
  assert.equal(GameHandSystem.activeCount(side), 5);
  assert.equal(side.hand.length, 5);
  assert.equal(side.archiveZone.length, 1);
});

test("archive target snapshots resolve cells and live units without retargeting", () => {
  const cell = {r: 3, c: 8};
  const unit = {id: 17, name: "锁定单位"};
  const context = {
    cellAt: (r, c) => r === 3 && c === 8 ? cell : null,
    units: () => [unit],
    side: {discard: []}
  };
  assert.equal(GameArchiveTargetSnapshot.resolve({kind: "cell", r: 3, c: 8}, context), cell);
  assert.equal(GameArchiveTargetSnapshot.resolve({kind: "unit", unitId: 17}, context), unit);
  assert.equal(GameArchiveTargetSnapshot.resolve({kind: "unit", unitId: 99}, context), null);
});

test("archive AI selects the first legal card by priority then deck order", () => {
  const cards = [
    {id: 1, name: "高优先级数字", priority: 7, order: 0},
    {id: 2, name: "先检查但非法", priority: 1, order: 0},
    {id: 3, name: "最终选择", priority: 1, order: 1}
  ];
  const defs = new Map([
    ["高优先级数字", {name: "高优先级数字", target: "none"}],
    ["先检查但非法", {name: "先检查但非法", target: "cell"}],
    ["最终选择", {name: "最终选择", target: "cell"}]
  ]);
  const legalTarget = {r: 2, c: 4};
  const plan = GameArchiveCastSystem.createAiPlan({owner: 1, hand: cards}, {
    getDef: instance => defs.get(instance.name),
    findTarget: def => def.name === "最终选择" ? legalTarget : null,
    validateTarget: (_def, _owner, target) => target === legalTarget,
    captureTarget: GameArchiveTargetSnapshot.capture
  });
  assert.equal(plan.instance, cards[2]);
  assert.deepEqual(plan.targetSnapshot, {kind: "cell", r: 2, c: 4});
});

test("archive delay includes a locked optional ink cost", () => {
  const def = {
    cost: 10,
    archiveDelayOption: {snapshotKind: "choice", field: "payOverload", value: true, extraTurns: 3}
  };
  assert.equal(GameArchiveCastSystem.waitTurns(def, {kind: "choice", payload: {payOverload: false}}), 5);
  assert.equal(GameArchiveCastSystem.waitTurns(def, {kind: "choice", payload: {payOverload: true}}), 8);
});

test("an archived discard selection becomes invalid when any locked card leaves discard", () => {
  const first = {id: 1}, second = {id: 2};
  const snapshot = {kind: "instances", instanceIds: [1, 2]};
  const context = {cellAt() {}, units: () => [], side: {discard: [first]}};
  assert.equal(GameArchiveTargetSnapshot.resolve(snapshot, context), null);
  context.side.discard.push(second);
  assert.deepEqual(GameArchiveTargetSnapshot.resolve(snapshot, context), {instances: [first, second]});
});

test("hand refill stops cleanly when no card can be drawn", () => {
  const side = {hand: [], draw: []};
  assert.equal(GameHandSystem.refill(side, 5, () => null), 0);
  assert.equal(side.hand.length, 0);
});

test("singularity releases at most one due card from the same batch per turn", () => {
  const first = {name: "甲"}, second = {name: "乙"};
  const side = {hand: [], discard: [first, second], archiveZone: []};
  GameArchiveSystem.archiveDiscardBatch(side, [first, second], () => 2);
  const firstDue = GameArchiveSystem.tick(side);
  assert.equal(firstDue.length, 1);
  assert.equal(GameArchiveSystem.release(side, firstDue[0]), first);
  const secondDue = GameArchiveSystem.tick(side);
  assert.equal(secondDue.length, 1);
  assert.equal(GameArchiveSystem.release(side, secondDue[0]), second);
});

test("opponent selection preserves explicit mirror matches and supplies a fallback", () => {
  const cards = {sina: [{}], fine: [{}], "20735": [{}]};
  const roles = Object.keys(cards);
  assert.equal(GameOpponentSelection.resolve("20735", "20735", roles, cards), "20735");
  assert.equal(GameOpponentSelection.resolve("20735", null, roles, cards), "sina");
});

test("efficiency order applies all three turn multipliers", () => {
  const side = {};
  const api = {payInk: () => true};
  GameEffectRegistry.invoke("20735.efficiency-order", "play", {
    owner: 1, target: {payOverload: true}, side, archived: false, api
  });
  assert.equal(GameModifierSystem.multiplier(side, "movement"), 2);
  assert.equal(GameModifierSystem.multiplier(side, "paint"), 2);
  assert.equal(GameModifierSystem.multiplier(side, "production"), 2);
});

test("skill-archived efficiency order does not charge its locked overload cost again", () => {
  const side = {};
  let payments = 0;
  const api = {payInk: () => { payments++; return true; }};
  GameEffectRegistry.invoke("20735.efficiency-order", "play", {
    owner: 1, target: {payOverload: true}, side, archived: true, archiveSource: "skill", api
  });
  assert.equal(payments, 0);
  assert.equal(side.skipTurns || 0, 0);
  assert.equal(GameModifierSystem.multiplier(side, "movement"), 1);
  GameModifierSystem.startTurn(side);
  assert.equal(GameModifierSystem.multiplier(side, "movement"), 2);
});

test("drone passive bonuses require another drone within three hexes", () => {
  const unit = {id: 1, owner: 1, cell: {x: 0}, birth: 1};
  const partner = {id: 2, owner: 1, cell: {x: 3}, birth: 2};
  const api = {
    units: () => [unit, partner],
    hasTag: candidate => candidate === partner,
    distance: (a, b) => Math.abs(a.x - b.x)
  };
  assert.deepEqual(GameEffectRegistry.invoke("20735.mass-drone", "statModifiers", {unit, api}), {attack: 1, paint: 1});
  partner.cell.x = 4;
  assert.equal(GameEffectRegistry.invoke("20735.mass-drone", "statModifiers", {unit, api}), null);
});

test("painting drone randomly paints two cells when a nearby drone enables it", () => {
  const unit = {id: 1, owner: 1, cell: {x: 0}, birth: 1};
  const partner = {id: 2, owner: 1, cell: {x: 3}, birth: 2};
  const cells = Array.from({length: 4}, (_, index) => ({id: index, owner: 0}));
  const painted = [], links = [];
  const api = {
    units: () => [unit, partner],
    hasTag: candidate => candidate === partner,
    distance: (a, b) => Math.abs(a.x - b.x),
    neighbors: () => cells,
    random: () => 0,
    paint: cell => painted.push(cell),
    showDroneLink: (from, to) => links.push([from, to])
  };
  GameEffectRegistry.invoke("20735.painting-delta", "afterUnitAct", {unit, api});
  assert.equal(painted.length, 2);
  assert.equal(new Set(painted).size, 2);
  assert.deepEqual(links[0], [unit, partner]);
});

test("repair drone heals only up to the target's original durability", () => {
  const unit = {id: 1, owner: 1, cell: {x: 0}, birth: 1};
  const target = {id: 2, owner: 1, cell: {x: 1}, hp: 2, maxHp: 5, birth: 2};
  const api = {
    units: () => [unit, target],
    hasTag: () => false,
    distance: () => 1,
    baseStats: () => ({hp: 3}),
    showDroneLink() {}
  };
  GameEffectRegistry.invoke("20735.repair-omega", "afterUnitAct", {unit, api});
  assert.equal(target.hp, 3);
  GameEffectRegistry.invoke("20735.repair-omega", "afterUnitAct", {unit, api});
  assert.equal(target.hp, 3);
});

test("purifier protocol keeps its permanent durability when cooling ends", () => {
  const unit = {name: "净化单元·Mk-II", maxHp: 5, hp: 5, cooling: true, protocolProgress: 3};
  const api = {log() {}};
  GameEffectRegistry.invoke("20735.purifier-mk2", "blockedPaint", {unit, count: 1, api});
  assert.equal(unit.maxHp, 8);
  assert.equal(unit.hp, 8);
  unit.maxHp -= 2;
  unit.hp = Math.min(unit.hp, unit.maxHp);
  assert.equal(unit.maxHp, 6);
  assert.equal(unit.hp, 6);
});

test("cooling status removes its temporary durability after the unit acts", () => {
  const unit = {
    id: 1, name: "测试书灵", move: 4, paint: 2, maxHp: 3, hp: 3,
    permanentMove: 0, bonusMove: 0, effectMove: 0, effectPaint: 0
  };
  const side = {cooledUnitIds: new Set(), coolingProtocolComplete: false};
  const logs = [];
  const api = {asUnit: target => target, gainInk() {}, log: message => logs.push(message)};
  GameEffectRegistry.invoke("20735.emergency-cooling", "play", {owner: 1, target: unit, side, api});
  assert.equal(unit.maxHp, 5);
  assert.equal(unit.hp, 5);
  GameStatusSystem.invoke(unit, "beforeAction", {
    api, movementBeforeStatus: 4, paintBeforeStatus: 2
  });
  assert.equal(unit.effectMove, -4);
  assert.equal(unit.effectPaint, -2);
  GameStatusSystem.invoke(unit, "afterAction", {api});
  assert.equal(unit.maxHp, 3);
  assert.equal(unit.hp, 3);
  assert.equal(unit.permanentMove, 1);
  assert.equal(GameStatusSystem.has(unit, "20735.cooling"), false);
  assert.equal(logs.length, 1);
});

test("target resolver skips illegal automatic targets", () => {
  const targets = [{id: 1, blocked: true}, {id: 2, blocked: false}];
  assert.equal(GameTargetResolver.firstLegal(targets, target => !target.blocked), targets[1]);
});
