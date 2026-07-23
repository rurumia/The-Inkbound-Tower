import {readFile, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {fileURLToPath} from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const RIGS = Object.freeze({
  "initial.spreader": {
    positions: {
      "back-ribbons": [0, 285], "hip-core": [0, -150], head: [0, 225], torso: [0, 0],
      "arm-upper-left": [-205, 25], "arm-lower-left": [-330, -85],
      "arm-upper-right": [205, 25], "arm-lower-right": [330, -85],
      "leg-upper-left": [-75, -250], "leg-lower-left": [-75, -445],
      "leg-upper-right": [75, -250], "leg-lower-right": [75, -445]
    },
    parents: {
      "back-ribbons": "torso", "hip-core": "torso", head: "torso",
      "arm-upper-left": "torso", "arm-lower-left": "arm-upper-left",
      "arm-upper-right": "torso", "arm-lower-right": "arm-upper-right",
      "leg-upper-left": "hip-core", "leg-lower-left": "leg-upper-left",
      "leg-upper-right": "hip-core", "leg-lower-right": "leg-upper-right"
    },
    behind: ["back-ribbons", "hip-core", "leg-upper-left", "leg-upper-right", "leg-lower-left", "leg-lower-right"],
    front: ["torso", "arm-upper-left", "arm-upper-right", "arm-lower-left", "arm-lower-right", "head"],
    hidden: [],
    bodyBone: "torso",
    headBone: "head",
    swayBone: "back-ribbons",
    attackBone: "arm-lower-left",
    attackUpperBone: "arm-upper-left",
    brushBone: "arm-lower-right",
    anchors: {shadow: [0, -590], status: [0, 390], selection: [0, -520], brush: [0, -155], hit: [0, -185]}
  },
  "initial.resource": {
    positions: {
      hip: [0, -170], cap: [0, 220], body: [0, 0],
      "arm-upper-left": [-205, 55], "arm-lower-left": [-315, -120],
      "arm-upper-right": [205, 55], "arm-lower-right": [315, -120],
      "leg-upper-left": [-65, -215], "leg-lower-left": [-65, -395],
      "leg-upper-right": [65, -215], "leg-lower-right": [65, -395], seal: [0, -10]
    },
    parents: {
      hip: "body", cap: "body",
      "arm-upper-left": "body", "arm-lower-left": "arm-upper-left",
      "arm-upper-right": "body", "arm-lower-right": "arm-upper-right",
      "leg-upper-left": "hip", "leg-lower-left": "leg-upper-left",
      "leg-upper-right": "hip", "leg-lower-right": "leg-upper-right"
    },
    behind: ["hip", "leg-upper-left", "leg-upper-right", "leg-lower-left", "leg-lower-right"],
    front: ["body", "cap", "arm-upper-left", "arm-upper-right", "arm-lower-left", "arm-lower-right"],
    hidden: ["seal"],
    bodyBone: "body",
    headBone: "cap",
    attackBone: "arm-lower-left",
    attackUpperBone: "arm-upper-left",
    brushBone: "arm-lower-right",
    anchors: {shadow: [0, -510], status: [0, 370], selection: [0, -440], brush: [0, -145], hit: [0, -150]},
    ability: true
  },
  "initial.fighter": {
    positions: {
      "back-armor": [0, 25], pelvis: [0, -150], head: [0, 235], torso: [0, 0],
      "arm-upper-left": [-210, 45], "arm-lower-left": [-340, -130],
      "arm-upper-right": [210, 45], "arm-lower-right": [300, -120],
      "leg-upper-left": [-85, -245], "leg-lower-left": [-90, -465],
      "leg-upper-right": [85, -245], "leg-lower-right": [90, -465]
    },
    parents: {
      "back-armor": "torso", pelvis: "torso", head: "torso",
      "arm-upper-left": "torso", "arm-lower-left": "arm-upper-left",
      "arm-upper-right": "torso", "arm-lower-right": "arm-upper-right",
      "leg-upper-left": "pelvis", "leg-lower-left": "leg-upper-left",
      "leg-upper-right": "pelvis", "leg-lower-right": "leg-upper-right"
    },
    behind: ["back-armor", "pelvis", "leg-upper-left", "leg-upper-right", "leg-lower-left", "leg-lower-right"],
    front: ["torso", "arm-upper-left", "arm-upper-right", "arm-lower-left", "arm-lower-right", "head"],
    hidden: [],
    bodyBone: "torso",
    headBone: "head",
    swayBone: "back-armor",
    attackBone: "arm-lower-left",
    attackUpperBone: "arm-upper-left",
    brushBone: "arm-lower-right",
    anchors: {shadow: [0, -610], status: [0, 400], selection: [0, -540], brush: [0, -170], hit: [0, -210]}
  }
});

const q = value => Math.round(value * 1000) / 1000;
const rotate = values => values.map(([time, value]) => ({time, value}));
const translate = values => values.map(([time, x, y]) => ({time, x, y}));
const scale = values => values.map(([time, x, y]) => ({time, x, y}));

function animations(rig, partNames) {
  const moveArmLeft = rig.moveArmLeft || "arm-upper-left";
  const moveArmRight = rig.moveArmRight || "arm-upper-right";
  const has = name => name && partNames.has(name);
  const optionalBones = entries => Object.fromEntries(entries.filter(([name]) => has(name)));
  const result = {
    spawn: {bones: {
      root: {
        scale: scale([[0, 0.15, 0.15], [0.22, 1.08, 1.08], [0.4, 1, 1]]),
        translate: translate([[0, 0, -35], [0.4, 0, 0]])
      }
    }},
    idle: {bones: {
      [rig.bodyBone]: {
        translate: translate([[0, 0, 0], [0.6, 0, 10], [1.2, 0, 0]]),
        rotate: rotate([[0, -1.5], [0.6, 1.5], [1.2, -1.5]])
      },
      [rig.headBone]: {rotate: rotate([[0, -4], [0.6, 4], [1.2, -4]])},
      ...optionalBones([
        [moveArmLeft, {rotate: rotate([[0, 2], [0.6, -3], [1.2, 2]])}],
        [moveArmRight, {rotate: rotate([[0, -2], [0.6, 3], [1.2, -2]])}],
        [rig.swayBone, {rotate: rotate([[0, -5], [0.6, 6], [1.2, -5]])}]
      ])
    }},
    move: {bones: {
      [rig.bodyBone]: {
        translate: translate([[0, 0, 0], [0.15, 0, 12], [0.3, 0, 0], [0.45, 0, 12], [0.6, 0, 0]]),
        rotate: rotate([[0, -2], [0.15, 2], [0.3, -2], [0.45, 2], [0.6, -2]])
      },
      "leg-upper-left": {rotate: rotate([[0, -18], [0.3, 18], [0.6, -18]])},
      "leg-upper-right": {rotate: rotate([[0, 18], [0.3, -18], [0.6, 18]])},
      "leg-lower-left": {rotate: rotate([[0, 12], [0.3, -12], [0.6, 12]])},
      "leg-lower-right": {rotate: rotate([[0, -12], [0.3, 12], [0.6, -12]])},
      [moveArmLeft]: {rotate: rotate([[0, 10], [0.3, -10], [0.6, 10]])},
      [moveArmRight]: {rotate: rotate([[0, -10], [0.3, 10], [0.6, -10]])},
      ...optionalBones([[rig.swayBone, {rotate: rotate([[0, -8], [0.3, 10], [0.6, -8]])}]])
    }},
    attack: {
      bones: {
        [rig.attackBone]: {rotate: rotate([[0, 0], [0.12, -32], [0.28, 68], [0.55, 0]])},
        [rig.bodyBone]: {rotate: rotate([[0, 0], [0.12, -5], [0.28, 10], [0.55, 0]])},
        ...optionalBones([[rig.attackUpperBone, {rotate: rotate([[0, 0], [0.12, -12], [0.28, 26], [0.55, 0]])}]])
      },
      events: [{time: 0.28, name: "hit"}]
    },
    hurt: {bones: {
      root: {translate: translate([[0, 0, 0], [0.06, -14, 0], [0.14, 7, 0], [0.28, 0, 0]])},
      [rig.bodyBone]: {rotate: rotate([[0, 0], [0.08, -8], [0.28, 0]])}
    }},
    death: {bones: {
      root: {
        rotate: rotate([[0, 0], [0.7, -18]]),
        translate: translate([[0, 0, 0], [0.7, 0, -65]]),
        scale: scale([[0, 1, 1], [0.5, 1.05, 0.7], [0.7, 0.05, 0.05]])
      }
    }}
  };
  if (rig.ability) result.ability = {bones: {
    [rig.bodyBone]: {scale: scale([[0, 1, 1], [0.3, 1.12, 1.12], [0.65, 1, 1]])},
    "arm-lower-left": {rotate: rotate([[0, 0], [0.3, -28], [0.65, 0]])},
    "arm-lower-right": {rotate: rotate([[0, 0], [0.3, 28], [0.65, 0]])}
  }};
  return result;
}

function anchorData(rig) {
  return [
    {name: "shadow_anchor", parent: "root", x: rig.anchors.shadow[0], y: rig.anchors.shadow[1]},
    {name: "status_anchor", parent: "root", x: rig.anchors.status[0], y: rig.anchors.status[1]},
    {name: "selection_anchor", parent: "root", x: rig.anchors.selection[0], y: rig.anchors.selection[1]},
    {name: "brush_anchor", parent: rig.brushBone, x: rig.anchors.brush[0], y: rig.anchors.brush[1]},
    {name: "hit_anchor", parent: rig.attackBone, x: rig.anchors.hit[0], y: rig.anchors.hit[1]}
  ];
}

export async function buildProject(profileId, root = projectRoot) {
  const rig = RIGS[profileId];
  if (!rig) throw new Error(`Unknown initial Spine profile: ${profileId}`);
  const directory = join(root, "spine-projects", profileId);
  const manifest = JSON.parse(await readFile(join(directory, "images", "parts.json"), "utf8"));
  const parts = new Map(manifest.parts.map(part => [part.name, part]));
  const order = [...rig.behind, ...rig.front];
  for (const name of order) if (!parts.has(name)) throw new Error(`${profileId} is missing part ${name}`);

  const bones = [{name: "root"}];
  const pending = new Set(order);
  const absolutePositions = new Map([["root", [0, 0]]]);
  while (pending.size) {
    const before = pending.size;
    for (const name of [...pending]) {
      const parent = rig.parents?.[name] || "root";
      if (!absolutePositions.has(parent)) continue;
      const absolute = rig.positions[name];
      const parentAbsolute = absolutePositions.get(parent);
      const x = absolute[0] - parentAbsolute[0];
      const y = absolute[1] - parentAbsolute[1];
      bones.push({name, parent, x, y});
      absolutePositions.set(name, absolute);
      pending.delete(name);
    }
    if (pending.size === before) throw new Error(`${profileId} has an invalid bone parent graph: ${[...pending].join(", ")}`);
  }
  bones.push(...anchorData(rig));

  const slots = order.map(name => ({name: `part-${name}`, bone: name, attachment: name}));
  slots.push(...["shadow_anchor", "brush_anchor", "hit_anchor", "status_anchor", "selection_anchor"]
    .map(name => ({name, bone: name})));

  const attachments = {};
  for (const name of order) {
    const part = parts.get(name);
    attachments[`part-${name}`] = {
      [name]: {path: name, width: part.width, height: part.height}
    };
  }

  const xs = order.map(name => rig.positions[name][0]);
  const ys = order.map(name => rig.positions[name][1]);
  const skeleton = {
    skeleton: {
      hash: "",
      spine: "4.2.43",
      x: q(Math.min(...xs) - 250),
      y: q(Math.min(...ys) - 250),
      width: q(Math.max(...xs) - Math.min(...xs) + 500),
      height: q(Math.max(...ys) - Math.min(...ys) + 500),
      images: "./images/"
    },
    bones,
    slots,
    skins: [{name: "default", attachments}],
    events: {hit: {}},
    animations: animations(rig, new Set(order))
  };
  const output = join(directory, "source-skeleton.json");
  await writeFile(output, JSON.stringify(skeleton, null, 2) + "\n", "utf8");
  return {profileId, output, boneCount: bones.length, slotCount: slots.length, animationCount: Object.keys(skeleton.animations).length};
}

async function main() {
  for (const profileId of Object.keys(RIGS)) {
    const result = await buildProject(profileId);
    console.log(`${profileId}: ${result.boneCount} bones, ${result.slotCount} slots, ${result.animationCount} animations`);
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
