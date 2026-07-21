(function createArchiveTargetSnapshot(global) {
  "use strict";

  function capture(def, target) {
    if (def.target === "none") return {kind: "none"};
    if (def.target === "cell" || def.target === "summon") {
      return {kind: "cell", r: target.r, c: target.c};
    }
    if (["own", "groundOwn", "flying", "enemy"].includes(def.target)) {
      const unit = target && target.id ? target : null;
      return {kind: "unit", unitId: unit && unit.id};
    }
    if (def.target === "overloadChoice") {
      return {kind: "choice", payload: {payOverload: !!target.payOverload}};
    }
    if (def.target === "discardArchive") {
      return {kind: "instances", instanceIds: target.instances.map(instance => instance.id)};
    }
    return {kind: "value", payload: target};
  }

  function resolve(snapshot, context) {
    if (!snapshot || snapshot.kind === "none") return null;
    if (snapshot.kind === "cell") return context.cellAt(snapshot.r, snapshot.c);
    if (snapshot.kind === "unit") return context.units().find(unit => unit.id === snapshot.unitId) || null;
    if (snapshot.kind === "choice") return {...snapshot.payload};
    if (snapshot.kind === "instances") {
      const byId = new Map(context.side.discard.map(instance => [instance.id, instance]));
      const instances = snapshot.instanceIds.map(id => byId.get(id)).filter(Boolean);
      return instances.length === snapshot.instanceIds.length ? {instances} : null;
    }
    return snapshot.payload;
  }

  function describe(snapshot, context) {
    if (!snapshot) return "发动时自动选择";
    if (snapshot.kind === "none") return "无目标";
    if (snapshot.kind === "cell") return `格子 ${snapshot.r},${snapshot.c}`;
    if (snapshot.kind === "unit") {
      const unit = context.units().find(candidate => candidate.id === snapshot.unitId);
      return unit ? unit.name : "目标已失效";
    }
    if (snapshot.kind === "choice") return snapshot.payload.payOverload ? "支付过载：等待+3回合" : "接受过载惩罚";
    if (snapshot.kind === "instances") return `弃牌目标 ${snapshot.instanceIds.length} 张`;
    return "已保存目标";
  }

  global.GameArchiveTargetSnapshot = Object.freeze({capture, resolve, describe});
})(window);
