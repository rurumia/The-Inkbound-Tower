(function createSpineRuntimeAdapter(global) {
  "use strict";

  const RUNTIME_VERSION = "4.2.43";
  const REQUIRED_API = Object.freeze([
    "AnimationState",
    "AnimationStateData",
    "AtlasAttachmentLoader",
    "GLTexture",
    "Skeleton",
    "SkeletonJson",
    "TextureAtlas"
  ]);

  function requireRuntime(runtime) {
    if (!runtime) throw new Error("Spine Runtime 4.2 is not loaded.");
    const missing = REQUIRED_API.filter(name => typeof runtime[name] !== "function");
    if (missing.length) throw new Error(`Spine Runtime is incomplete: ${missing.join(", ")}.`);
    return runtime;
  }

  function requireAsset(profile, assets) {
    const assetId = profile.assetId || profile.id;
    const asset = assets?.[assetId];
    if (!asset) throw new Error(`Missing Spine asset bundle for ${assetId} (visual profile ${profile.id}).`);
    const version = asset.skeleton?.skeleton?.spine || "";
    if (version !== RUNTIME_VERSION) {
      throw new Error(`Spine asset ${assetId} uses ${version || "an unknown version"}; expected ${RUNTIME_VERSION}.`);
    }
    if (!asset.atlas || !asset.textureDataUrl) {
      throw new Error(`Spine asset bundle for ${assetId} is incomplete.`);
    }
    return asset;
  }

  function loadImage(source, ImageType = global.Image) {
    if (typeof ImageType !== "function") throw new Error("Spine textures require an Image implementation.");
    return new Promise((resolve, reject) => {
      const image = new ImageType();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to decode a packed Spine texture."));
      image.src = source;
    });
  }

  function applyMixes(stateData) {
    const mixes = [
      ["idle", "move", 0.12],
      ["move", "idle", 0.12],
      ["move", "attack", 0.08],
      ["attack", "move", 0.08],
      ["hurt", "idle", 0.1]
    ];
    for (const [from, to, duration] of mixes) stateData.setMix(from, to, duration);
  }

  async function create(options = {}) {
    const runtime = requireRuntime(options.runtime || global.spine);
    const profiles = options.profiles || global.GameSpiritVisualProfiles;
    const profile = typeof options.profile === "string" ? profiles?.get(options.profile) : options.profile;
    if (!profile?.id) throw new Error("A registered Spine visual profile is required.");
    const asset = requireAsset(profile, options.assets || global.GameSpineAssets);
    const image = await loadImage(asset.textureDataUrl, options.Image);
    const texture = new runtime.GLTexture(options.gl, image);
    const loadTexturePage = page => {
      const normalized = String(page).replaceAll("\\", "/");
      if (!normalized.endsWith(profile.textureFile)) {
        throw new Error(`Unexpected Spine texture page for ${profile.id}: ${page}.`);
      }
      return texture;
    };
    let atlas;
    if (typeof runtime.TextureAtlas.prototype?.setTextures === "function") {
      atlas = new runtime.TextureAtlas(asset.atlas);
      atlas.setTextures({get: loadTexturePage});
    } else {
      atlas = new runtime.TextureAtlas(asset.atlas, loadTexturePage);
    }
    const attachmentLoader = new runtime.AtlasAttachmentLoader(atlas);
    const skeletonJson = new runtime.SkeletonJson(attachmentLoader);
    skeletonJson.scale = profile.scale || 1;
    const skeletonData = skeletonJson.readSkeletonData(asset.skeleton);
    const skeleton = new runtime.Skeleton(skeletonData);
    const stateData = new runtime.AnimationStateData(skeletonData);
    applyMixes(stateData);
    const state = new runtime.AnimationState(stateData);
    const eventListeners = new Set();
    state.addListener?.({
      event(entry, event) {
        for (const listener of eventListeners) listener(event.data?.name || event.name, event, entry);
      }
    });

    function setAnimation(name, loop = name === "idle" || name === "move") {
      const resolved = profiles?.resolveAnimation?.(profile, name) || profile.animationAliases?.[name] || name;
      if (!skeletonData.findAnimation?.(resolved)) throw new Error(`Spine animation ${resolved} (requested as ${name}) is missing from ${profile.assetId || profile.id}.`);
      return state.setAnimation(0, resolved, Boolean(loop));
    }

    function update(deltaSeconds) {
      const delta = Math.max(0, Number(deltaSeconds) || 0);
      state.update(delta);
      state.apply(skeleton);
      skeleton.updateWorldTransform(runtime.Physics?.update);
    }

    function onEvent(listener) {
      if (typeof listener !== "function") throw new TypeError("Spine event listener must be a function.");
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    }

    function dispose() {
      eventListeners.clear();
      state.clearTracks?.();
      texture.dispose?.();
    }

    setAnimation("idle", true);
    return Object.freeze({profile, atlas, texture, skeletonData, skeleton, stateData, state, setAnimation, update, onEvent, dispose});
  }

  global.GameSpineRuntimeAdapter = Object.freeze({version: RUNTIME_VERSION, create, loadImage, applyMixes});
})(window);
