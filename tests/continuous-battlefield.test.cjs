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
load("src/presentation/brush-motion.js");
load("src/presentation/camera-2d.js");
load("src/presentation/terrain-renderer.js");
load("src/content/spirit-visual-profiles.js");
load("src/battlefield/battlefield-adapter.js");
load("src/content/brush-profiles.js");

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

test("production paint fields use 32 samples per world unit", () => {
  const field = GamePaintField.create();
  assert.deepEqual([field.width, field.height], [1920, 960]);
  assert.equal(field.width / GameWorldSpace.width, 32);
  assert.equal(field.height / GameWorldSpace.height, 32);
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

test("fibered ink colors and crystal materials are deterministic", () => {
  const shade=GameContinuousTerrainRenderer.shadeInk;
  const first=shade(1);
  assert.equal(first,shade(1));
  assert.notEqual(first,shade(1,13.25,8.5));
  assert.notEqual(shade(0,12.25,8.5,0),first);
  assert.notEqual(GameContinuousTerrainRenderer.inkTextureSample(1,4,4).density,
    GameContinuousTerrainRenderer.inkTextureSample(1,18,11).density);
  assert.notEqual(GameContinuousTerrainRenderer.shadeCrystal(1,12.25,8.5),
    GameContinuousTerrainRenderer.shadeCrystal(-1,12.25,8.5));
  assert.equal(GameContinuousTerrainRenderer.materialVersion,5);
  assert.equal(GameContinuousTerrainRenderer.inkMode,"fibered-wash");
  assert.equal(GameContinuousTerrainRenderer.inkEdgeMode,"brush-soft");
  assert.equal(GameContinuousTerrainRenderer.inkEdgeFeatherU,1.25);
  assert.equal(GameContinuousTerrainRenderer.battlefieldOutline,false);
  assert.equal(GameContinuousTerrainRenderer.backgroundUrl,"images/battle_scroll_field.webp");
  assert.equal(GameContinuousTerrainRenderer.backgroundWidthScale,1.36);
  assert.equal(GameContinuousTerrainRenderer.backgroundHeightScale,1.16);
  assert.equal(GameContinuousTerrainRenderer.backgroundVisualScale,1.15);
  assert.equal(GameContinuousTerrainRenderer.backgroundOffsetYU,-.5);
  assert.equal(GameContinuousTerrainRenderer.backgroundStripCount,96);
  assert.equal(GameContinuousTerrainRenderer.materialStripHeightPx,2);
  assert.equal(GameContinuousTerrainRenderer.crystalOverflowU,.12);
  const edgeAlpha=GameContinuousTerrainRenderer.inkEdgeAlpha;
  assert.equal(edgeAlpha(0,15),0);
  assert.equal(edgeAlpha(30,15),1);
  assert.ok(edgeAlpha(.9,15)>edgeAlpha(.25,15));
  assert.notEqual(edgeAlpha(.55,5),edgeAlpha(.55,6));
});

test("adjacent crystal cells share one continuous parchment-based neutral material", () => {
  const regions=GameContinuousRegions.create();
  regions.add({id:"neutral-a",type:"crystal",owner:0,shape:GameContinuousGeometry.circle({x:10,y:10},.52)});
  regions.add({id:"neutral-b",type:"crystal",owner:0,shape:GameContinuousGeometry.circle({x:11,y:10},.52)});
  regions.add({id:"player-far",type:"crystal",owner:1,shape:GameContinuousGeometry.circle({x:20,y:10},.52)});
  const groups=GameContinuousTerrainRenderer.crystalGroups({spatial:{regions},cells:[]});
  assert.equal(groups.length,2);
  const neutral=groups.find(group=>group.owner===0);
  assert.equal(neutral.shapes.length,3);
  assert.ok(neutral.shapes.some(shape=>shape.kind==="pathStroke"));
  const color=GameContinuousTerrainRenderer.shadeCrystal(0,10.5,10,neutral);
  const red=color>>>16&255,green=color>>>8&255,blue=color&255;
  assert.ok(red>green&&green>blue);
  assert.ok(red-green<35&&green-blue>25);
});

test("paint fields accumulate and consume only changed raster bounds", () => {
  const field=GamePaintField.create({width:240,height:120});
  assert.equal(field.consumeDirtyBounds(),null);
  field.apply({shape:GameContinuousGeometry.circle({x:10,y:10},1),owner:1,kind:"paint",strength:1});
  field.apply({shape:GameContinuousGeometry.circle({x:20,y:10},1),owner:1,kind:"paint",strength:1});
  const dirty=field.consumeDirtyBounds();
  assert.ok(dirty.minColumn<dirty.maxColumn);
  assert.ok(dirty.minRow<dirty.maxRow);
  assert.ok(dirty.minColumn<=36&&dirty.maxColumn>=84);
  assert.equal(field.consumeDirtyBounds(),null);
});

test("paint territory totals stay incremental across ownership changes", () => {
  const field=GamePaintField.create({width:240,height:120});
  const shape=GameContinuousGeometry.circle({x:20,y:12},3);
  field.apply({shape,owner:1,kind:"paint",strength:1});
  const player=field.measure();
  field.apply({shape,owner:-1,kind:"paint",strength:1});
  const enemy=field.measure();
  assert.ok(player.player>0);
  assert.equal(player.enemy,0);
  assert.equal(enemy.player,0);
  assert.ok(enemy.enemy>0);
  assert.ok(Math.abs(enemy.player+enemy.enemy+enemy.neutral-1800)<1e-8);
});

test("paint operations only query continuous regions touching their bounds", () => {
  const regions=GameContinuousRegions.create();
  regions.add({type:"crystal",shape:GameContinuousGeometry.circle({x:50,y:25},2),owner:-1});
  assert.equal(regions.candidates(GameContinuousGeometry.bounds(
    GameContinuousGeometry.circle({x:5,y:5},1)
  )).length,0);
  assert.equal(regions.candidates(GameContinuousGeometry.bounds(
    GameContinuousGeometry.circle({x:49,y:25},1)
  )).length,1);
});

test("crystal capture masks preserve existing ink and leave parchment gaps untouched", () => {
  const field=GamePaintField.create({width:600,height:300});
  field.apply({shape:GameContinuousGeometry.circle({x:10,y:10},.75),owner:1,kind:"paint",strength:1});
  field.apply({shape:GameContinuousGeometry.circle({x:14,y:10},.75),owner:1,kind:"paint",strength:1});
  const mask=field.captureMask(GameContinuousGeometry.circle({x:10,y:10},2),{owner:1});
  assert.ok(mask);
  assert.equal(GameContinuousGeometry.containsPoint(mask,{x:10,y:10}),true);
  assert.equal(GameContinuousGeometry.containsPoint(mask,{x:11.5,y:10}),false);
  assert.equal(GameContinuousGeometry.containsPoint(mask,{x:14,y:10}),false);
});

test("raster ink dilation expands a full 1U in every direction", () => {
  const field=GamePaintField.create({width:600,height:300});
  field.apply({shape:GameContinuousGeometry.circle({x:20,y:15},.5),owner:1,kind:"paint",strength:1});
  const source=field.captureMask(null,{owner:1});
  const expanded=GameContinuousGeometry.dilateRasterMask(source,1);
  for(const point of [{x:21.45,y:15},{x:18.55,y:15},{x:20,y:16.45},{x:20,y:13.55}])
    assert.equal(GameContinuousGeometry.containsPoint(expanded,point),true);
  for(const point of [{x:21.65,y:15},{x:18.35,y:15},{x:20,y:16.65},{x:20,y:13.35}])
    assert.equal(GameContinuousGeometry.containsPoint(expanded,point),false);
});

test("a circular region triggers when its edge only touches a spirit body", () => {
  const region=GameContinuousGeometry.circle({x:10,y:10},1.5);
  assert.equal(GameContinuousGeometry.intersectsCircle(region,{x:11.85,y:10},.35),true);
  assert.equal(GameContinuousGeometry.intersectsCircle(region,{x:11.86,y:10},.35),false);
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

test("multiple same-type continuous regions receive stable unique ids", () => {
  const regions=GameContinuousRegions.create();
  const first=regions.add({type:"study",shape:GameContinuousGeometry.circle({x:10,y:10},1.5),owner:1});
  const second=regions.add({type:"study",shape:GameContinuousGeometry.circle({x:14,y:10},1.5),owner:1});
  const crystal=regions.add({type:"crystal",shape:GameContinuousGeometry.circle({x:12,y:10},.5),owner:0});
  assert.ok(first.id&&second.id&&crystal.id);
  assert.notEqual(first.id,second.id);
  assert.deepEqual(regions.list("study").map(region=>region.id).sort(),[first.id,second.id].sort());
});

test("wall study can coexist with crystal and both regions can be removed by id", () => {
  const regions=GameContinuousRegions.create();
  const shape=GameContinuousGeometry.circle({x:12,y:12},3);
  regions.add({id:"wall-study",type:"study",shape,owner:1,allowCrystal:true,permanent:false});
  regions.add({id:"wall-crystal",type:"crystal",shape,owner:1,permanent:false});
  assert.equal(regions.has("study",{x:12,y:12}),true);
  assert.equal(regions.has("crystal",{x:12,y:12}),true);
  assert.equal(regions.remove("wall-study").length,1);
  assert.equal(regions.remove("wall-crystal").length,1);
  assert.equal(regions.has("study",{x:12,y:12}),false);
  assert.equal(regions.has("crystal",{x:12,y:12}),false);
});

test("continuous ink contact includes a circle touching the raster edge", () => {
  const field=GamePaintField.create({width:600,height:300});
  field.apply({shape:GameContinuousGeometry.circle({x:10,y:10},1),owner:1,kind:"paint",strength:1});
  assert.equal(field.touchesCircle({x:12,y:10},1,1),true);
  assert.equal(field.touchesCircle({x:12.2,y:10},1,1),false);
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

test("continuous brush sections are sampled by arc length and ignore animation frame count", () => {
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
  assert.ok(first.operations.every(operation=>operation.shape.kind==="brushStroke"));
});

test("styled brushes leave an unbroken centerline", () => {
  const ids = [
    "initial.spreader", "initial.resource", "initial.fighter",
    "sina.charging-sparrow", "fine.ink-solidifier", "20735.patrol-a", "20735.cycle-pump"
  ];
  for (const id of ids) {
    const field = GamePaintField.create();
    const profile = GameBrushProfiles.atRate(id, 1);
    GameContinuousBrushes.apply(field, profile, [{x: 3, y: 10}, {x: 15, y: 10}], 1);
    for (let step = 0; step <= 192; step++) {
      const point = {x: 3 + 12 * step / 192, y: 10};
      assert.ok(field.sample(point) > 0, `${id} left a gap at ${point.x}`);
    }
  }
});

test("a painting spirit stamps its category brush while stationary", () => {
  const field = GamePaintField.create({width: 480, height: 240});
  const profile = GameBrushProfiles.atRate("sina.charging-sparrow", 1);
  const result = GameContinuousBrushes.apply(field, profile, [{x: 8, y: 10}], 1);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].shape.style, "feather");
  assert.ok(field.sample({x: 8, y: 10}) > 0);
});

test("paint rates scale one brush instead of creating side brushes", () => {
  const profile = GameBrushProfiles.get("sina.guardian-swan");
  const operationSets = [1, 2, 3].map(rate => GameContinuousBrushes.operations(
    GameBrushProfiles.atRate(profile, rate), [{x: 4, y: 8}, {x: 8, y: 8}], 1
  ));
  const shapes = operationSets.map(operations => operations.reduce((best, operation) =>
    operation.pressure > best.pressure ? operation : best
  ).shape);
  assert.deepEqual(shapes.map(shape => shape.length), [1.3984375, 2.80078125, 4.19921875]);
  assert.deepEqual(shapes.map(shape => shape.width), [.71875, 1.44140625, 2.16015625]);
  assert.deepEqual([1, 2, 3].map(GameBrushProfiles.sizeForRate), [1, 2, 3]);
  assert.deepEqual(operationSets.map(operations=>[operations[0].pressure,operations.at(-1).pressure]),
    [[.22,.22],[.22,.22],[.22,.22]]);
  const horizontal=operationSets[0];
  assert.ok(horizontal.every(operation=>Math.abs(operation.shape.angle-Math.PI/2)<1e-6));
});

test("brush pressure grows and shrinks linearly around a curvature-selected peak", () => {
  const profile=GameBrushProfiles.atRate("sina.charging-sparrow",1);
  const earlyCurve=[{x:2,y:8},{x:5,y:8},{x:6,y:10},{x:14,y:10}];
  const lateCurve=earlyCurve.map(point=>({x:16-point.x,y:point.y})).reverse();
  const early=GameContinuousBrushes.operations(profile,earlyCurve,1);
  const late=GameContinuousBrushes.operations(profile,lateCurve,1);
  assert.ok(early[0].pressurePeak<.5);
  assert.ok(late[0].pressurePeak>.5);
  for(const operations of [early,late]){
    const peak=operations.find(operation=>operation.progress===operation.pressurePeak);
    assert.equal(operations[0].pressure,.22);
    assert.equal(operations.at(-1).pressure,.22);
    assert.equal(peak.pressure,1);
    const before=operations[Math.max(1,operations.indexOf(peak)-1)];
    const expected=.22+(1-.22)*before.progress/before.pressurePeak;
    assert.ok(Math.abs(before.pressure-expected)<1e-9);
  }
});

test("normal-following brush angles stay continuous across logical movement segments", () => {
  const motion=GameBrushMotion.create([
    {x:4,y:8},{x:5,y:8},{x:6,y:9},{x:7,y:9}
  ],{type:"sweep",seed:"normal-seam"});
  const profile=GameBrushProfiles.atRate("sina.charging-sparrow",1);
  const operations=GameContinuousBrushes.operations(profile,motion.points,1);
  for(let index=1;index<operations.length;index++){
    const before=operations[index-1].shape.angle;
    const after=operations[index].shape.angle;
    const delta=Math.abs(Math.atan2(Math.sin(after-before),Math.cos(after-before)));
    assert.ok(delta<.35,`brush normal jumped ${delta} radians at stamp ${index}`);
  }
});

test("adjacent brush sections share exact edges without stamp scalloping", () => {
  const profile=GameBrushProfiles.atRate("sina.charging-sparrow",1);
  const operations=GameContinuousBrushes.operations(profile,[{x:3,y:9},{x:15,y:9}],1);
  assert.ok(operations.length>2);
  for(let index=1;index<operations.length;index++){
    const previous=operations[index-1].shape.outline;
    const current=operations[index].shape.outline;
    assert.deepEqual(previous[1],current[0]);
    assert.deepEqual(previous[2],current[3]);
  }
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

test("an ink well starts capture at 66 percent ring control", () => {
  let control=.65;
  const entities=GameContinuousEntities.create();
  const wells=GameContinuousWells.create({paintField:{sample:()=>control},entities,random:()=>.5});
  wells.generate();
  assert.equal(GameContinuousWells.captureRatio,.66);
  assert.equal(wells.update().length,0);
  assert.equal(wells.list()[0].pendingOwner,0);
  control=.66;
  assert.equal(wells.update().length,0);
  assert.equal(wells.list()[0].pendingOwner,1);
  assert.equal(wells.update()[0].type,"WellCaptured");
  assert.equal(wells.list()[0].owner,1);
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

test("33 gameplay spirit templates resolve to independent Spine bundles", () => {
  const profiles = GameSpiritVisualProfiles.all();
  assert.equal(profiles.length, 33);
  assert.equal(new Set(profiles.map(profile => profile.id)).size, 33);
  assert.equal(new Set(profiles.map(profile => profile.assetId)).size, 33);
  assert.equal(profiles.every(profile => profile.assetId === profile.id), true);
  assert.equal(profiles.every(profile => profile.assetRoot === `assets/spine/${profile.id}`), true);
  assert.equal(profiles.filter(profile => profile.id.startsWith("initial.")).every(profile => profile.battleScale === 1), true);
  assert.equal(profiles.filter(profile => !profile.id.startsWith("initial.")).every(profile => profile.battleScale === 2.5), true);
  for (const profile of profiles) {
    assert.ok(GameSpiritVisualProfiles.baseAnimations.every(animation => profile.requiredAnimations.includes(animation)), profile.id);
    assert.ok(profile.requiredSlots.includes("brush_anchor"), profile.id);
    assert.ok(profile.requiredSlots.includes("hit_anchor"), profile.id);
    assert.ok(profile.requiredBones.includes("root"), profile.id);
  }
  assert.equal(GameSpiritVisualProfiles.resolveAnimation("sina.swan-messenger", "fly"), "fly");
  assert.equal(GameSpiritVisualProfiles.resolveAnimation("fine.wall-of-truth", "disabled"), "disabled");
  assert.equal(GameSpiritVisualProfiles.resolveAnimation("initial.resource", "takeoff"), "spawn");
  assert.equal(GameSpiritVisualProfiles.resolveAnimation("initial.fighter", "land"), "idle");
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
  assert.equal(camera.scaleAt({x:30,y:0}) / camera.scaleAt({x:30,y:30}), .7);
  const farLeft=camera.worldToScreen({x:0,y:0});
  const farRight=camera.worldToScreen({x:60,y:0});
  const nearLeft=camera.worldToScreen({x:0,y:30});
  const nearRight=camera.worldToScreen({x:60,y:30});
  assert.ok(Math.abs((farRight.x-farLeft.x)/(nearRight.x-nearLeft.x)-.7)<1e-12);
  const farCenter=camera.worldToScreen({x:30,y:0});
  const nearCenter=camera.worldToScreen({x:30,y:30});
  assert.ok(Math.abs((nearCenter.y-farCenter.y)/(30*camera.snapshot().scale)-.7)<1e-12);
  const radius=0.1;
  const farHorizontal=camera.worldToScreen({x:30+radius,y:0}).x-farCenter.x;
  const farVertical=farCenter.y-camera.worldToScreen({x:30,y:radius}).y;
  const nearHorizontal=nearRight.x-camera.worldToScreen({x:60-radius,y:30}).x;
  const nearVertical=nearCenter.y-camera.worldToScreen({x:30,y:30-radius}).y;
  assert.ok(Math.abs(farHorizontal)>Math.abs(farVertical));
  assert.ok(Math.abs(Math.abs(nearHorizontal/nearVertical)-1)<.01);
});

test("90 alternating continuous actions remain deterministic", () => {
  function simulate() {
    let value = 0;
    const battlefield = GameContinuousBattlefield.create({
      paintWidth: 120, paintHeight: 60,
      random: () => (value = (value + 0.173) % 1)
    });
    battlefield.setup();
    for (let action = 0; action < 90; action++) {
      const spirits = battlefield.entities.list(entity => entity.kind === "spirit");
      const spirit = spirits[action % spirits.length];
      const direction = spirit.owner === 1 ? 1 : -1;
      const destination = GameWorldSpace.clampPoint({
        x: spirit.position.x + direction * (1 + action % 3),
        y: spirit.position.y + (action % 2 ? .5 : -.5)
      }, spirit.body.radius);
      battlefield.executeMove(spirit.id, destination);
      battlefield.resolveMapEnd();
    }
    return battlefield.snapshot();
  }
  const first = simulate();
  const second = simulate();
  assert.equal(first.paintHash, second.paintHash);
  assert.deepEqual(first.territory, second.territory);
  assert.deepEqual(first.entities, second.entities);
  assert.ok(Math.abs(first.territory.player + first.territory.enemy + first.territory.neutral - 1800) < 1e-8);
});
