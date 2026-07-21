"use strict";

/* =========================================================
   牌堆、墨水与书灵
========================================================= */

function side(owner){return owner===1?B.player:B.enemy}

function defForUnit(unit){return CARD_MAP.get(unit.cardName||unit.name)}
function hasTag(entity,tag){
  const tags=entity.tags||defForUnit(entity)?.tags||[];
  return tags.includes(tag);
}
function invokeUnitEffect(unit,hook,extra={}){
  if(!unit||unit.dead||!unit.effectId)return undefined;
  return GameEffectRegistry.invoke(unit.effectId,hook,{unit,side:side(unit.owner),api:GAME_API,...extra});
}
function invokeAllUnitEffects(owner,hook,extra={}){
  const event=extra.event||{};
  B.units.filter(unit=>!unit.dead&&unit.owner===owner).sort((a,b)=>a.birth-b.birth)
    .forEach(unit=>invokeUnitEffect(unit,hook,{...extra,event}));
  return event;
}

function unitBaseStats(unit){
  const def=defForUnit(unit);
  return unit.baseStats||def?.stats||{
    attack:unit.attack,maxHp:unit.maxHp,hp:unit.maxHp,move:unit.move,paint:unit.paint
  };
}

function unitPassiveBonuses(unit){
  return GameEffectRegistry.invoke(unit.effectId,"statModifiers",{unit,side:side(unit.owner),api:GAME_API})||{};
}

function attackFor(unit){
  const passive=unitPassiveBonuses(unit);
  return Math.max(0,unit.attack+unit.bonusAttack+unit.effectAttack+(passive.attack||0));
}

function currentUnitStats(unit){
  return {
    attack:attackFor(unit),
    hp:unit.hp,
    maxHp:unit.maxHp,
    move:movementFor(unit),
    paint:effectivePaint(unit)
  };
}

const GAME_API={
  side,
  units(owner){return B.units.filter(unit=>!unit.dead&&(owner===undefined||unit.owner===owner))},
  cells(){return B.cells},
  neighbors(cell){return neighbors(cell)},
  distance(a,b){return hexDistance(a,b)},
  random(){return B.rng()},
  enemyOwner(owner){return enemyOf(owner)},
  hasTag(entity,tag){return hasTag(entity,tag)},
  baseStats(unit){return unitBaseStats(unit)},
  asUnit(target){return target?.id?target:unitAt(target)},
  gainInk(owner,points,reason=""){
    const s=side(owner),unit=s.activeProductionUnit;
    let multiplier=GameModifierSystem.multiplier(s,"production");
    if(unit?.doubleNextProduction){multiplier*=2;unit.doubleNextProduction=false}
    gainInk(s,points*2*multiplier,reason);
  },
  payInk(owner,points){return payInk(side(owner),points*2)},
  paint(cell,owner,context={}){paintCell(cell,owner,context)},
  log(...args){return addLog(...args)},
  dealEffectDamage(target,amount,source=null){return dealEffectDamage(target,amount,source)},
  showDroneLink(from,to){
    return GameDroneLinkSystem.trigger(B,from,to,()=>drawBattle());
  },
  protectCell(cell,unit){
    return MapRules.tryCellEffect(cell,"purified",current=>{
      current.purified={owner:unit.owner,unitId:unit.id,until:B.global+2};
    },{source:"unit",unit});
  },
  neutralize(cell,context={source:"card"}){
    const changed=MapRules.tryCellEffect(cell,"neutralize",current=>{
      current.owner=0;
      current.studied=false;
      current.permanentStudied=false;
    },context);
    if(changed)B.dirty=true;
    return changed;
  },
  discardOther(s,excluded,reason){
    const candidate=[...s.hand].filter(instance=>instance!==excluded&&!instance.archive&&!instance.protected)
      .sort((a,b)=>b.priority-a.priority||b.order-a.order)[0];
    if(!candidate)return false;
    removeHandCard(s,candidate);s.discard.push(candidate);drawTo(s,5);
    addLog(`${ownerName(s.owner)}因${reason}弃置「${candidate.name}」。`,"s");
    return true;
  },
  pushToHalfEdge(unit){
    const targetColumn=unit.owner===1?0:60;
    const legal=B.cells.filter(cell=>{
      const free=unit.height===1?!cell.ground&&!cell.well:!cell.air;
      return free&&(unit.owner===1?cell.c<30:cell.c>=30);
    }).sort((a,b)=>Math.abs(a.c-targetColumn)-Math.abs(b.c-targetColumn)||hexDistance(a,unit.cell)-hexDistance(b,unit.cell));
    if(legal[0])moveUnit(unit,legal[0],{paint:false,triggerStudy:false,updateFacing:false,teleport:true});
  },
  canPlaceFortification(owner,cell){return canPlaceFortification(owner,cell)},
  createFortification(owner,cell){return createFortification(owner,cell)},
  archiveDiscardBatch(s,instances){
    return GameArchiveSystem.archiveDiscardBatch(s,instances,instance=>getDef(instance).cost/2);
  }
};

function drawOne(s){
  if(!s.draw.length&&s.discard.length){
    s.draw=shuffle(s.discard,B.rng);
    s.discard=[];
    addLog(`${ownerName(s.owner)}将弃牌堆洗回牌堆。`,"s");
  }
  if(s.draw.length){
    const instance=s.draw.pop();
    instance.handTurns=0;instance.archive=null;
    s.hand.push(instance);
    return instance;
  }
  return null;
}

function drawTo(s,n=5){
  return GameHandSystem.refill(s,Math.min(n,RULES.handLimit),drawOne);
}

function gainInk(s,half,reason=""){
  const old=s.ink;
  s.ink=Math.min(s.cap,s.ink+half);
  if(s.ink>old)addLog(`${ownerName(s.owner)}获得 ${formatInk(s.ink-old)} 墨水${reason?"（"+reason+"）":""}。`,"b");
}

function payInk(s,half){
  if(s.ink<half)return false;
  s.ink-=half;return true;
}

function summonUnit(owner,name,cell,stats=null,opt={}){
  if(!cell||cell.ground||cell.well)return null;
  const def=CARD_MAP.get(name);
  const resource=opt.resource??def?.type.includes("资源")??false;

  stats=stats||{attack:0,hp:3,move:0,paint:0,ai:"avoid"};
  const u={
    id:uid++,owner,name,cardName:name,birth:++B.birth,cell,height:1,
    attack:stats.attack,maxHp:stats.hp,hp:stats.hp,
    move:stats.move,paint:stats.paint,ai:stats.ai,
    baseStats:Object.freeze({attack:stats.attack,hp:stats.hp,move:stats.move,paint:stats.paint}),
    shield:0,flying:0,duration:resource?(def?.duration??durationFor(name)):0,
    resource,dead:false,rooted:false,halfDamage:false,
    bonusMove:0,bonusAttack:0,effectMove:0,effectAttack:0,effectPaint:0,permanentMove:0,
    effectId:opt.effectId||def?.effectId||null,tags:[...(opt.tags||def?.tags||[])],
    eternal:false,lastLanded:false,
    skipMoveOnce:false,silencedOnce:false,extraActions:0,
    lastMoveDirection:owner===1?0:3
  };
  B.units.push(u);
  cell.ground=u;
  if(!opt.initial)addLog(`${ownerName(owner)}召唤了「${name}」。`,owner===1?"p":"e");

  if(name==="禁咒守卫")u.shield++;
  if(name==="真理之墙")applyWallAura(u);
  if(name==="侦查隼·B型"&&cell.owner===owner)makeFlying(u,2);
  if(name==="冲锋白雀"&&!opt.initial)chargeForward(u,4,false);

  invokeUnitEffect(u,"summon",{sourceInstance:opt.sourceInstance});

  B.dirty=true;
  return u;
}

function durationFor(name){
  const map={
    "小天鹅信使":3,"湖光集结":3,"羽翼泵动站":4,"天鹅湖休息区":3,
    "流动书架":3,"沉思蜡烛":3,"真理循环装置":5,"真理馆长":3
  };
  return map[name]||3;
}

function removeUnit(u,death=true){
  if(u.dead)return;
  u.dead=true;
  if(u.height===1&&u.cell.ground===u)u.cell.ground=null;
  if(u.height===2&&u.cell.air===u)u.cell.air=null;
  (u.footprint||[]).forEach(cell=>{if(cell.ground===u)cell.ground=null});

  if(death&&u.name==="奥术记录仪"){
    rectCells(u.cell,3).forEach(x=>crystallize(x));
  }
  if(death)invokeAllUnitEffects(u.owner,"unitDestroyed",{destroyed:u,event:{}});
  addLog(`「${u.name}」${death?"被摧毁":"退场"}。`,"s");
}

function unitAt(cell,preferGround=true){
  return preferGround?(cell.ground||cell.air):(cell.air||cell.ground);
}

function legalSummonCell(owner,cell){
  if(!cell||cell.ground||cell.well)return false;
  return owner===1?cell.c<30:cell.c>=30;
}

function fortificationPair(owner,cell){
  const isEdge=target=>target?.owner===owner&&neighbors(target).some(next=>next.owner!==owner);
  if(!cell||!isEdge(cell)||cell.ground||cell.well)return null;
  const second=neighbors(cell).find(next=>isEdge(next)&&!next.ground&&!next.well);
  return second?[cell,second]:null;
}

function canPlaceFortification(owner,cell){return !!fortificationPair(owner,cell)}

function createFortification(owner,cell){
  const footprint=fortificationPair(owner,cell);
  if(!footprint)return null;
  const unit=summonUnit(owner,"防御工事",footprint[0],
    {attack:0,hp:3,move:0,paint:0,ai:"avoid"},{tags:["工事"],resource:false});
  if(!unit)return null;
  unit.footprint=footprint;
  footprint.forEach(part=>part.ground=unit);
  return unit;
}

function crystallize(cell,context={}){
  if(!cell||cell.crystal)return false;
  return MapRules.tryCellEffect(cell,"crystallize",current=>{
    current.permanentCrystal=true;
    current.crystal=true;
    B.dirty=true;
  },context);
}

function applyWallAura(u){
  rectCells(u.cell,5).forEach(c=>{
    if(c.crystal)return;
    markStudied(c,{source:"aura",unit:u});
    crystallize(c,{source:"aura",unit:u});
  });
}

function markStudied(cell,context={source:"skill"}){
  if(!cell)return false;
  return MapRules.tryCellEffect(cell,"studied",current=>{
    current.permanentStudied=true;
    current.studied=true;
  },context);
}

function refreshWallAura(u,move){
  const result=move();
  if(u.name==="真理之墙")applyWallAura(u);
  return result;
}

function makeFlying(u,duration=2){
  if(u.dead||u.height===2||u.cell.air)return false;
  u.cell.ground=null;
  u.height=2;u.cell.air=u;
  u.flying=Math.max(u.flying,duration);
  addLog(`「${u.name}」进入飞行。`,"s");

  B.units.filter(x=>!x.dead&&x.owner===u.owner&&x.name==="羽翼泵动站")
    .forEach(()=>gainInk(side(u.owner),2,"羽翼泵动站"));
  return true;
}

function nearestLanding(u,target=u.cell){
  const legal=B.cells.filter(x=>!x.ground&&!x.well);
  legal.sort((a,b)=>hexDistance(a,target)-hexDistance(b,target)||a.c-b.c||a.r-b.r);
  return legal[0]||null;
}

function landUnit(u,target=null){
  if(u.dead||u.height!==2)return false;
  if(target?.ground&&target.ground.owner!==u.owner&&u.name==="重力白鹅"&&target.ground.hp<=2)
    removeUnit(target.ground);
  const dest=target&&!target.ground&&!target.well?target:nearestLanding(u,target||u.cell);
  if(!dest)return false;
  u.cell.air=null;
  u.cell=dest;u.height=1;dest.ground=u;
  u.flying=0;u.lastLanded=true;
  side(u.owner).landedThisTurn=true;
  addLog(`「${u.name}」降落。`,"s");
  triggerLanding(u);
  return true;
}

function triggerLanding(u){
  if(u.name==="冲锋白雀")chargeForward(u,8,true,2);
  if(u.name==="护卫大天鹅"){
    B.units.filter(x=>!x.dead&&x.owner!==u.owner&&hexDistance(x.cell,u.cell)<=2)
      .forEach(x=>pushAway(x,u.cell,3).forEach(c=>MapRules.tryChangeOwner(c,OWNER.N,{kind:"reset",source:"unit"})));
  }
  if(u.name==="幻影孔雀")paintCell(randomNeighbor(u.cell),u.owner);
}

function randomNeighbor(c){
  const n=neighbors(c);return n[Math.floor(B.rng()*n.length)]||c;
}

