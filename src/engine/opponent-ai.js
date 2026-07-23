"use strict";

/* =========================================================
   敌方意图与狂热
========================================================= */

function refillIntents(){
  while(B.intents.length<3){
    const s=B.enemy;
    const reservedIds=new Set(B.intents.map(x=>x.instanceId));
    const reservedSummons=new Set(B.intents
      .filter(x=>x.cardTarget==="summon"&&x.target)
      .map(x=>key(x.target.r,x.target.c)));
    const candidates=s.hand.filter(x=>!x.archive&&!reservedIds.has(x.id)).map(inst=>{
      const d=getDef(inst);
      const play=CardAI.bestPlay(d,2,reservedSummons);
      return {inst,d,target:play?.target,play,valid:!!play};
    });
    if(!candidates.length)break;
    const viable=candidates.filter(x=>x.valid);
    viable.sort((a,b)=>CardAI.compareImpact(a.play,b.play)||
      a.inst.priority-b.inst.priority||a.inst.order-b.inst.order);
    const chosen=viable[0]||candidates
      .sort((a,b)=>a.inst.priority-b.inst.priority||a.inst.order-b.inst.order)[0];
    const {inst,d,target}=chosen;
    B.intents.push({
      instanceId:inst.id,
      name:d.name,
      cardTarget:d.target,
      target,
      targetHint:describeIntentTarget(d,target),
      meaningful:chosen.valid,
      ink:-d.cost
    });
  }
}

function lockIntentTarget(d,owner,reservedSummons=new Set()){
  return CardAI.bestPlay(d,owner,reservedSummons)?.target;
}

function refreshSummonIntents(){
  const reservedSummons=new Set();
  for(const intent of B.intents){
    if(intent.cardTarget!=="summon")continue;
    const inst=B.enemy.hand.find(instance=>instance.id===intent.instanceId);
    const d=inst&&getDef(inst);
    const currentKey=intent.target&&key(intent.target.r,intent.target.c);
    const currentValid=!!d&&!!intent.target&&!reservedSummons.has(currentKey)&&
      validateLockedIntent(d,2,intent.target);
    if(!currentValid){
      const play=d&&CardAI.bestPlay(d,2,reservedSummons);
      intent.target=play?.target;
      intent.meaningful=!!play;
      intent.targetHint=describeIntentTarget(d||{target:"summon"},intent.target);
    }
    if(intent.target)reservedSummons.add(key(intent.target.r,intent.target.c));
  }
  B.dirty=true;
}

function shouldEnemyArchive(globalAction){
  return globalAction%4===1;
}

function describeIntentTarget(d,target){
  if(d.target==="none")return "无目标";
  if(d.target==="overloadChoice")return target?.payOverload?"支付过载费用":"承受跳过回合";
  if(d.target==="discardArchive")return target?.instances?.length?`归档 ${target.instances.length} 张弃牌`:"当前无合法弃牌";
  if(target===undefined)return "当前无合法目标";
  if(d.target==="summon")return `召唤至 ${target.r},${target.c}`;
  if(d.name==="精准俯冲")return `${target.unit.name} → ${target.cell.r},${target.cell.c}`;
  if(d.name==="逻辑重构")return `${target.first.name} ↔ ${target.second.name}`;
  if(target?.id)return `${target.name}（${target.cell.r},${target.cell.c}）`;
  if(target?.r!==undefined)return `区域 ${target.r},${target.c}`;
  return "锁定目标";
}

function validateLockedIntent(d,owner,target){
  if(d.name==="精准俯冲"){
    if(!target||!validateTarget(d,owner,target.unit))return false;
    const c=target.cell,u=target.unit;
    const crushable=u.name==="重力白鹅"&&c?.ground&&c.ground.owner!==owner&&c.ground.hp<=2;
    return !!c&&!c.well&&!c.spellBlocked&&(!c.ground||crushable);
  }
  if(d.name==="逻辑重构"){
    if(!target)return false;
    const {first,second}=target;
    return validateTarget(d,owner,first)&&!!second&&!second.dead&&!second.eternal&&
      second.owner===owner&&second!==first&&second.height===first.height&&
      first.cell.owner===owner&&second.cell.owner===owner&&!second.cell.spellBlocked;
  }
  return validateTarget(d,owner,target);
}

async function enemyAction(){
  refreshSummonIntents();
  if(await tryEnemySkill())return;
  const intent=B.intents.shift();
  const s=B.enemy;
  if(!intent){
    addLog("敌人没有可执行意图，结束回合。","e");
    await resolveTurn(2);
    return;
  }
  const inst=s.hand.find(x=>x.id===intent.instanceId);
  if(!inst){
    addLog(`敌人意图「${intent.name}」失效，执行双牺牲。`,"e");
    enemySacrifice();
    enemySacrifice();
    refillIntents();
    await resolveTurn(2);
    return;
  }

  const d=getDef(inst);
  const target=intent.target;

  if(intent.meaningful&&s.ink>=d.cost&&validateLockedIntent(d,2,target)){
    payInk(s,d.cost);
    removeHandCard(s,inst);s.discard.push(inst);drawTo(s,5);
    markCardPlayed(s,d);
    executeCard(d,2,target,{sourceInstance:inst});
    refundSpellSystems(2,d);
    addLog(`敌人执行意图「${d.name}」。`,"e");
  }else{
    addLog(`敌人意图「${d.name}」无法执行，执行双牺牲。`,"e");
    enemySacrifice(inst);
    enemySacrifice();
  }

  refillIntents();
  await resolveTurn(2);
}

async function tryEnemySkill(){
  const s=B.enemy,skill=roleDef(s.role)?.skill,handler=skill&&ROLE_SKILLS[skill.id];
  if(!handler||s.skillCd>0)return false;
  if(skill.id==="archive"){
    if(!shouldEnemyArchive(B.global))return false;
    const plan=createArchiveAiPlan(s);
    if(!plan||!handler.execute(plan,s))return false;
    s.skillCd=skill.cooldown;
    B.intents=B.intents.filter(intent=>intent.instanceId!==plan.instance.id);
    drawTo(s,5);
    refillIntents();
    addLog(`敌人按优先级归档「${plan.def.name}」，并锁定发动目标。`,"e");
    await resolveTurn(2);
    return true;
  }
  if(!handler.aiTarget)return false;
  const target=handler.aiTarget(s);
  if(!target)return false;
  const shouldUse=B.global%4===1;
  if(!shouldUse||!handler.execute(target,s))return false;
  s.skillCd=skill.cooldown;
  B.intents=B.intents.filter(intent=>intent.instanceId!==target.id);
  refillIntents();
  addLog(`敌人使用角色技能「${skill.name}」。`,"e");
  await resolveTurn(2);
  return true;
}

function enemySacrifice(preferred=null){
  const s=B.enemy;
  const reservedIds=new Set(B.intents.map(x=>x.instanceId));
  let inst=preferred&&s.hand.includes(preferred)?preferred:
    [...s.hand].filter(x=>!x.protected&&!x.archive&&!reservedIds.has(x.id))
      .sort((a,b)=>b.priority-a.priority||b.order-a.order)[0];
  if(!inst)return;
  removeHandCard(s,inst);s.discard.push(inst);
  gainInk(s,1,"牺牲");
  const def=getDef(inst);
  if(def?.effectId)GameEffectRegistry.invoke(def.effectId,"sacrificed",{instance:inst,side:s,api:GAME_API});
  drawTo(s,5);
}

async function frenzyAction(){
  const s=B.player;
  const skill=roleDef(s.role)?.skill,handler=skill&&ROLE_SKILLS[skill.id];
  if(skill?.id==="archive"&&handler&&s.skillCd<=0){
    const plan=createArchiveAiPlan(s);
    if(plan&&handler.execute(plan,s)){
      s.skillCd=skill.cooldown;
      drawTo(s,5);
      addLog(`狂热按优先级归档「${plan.def.name}」，并锁定发动目标。`,"p");
      await resolveTurn(1);
      return;
    }
  }
  const plays=s.hand.filter(inst=>!inst.archive&&s.ink>=getDef(inst).cost).map(inst=>{
    const d=getDef(inst),play=CardAI.bestPlay(d,1);
    return {inst,d,play};
  }).filter(x=>x.play);
  plays.sort((a,b)=>CardAI.compareImpact(a.play,b.play)||
    a.inst.priority-b.inst.priority||a.inst.order-b.inst.order);
  const chosen=plays[0];

  if(chosen){
    const {inst:playable,d,play}=chosen,target=play.target;
    payInk(s,d.cost);
    removeHandCard(s,playable);s.discard.push(playable);drawTo(s,5);
    markCardPlayed(s,d);
    executeCard(d,1,target,{sourceInstance:playable});
    refundSpellSystems(1,d);
    addLog(`狂热自动打出「${d.name}」。`,"p");
  }else{
    const candidates=[...s.hand].filter(x=>!x.protected&&!x.archive)
      .sort((a,b)=>b.priority-a.priority||b.order-a.order);
    if(candidates[0]){
      for(let i=0;i<2&&candidates[i];i++){
        const x=candidates[i];
        if(!s.hand.includes(x))continue;
        removeHandCard(s,x);s.discard.push(x);gainInk(s,1,"狂热牺牲");
        const def=getDef(x);
        if(def?.effectId)GameEffectRegistry.invoke(def.effectId,"sacrificed",{instance:x,side:s,api:GAME_API});
        drawTo(s,5);
      }
    }else addLog("狂热没有可出牌或可牺牲卡，直接结束回合。","s");
  }
  await resolveTurn(1);
}

function findAutoTarget(d,owner){
  return CardAI.bestPlay(d,owner)?.target;
}

window.GameOpponentIntentRules=Object.freeze({shouldEnemyArchive});

