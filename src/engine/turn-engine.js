"use strict";

const INK_WELL_INCOME=2;

function advanceFlightStatus(unit,land=landUnit){
  if(unit.flying<=0)return false;
  unit.flying--;
  if(unit.flying<=0&&!land(unit)){
    // A full ground layer can temporarily leave no legal landing cell.
    // Keep the timer alive so the unit retries on the next owned turn.
    unit.flying=1;
    return false;
  }
  return true;
}

window.GameFlightStatus=Object.freeze({advance:advanceFlightStatus});

/* =========================================================
   回合流程
========================================================= */

async function startTurn(owner){
  if(B.ended)return;
  B.current=owner;
  B.busy=true;
  B.selected=null;B.targetStep=0;B.targetData=null;

  const s=side(owner);
  s.sacrifices=0;s.spellRefunds=0;s.landedThisTurn=false;
  s.playedAggressive=false;s.bonusPlayAfterSacrifice=false;
  GameModifierSystem.startTurn(s);
  B.speed=B.global>=B.fastFrenzyStart?3:B.global>=B.frenzyStart?2:1;
  if(owner===2&&typeof refreshSummonIntents==="function")refreshSummonIntents();

  if(s.skipNext||s.skipTurns>0){
    s.skipNext=false;
    if(s.skipTurns>0)s.skipTurns--;
    addLog(`${ownerName(owner)}的行动回合被跳过。`,"s");
    updateUI();
    await sleep(300/B.speed);
    await resolveTurn(owner);
    return;
  }

  if(s.skillCd>0)s.skillCd--;

  B.wells.filter(w=>w.owner===owner).forEach(()=>gainInk(s,INK_WELL_INCOME,"墨井"));
  processTurnStartResources(owner);
  processStatuses(owner);
  drawTo(s,5);

  B.busy=false;
  updateUI();

  if(owner===2){
    B.busy=true;
    await sleep(700/B.speed);
    await enemyAction();
  }else if(B.global>=B.frenzyStart){
    B.busy=true;
    addLog("狂热自动逻辑接管玩家操作。","s");
    await sleep(500/B.speed);
    await frenzyAction();
  }
}

function processTurnStartResources(owner){
  const s=side(owner);
  B.units.filter(u=>!u.dead&&u.owner===owner).forEach(u=>{
    s.activeProductionUnit=u;
    switch(u.name){
      case "小天鹅信使":gainInk(s,u.height===2?6:4,u.name);break;
      case "羽翼泵动站":gainInk(s,4,u.name);break;
      case "流动书架":gainInk(s,u.deployedFriendly?6:4,u.name);break;
      case "沉思蜡烛":gainInk(s,continuousRegionTouchesUnit("crystal",u)?8:4,u.name);break;
      case "真理循环装置":gainInk(s,4,u.name);break;
      case "图书馆活化石像":
        if(continuousRegionTouchesUnit("study",u))u.hp=Math.min(u.maxHp,u.hp+1);
        break;
      case "最终论文：永恒结晶":
        u.shield++;gainInk(s,4,u.name);break;
    }
    invokeUnitEffect(u,"turnStart");
    s.activeProductionUnit=null;
  });
}

function processStatuses(owner){
  B.units.filter(u=>!u.dead&&u.owner===owner).forEach(u=>{
    u.rooted=false;u.bonusMove=0;u.bonusAttack=0;
    u.effectMove=0;u.effectAttack=0;u.effectPaint=0;
    if(u.flying>0)GameFlightStatus.advance(u);
    if(u.duration>0){
      u.duration--;
      if(u.duration<=0)removeUnit(u,false);
    }
  });
}

async function submitAction(){
  if(B.busy||B.current!==1||B.ended)return;
  B.busy=true;updateUI();
  await resolveTurn(1);
}

async function resolveTurn(owner){
  setPhase(`${ownerName(owner)}书灵运算阶段`);

  const units=B.units
    .filter(u=>!u.dead&&u.owner===owner)
    .sort((a,b)=>a.birth-b.birth);

  for(const u of units){
    if(u.dead)continue;
    await unitAct(u);
    while(!u.dead&&u.extraActions>0){
      u.extraActions--;
      await unitAct(u);
    }
    drawBattle();
    await sleep(90/B.speed);
  }

  processEndResources(owner);
  processArchiveEnd(owner);
  infiltration();
  updateWells();
  cleanupDead();

  B.global++;
  if(B.global%2===0){
    B.round++;
    B.player.cap+=2;
    B.enemy.cap+=2;
  }

  if(owner===2&&checkVictory())return;
  if(B.global>=B.settlementLimit){
    settleBattle();return;
  }

  if(B.global===B.frenzyStart)addLog("狂热将在下一回合开始。","s");
  if(B.global===B.fastFrenzyStart)addLog("狂热速度提升至 3×。","s");

  updateUI();
  await sleep(180/B.speed);
  startTurn(enemyOf(owner));
}

function processEndResources(owner){
  const s=side(owner);
  B.units.filter(u=>!u.dead&&u.owner===owner).forEach(u=>{
    s.activeProductionUnit=u;
    if(u.name==="湖光集结"&&B.units.some(x=>!x.dead&&x.owner===owner&&x.height===2))
      gainInk(s,6,u.name);
    if(u.name==="天鹅湖休息区"){
      gainInk(s,6,u.name);
      if(u.restBonus){gainInk(s,4,"降落奖励");u.restBonus=false}
      if(s.landedThisTurn)u.restBonus=true;
    }
    if(u.name==="真理馆长"){
      const area=continuousRegionArea("crystal",owner);
      gainInk(s,Math.min(8,Math.floor(area/5)*2),u.name);
    }
    invokeUnitEffect(u,"turnEnd");
    s.activeProductionUnit=null;
  });
}

function markCardPlayed(s,def){
  if(def.type.includes("进攻")||def.type.includes("效果"))s.playedAggressive=true;
}

function archiveAutoTarget(def,owner,options={}){
  const s=side(owner);
  if(def.target==="none")return null;
  if(def.target==="overloadChoice")return {payOverload:options.archiving||s.ink>=6};
  if(def.target==="discardArchive"){
    const seen=new Set();
    const instances=[...s.discard].sort((a,b)=>getDef(b).cost-getDef(a).cost||a.order-b.order)
      .filter(instance=>!seen.has(instance.name)&&seen.add(instance.name)).slice(0,3);
    return {instances};
  }
  if(def.target==="summon"){
    return GameTargetResolver.bestLegal(B.cells,target=>validateTarget(def,owner,target),
      (a,b)=>owner===1?b.c-a.c:a.c-b.c||a.r-b.r);
  }
  if(def.target==="own"||def.target==="groundOwn"||def.target==="flying"){
    return GameTargetResolver.bestLegal(B.units,target=>validateTarget(def,owner,target),
      (a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.birth-b.birth);
  }
  if(def.target==="enemy"){
    return GameTargetResolver.bestLegal(B.units,target=>validateTarget(def,owner,target),
      (a,b)=>a.hp-b.hp||a.birth-b.birth);
  }
  if(def.target==="cell"){
    return GameTargetResolver.bestLegal(B.cells,target=>validateTarget(def,owner,target),
      (a,b)=>Math.abs(a.c-30)-Math.abs(b.c-30)||a.r-b.r);
  }
  return findAutoTarget(def,owner);
}

function createArchiveAiPlan(s){
  return GameArchiveCastSystem.createAiPlan(s,{
    getDef,
    findTarget:(def,owner)=>archiveAutoTarget(def,owner,{archiving:true}),
    validateTarget,
    captureTarget:GameArchiveTargetSnapshot.capture
  });
}

function resolveStoredArchiveTarget(entry,owner){
  return GameArchiveTargetSnapshot.resolve(entry.targetSnapshot,{
    cellAt,
    cellAtWorld:point=>GameBattlefieldAdapter.worldToCell(point,B.cells),
    units:()=>B.units.filter(unit=>!unit.dead),
    side:side(owner)
  });
}

function processArchiveEnd(owner){
  const s=side(owner),due=GameArchiveSystem.tick(s);
  due.forEach(entry=>{
    const instance=GameArchiveSystem.release(s,entry),def=getDef(instance);
    const target=entry.source==="skill"
      ?resolveStoredArchiveTarget(entry,owner)
      :archiveAutoTarget(def,owner);
    const valid=def.target==="none"||validateTarget(def,owner,target);
    s.discard.push(instance);
    if(valid){
      markCardPlayed(s,def);
      executeCard(def,owner,target,{sourceInstance:instance,archived:true,archiveSource:entry.source});
      refundSpellSystems(owner,def);
      addLog(`${ownerName(owner)}的归档牌「${def.name}」在锁定目标免费发动。`,owner===1?"p":"e");
    }else addLog(`归档牌「${def.name}」的锁定目标已失效，进入弃牌堆且未产生效果。`,"s");
    drawTo(s,5);
  });
}

