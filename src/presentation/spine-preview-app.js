(function createSpinePreview(global) {
  "use strict";

  const ANIMATION_LABELS = Object.freeze({
    spawn: "登场", idle: "待机", move: "移动", attack: "攻击",
    hurt: "受击", death: "退场", ability: "能力"
  });

  function createRenderer(canvas, gl, runtime) {
    const scene = new runtime.SceneRenderer(canvas, gl, true);

    function resize() {
      const ratio = Math.max(1, global.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      return {width, height};
    }

    function draw(skeleton) {
      const {width, height} = resize();
      const worldHeight = 1380;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      scene.camera.setViewport(width, height);
      scene.camera.position.set(0, 10, 0);
      scene.camera.zoom = worldHeight / height;
      scene.begin();
      scene.drawSkeleton(skeleton, true);
      scene.end();
    }

    function opaquePixels() {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) count++;
      return count;
    }

    function dispose() {
      scene.dispose();
    }

    return Object.freeze({draw, opaquePixels, dispose});
  }

  async function createPlayer(element) {
    const id = element.dataset.profile;
    const profile = global.GameSpiritVisualProfiles.get(id);
    if (!profile) throw new Error(`Unknown preview profile: ${id}`);
    const canvas = element.querySelector("canvas");
    const gl = canvas.getContext("webgl2", {alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true})
      || canvas.getContext("webgl", {alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true});
    if (!gl) throw new Error(`WebGL is unavailable for ${id}`);
    const entity = await global.GameSpineRuntimeAdapter.create({gl, profile});
    const renderer = createRenderer(canvas, gl, global.spine);
    const select = element.querySelector("select");
    for (const name of profile.requiredAnimations) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = ANIMATION_LABELS[name] || name;
      select.appendChild(option);
    }
    select.value = "idle";
    select.addEventListener("change", () => entity.setAnimation(select.value, true));

    function setAnimation(name) {
      if (!profile.requiredAnimations.includes(name)) return false;
      select.value = name;
      entity.setAnimation(name, true);
      return true;
    }

    function update(delta, speed, paused) {
      if (!paused) entity.update(delta * speed);
      renderer.draw(entity.skeleton);
    }

    function snapshot() {
      return Object.freeze({
        id,
        animation: entity.state.getCurrent(0)?.animation?.name || null,
        opaquePixels: renderer.opaquePixels(),
        canvas: [canvas.width, canvas.height],
        glError: gl.getError()
      });
    }

    return Object.freeze({id, profile, entity, renderer, setAnimation, update, snapshot});
  }

  async function start() {
    const status = document.getElementById("previewStatus");
    const players = await Promise.all([...document.querySelectorAll(".spirit-view")].map(createPlayer));
    let paused = false;
    let speed = 1;
    let previous = performance.now();

    for (const button of document.querySelectorAll("[data-global-animation]")) {
      button.addEventListener("click", () => {
        const name = button.dataset.globalAnimation;
        for (const player of players) player.setAnimation(name);
        document.querySelectorAll("[data-global-animation]").forEach(current => current.classList.toggle("active", current === button));
      });
    }

    const pauseButton = document.getElementById("pauseButton");
    pauseButton.addEventListener("click", () => {
      paused = !paused;
      pauseButton.textContent = paused ? "播放" : "暂停";
      pauseButton.classList.toggle("active", paused);
    });
    document.getElementById("speedSelect").addEventListener("change", event => {
      speed = Number(event.target.value) || 1;
    });

    function frame(now) {
      const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      for (const player of players) player.update(delta, speed, paused);
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);

    status.textContent = "3 个书灵已加载";
    status.className = "preview-status ready";
    document.body.dataset.previewReady = "true";
    global.GameSpinePreview = Object.freeze({
      players,
      setAnimation(name) { return players.map(player => player.setAnimation(name)); },
      setPaused(value) {
        paused = Boolean(value);
        pauseButton.textContent = paused ? "播放" : "暂停";
        pauseButton.classList.toggle("active", paused);
      },
      snapshot() { return players.map(player => player.snapshot()); }
    });
  }

  start().catch(error => {
    const status = document.getElementById("previewStatus");
    status.textContent = error.message;
    status.className = "preview-status error";
    document.body.dataset.previewReady = "error";
    console.error(error);
  });
})(window);
