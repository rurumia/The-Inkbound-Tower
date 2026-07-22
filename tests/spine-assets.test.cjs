const test = require("node:test");
const assert = require("node:assert/strict");
const {mkdtemp, mkdir, writeFile, readFile, rm} = require("node:fs/promises");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "inkbound-spine-"));
  const assetRoot = "assets/spine/test.spirit";
  const directory = path.join(root, assetRoot);
  await mkdir(directory, {recursive: true});
  const profile = {
    id: "test.spirit", assetRoot,
    skeletonFile: "skeleton.json", atlasFile: "skeleton.atlas", textureFile: "texture.png", previewFile: "preview.png",
    requiredBones: ["root"], requiredSlots: ["brush_anchor", "hit_anchor"],
    requiredAnimations: ["spawn", "idle", "move", "attack", "hurt", "death"]
  };
  const skeleton = {
    skeleton: {spine: "4.2.50"},
    bones: [{name: "root"}],
    slots: [{name: "brush_anchor", bone: "root"}, {name: "hit_anchor", bone: "root"}],
    animations: Object.fromEntries(profile.requiredAnimations.map(name => [name, {}]))
  };
  await writeFile(path.join(directory, "skeleton.json"), JSON.stringify(skeleton));
  await writeFile(path.join(directory, "skeleton.atlas"), "texture.png\nsize: 1,1\n");
  await writeFile(path.join(directory, "texture.png"), PNG);
  await writeFile(path.join(directory, "preview.png"), PNG);
  return {root, profile, directory};
}

test("Spine asset validation enforces version, slots, and animations", async () => {
  const module = await import(pathToFileURL(path.join(__dirname, "../tools/spine-assets.mjs")));
  const data = await fixture();
  try {
    const valid = await module.validateProfile(data.profile, data.root);
    assert.equal(valid.valid, true, valid.errors.join("; "));
    const skeletonPath = path.join(data.directory, "skeleton.json");
    const skeleton = JSON.parse(await readFile(skeletonPath, "utf8"));
    delete skeleton.animations.attack;
    await writeFile(skeletonPath, JSON.stringify(skeleton));
    const invalid = await module.validateProfile(data.profile, data.root);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.includes("missing animation: attack"));
  } finally {
    await rm(data.root, {recursive: true, force: true});
  }
});

test("Spine packer emits a classic file-compatible asset bundle", async () => {
  const module = await import(pathToFileURL(path.join(__dirname, "../tools/spine-assets.mjs")));
  const data = await fixture();
  try {
    const output = path.join(data.root, "spine-assets.js");
    const result = await module.packProfiles({root: data.root, profiles: [data.profile], output});
    assert.equal(result.count, 1);
    const source = await readFile(output, "utf8");
    assert.match(source, /^window\.GameSpineAssets=Object\.freeze/);
    assert.match(source, /data:image\/png;base64/);
  } finally {
    await rm(data.root, {recursive: true, force: true});
  }
});
