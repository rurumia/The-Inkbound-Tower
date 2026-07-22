import {readFile, stat, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {runInNewContext} from "node:vm";
import {fileURLToPath} from "node:url";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function loadProfiles(root = projectRoot) {
  const source = await readFile(join(root, "src/content/spirit-visual-profiles.js"), "utf8");
  const sandbox = {window: {}};
  runInNewContext(source, sandbox, {filename: "spirit-visual-profiles.js"});
  return sandbox.window.GameSpiritVisualProfiles.all();
}

async function readable(path) {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}

function names(values = []) {
  return new Set(values.map(value => value.name));
}

export async function validateProfile(profile, root = projectRoot) {
  const base = join(root, profile.assetRoot);
  const paths = {
    skeleton: join(base, profile.skeletonFile),
    atlas: join(base, profile.atlasFile),
    texture: join(base, profile.textureFile),
    preview: join(base, profile.previewFile)
  };
  const errors = [];
  for (const [kind, path] of Object.entries(paths)) {
    if (!await readable(path)) errors.push(`missing ${kind}: ${path}`);
  }
  if (errors.length) return {profile, valid: false, errors, paths};

  let skeleton;
  try {
    skeleton = JSON.parse(await readFile(paths.skeleton, "utf8"));
  } catch (error) {
    errors.push(`invalid skeleton JSON: ${error.message}`);
  }
  if (skeleton) {
    const version = skeleton.skeleton?.spine || "";
    if (!/^4\.2(?:\.|$)/.test(version)) errors.push(`unsupported Spine export version: ${version || "missing"}; expected 4.2.x`);
    const bones = names(skeleton.bones);
    const slots = names(skeleton.slots);
    const animations = new Set(Object.keys(skeleton.animations || {}));
    for (const name of profile.requiredBones || []) if (!bones.has(name)) errors.push(`missing bone: ${name}`);
    for (const name of profile.requiredSlots) if (!slots.has(name)) errors.push(`missing slot: ${name}`);
    for (const name of profile.requiredAnimations) if (!animations.has(name)) errors.push(`missing animation: ${name}`);
  }
  const texture = await readFile(paths.texture);
  const preview = await readFile(paths.preview);
  if (!texture.subarray(0, 8).equals(PNG_SIGNATURE)) errors.push("texture is not a PNG file");
  if (!preview.subarray(0, 8).equals(PNG_SIGNATURE)) errors.push("preview is not a PNG file");
  const atlas = await readFile(paths.atlas, "utf8");
  if (!atlas.includes(profile.textureFile)) errors.push(`atlas does not reference ${profile.textureFile}`);
  return {profile, valid: errors.length === 0, errors, paths, skeleton, atlas, texture, preview};
}

export async function validateAll(options = {}) {
  const root = options.root || projectRoot;
  const profiles = options.profiles || await loadProfiles(root);
  return Promise.all(profiles.map(profile => validateProfile(profile, root)));
}

export async function packProfiles(options = {}) {
  const root = options.root || projectRoot;
  const output = options.output || join(root, "dist/spine-assets.js");
  const results = await validateAll({root, profiles: options.profiles});
  const invalid = results.filter(result => !result.valid);
  if (invalid.length) throw new Error(invalid.map(result => `${result.profile.id}: ${result.errors.join("; ")}`).join("\n"));
  const assets = Object.fromEntries(results.map(result => [result.profile.id, {
    skeleton: result.skeleton,
    atlas: result.atlas,
    textureDataUrl: `data:image/png;base64,${result.texture.toString("base64")}`,
    previewDataUrl: `data:image/png;base64,${result.preview.toString("base64")}`
  }]));
  const source = `window.GameSpineAssets=Object.freeze(${JSON.stringify(assets)});\n`;
  await writeFile(output, source, "utf8");
  return {output, count: results.length};
}

async function main() {
  const command = process.argv[2] || "status";
  if (command === "pack") {
    const result = await packProfiles();
    console.log(`Packed ${result.count} Spine profiles to ${result.output}`);
    return;
  }
  const results = await validateAll();
  const valid = results.filter(result => result.valid);
  const invalid = results.filter(result => !result.valid);
  console.log(`Spine assets: ${valid.length}/${results.length} complete`);
  for (const result of invalid) console.log(`${result.profile.id}: ${result.errors.join("; ")}`);
  if (command === "validate" && invalid.length) process.exitCode = 1;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
