import {execFile} from "node:child_process";
import {copyFile, readFile, unlink, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const INITIAL_IDS = Object.freeze(["initial.spreader", "initial.resource", "initial.fighter"]);
const runFile = promisify(execFile);

export async function normalize(profileId, root = projectRoot) {
  const exportDirectory = join(root, "assets", "spine", profileId);
  const projectDirectory = join(root, "spine-projects", profileId);
  const exportedJson = join(exportDirectory, "source-skeleton.json");
  const exportedTexture = join(exportDirectory, "skeleton.png");
  const atlasPath = join(exportDirectory, "skeleton.atlas");
  const skeletonPath = join(exportDirectory, "skeleton.json");
  const texturePath = join(exportDirectory, "texture.png");
  const previewPath = join(exportDirectory, "preview.webp");

  await copyFile(exportedJson, skeletonPath);
  await copyFile(exportedTexture, texturePath);
  const atlas = await readFile(atlasPath, "utf8");
  if (!/^skeleton\.png\r?\n/.test(atlas)) throw new Error(`${profileId} atlas does not start with skeleton.png.`);
  await writeFile(atlasPath, atlas.replace(/^skeleton\.png(?=\r?\n)/, "texture.png"), "utf8");
  await runFile(process.env.PYTHON || "python", [
    join(root, "tools", "optimize-spine-preview.py"),
    join(projectDirectory, "assembly-reference.png"),
    previewPath
  ]);
  await unlink(exportedJson);
  await unlink(exportedTexture);
  return {profileId, skeletonPath, atlasPath, texturePath, previewPath};
}

async function main() {
  const ids = process.argv.slice(2);
  for (const profileId of ids.length ? ids : INITIAL_IDS) {
    await normalize(profileId);
    console.log(`${profileId}: normalized Spine export`);
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
