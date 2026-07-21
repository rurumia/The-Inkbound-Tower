"use strict";

/* =========================================================
   34 张卡牌效果
========================================================= */

function executeCard(d,owner,target,context={}){
  const s=side(owner);

  if(d.target==="summon"){
    const u=summonUnit(owner,d.name,target,d.stats,{sourceInstance:context.sourceInstance});
    if(!u)return;

    if(d.name==="流动书架")u.deployedFriendly=target.owner===owner;
    return;
  }

  if(d.effectId&&GameEffectRegistry.has(d.effectId)){
    GameEffectRegistry.invoke(d.effectId,"play",{
      def:d,owner,target,side:s,sourceInstance:context.sourceInstance,
      archived:context.archived,archiveSource:context.archiveSource,api:GAME_API
    });
    B.dirty=true;
    return;
  }

  switch(d.name){
    case "紧急着陆指令":
      B.units.filter(u=>!u.dead&&u.owner===owner&&u.height===2&&!u.cell.spellBlocked).forEach(u=>{
        landUnit(u);
        cellsRadius(u.cell,1).filter(x=>!x.spellBlocked)
          .forEach(x=>paintCell(x,owner,{source:"card"}));
      });
      break;

    case "轻盈之舞":{
      const u=target.id?target:unitAt(target);
      if(u.height===1)makeFlying(u,1);
      else u.extraActions++;
      break;
    }

    case "莽撞突击":
      B.units.filter(u=>!u.dead&&u.owner===owner&&!u.cell.spellBlocked)
        .forEach(u=>chargeForward(u,u.move+u.bonusMove,true,1));
      break;

    case "全体升空！":
      B.units.filter(u=>!u.dead&&u.owner===owner&&u.height===1&&!u.cell.spellBlocked).forEach(u=>{
        if(makeFlying(u,2))u.bonusMove+=2;
      });
      break;

    case "精准俯冲":{
      const u=target.unit||target;
      const dest=target.cell||automaticLandingTarget(u);
      if(dest&&landUnit(u,dest))u.bonusAttack+=1;
      break;
    }

    case "白羽防护罩":{
      const u=target.id?target:unitAt(target);
      u.halfDamage=true;
      if(u.lastLanded)u.hp=Math.min(u.maxHp,u.hp+2);
      break;
    }

    case "乱序风暴":
      B.units.filter(u=>!u.dead&&u.height===2&&!u.cell.spellBlocked).forEach(u=>{
        const legal=B.cells.filter(c=>!c.air&&!c.spellBlocked);
        const dest=legal[Math.floor(B.rng()*legal.length)];
        if(dest){
          u.cell.air=null;u.cell=dest;dest.air=u;
          landUnit(u);
          rectCells(u.cell,5).filter(x=>!x.spellBlocked)
            .forEach(x=>paintCell(x,u.owner,{source:"card"}));
        }
      });
      break;

    case "索引重排":{
      const u=target.id?target:unitAt(target);
      const origin=u.cell;
      const half=B.cells.filter(c=>{
        const correct=u.owner===1?c.c<30:c.c>=30;
        const slotFree=u.height===1?!c.ground&&!c.well:!c.air;
        return correct&&slotFree&&!c.spellBlocked;
      });
      const dest=half[Math.floor(B.rng()*half.length)];
      if(dest){
        refreshWallAura(u,()=>{
          if(u.height===1){u.cell.ground=null;u.cell=dest;dest.ground=u}
          else if(!dest.air){u.cell.air=null;u.cell=dest;dest.air=u}
        });
      }
      if(origin.studied){u.rooted=true;u.skipMoveOnce=true}
      break;
    }

    case "结晶共鸣":{
      const crystals=B.cells.filter(c=>c.owner===owner&&c.crystal);
      const spread=new Set();
      crystals.forEach(c=>neighbors(c).forEach(n=>spread.add(n)));
      spread.forEach(c=>paintCell(c,owner,{source:"card"}));
      break;
    }

    case "逻辑重构":{
      const first=target.first||target;
      const second=target.second||B.units
        .filter(u=>!u.dead&&!u.eternal&&u.owner===owner&&u!==first&&u.height===first.height&&
          u.cell.owner===owner&&!u.cell.spellBlocked)
        .sort((a,b)=>a.birth-b.birth)[0];
      swapUnits(first,second);
      break;
    }

    case "“保持安静”":
      rectCells(target,5).filter(c=>!c.spellBlocked).forEach(c=>{
        [c.ground,c.air].filter(Boolean).forEach(u=>{
          if(u.owner!==owner){u.skipMoveOnce=true;u.silencedOnce=true}
          if(u.owner!==owner)u.rooted=true;
        });
      });
      break;

    case "噤声":
      rectCells(target,5).forEach(c=>MapRules.tryCellEffect(c,"spell-block",current=>{
        current.spellBlocked=true;
      },{source:"card"}));
      break;

    case "奥术结晶界":{
      const component=largestOwnedComponent(owner,true);
      component.filter(c=>!c.spellBlocked).forEach(c=>crystallize(c));
      s.skipNext=true;
      break;
    }

    case "最终论文：永恒结晶":{
      const u=target.id?target:unitAt(target);
      cellsRadius(u.cell,2).filter(c=>!c.spellBlocked).forEach(c=>crystallize(c));
      u.move=0;u.attack=0;u.eternal=true;
      u.duration=0;u.resource=false;
      u.name="最终论文：永恒结晶";
      break;
    }
  }
  B.dirty=true;
}

function finishDive(cell){
  const {unit,inst,def}=B.selected;
  const crushable=unit.name==="重力白鹅"&&cell?.ground&&cell.ground.owner!==unit.owner&&cell.ground.hp<=2;
  if(!cell||cell.well||cell.spellBlocked||cell.ground&&!crushable)return;
  commitPlayerCard(inst,def,{unit,cell});
}

function finishSwap(target){
  const {first:a,inst,def}=B.selected;
  const b=target?(target.id?target:unitAt(target)):null;
  if(!b||a.eternal||b.eternal||b.owner!==a.owner||b===a||b.cell.owner!==a.owner||b.cell.spellBlocked)return;
  if(a.height!==b.height)return;
  commitPlayerCard(inst,def,{first:a,second:b});
}

function swapUnits(a,b){
  if(!a||!b)return false;
  const ca=a.cell,cb=b.cell;
  if(a.height===1){ca.ground=b;cb.ground=a}
  else{ca.air=b;cb.air=a}
  a.cell=cb;b.cell=ca;
  if(a.name==="真理之墙")applyWallAura(a);
  if(b.name==="真理之墙")applyWallAura(b);
  [a,b].forEach(u=>{
    if(u.cell.studied)u.hp=Math.min(u.maxHp,u.hp+2);
  });
  return true;
}

function automaticLandingTarget(u){
  const cells=B.cells.filter(c=>!c.spellBlocked&&!c.well&&(!c.ground||
    u.name==="重力白鹅"&&c.ground.owner!==u.owner&&c.ground.hp<=2));
  cells.sort((a,b)=>hexDistance(a,u.cell)-hexDistance(b,u.cell)||a.c-b.c||a.r-b.r);
  return cells[0]||null;
}

function largestOwnedComponent(owner,ownHalfOnly=false){
  const seen=new Set(),groups=[];
  for(const c of B.cells){
    if(c.owner!==owner||seen.has(c)||ownHalfOnly&&(owner===1?c.c>=30:c.c<30))continue;
    const group=[],q=[c];seen.add(c);
    while(q.length){
      const x=q.shift();group.push(x);
      neighbors(x).forEach(n=>{
        if(n.owner===owner&&!seen.has(n)&&(!ownHalfOnly||(owner===1?n.c<30:n.c>=30))){
          seen.add(n);q.push(n);
        }
      });
    }
    groups.push(group);
  }
  groups.sort((a,b)=>b.length-a.length);
  return groups[0]||[];
}

