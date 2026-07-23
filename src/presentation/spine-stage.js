(function createSpineStage(global) {
  "use strict";

  const VISUAL_OFFSET_Y_U = 1;

  function create(options) {
    const canvas = options.canvas;
    const gl = options.gl;
    const camera = options.camera;
    const runtime = options.runtime || global.spine;
    const scene = new runtime.SceneRenderer(canvas, gl, true);
    const views = new Map();
    const loading = new Map();
    const pendingAnimations = new Map();

    function visibleUnits(battle, now = performance.now()) {
      return battle.units.filter(unit => !unit.dead || (unit._retainSpineUntil || 0) > now);
    }

    async function ensure(unit) {
      if (views.has(unit.id)) return views.get(unit.id);
      if (loading.has(unit.id)) return loading.get(unit.id);
      const pending = (async () => {
        const profileId = GameBattlefieldAdapter.visualProfileId(unit);
        const profile = global.GameSpiritVisualProfiles.get(profileId) || global.GameSpiritVisualProfiles.get("initial.spreader");
        const entity = await global.GameSpineRuntimeAdapter.create({gl, profile});
        const view = {entity, animation: "idle", until: 0};
        views.set(unit.id, view);
        loading.delete(unit.id);
        const pending = pendingAnimations.get(unit.id);
        if (pending) {
          pendingAnimations.delete(unit.id);
          play(unit, pending.animation, pending.durationMs);
        }
        return view;
      })().catch(error => {
        loading.delete(unit.id);
        console.error(error);
        return null;
      });
      loading.set(unit.id, pending);
      return pending;
    }

    function play(unit, animation, durationMs = 0) {
      const view = views.get(unit?.id);
      if (!view) {
        pendingAnimations.set(unit.id, {animation, durationMs});
        ensure(unit);
        return false;
      }
      view.animation = animation;
      view.until = durationMs ? performance.now() + durationMs : 0;
      view.entity.setAnimation(animation, animation === "idle" || animation === "move" || animation === "fly");
      return true;
    }

    function sync(battle, units = visibleUnits(battle)) {
      const alive = new Set();
      for (const unit of units) {
        alive.add(unit.id);
        ensure(unit);
      }
      for (const [id, view] of views) {
        if (alive.has(id)) continue;
        view.entity.dispose();
        views.delete(id);
        pendingAnimations.delete(id);
      }
    }

    function draw(battle, size, deltaSeconds) {
      const now = performance.now();
      const units = visibleUnits(battle, now);
      sync(battle, units);
      const ratio = size.pixelRatio;
      gl.viewport(0, 0, size.physicalWidth, size.physicalHeight);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      scene.camera.setViewport(size.physicalWidth, size.physicalHeight);
      scene.camera.position.set(size.physicalWidth / 2, size.physicalHeight / 2, 0);
      scene.camera.zoom = 1;
      scene.begin();
      for (const unit of units.sort((a, b) => a.height - b.height || a.birth - b.birth)) {
        const view = views.get(unit.id);
        if (!view) continue;
        if (view.until && now >= view.until) play(unit, "idle");
        view.entity.update(deltaSeconds);
        const position = GameBattlefieldAdapter.unitPosition(unit);
        const screen = camera.worldToScreen(position);
        const localScale = camera.scaleAt(position);
        const skeleton = view.entity.skeleton;
        skeleton.x = screen.x * ratio;
        skeleton.y = (size.height - screen.y + (VISUAL_OFFSET_Y_U + (unit.height === 2 ? 0.7 : 0)) * localScale) * ratio;
        const skeletonScale = Math.max(0.008, localScale / 620) * ratio * (view.entity.profile.battleScale || 1);
        skeleton.scaleX = (unit.owner === 2 ? -1 : 1) * skeletonScale;
        skeleton.scaleY = skeletonScale;
        skeleton.updateWorldTransform(runtime.Physics?.update);
        scene.drawSkeleton(skeleton, true);
      }
      scene.end();
    }

    function destroy() {
      for (const view of views.values()) view.entity.dispose();
      views.clear(); scene.dispose();
    }

    return Object.freeze({draw, play, sync, destroy, views});
  }

  global.GameContinuousSpineStage = Object.freeze({visualOffsetYU:VISUAL_OFFSET_Y_U,create});
})(window);
