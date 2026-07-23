"use strict";

/* =========================================================
   自动出牌评估模块
========================================================= */

const CardAI=(()=>{
  const evaluators=new Map();

  function makeImpact(values={}){
    const impact={tactical:0,territory:0,crystal:0,resource:0,waste:0,...values};
    const total=impact.tactical+impact.territory*2+impact.crystal*1.5+
      impact.resource-impact.waste*.25;
    impact.meaningful=values.meaningful??total>0;
    impact.score=[impact.meaningful?1:0,total,impact.territory,impact.tactical,
      impact.crystal,impact.resource,-impact.waste];
    return impact;
  }

  function ownerImpact(cells,owner,context={}){
    const result=MapRules.inspectOwnerChanges(cells,owner,{source:"card",...context});
    return {territory:result.territory,waste:result.blocked.length,
      changedCells:result.changeable,blockedCells:result.blocked};
  }

  function continuousCrystalImpact(shape,owner){
    const mask=shape&&B.spatial?.paint?.captureMask(shape,{
      owner:ownerSign(owner),excludeCrystal:true
    });
    return {crystal:mask?continuousShapeArea(mask):0,waste:0,crystalMask:mask};
  }

  function legalLandingCell(u,c){
    if(!c||c.well||c.spellBlocked)return false;
    return !c.ground||u.name==="重力白鹅"&&c.ground.owner!==u.owner&&c.ground.hp<=2;
  }

  function targetsFor(d,owner,reservedSummons=new Set()){
    const own=B.units.filter(u=>!u.dead&&u.owner===owner);
    const enemy=B.units.filter(u=>!u.dead&&u.owner!==owner);
    if(d.target==="none")return [null];
    if(d.target==="overloadChoice")return [{payOverload:side(owner).ink>=d.cost+6}];
    if(d.target==="discardArchive"){
      const seen=new Set(),instances=side(owner).discard.filter(instance=>
        !seen.has(instance.name)&&seen.add(instance.name)).slice(0,3);
      return instances.length?[{instances}]:[];
    }
    if(d.target==="summon")return B.cells.filter(c=>
      legalSummonCell(owner,c)&&!reservedSummons.has(key(c.r,c.c))&&
      (d.name!=="真理之墙"||GameSpatialEffectProfiles.validPlacement(d.name,c)));
    if(d.name==="精准俯冲"){
      const units=own.filter(u=>u.height===2&&!continuousSpellBlockedUnit(u));
      const cells=B.cells.filter(c=>!continuousRegionAt("spellBlock",c)&&!c.well);
      return units.flatMap(unit=>cells.filter(c=>legalLandingCell(unit,c)).map(cell=>({unit,cell})));
    }
    if(d.name==="逻辑重构"){
      const units=own.filter(u=>!u.eternal&&u.name!=="真理之墙"&&continuousInkTouchesUnit(owner,u)&&!continuousSpellBlockedUnit(u));
      const pairs=[];
      units.forEach((first,i)=>units.slice(i+1).forEach(second=>{
        if(second.height===first.height)pairs.push({first,second});
      }));
      return pairs;
    }
    if(d.target==="own")return own.filter(u=>!continuousSpellBlockedUnit(u));
    if(d.target==="groundOwn")return own.filter(u=>u.height===1&&!continuousSpellBlockedUnit(u));
    if(d.target==="flying")return own.filter(u=>u.height===2&&!continuousSpellBlockedUnit(u));
    if(d.target==="enemy")return enemy.filter(u=>!continuousSpellBlockedUnit(u)&&
      (d.name!=="索引重排"||!u.eternal));
    if(d.target==="cell")return B.cells.filter(c=>!continuousRegionAt("spellBlock",c)&&
      GameSpatialEffectProfiles.validPlacement(d.name,c)&&
      (owner===1?c.c<35:c.c>25)&&
      (d.effectId!=="20735.defense-matrix"||canPlaceFortification(owner,c)));
    return [];
  }

  function genericImpact(d,owner,target){
    if(d.target==="summon"){
      const stats=d.stats;
      const future=ownerImpact([target,...neighbors(target)],owner,{kind:"future-paint",source:"unit"});
      const tactical=stats?stats.hp+stats.attack*2+stats.move+stats.paint*2:6;
      const wall=d.name==="真理之墙"?{crystal:Math.PI*FINE_CONTINUOUS_RADIUS.wall**2,waste:0}:null;
      return makeImpact({meaningful:true,tactical,territory:future.territory*.2,
        crystal:wall?.crystal||0,waste:future.waste+(wall?.waste||0),
        resource:d.type.includes("资源")?4:0});
    }
    return makeImpact({meaningful:true,tactical:1});
  }

  function analyze(d,owner,target){
    const evaluator=evaluators.get(d.name);
    const impact=evaluator?evaluator(d,owner,target):genericImpact(d,owner,target);
    return {...impact,target};
  }

  function compareImpact(a,b){
    return compareScoreArrays(b.score,a.score);
  }

  function bestPlay(d,owner,reservedSummons=new Set()){
    const plays=targetsFor(d,owner,reservedSummons).map(target=>analyze(d,owner,target))
      .filter(x=>x.meaningful);
    plays.sort(compareImpact);
    return plays[0];
  }

  function register(names,evaluator){
    (Array.isArray(names)?names:[names]).forEach(name=>evaluators.set(name,evaluator));
  }

  return {register,targetsFor,analyze,bestPlay,ownerImpact,
    continuousCrystalImpact,makeImpact,compareImpact};
})();

CardAI.register("紧急着陆指令",(d,owner)=>{
  const units=B.units.filter(u=>!u.dead&&u.owner===owner&&u.height===2&&!continuousSpellBlockedUnit(u));
  return CardAI.makeImpact({meaningful:units.length>0,tactical:units.length*3});
});
CardAI.register("轻盈之舞",(d,owner,u)=>CardAI.makeImpact({
  meaningful:!!u,tactical:u?.height===2?movementFor(u)+attackFor(u)+3:4
}));
CardAI.register("莽撞突击",(d,owner)=>{
  const units=B.units.filter(u=>!u.dead&&u.owner===owner&&!u.eternal&&!continuousSpellBlockedUnit(u)&&movementFor(u)>0);
  return CardAI.makeImpact({meaningful:units.length>0,tactical:units.length*3});
});
CardAI.register("全体升空！",(d,owner)=>{
  const units=B.units.filter(u=>!u.dead&&u.owner===owner&&u.height===1&&!u.cell.air&&!continuousSpellBlockedUnit(u));
  return CardAI.makeImpact({meaningful:units.length>0,tactical:units.length*4});
});
CardAI.register("精准俯冲",(d,owner,target)=>{
  const u=target.unit,c=target.cell;
  const enemyDistance=nearestDistance(c,B.units.filter(x=>!x.dead&&x.owner!==owner));
  const crush=c.ground&&c.ground.owner!==owner&&c.ground.hp<=2?6:0;
  const crystalWaste=c.crystal&&c.owner!==owner?1:0;
  return CardAI.makeImpact({meaningful:!!u,tactical:crush+Math.max(0,6-enemyDistance),waste:crystalWaste});
});
CardAI.register("白羽防护罩",(d,owner,u)=>CardAI.makeImpact({
  meaningful:!!u,tactical:(u.lastLanded&&u.hp<u.maxHp?4:0)+(u.halfDamage?0:3)
}));
CardAI.register("乱序风暴",(d,owner)=>{
  const units=B.units.filter(u=>!u.dead&&u.height===2&&!continuousSpellBlockedUnit(u));
  const mutable=B.cells.filter(c=>MapRules.ownerChange(c,owner,{source:"card"}).allowed).length;
  const blocked=B.cells.filter(c=>c.crystal).length;
  return CardAI.makeImpact({meaningful:units.length>0,tactical:units.length*3,
    territory:units.length*25*mutable/B.cells.length,waste:units.length*25*blocked/B.cells.length});
});
CardAI.register("索引重排",(d,owner,u)=>CardAI.makeImpact({
  meaningful:!!u,tactical:u?(continuousRegionTouchesUnit("study",u,owner)?8:3)+Math.max(0,8-nearestDistance(u.cell,
    B.units.filter(x=>!x.dead&&x.owner===owner))):0
}));
CardAI.register("结晶共鸣",(d,owner)=>{
  const sign=ownerSign(owner);
  const regions=(B.spatial?.regions?.list("crystal")||[]).filter(region=>region.owner===sign);
  const spread=regions.reduce((area,region)=>{
    const source=rasterizeContinuousShape(region.shape);
    return area+(source?Math.max(0,continuousShapeArea(GameContinuousGeometry.dilateRasterMask(source,1))-
      continuousShapeArea(source)):0);
  },0);
  return CardAI.makeImpact({meaningful:regions.length>0,territory:spread});
});
CardAI.register("逻辑重构",(d,owner,target)=>{
  const {first,second}=target;
  const healing=(continuousRegionTouchesCircle("study",GameBattlefieldAdapter.cellToWorld(second.cell),first.body?.radius||.35)
    ?Math.min(2,first.maxHp-first.hp):0)+
    (continuousRegionTouchesCircle("study",GameBattlefieldAdapter.cellToWorld(first.cell),second.body?.radius||.35)
      ?Math.min(2,second.maxHp-second.hp):0);
  const position=Math.abs(nearestDistance(first.cell,B.units.filter(x=>!x.dead&&x.owner!==owner))-
    nearestDistance(second.cell,B.units.filter(x=>!x.dead&&x.owner!==owner)));
  return CardAI.makeImpact({meaningful:healing+position>0,tactical:healing*2+position});
});
CardAI.register("“保持安静”",(d,owner,target)=>{
  const shape=GameContinuousGeometry.circle(GameSpatialEffectProfiles.centerOf(target),FINE_CONTINUOUS_RADIUS.quiet);
  const units=B.units.filter(u=>!u.dead&&u.owner!==owner&&!u.skipMoveOnce).filter(u=>{
    const body=unitWorldCircle(u);
    return GameContinuousGeometry.intersectsCircle(shape,body.center,body.radius);
  });
  return CardAI.makeImpact({meaningful:units.length>0,tactical:units.length*5});
});
CardAI.register("噤声",(d,owner,target)=>{
  const shape=GameContinuousGeometry.circle(GameSpatialEffectProfiles.centerOf(target),FINE_CONTINUOUS_RADIUS.silence);
  const enemyUnits=B.units.filter(u=>!u.dead&&u.owner!==owner).filter(u=>{
    const body=unitWorldCircle(u);
    return GameContinuousGeometry.intersectsCircle(shape,body.center,body.radius);
  }).length;
  return CardAI.makeImpact({meaningful:true,tactical:enemyUnits*3+Math.PI*.4});
});
CardAI.register("奥术结晶界",(d,owner)=>{
  const boundary=GameContinuousGeometry.rect({x:owner===1?15:45,y:15},30,30);
  const mask=B.spatial?.paint?.captureMask(boundary,{owner:ownerSign(owner),excludeCrystal:true});
  const area=mask?continuousShapeArea(mask):0;
  return CardAI.makeImpact({meaningful:area>0,crystal:area});
});
CardAI.register("最终论文：永恒结晶",(d,owner,u)=>{
  if(!u||u.eternal)return CardAI.makeImpact({meaningful:false});
  const crystal=Math.PI*FINE_CONTINUOUS_RADIUS.eternal**2;
  return CardAI.makeImpact({meaningful:true,tactical:6,resource:6,
    crystal});
});

