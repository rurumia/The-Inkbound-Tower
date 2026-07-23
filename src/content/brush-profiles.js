(function registerBrushProfiles(global) {
  "use strict";

  const PAINT_BY_ID = Object.freeze({
    "initial.spreader": 2, "initial.resource": 1, "initial.fighter": 1,
    "sina.charging-sparrow": 1, "sina.guardian-swan": 3, "sina.scout-falcon-b": 1,
    "sina.gravity-goose": 2, "sina.phantom-peacock": 3, "sina.iron-woodpecker": 1,
    "fine.spell-guard": 1, "fine.ink-solidifier": 2, "fine.living-statue": 1,
    "fine.binding-bottle": 2, "fine.arcane-recorder": 1,
    "20735.maintenance-alpha": 1, "20735.cycle-pump": 1, "20735.emergency-generator": 1,
    "20735.patrol-a": 1, "20735.purifier-mk2": 2, "20735.painting-delta": 2
  });
  function styleFor(id) {
    if (id === "initial.spreader") return {shape:"fan",lengthRatio:1.05,widthRatio:1.2,spacingU:.42};
    if (id === "initial.resource") return {shape:"droplet",lengthRatio:1.25,widthRatio:.82,spacingU:.3};
    if (id === "initial.fighter") return {shape:"blade",lengthRatio:1.35,widthRatio:.72,spacingU:.34};
    if (id.startsWith("sina.")) return {shape:"feather",lengthRatio:1.4,widthRatio:.72,spacingU:.34};
    if (id.startsWith("fine.")) return {shape:"crystal",lengthRatio:1.18,widthRatio:.9,spacingU:.36};
    if (["20735.cycle-pump","20735.emergency-generator","20735.scrap-pile"].includes(id))
      return {shape:"roller",lengthRatio:.82,widthRatio:1.18,spacingU:.32};
    return {shape:"gear",lengthRatio:1,widthRatio:1,spacingU:.38};
  }

  function sizeForRate(rate) {
    return Math.max(0, GameWorldSpace.quantize(Number(rate) || 0));
  }

  const profiles = global.GameSpiritVisualProfiles.all().map(visual => {
    const paint = PAINT_BY_ID[visual.id] || 0;
    const style = styleFor(visual.id);
    return Object.freeze({
      id: visual.id,
      ...style,
      widthU: sizeForRate(paint),
      baseRate: paint,
      hardness: 0.88,
      flow: 1,
      pressure: true,
      pressureMin: 0.22,
      offsetU: -.16,
      lateralOffsetU: 0,
      rotationMode: "normal",
      stationaryStamp: paint > 0,
      trailEffectId: visual.id === "20735.purifier-mk2" ? "purification" : null
    });
  });
  const byId = new Map(profiles.map(profile => [profile.id, profile]));

  function atRate(profileOrId, rate) {
    const profile = typeof profileOrId === "string" ? byId.get(profileOrId) : profileOrId;
    const fallback = profile || byId.get("initial.spreader");
    return Object.freeze({...fallback,widthU:sizeForRate(rate),baseRate:rate});
  }

  function forUnit(unit, rate = unit?.paint || 0) {
    const id = global.GameBattlefieldAdapter?.visualProfileId(unit) || "initial.spreader";
    return atRate(id, rate);
  }

  global.GameBrushProfiles = Object.freeze({
    all: () => profiles.slice(),
    get: id => byId.get(id) || byId.get("initial.spreader"),
    atRate,
    forUnit,
    sizeForRate,
    widthForPaint: sizeForRate
  });
})(window);
