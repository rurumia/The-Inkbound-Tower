import {access, readFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {promisify} from "node:util";
import {resolve, join} from "node:path";
import {fileURLToPath} from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function loadConfig(root = projectRoot) {
  return JSON.parse(await readFile(join(root, "spine.config.json"), "utf8"));
}

export function editorCandidates(root = projectRoot, env = process.env) {
  return [
    env.SPINE_EDITOR,
    resolve(root, "../../spine/Spine.com"),
    "C:\\Program Files\\Spine\\Spine.com",
    "C:\\Program Files (x86)\\Spine\\Spine.com"
  ].filter(Boolean);
}

export async function findEditor(root = projectRoot, env = process.env) {
  for (const candidate of editorCandidates(root, env)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the small, deterministic candidate list.
    }
  }
  return null;
}

export async function readEditorVersion(executable, pinnedVersion, execute = execFileAsync) {
  const result = await execute(executable, ["-u", pinnedVersion, "--version"], {
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const output = typeof result === "string" ? result : `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(/Spine\s+(\d+\.\d+\.\d+)\s+(?:Professional|Essential|Trial)/i);
  if (!match) throw new Error("Unable to read the Spine Editor version from its CLI output.");
  return match[1];
}

export async function doctor(options = {}) {
  const root = options.root || projectRoot;
  const config = options.config || await loadConfig(root);
  if (config.editorVersion !== config.runtimeVersion) {
    throw new Error(`Spine version mismatch: editor ${config.editorVersion}, runtime ${config.runtimeVersion}.`);
  }

  const executable = options.executable || await findEditor(root, options.env || process.env);
  if (!executable) {
    throw new Error("Spine Editor not found. Set SPINE_EDITOR to the full path of Spine.com.");
  }
  const editorVersion = await readEditorVersion(executable, config.editorVersion, options.execute);
  if (editorVersion !== config.editorVersion) {
    throw new Error(`Spine Editor ${editorVersion} does not match pinned version ${config.editorVersion}.`);
  }

  const runtimePath = resolve(root, config.runtimeFile);
  const licensePath = resolve(root, config.runtimeLicense);
  await access(runtimePath);
  await access(licensePath);
  const runtimeHash = createHash("sha256").update(await readFile(runtimePath)).digest("hex").toUpperCase();
  if (runtimeHash !== config.runtimeSha256) {
    throw new Error(`Spine Runtime integrity check failed for ${config.runtimeFile}.`);
  }
  return Object.freeze({
    ready: true,
    editorVersion,
    runtimeVersion: config.runtimeVersion,
    runtimeHash,
    executable,
    runtimePath,
    licensePath
  });
}

async function main() {
  const result = await doctor();
  console.log(`Spine Editor: ${result.editorVersion}`);
  console.log(`Spine Runtime: ${result.runtimeVersion}`);
  console.log(`Editor CLI: ${result.executable}`);
  console.log(`Runtime file: ${result.runtimePath}`);
  console.log("Spine toolchain: ready");
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(`Spine toolchain: ${error.message}`);
  process.exitCode = 1;
});
