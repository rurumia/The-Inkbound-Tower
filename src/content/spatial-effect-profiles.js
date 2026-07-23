(function registerSpatialEffectProfiles(global) {
  "use strict";

  const SINA = [
    "小天鹅信使","湖光集结","羽翼泵动站","天鹅湖休息区","冲锋白雀","护卫大天鹅","侦查隼·B型","重力白鹅","幻影孔雀","铁喙啄木鸟",
    "紧急着陆指令","轻盈之舞","莽撞突击","全体升空！","精准俯冲","白羽防护罩","乱序风暴"
  ];
  const FINE = [
    "流动书架","沉思蜡烛","真理循环装置","真理馆长","禁咒守卫","墨水凝固者","图书馆活化石像","禁锢墨水瓶","奥术记录仪","真理之墙",
    "索引重排","结晶共鸣","逻辑重构","“保持安静”","噤声","奥术结晶界","最终论文：永恒结晶"
  ];
  const ROLE_20735 = [
    "维护子机-α","循环泵站","应急发电机","废料堆","标准巡逻兵·A型","净化单元·Mk-II","量产无人机","拦截无人机·Σ型","涂装无人机·Δ型","修复无人机·Ω型",
    "系统维护","区域净化协议","紧急冷却","备用能源调配","防御矩阵","效率优化指令","超维归档：奇点"
  ];
  const SUMMONS = new Set([...SINA.slice(0, 10), ...FINE.slice(0, 10), ...ROLE_20735.slice(0, 10)]);
  const definitions = new Map();

  function define(name, settings = {}) {
    definitions.set(name, Object.freeze({
      name,
      target: settings.target || (SUMMONS.has(name) ? "point" : "none"),
      shape: settings.shape || (SUMMONS.has(name) ? "body" : "none"),
      radiusU: settings.radiusU || 0,
      widthU: settings.widthU || 0,
      heightU: settings.heightU || 0,
      rangeU: settings.rangeU || 0,
      areaU2: settings.areaU2 || 0,
      completeInside: settings.completeInside !== false,
      animation: settings.animation || (SUMMONS.has(name) ? "spawn" : "ability")
    }));
  }

  [...SINA, ...FINE, ...ROLE_20735].forEach(name => define(name));
  const override = (name, settings) => define(name, settings);

  override("冲锋白雀", {target:"point",shape:"path",rangeU:4,animation:"move"});
  override("护卫大天鹅", {target:"point",shape:"circle",radiusU:2,rangeU:3,animation:"land"});
  override("幻影孔雀", {target:"path",shape:"path",areaU2:1,animation:"move"});
  override("紧急着陆指令", {target:"allFriendlyAir",shape:"boundary",rangeU:1,animation:"land"});
  override("轻盈之舞", {target:"friendlyUnit",shape:"body",animation:"takeoff"});
  override("莽撞突击", {target:"allFriendly",shape:"path",animation:"move"});
  override("全体升空！", {target:"allFriendlyGround",shape:"body",animation:"takeoff"});
  override("精准俯冲", {target:"airUnitAndPoint",shape:"body",animation:"land"});
  override("白羽防护罩", {target:"friendlyGround",shape:"body",animation:"shield"});
  override("乱序风暴", {target:"allAir",shape:"circle",radiusU:3,areaU2:25,animation:"land"});
  override("墨水凝固者", {target:"self",shape:"circle",radiusU:1.5});
  override("禁锢墨水瓶", {target:"studyEntry",shape:"circle",radiusU:.6});
  override("奥术记录仪", {target:"self",shape:"circle",radiusU:1.5});
  override("真理之墙", {target:"point",shape:"circle",radiusU:3});
  override("索引重排", {target:"enemyUnit",shape:"body",animation:"move"});
  override("结晶共鸣", {target:"friendlyCrystal",shape:"boundary",rangeU:1});
  override("逻辑重构", {target:"twoFriendlyUnits",shape:"body",animation:"move"});
  override("“保持安静”", {target:"point",shape:"circle",radiusU:2.5});
  override("噤声", {target:"point",shape:"circle",radiusU:2.5});
  override("奥术结晶界", {target:"allFriendlyInkInHalf",shape:"component"});
  override("最终论文：永恒结晶", {target:"friendlyUnit",shape:"circle",radiusU:2.5,animation:"transform"});
  override("标准巡逻兵·A型", {target:"self",shape:"circle",areaU2:3});
  override("净化单元·Mk-II", {target:"path",shape:"path",rangeU:0});
  override("量产无人机", {target:"friendlyDrone",shape:"circle",radiusU:3});
  override("拦截无人机·Σ型", {target:"friendlyDrone",shape:"circle",radiusU:3,rangeU:.25});
  override("涂装无人机·Δ型", {target:"self",shape:"circle",radiusU:1.5,rangeU:3,areaU2:2});
  override("修复无人机·Ω型", {target:"friendlyUnit",shape:"circle",radiusU:5,rangeU:3});
  override("系统维护", {target:"friendlyUnit",shape:"body"});
  override("区域净化协议", {target:"point",shape:"verticalBand",widthU:10,heightU:30});
  override("紧急冷却", {target:"friendlyUnit",shape:"body",animation:"disabled"});
  override("备用能源调配", {target:"friendlyUnit",shape:"body"});
  override("防御矩阵", {target:"friendlyBoundary",shape:"rect",widthU:2,heightU:.8});
  override("效率优化指令", {target:"allFriendly",shape:"none"});
  override("超维归档：奇点", {target:"discardCards",shape:"none"});

  const skills = Object.freeze([
    Object.freeze({id:"tailwind",name:"起风",target:"friendlyGround",shape:"body",animation:"takeoff",completeInside:true}),
    Object.freeze({id:"closeReading",name:"精读",target:"friendlyPoint",shape:"circle",radiusU:1.5,animation:"ability",completeInside:true}),
    Object.freeze({id:"archive",name:"归档",target:"handCard",shape:"snapshot",animation:"ability",completeInside:false})
  ]);
  const skillById = new Map(skills.map(profile => [profile.id, profile]));

  function centerOf(target) {
    if (!target) return null;
    if (target.position) return GameWorldSpace.point(target.position.x, target.position.y);
    if (target.cell) return centerOf(target.cell);
    if (Number.isFinite(target.x) && Number.isFinite(target.y)) return GameWorldSpace.point(target.x, target.y);
    return global.GameBattlefieldAdapter?.cellToWorld(target) || null;
  }

  function geometry(profileOrName, target) {
    const profile = typeof profileOrName === "string" ? definitions.get(profileOrName) || skillById.get(profileOrName) : profileOrName;
    const center = centerOf(target);
    if (!profile || !center || ["none","body","snapshot","component","boundary"].includes(profile.shape)) return null;
    if (profile.shape === "circle") return GameContinuousGeometry.circle(center, profile.radiusU);
    if (profile.shape === "rect") return GameContinuousGeometry.rect(center, profile.widthU, profile.heightU);
    if (profile.shape === "verticalBand") return GameContinuousGeometry.rect({x:center.x,y:GameWorldSpace.height/2}, profile.widthU, GameWorldSpace.height);
    if (profile.shape === "path") return GameContinuousGeometry.pathStroke(target.path || [center, center], target.widthU || .75);
    return null;
  }

  function validPlacement(profileOrName, target) {
    const profile = typeof profileOrName === "string" ? definitions.get(profileOrName) || skillById.get(profileOrName) : profileOrName;
    const shape = geometry(profile, target);
    return !shape || !profile.completeInside || GameContinuousGeometry.shapeInsideWorld(shape);
  }

  global.GameSpatialEffectProfiles = Object.freeze({
    all: () => [...definitions.values()],
    cards: () => [...definitions.values()],
    skills: () => skills.slice(),
    get: name => definitions.get(name) || null,
    getSkill: id => skillById.get(id) || null,
    geometry,
    validPlacement,
    centerOf
  });
})(window);
