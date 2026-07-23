(function register20735Content(global) {
  "use strict";

  const role = {
    id: "20735",
    name: "20735",
    fallback: "20",
    images: {
      selection: "images/20735立绘.jpg",
      avatar: "images/20735头像.jpg"
    },
    accent: "#78d9a6",
    opponents: ["sina", "fine"],
    summary: "机械、归档、稳定资源与无人机协同。",
    skill: {
      id: "archive",
      name: "归档",
      cooldown: 0,
      target: "hand",
      description: "选择一张手牌并锁定目标，不消耗墨水且不立即生效。该牌移入独立归档区并补牌；等待基础费用对应的回合数后在锁定目标免费发动。",
      prompt: "选择一张未归档的手牌。"
    },
    traits: [
      "归档牌进入地图左下的独立归档区；目标失效时不产生效果并进入弃牌堆",
      "资源书灵提供稳定墨水与战场支援",
      "无人机通过集群获得移动、涂色和防护收益"
    ]
  };

  const cards = [
    {
      id: "maintenance-alpha", name: "维护子机-α", cost: 3, type: "资源书灵", target: "summon",
      text: "持续3回合。回合开始产出2墨水；场上至少有3个己方书灵时额外产出1墨水。",
      stats: {attack: 0, hp: 2, move: 2, paint: 1, ai: "expand"},
      duration: 3, tags: ["资源", "机械"], effectId: "20735.maintenance-alpha"
    },
    {
      id: "cycle-pump", name: "循环泵站", cost: 5, type: "资源书灵", target: "summon",
      text: "持续4回合。回合开始产出3墨水。保守协议：本回合未使用进攻书灵或效果卡，回合结束额外获得1墨水。",
      stats: {attack: 0, hp: 3, move: 0, paint: 1, ai: "avoid"},
      duration: 4, tags: ["资源", "设施", "协议"], effectId: "20735.cycle-pump"
    },
    {
      id: "emergency-generator", name: "应急发电机", cost: 2, type: "资源书灵", target: "summon",
      text: "持续2回合。登场时获得1墨水并弃1张其他手牌；回合结束产出2墨水。",
      stats: {attack: 0, hp: 1, move: 0, paint: 1, ai: "avoid"},
      duration: 2, tags: ["资源", "设施"], effectId: "20735.emergency-generator"
    },
    {
      id: "scrap-pile", name: "废料堆", cost: 1, type: "资源书灵", target: "summon",
      text: "持续2回合。在手牌中被牺牲时额外获得1墨水；存放满4回合后再额外获得2墨水，并可正常支付费用使用另一张手牌。",
      stats: {attack: 0, hp: 1, move: 0, paint: 0, ai: "avoid"},
      duration: 2, tags: ["资源", "废料", "协议"], effectId: "20735.scrap-pile"
    },
    {
      id: "patrol-a", name: "标准巡逻兵·A型", cost: 2, type: "进攻书灵", target: "summon",
      text: "攻击1、耐久2、移动3U、涂色1。优先扩张己方边缘；累计移除6U²敌方控制后攻击+1并生成约3U²机械笔迹。",
      stats: {attack: 1, hp: 2, move: 3, paint: 1, ai: "expand"},
      tags: ["机械", "协议"], effectId: "20735.patrol-a"
    },
    {
      id: "purifier-mk2", name: "净化单元·Mk-II", cost: 4, type: "进攻书灵", target: "summon",
      text: "攻击1、耐久3、移动2U、涂色2。完整移动笔迹获得1回合净化层；累计阻止4U²涂色后耐久上限变为6。",
      stats: {attack: 1, hp: 3, move: 2, paint: 2, ai: "expand"},
      tags: ["机械", "净化", "协议"], effectId: "20735.purifier-mk2"
    },
    {
      id: "mass-drone", name: "量产无人机", cost: 2, type: "进攻书灵", target: "summon",
      text: "攻击0、耐久1、移动4U、涂色0。中心距离3U内存在另一架己方无人机时，攻击力和涂色速率均变为1。",
      stats: {attack: 0, hp: 1, move: 4, paint: 0, ai: "expand"},
      tags: ["无人机", "蜂群"], effectId: "20735.mass-drone"
    },
    {
      id: "interceptor-sigma", name: "拦截无人机·Σ型", cost: 4, type: "进攻书灵", target: "summon",
      text: "攻击1、耐久3、移动5U、涂色0。代身体相邻的无人机承伤并反击；3U内存在另一架无人机时攻击+1；累计代受2点伤害后耐久上限+2。",
      stats: {attack: 1, hp: 3, move: 5, paint: 0, ai: "guard"},
      tags: ["无人机", "护卫", "协议"], effectId: "20735.interceptor-sigma"
    },
    {
      id: "painting-delta", name: "涂装无人机·Δ型", cost: 4, type: "进攻书灵", target: "summon",
      text: "攻击0、耐久2、移动3U、涂色2。3U内存在另一架无人机时移动+1U，并在行动结束生成约2U²连通机械笔迹。",
      stats: {attack: 0, hp: 2, move: 3, paint: 2, ai: "expand"},
      tags: ["无人机", "蜂群"], effectId: "20735.painting-delta"
    },
    {
      id: "repair-omega", name: "修复无人机·Ω型", cost: 5, type: "进攻书灵", target: "summon",
      text: "攻击0、耐久3、移动4U、涂色0。行动结束修复中心距离5U内的己方书灵；无人机被摧毁时回收1墨水。3U内有无人机时不能被普通攻击。",
      stats: {attack: 0, hp: 3, move: 4, paint: 0, ai: "guard"},
      tags: ["无人机", "维修", "蜂群"], effectId: "20735.repair-omega"
    },
    {
      id: "system-maintenance", name: "系统维护", cost: 2, type: "效果卡", target: "own",
      text: "资源书灵持续时间+1并弃1张其他手牌；进攻书灵恢复2耐久。",
      tags: ["维护"], effectId: "20735.system-maintenance"
    },
    {
      id: "area-purge", name: "区域净化协议", cost: 5, type: "效果卡", target: "cell",
      text: "将以目标点为中心、宽10U高30U的完整纵向带重置为中立，并把相交书灵推回各自半场边缘。",
      tags: ["协议", "区域"], effectId: "20735.area-purge"
    },
    {
      id: "emergency-cooling", name: "紧急冷却", cost: 3, type: "效果卡", target: "own",
      text: "目标冷却至下次行动结束：不能移动或涂色，耐久及上限+2；结束后永久移动+1。冷却3个不同书灵后获得4墨水。",
      tags: ["冷却", "协议"], effectId: "20735.emergency-cooling"
    },
    {
      id: "reserve-energy", name: "备用能源调配", cost: 4, type: "效果卡", target: "own",
      text: "资源书灵持续时间+1并获得2墨水；若剩余时间不超过2，其下一次产出翻倍。进攻书灵恢复2耐久。",
      tags: ["资源", "协议"], effectId: "20735.reserve-energy"
    },
    {
      id: "defense-matrix", name: "防御矩阵", cost: 6, type: "效果卡", target: "cell",
      text: "在己方墨迹边缘生成约2U×0.8U防御工事。敌人进入外扩1U警戒区时移动-2U，工事耗1耐久并造成1伤害；有2架无人机时额外生成1座。",
      tags: ["工事", "无人机"], effectId: "20735.defense-matrix"
    },
    {
      id: "efficiency-order", name: "效率优化指令", cost: 5, type: "效果卡", target: "overloadChoice",
      text: "本回合使用后的己方书灵移动、涂色和资源产出翻倍。可额外支付3墨水，否则跳过之后2个己方回合。",
      tags: ["过载"], effectId: "20735.efficiency-order",
      archiveDelayOption: {snapshotKind: "choice", field: "payOverload", value: true, extraTurns: 3}
    },
    {
      id: "singularity", name: "超维归档：奇点", cost: 10, type: "ACE效果卡", target: "discardArchive",
      text: "从弃牌堆选择至多3张不同名称的牌放入独立归档区。其每回合倒计时-2；同时归零时按选择顺序逐回合免费自动使用。",
      tags: ["ACE", "归档"], effectId: "20735.singularity"
    }
  ];

  global.GameContentModules = global.GameContentModules || {characters: []};
  global.GameContentModules.characters.push({role, cards});
})(window);
