"use strict";

/* =========================================================
   玩家操作与卡牌
========================================================= */

function selectCard(id){
  if(B.busy||B.current!==1||(B.player.sacrifices>0&&!B.player.bonusPlayAfterSacrifice))return;
  const inst=B.player.hand.find(x=>x.id===id);
  if(!inst||inst.archive)return;
  const d=getDef(inst);

  if(B.player.ink<d.cost){
    addLog("墨水不足。","s");return;
  }

  B.selected={kind:"card",inst,def:d};
  B.targetStep=0;B.targetData=null;

  if(d.target==="discardArchive"){
    openDiscardArchivePicker(inst,d);
  }else if(d.target==="overloadChoice"){
    modalAction={kind:"overload",inst,def:d};
    openModal(GameArchiveView.overloadChoice(B.player.ink>=d.cost+6));
  }else if(d.target==="none"){
    playSelectedCard(null);
  }else{
    document.getElementById("selectionInfo").innerHTML=
      `<b>${d.name}</b><br>${targetInstruction(d)}`;
    updateUI();
  }
}

function beginArchiveCardSelection(instance){
  const def=getDef(instance);
  if(!def||!B.player.hand.includes(instance))return false;
  B.selected={kind:"archiveTarget",inst:instance,def};
  B.targetStep=0;B.targetData=null;

  if(def.target==="discardArchive"){
    openDiscardArchivePicker(instance,def,"archive");
  }else if(def.target==="overloadChoice"){
    modalAction={kind:"archiveOverload",inst:instance,def};
    openModal(GameArchiveView.overloadChoice(true,{archiving:true}));
  }else if(def.target==="none"){
    commitArchiveSelection(null);
  }else{
    document.getElementById("selectionInfo").innerHTML=
      `<b>归档「${def.name}」</b><br>${targetInstruction(def)}<br>目标会被锁定，倒计时结束时才免费发动。`;
    updateUI();
  }
  return true;
}

function commitArchiveSelection(target){
  if(B.selected?.kind!=="archiveTarget")return false;
  const {inst,def}=B.selected,s=B.player;
  if(!validateTarget(def,1,target)){
    addLog("目标非法，请重新选择归档目标。","s");
    return false;
  }
  const targetSnapshot=GameArchiveTargetSnapshot.capture(def,target);
  const skill=roleDef(s.role)?.skill;
  const handler=skill&&ROLE_SKILLS[skill.id];
  if(!handler||!handler.execute({instance:inst,targetSnapshot},s))return false;

  s.skillCd=skill.cooldown;
  drawTo(s,5);
  B.selected=null;
  s.bonusPlayAfterSacrifice=false;
  addLog(`玩家归档「${def.name}」，目标已锁定。`,"p");
  updateUI();
  submitAction();
  return true;
}

function cancelArchiveSelection(){
  if(!B)return;
  closeModal();
  modalAction=null;
  if(B.selected?.kind==="archiveTarget"||B.selected?.kind==="skill")B.selected=null;
  updateUI();
}

function targetInstruction(d){
  const map={
    summon:"点击己方半场的合法连续位置进行召唤。",
    own:"点击一个己方书灵。",
    groundOwn:"点击一个地面己方书灵。",
    flying:"点击一个飞行己方书灵。",
    enemy:"点击一个敌方书灵。",
    cell:"点击一个连续区域的中心点。",
    discardArchive:"从弃牌堆选择归档牌。",
    overloadChoice:"选择过载代价。"
  };
  return map[d.target]||"选择目标。";
}

function playSelectedCard(target){
  if(!B.selected||B.selected.kind!=="card")return false;
  const {inst,def}=B.selected;
  const s=B.player;

  if(!validateTarget(def,1,target)){
    addLog("目标非法，卡牌返回手牌。","s");
    return false;
  }
  if(def.name==="精准俯冲"){
    B.selected={kind:"dive",inst,def,unit:target.id?target:unitAt(target)};
    document.getElementById("selectionInfo").innerHTML="<b>精准俯冲</b><br>现在点击合法地面格；重力白鹅也可选择耐久不高于 2 的敌人格。";
    updateUI();
    return true;
  }
  if(def.name==="逻辑重构"){
    const first=target.id?target:unitAt(target);
    if(first.name==="真理之墙"){addLog("真理之墙固定在原位，不能交换。","s");return false}
    if(!continuousInkTouchesUnit(1,first)){addLog("第一个目标必须接触己方墨迹。","s");return false}
    B.selected={kind:"swap",inst,def,first};
    document.getElementById("selectionInfo").innerHTML="<b>逻辑重构</b><br>请选择同高度、接触己方墨迹的第二个己方书灵。";
    updateUI();
    return true;
  }
  commitPlayerCard(inst,def,target);
  return true;
}

function commitPlayerCard(inst,def,target){
  const s=B.player;
  if(!payInk(s,def.cost))return false;
  removeHandCard(s,inst);
  s.discard.push(inst);
  drawTo(s,5);
  markCardPlayed(s,def);
  try{
    executeCard(def,1,target,{sourceInstance:inst});
    refundSpellSystems(1,def);
    addLog(`玩家打出「${def.name}」。`,"p");
  }catch(error){
    console.error(`卡牌「${def.name}」效果解析失败`,error);
    addLog(`「${def.name}」效果解析异常，本次操作已结束。`,"s");
  }finally{
    B.selected=null;
    s.bonusPlayAfterSacrifice=false;
    updateUI();
    submitAction();
  }
  return true;
}

function validateTarget(d,owner,target){
  if(d.target==="none")return true;
  if(!target)return false;

  if(d.target==="overloadChoice")return typeof target.payOverload==="boolean";
  if(d.target==="discardArchive")return Array.isArray(target.instances)&&target.instances.length>=1&&target.instances.length<=3&&
    new Set(target.instances.map(instance=>instance.name)).size===target.instances.length&&
    target.instances.every(instance=>side(owner).discard.includes(instance));

  if(d.target==="summon"){
    if(target.r===undefined||!legalSummonCell(owner,target))return false;
    return d.name!=="真理之墙"||GameSpatialEffectProfiles.validPlacement(d.name,target);
  }
  if(d.target==="cell"){
    const profile=GameSpatialEffectProfiles.get(d.name);
    const continuousPoint=profile?.target==="point"&&Number.isFinite(target.x)&&Number.isFinite(target.y);
    if(continuousPoint)return GameSpatialEffectProfiles.validPlacement(profile,target)&&
      !continuousRegionAt("spellBlock",target);
    return target.r!==undefined&&!continuousRegionAt("spellBlock",target)&&
      (d.effectId!=="20735.defense-matrix"||canPlaceFortification(owner,target));
  }

  const u=target.id?target:unitAt(target);
  if(!u||u.dead)return false;
  if(d.type.includes("效果")&&continuousRegionTouchesUnit("spellBlock",u,null))return false;
  if((d.name==="索引重排"||d.name==="逻辑重构")&&u.eternal)return false;
  if(d.name==="最终论文：永恒结晶"&&
    !GameSpatialEffectProfiles.validPlacement(d.name,GameBattlefieldAdapter.unitPosition(u)))return false;
  if(d.target==="own")return u.owner===owner;
  if(d.target==="groundOwn")return u.owner===owner&&u.height===1;
  if(d.target==="flying")return u.owner===owner&&u.height===2;
  if(d.target==="enemy")return u.owner!==owner;
  return false;
}

function removeHandCard(s,inst){
  const i=s.hand.indexOf(inst);
  if(i>=0)s.hand.splice(i,1);
}

function sacrificeCard(id){
  const s=B.player;
  if(B.busy||B.current!==1||s.sacrifices>=2)return;
  const inst=s.hand.find(x=>x.id===id);
  if(!inst||inst.protected||inst.archive){
    addLog("这张牌受到保护，不能牺牲。","s");return;
  }
  removeHandCard(s,inst);
  s.discard.push(inst);
  s.sacrifices++;
  gainInk(s,1,"牺牲");
  const def=getDef(inst);
  if(def?.effectId)GameEffectRegistry.invoke(def.effectId,"sacrificed",{instance:inst,side:s,api:GAME_API});
  drawTo(s,5);
  addLog(`玩家牺牲「${inst.name}」。`,"p");

  if(s.sacrifices>=2&&!s.bonusPlayAfterSacrifice)submitAction();
  else updateUI();
}

function openDiscardArchivePicker(inst,def,mode="play"){
  const unique=[],seen=new Set();
  B.player.discard.forEach(instance=>{if(!seen.has(instance.name)){seen.add(instance.name);unique.push(instance)}});
  modalAction={kind:mode==="archive"?"archiveDiscardArchive":"discardArchive",inst,def,choices:unique,selected:[]};
  openModal(GameArchiveView.discardPicker(unique,getDef,formatInk,{archiving:mode==="archive"}));
}

function toggleArchivePick(id,checked){
  if(!["discardArchive","archiveDiscardArchive"].includes(modalAction?.kind))return;
  const instance=modalAction.choices.find(choice=>choice.id===id);
  if(!instance)return;
  if(checked&&modalAction.selected.length<3)modalAction.selected.push(instance);
  if(!checked)modalAction.selected=modalAction.selected.filter(choice=>choice!==instance);
  document.querySelectorAll(".archive-choice input").forEach(input=>{
    input.disabled=!input.checked&&modalAction.selected.length>=3;
  });
  document.getElementById("archivePickStatus").textContent=`已选择 ${modalAction.selected.length}/3`;
}

function confirmArchivePick(){
  if(!["discardArchive","archiveDiscardArchive"].includes(modalAction?.kind)||!modalAction.selected.length)return;
  const {kind,inst,def,selected}=modalAction;
  closeModal();modalAction=null;
  if(kind==="archiveDiscardArchive")commitArchiveSelection({instances:selected});
  else commitPlayerCard(inst,def,{instances:selected});
}

function confirmOverload(payOverload){
  if(!["overload","archiveOverload"].includes(modalAction?.kind))return;
  const {kind,inst,def}=modalAction;
  if(kind==="overload"&&payOverload&&B.player.ink<def.cost+6)return;
  closeModal();modalAction=null;
  if(kind==="archiveOverload")commitArchiveSelection({payOverload});
  else commitPlayerCard(inst,def,{payOverload});
}

function cancelSpecialCard(){
  closeModal();
  modalAction=null;
  if(B){B.selected=null;updateUI()}
}

function endTurn(){
  if(B.busy||B.current!==1)return;
  addLog("玩家结束操作阶段。","p");
  submitAction();
}

/* 技能处理器与角色资料分离，新增角色只需注册一个同 id 的处理器。 */
const ROLE_SKILLS={
  tailwind:{
    execute(target,side){
      const u=target.id?target:unitAt(target);
      if(!u||u.owner!==side.owner||u.height!==1||u.cell.air||continuousSpellBlockedUnit(u))return false;
      makeFlying(u,Math.max(1,Math.ceil(cardCostByUnit(u)/2)));
      return true;
    },
    aiTarget(side){
      return B.units.filter(unit=>!unit.dead&&unit.owner===side.owner&&unit.height===1&&!unit.cell.air&&!continuousSpellBlockedUnit(unit))
        .sort((a,b)=>b.move-a.move||a.birth-b.birth)[0]||null;
    }
  },
  closeReading:{
    execute(target,side){
      const shape=closeReadingShape(target);
      if(!shape||!canUseCloseReadingAt(target,side)){
        addLog("精读区域必须完整位于战场内、接触己方墨迹且不能触及噤声区。","s");
        return false;
      }
      markStudyCircle(shape.center,FINE_CONTINUOUS_RADIUS.study,{source:"skill",owner:side.owner});
      B.units.filter(unit=>!unit.dead&&unit.owner===side.owner).forEach(unit=>{
        const body=unitWorldCircle(unit);
        if(!GameContinuousGeometry.intersectsCircle(shape,body.center,body.radius))return;
        unit.shield++;
        if(continuousInkTouchesUnit(side.owner,unit))triggerStudy(unit,unit.cell,false);
      });
      triggerAdjacentRecorders(shape,side.owner);
      return true;
    },
    aiTarget(side){
      return B.cells.map(GameBattlefieldAdapter.cellToWorld).filter(point=>canUseCloseReadingAt(point,side))
        .sort((a,b)=>closeReadingScore(b,side.owner)-closeReadingScore(a,side.owner))[0]||null;
    }
  },
  archive:{
    execute(target,side){
      const instance=target?.instance||null;
      const def=instance&&getDef(instance);
      const snapshot=target?.targetSnapshot||null;
      return !!def&&GameArchiveSystem.archiveHand(side,instance,
        GameArchiveCastSystem.waitTurns(def,snapshot),snapshot);
    }
  }
};

function closeReadingShape(target){
  const center=GameSpatialEffectProfiles.centerOf(target);
  return center?GameContinuousGeometry.circle(center,FINE_CONTINUOUS_RADIUS.study):null;
}

function closeReadingScore(target,owner){
  const shape=closeReadingShape(target);
  if(!shape)return -Infinity;
  return B.units.filter(unit=>!unit.dead&&unit.owner===owner).reduce((score,unit)=>{
    const body=unitWorldCircle(unit);
    return score+(GameContinuousGeometry.intersectsCircle(shape,body.center,body.radius)?4:0);
  },B.spatial.paint.analyze(shape,ownerSign(owner)).friendlyArea);
}

function canUseCloseReadingAt(target,side=B.player){
  const shape=closeReadingShape(target);
  if(!shape||!GameContinuousGeometry.shapeInsideWorld(shape))return false;
  const blocked=(B.spatial?.regions?.list("spellBlock")||[]).some(region=>
    GameContinuousGeometry.intersectsCircle(region.shape,shape.center,shape.radius)
  );
  return !blocked&&continuousInkTouchesCircle(side.owner,shape.center,shape.radius);
}

function useSkill(){
  if(B.busy||B.current!==1||B.player.sacrifices>0)return;
  if(B.player.skillCd>0)return;
  const skill=roleDef(B.player.role)?.skill;
  if(!skill||!ROLE_SKILLS[skill.id])return;
  B.selected={kind:"skill",role:B.player.role};
  document.getElementById("selectionInfo").innerHTML=`<b>${skill.name}</b><br>${skill.prompt}`;
  updateUI();
}

function selectSkillHandCard(id){
  if(B.selected?.kind!=="skill")return;
  const skill=roleDef(B.player.role)?.skill;
  if(skill?.target!=="hand")return;
  const instance=B.player.hand.find(card=>card.id===id&&!card.archive);
  if(!instance)return;
  if(skill.id==="archive")beginArchiveCardSelection(instance);
  else executeSkill(instance);
}

function executeSkill(target){
  const s=B.player;
  const skill=roleDef(s.role)?.skill;
  const handler=skill&&ROLE_SKILLS[skill.id];
  if(!handler||!handler.execute(target,s))return false;
  s.skillCd=skill.cooldown;
  drawTo(s,5);
  B.selected=null;
  B._targetPreview=null;
  addLog(`玩家使用角色技能「${skill.name}」。`,"p");
  submitAction();
  return true;
}

function cardCostByUnit(u){
  const d=CARD_MAP.get(u.name);return d?d.cost:2;
}

function triggerStudy(u,studyCell=u.cell,notifyRecorders=true){
  if(u.name==="禁咒守卫"&&!u.studyResolved){
    u.studyResolved=true;
    u.maxHp+=2;u.hp+=2;
    addLog("禁咒守卫通过精研提高了耐久上限。","b");
  }
  if(u.name==="禁锢墨水瓶")crystallizeInkInCircle(studyCell,FINE_CONTINUOUS_RADIUS.binding,{allOwners:true,owner:u.owner,source:"study"});
  if(notifyRecorders)triggerAdjacentRecorders(studyCell,u.owner);
}

function triggerAdjacentRecorders(studyTarget,owner){
  const studyShape=studyTarget?.kind?studyTarget:GameContinuousGeometry.circle(
    GameSpatialEffectProfiles.centerOf(studyTarget),.52
  );
  const recorders=B.units.filter(unit=>!unit.dead&&unit.owner===owner&&unit.name==="奥术记录仪")
    .filter(unit=>{
      const body=unitWorldCircle(unit);
      return GameContinuousGeometry.intersectsCircle(studyShape,body.center,body.radius+.25);
    }).sort((a,b)=>a.birth-b.birth);
  recorders.forEach(u=>{
    const center=GameBattlefieldAdapter.unitPosition(u);
    for(let index=0;index<16;index++){
      const angle=index*Math.PI*2/16;
      const point=GameWorldSpace.clampPoint({x:center.x+Math.cos(angle)*.8,y:center.y+Math.sin(angle)*.8},.6);
      if(Math.abs(B.spatial.paint.sample(point))>.05||!B.spatial.regions.permits(point,{kind:"paint",source:"unit",owner:ownerSign(owner)}))continue;
      paintContinuousArea(point,owner,1,{radiusU:.8,style:"page",seed:u.id+B.global+index});
      B.dirty=true;
      break;
    }
  });
}

function refundSpellSystems(owner,d){
  if(!d.type.includes("效果"))return;
  const s=side(owner);
  B.units.filter(u=>!u.dead&&u.owner===owner&&u.name==="真理循环装置")
    .forEach(()=>{
      if(s.spellRefunds<2){gainInk(s,2,"真理循环装置");s.spellRefunds++}
    });
}

