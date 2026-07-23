(function registerSpiritVisualProfiles(global) {
  "use strict";

  const BASE_ANIMATIONS = Object.freeze(["spawn", "idle", "move", "attack", "hurt", "death"]);
  const SPREADER_ANIMATION_ALIASES = Object.freeze({
    takeoff: "spawn",
    fly: "move",
    land: "idle",
    ability: "attack",
    cast: "attack",
    shield: "attack",
    disabled: "idle",
    transform: "attack"
  });
  const INITIAL = [
    ["initial.spreader", "Spreader"],
    ["initial.resource", "Resource", ["ability"]],
    ["initial.fighter", "Fighter"]
  ];
  const SINA = [
    ["sina.swan-messenger", "小天鹅信使", ["takeoff", "fly", "land", "ability"]],
    ["sina.lake-rally", "湖光集结", ["ability"]],
    ["sina.wing-pump", "羽翼泵动站", ["ability"]],
    ["sina.rest-area", "天鹅湖休息区", ["ability"]],
    ["sina.charging-sparrow", "冲锋白雀", ["takeoff", "fly", "land", "ability"]],
    ["sina.guardian-swan", "护卫大天鹅", ["takeoff", "fly", "land", "ability"]],
    ["sina.scout-falcon-b", "侦查隼·B型", ["takeoff", "fly", "land"]],
    ["sina.gravity-goose", "重力白鹅", ["takeoff", "fly", "land", "ability"]],
    ["sina.phantom-peacock", "幻影孔雀", ["takeoff", "fly", "land", "ability"]],
    ["sina.iron-woodpecker", "铁喙啄木鸟", ["takeoff", "fly", "land"]]
  ];
  const FINE = [
    ["fine.moving-bookshelf", "流动书架", ["ability"]],
    ["fine.meditation-candle", "沉思蜡烛", ["ability"]],
    ["fine.truth-loop", "真理循环装置", ["ability"]],
    ["fine.truth-curator", "真理馆长", ["ability"]],
    ["fine.spell-guard", "禁咒守卫", ["shield", "ability"]],
    ["fine.ink-solidifier", "墨水凝固者", ["ability"]],
    ["fine.living-statue", "图书馆活化石像", ["ability"]],
    ["fine.binding-bottle", "禁锢墨水瓶", ["ability"]],
    ["fine.arcane-recorder", "奥术记录仪", ["ability"]],
    ["fine.wall-of-truth", "真理之墙", ["disabled", "ability"]]
  ];
  const ROLE_20735 = [
    ["20735.maintenance-alpha", "维护子机-α", ["ability"]],
    ["20735.cycle-pump", "循环泵站", ["ability", "disabled"]],
    ["20735.emergency-generator", "应急发电机", ["ability", "disabled"]],
    ["20735.scrap-pile", "废料堆", ["ability", "disabled"]],
    ["20735.patrol-a", "标准巡逻兵·A型", ["ability"]],
    ["20735.purifier-mk2", "净化单元·Mk-II", ["ability"]],
    ["20735.mass-drone", "量产无人机", ["ability"]],
    ["20735.interceptor-sigma", "拦截无人机·Σ型", ["shield", "ability"]],
    ["20735.painting-delta", "涂装无人机·Δ型", ["ability"]],
    ["20735.repair-omega", "修复无人机·Ω型", ["ability"]]
  ];

  const profiles = [...INITIAL, ...SINA, ...FINE, ...ROLE_20735].map(([id, name, extra = []]) => {
    const assetId = id;
    const aliases = {...SPREADER_ANIMATION_ALIASES};
    for (const animation of extra) delete aliases[animation];
    const animationAliases = Object.freeze(aliases);
    return Object.freeze({
    id,
    name,
    assetId,
    assetRoot: `assets/spine/${assetId}`,
    skeletonFile: "skeleton.json",
    atlasFile: "skeleton.atlas",
    textureFile: "texture.png",
    previewFile: "preview.webp",
    requiredBones: Object.freeze(["root"]),
    requiredSlots: Object.freeze(["shadow_anchor", "brush_anchor", "hit_anchor", "status_anchor", "selection_anchor"]),
    requiredAnimations: Object.freeze([...new Set([...BASE_ANIMATIONS, ...extra])]),
    scale: 1,
    battleScale: id.startsWith("initial.") ? 1 : 2.5,
    groundOffsetU: 0,
    animationAliases
  });
  });
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const byName = new Map(profiles.map(profile => [profile.name, profile]));
  if (byId.size !== profiles.length) throw new Error("Duplicate spirit visual profile id.");

  global.GameSpiritVisualProfiles = Object.freeze({
    baseAnimations: BASE_ANIMATIONS,
    all: () => profiles.slice(),
    get: id => byId.get(id) || null,
    getByName: name => byName.get(name) || null,
    resolveAnimation(profileOrId, animation) {
      const profile = typeof profileOrId === "string" ? byId.get(profileOrId) : profileOrId;
      return profile?.animationAliases?.[animation] || animation;
    }
  });
})(window);
