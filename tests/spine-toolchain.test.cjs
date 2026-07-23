const test = require("node:test");
const assert = require("node:assert/strict");
const {mkdtemp, mkdir, writeFile, rm} = require("node:fs/promises");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {createHash} = require("node:crypto");
const {pathToFileURL} = require("node:url");

const RUNTIME_SOURCE = "var spine={};";
const RUNTIME_SHA256 = createHash("sha256").update(RUNTIME_SOURCE).digest("hex").toUpperCase();

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "inkbound-spine-toolchain-"));
  const executable = path.join(root, "Spine.com");
  await mkdir(path.join(root, "vendor/spine"), {recursive: true});
  await writeFile(executable, "fixture");
  await writeFile(path.join(root, "vendor/spine/runtime.js"), RUNTIME_SOURCE);
  await writeFile(path.join(root, "vendor/spine/LICENSE"), "license");
  return {root, executable};
}

test("Spine toolchain doctor accepts one exact editor/runtime version", async () => {
  const module = await import(pathToFileURL(path.join(__dirname, "../tools/spine-toolchain.mjs")));
  assert.equal(
    module.editorCandidates("E:\\-project-\\game make\\html", {})[0],
    "E:\\-project-\\spine\\Spine.com"
  );
  const data = await fixture();
  const config = {
    editorVersion: "4.2.43",
    runtimeVersion: "4.2.43",
    runtimeFile: "vendor/spine/runtime.js",
    runtimeSha256: RUNTIME_SHA256,
    runtimeLicense: "vendor/spine/LICENSE"
  };
  try {
    const result = await module.doctor({
      root: data.root,
      config,
      executable: data.executable,
      execute: async (_file, args) => {
        assert.deepEqual(args, ["-u", "4.2.43", "--version"]);
        return {stdout: "Spine 4.2.43 Professional\nLicensed to: fixture", stderr: ""};
      }
    });
    assert.equal(result.ready, true);
    assert.equal(result.editorVersion, "4.2.43");

    await writeFile(path.join(data.root, "vendor/spine/runtime.js"), `${RUNTIME_SOURCE}\nmodified`);
    await assert.rejects(module.doctor({
      root: data.root,
      config,
      executable: data.executable,
      execute: async () => ({stdout: "Spine 4.2.43 Professional", stderr: ""})
    }), /integrity check failed/);
  } finally {
    await rm(data.root, {recursive: true, force: true});
  }
});

test("Spine toolchain doctor rejects editor/runtime drift", async () => {
  const module = await import(pathToFileURL(path.join(__dirname, "../tools/spine-toolchain.mjs")));
  const data = await fixture();
  try {
    await assert.rejects(module.doctor({
      root: data.root,
      config: {
        editorVersion: "4.2.43",
        runtimeVersion: "4.2.44",
        runtimeFile: "vendor/spine/runtime.js",
        runtimeSha256: RUNTIME_SHA256,
        runtimeLicense: "vendor/spine/LICENSE"
      },
      executable: data.executable,
      execute: async () => ({stdout: "Spine 4.2.43 Professional", stderr: ""})
    }), /version mismatch/);
  } finally {
    await rm(data.root, {recursive: true, force: true});
  }
});
