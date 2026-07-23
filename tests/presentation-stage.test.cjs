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
load("src/battlefield/battlefield-adapter.js");
load("src/presentation/camera-2d.js");
load("src/presentation/battlefield-stage.js");
load("src/presentation/action-sequencer.js");
load("src/presentation/brush-motion.js");
load("src/presentation/overlay-renderer.js");

function fakeDom(width = 800, height = 400) {
  const transforms = [];
  const viewport = [];
  const children = [];
  const context2d = () => ({
    setTransform: (...args) => transforms.push(args),
    clearRect() {}
  });
  const gl = {
    COLOR_BUFFER_BIT: 16384,
    viewport: (...args) => viewport.push(args),
    clearColor() {},
    clear() {}
  };
  const document = {
    createElement() {
      const canvas = {
        dataset: {}, style: {}, width: 0, height: 0,
        setAttribute() {},
        getContext(kind) { return kind === "2d" ? context2d() : gl; },
        getBoundingClientRect() { return {left: 20, top: 10, width, height}; },
        remove() { canvas.removed = true; }
      };
      return canvas;
    }
  };
  const container = {
    clientWidth: width,
    clientHeight: height,
    style: {},
    appendChild(canvas) { children.push(canvas); }
  };
  return {document, container, children, transforms, viewport};
}

test("battlefield stage keeps all three canvases and camera on one viewport", () => {
  const dom = fakeDom();
  const camera = GameContinuousCamera.create({width: 1, height: 1, padding: 0});
  const stage = GameContinuousBattlefieldStage.create({
    document: dom.document,
    container: dom.container,
    camera,
    pixelRatio: 2
  });

  assert.deepEqual(dom.children.map(canvas => canvas.dataset.battlefieldLayer), ["terrain", "spine", "overlay"]);
  assert.ok(dom.children.every(canvas => canvas.width === 1600 && canvas.height === 800));
  assert.ok(dom.children.every(canvas => canvas.style.width === "800px" && canvas.style.height === "400px"));
  assert.deepEqual(dom.transforms, [[2, 0, 0, 2, 0, 0], [2, 0, 0, 2, 0, 0]]);
  assert.deepEqual(dom.viewport, [[0, 0, 1600, 800]]);
  assert.deepEqual(camera.snapshot().viewport, {width: 800, height: 400});

  const source = {x: 18, y: 12};
  const screen = camera.worldToScreen(source);
  const restored = stage.pointerToWorld({x: screen.x + 20, y: screen.y + 10});
  assert.ok(GameWorldSpace.distance(source, restored) <= 1 / 256);

  stage.resize(600, 300, {pixelRatio: 1.5});
  assert.deepEqual(stage.snapshot(), {
    width: 600,
    height: 300,
    pixelRatio: 1.5,
    physicalWidth: 900,
    physicalHeight: 450,
    camera: camera.snapshot(),
    layers: ["terrain", "spine", "overlay"]
  });
  stage.destroy();
  assert.ok(dom.children.every(canvas => canvas.removed));
});

test("action sequencer queues views and reveals every paint operation once", async () => {
  const callbacks = [];
  const events = [];
  const sequencer = GameActionSequencer.create({
    now: () => 0,
    requestFrame: callback => callbacks.push(callback)
  });
  const plan = Object.freeze({
    pathLengthU: 5,
    path: Object.freeze([{x: 0, y: 0}, {x: 5, y: 0}]),
    paintOperations: Object.freeze([
      Object.freeze({sequence: 0, progress: 0}),
      Object.freeze({sequence: 1, progress: 0.5}),
      Object.freeze({sequence: 2, progress: 1})
    ])
  });
  const view = name => ({
    beginAction: () => events.push(`${name}:begin`),
    setAnimation: animation => events.push(`${name}:${animation}`),
    setPosition: position => events.push(`${name}:x${position.x}`),
    revealPaint: operation => events.push(`${name}:paint${operation.sequence}`),
    endAction: () => events.push(`${name}:end`)
  });

  const first = sequencer.enqueue(plan, view("first"));
  const second = sequencer.enqueue(plan, view("second"));
  await Promise.resolve();
  assert.ok(events.includes("first:begin"));
  assert.ok(!events.includes("second:begin"));

  callbacks.shift()(500);
  callbacks.shift()(1000);
  await first;
  await Promise.resolve();
  assert.ok(events.includes("second:begin"));
  callbacks.shift()(1000);
  await second;
  await sequencer.whenIdle();

  for (const name of ["first", "second"]) {
    assert.equal(events.filter(event => event === `${name}:paint0`).length, 1);
    assert.equal(events.filter(event => event === `${name}:paint1`).length, 1);
    assert.equal(events.filter(event => event === `${name}:paint2`).length, 1);
    assert.ok(events.indexOf(`${name}:move`) < events.indexOf(`${name}:idle`));
    assert.ok(events.indexOf(`${name}:idle`) < events.indexOf(`${name}:end`));
  }
  assert.ok(events.indexOf("first:end") < events.indexOf("second:begin"));
});

test("brush motion creates smooth deterministic curves through logical cells", () => {
  const guides=[{x:4,y:8},{x:5,y:8},{x:6,y:8},{x:7,y:8}];
  for(const type of GameBrushMotion.types){
    const motion=GameBrushMotion.create(guides,{type,seed:"spirit-7"});
    assert.equal(motion.type,type);
    assert.equal(motion.segments.length,guides.length-1);
    assert.deepEqual(motion.points[0],guides[0]);
    assert.deepEqual(motion.points.at(-1),guides.at(-1));
    assert.ok(motion.points.some(point=>Math.abs(point.y-8)>.01),`${type} remained a rigid line`);
    for(let index=1;index<motion.segments.length;index++){
      assert.deepEqual(motion.segments[index-1].points.at(-1),motion.segments[index].points[0]);
      const left=motion.segments[index-1].points;
      const right=motion.segments[index].points;
      const incoming={x:left.at(-1).x-left.at(-2).x,y:left.at(-1).y-left.at(-2).y};
      const outgoing={x:right[1].x-right[0].x,y:right[1].y-right[0].y};
      const cosine=(incoming.x*outgoing.x+incoming.y*outgoing.y)/Math.hypot(incoming.x,incoming.y)/Math.hypot(outgoing.x,outgoing.y);
      assert.ok(cosine>.9,`${type} has a visible corner at guide ${index}`);
    }
  }
});

test("continuous overlay exposes the next enemy summon position", () => {
  const target={r:7,c:42};
  const preview=GameContinuousOverlayRenderer.summonIntentPreview({
    intents:[{cardTarget:"summon",target,name:"禁咒守卫",meaningful:true}]
  });
  assert.deepEqual(preview.center,GameBattlefieldAdapter.cellToWorld(target));
  assert.equal(preview.name,"禁咒守卫");
  assert.equal(preview.radiusU,.82);
  assert.equal(GameContinuousOverlayRenderer.summonIntentAtPoint({
    intents:[{cardTarget:"summon",target,name:"禁咒守卫",meaningful:true}]
  },preview.center).name,"禁咒守卫");
  assert.equal(GameContinuousOverlayRenderer.summonIntentAtPoint({
    intents:[{cardTarget:"summon",target,name:"禁咒守卫",meaningful:true}]
  },{x:preview.center.x+1,y:preview.center.y}),null);
  assert.equal(GameContinuousOverlayRenderer.wellVisualSizeU,2.2);
  assert.equal(GameContinuousOverlayRenderer.summonIntentPreview({intents:[]}),null);
  assert.equal(GameContinuousOverlayRenderer.summonIntentPreview({
    intents:[{cardTarget:"summon",target:{r:7,c:10},name:"禁咒守卫",meaningful:true}]
  }),null);
});
