const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
const target = path.join(__dirname, "../src/presentation/spine-runtime-adapter.js");
delete require.cache[require.resolve(target)];
require(target);

function fakeRuntime() {
  class GLTexture {
    constructor(gl, image) { this.gl = gl; this.image = image; }
    dispose() { this.disposed = true; }
  }
  class TextureAtlas {
    constructor(source) {
      this.source = source;
    }
    setTextures(manager) { this.texture = manager.get("texture.png"); }
  }
  class AtlasAttachmentLoader {
    constructor(atlas) { this.atlas = atlas; }
  }
  class SkeletonJson {
    constructor(loader) { this.loader = loader; this.scale = 1; }
    readSkeletonData(source) {
      const animations = new Set(Object.keys(source.animations));
      return {source, findAnimation: name => animations.has(name) ? {name} : null};
    }
  }
  class Skeleton {
    constructor(data) { this.data = data; }
    updateWorldTransform(mode) { this.physicsMode = mode; }
  }
  class AnimationStateData {
    constructor(data) { this.data = data; this.mixes = []; }
    setMix(from, to, duration) { this.mixes.push([from, to, duration]); }
  }
  class AnimationState {
    constructor(data) { this.data = data; this.animations = []; }
    addListener(listener) { this.listener = listener; }
    setAnimation(track, name, loop) {
      const entry = {track, name, loop};
      this.animations.push(entry);
      return entry;
    }
    update(delta) { this.delta = delta; }
    apply(skeleton) { this.applied = skeleton; }
    clearTracks() { this.cleared = true; }
  }
  return {
    GLTexture, TextureAtlas, AtlasAttachmentLoader, SkeletonJson,
    Skeleton, AnimationStateData, AnimationState, Physics: {update: "physics-update"}
  };
}

class FakeImage {
  set src(value) {
    this.source = value;
    queueMicrotask(() => this.onload());
  }
}

const animations = Object.fromEntries(["spawn", "idle", "move", "attack", "hurt", "death"].map(name => [name, {}]));
const profile = {id: "initial.spreader", textureFile: "texture.png", scale: 0.75};
const asset = {
  skeleton: {skeleton: {spine: "4.2.43"}, animations},
  atlas: "texture.png\nsize: 64,64\n",
  textureDataUrl: "data:image/png;base64,AA=="
};

test("Spine runtime adapter creates an animated entity entirely from packed memory assets", async () => {
  const runtime = fakeRuntime();
  const entity = await GameSpineRuntimeAdapter.create({
    runtime,
    gl: {name: "webgl"},
    profile,
    assets: {[profile.id]: asset},
    Image: FakeImage
  });

  assert.equal(entity.texture.gl.name, "webgl");
  assert.equal(entity.texture.image.source, asset.textureDataUrl);
  assert.equal(entity.atlas.source, asset.atlas);
  assert.equal(entity.stateData.mixes.length, 5);
  assert.deepEqual(entity.state.animations[0], {track: 0, name: "idle", loop: true});
  assert.deepEqual(entity.setAnimation("attack", false), {track: 0, name: "attack", loop: false});

  const events = [];
  const unsubscribe = entity.onEvent(name => events.push(name));
  entity.state.listener.event({}, {data: {name: "hit"}});
  unsubscribe();
  entity.state.listener.event({}, {data: {name: "ignored"}});
  assert.deepEqual(events, ["hit"]);

  entity.update(1 / 60);
  assert.equal(entity.state.delta, 1 / 60);
  assert.equal(entity.skeleton.physicsMode, "physics-update");
  entity.dispose();
  assert.equal(entity.texture.disposed, true);
  assert.equal(entity.state.cleared, true);
});

test("Spine runtime adapter reports missing and wrong-version assets before rendering", async () => {
  const runtime = fakeRuntime();
  await assert.rejects(
    GameSpineRuntimeAdapter.create({runtime, gl: {}, profile, assets: {}, Image: FakeImage}),
    /Missing Spine asset bundle/
  );
  await assert.rejects(
    GameSpineRuntimeAdapter.create({
      runtime, gl: {}, profile,
      assets: {[profile.id]: {...asset, skeleton: {...asset.skeleton, skeleton: {spine: "4.3.0"}}}},
      Image: FakeImage
    }),
    /expected 4\.2\.43/
  );
});

test("Spine runtime adapter reuses a physical asset and aliases unsupported animations", async () => {
  const runtime = fakeRuntime();
  const sharedProfile = {
    id: "sina.swan-messenger",
    assetId: "initial.spreader",
    textureFile: "texture.png",
    animationAliases: {takeoff: "spawn", fly: "move", land: "idle", ability: "attack"}
  };
  const profiles = {resolveAnimation: (current, name) => current.animationAliases[name] || name};
  const entity = await GameSpineRuntimeAdapter.create({
    runtime, gl: {}, profile: sharedProfile, profiles,
    assets: {"initial.spreader": asset}, Image: FakeImage
  });
  assert.deepEqual(entity.setAnimation("fly", true), {track: 0, name: "move", loop: true});
  assert.deepEqual(entity.setAnimation("ability", false), {track: 0, name: "attack", loop: false});
});

test("Spine runtime adapter waits for the background asset bundle", async () => {
  const previousAssets = global.GameSpineAssets;
  const previousReady = global.GameSpineAssetsReady;
  delete global.GameSpineAssets;
  global.GameSpineAssetsReady = Promise.resolve({[profile.id]: asset});
  try {
    const entity = await GameSpineRuntimeAdapter.create({
      runtime: fakeRuntime(), gl: {}, profile, Image: FakeImage
    });
    assert.equal(entity.texture.image.source, asset.textureDataUrl);
    entity.dispose();
  } finally {
    if (previousAssets === undefined) delete global.GameSpineAssets;
    else global.GameSpineAssets = previousAssets;
    if (previousReady === undefined) delete global.GameSpineAssetsReady;
    else global.GameSpineAssetsReady = previousReady;
  }
});
