"use strict";

/* =========================================================
   书灵 AI、移动、涂色和战斗
========================================================= */

async function unitAct(u){
  if(u.dead)return;
  u.lastLanded=false;
  u.halfDamage=false;
  u.effectMove=0;u.effectAttack=0;u.effectPaint=0;
  invokeUnitEffect(u,"beforeUnitAct");
  GameStatusSystem.invoke(u,"beforeAction",{
    api:GAME_API,
    movementBeforeStatus:u.move+u.permanentMove+u.bonusMove+u.effectMove+
      (u.height===2&&u.name==="侦查隼·B型"?2:0),
    paintBeforeStatus:u.paint+u.effectPaint
  });

  try{

  if(u.name==="墨水凝固者"){
    const shape=GameContinuousGeometry.circle(
      GameBattlefieldAdapter.unitPosition(u),FINE_CONTINUOUS_RADIUS.solidifier
    );
    const coverage=B.spatial.paint.analyze(shape,ownerSign(u.owner));
    const crystal=coverage.friendlyStrongRatio>=.95
      ?crystallizeInkInCircle(shape.center,FINE_CONTINUOUS_RADIUS.solidifier,{owner:u.owner,source:"unit"})
      :null;
    if(crystal){
      addLog("墨水凝固者放弃移动并结晶化半径 1.5U 内的已有墨迹。","b");
      attackAdjacent(u);
      return;
    }
  }

  if(u.skipMoveOnce){u.skipMoveOnce=false;u.rooted=true}
  if(u.rooted||movementFor(u)<=0){
    if(u.height===1&&effectivePaint(u)>0)paintUnitCell(u,u.cell);
    attackAdjacent(u);
    u.silencedOnce=false;
    return;
  }

  const plan=planSpiritAction(u);
  if(plan.path.length===0&&u.height===1&&effectivePaint(u)>0)paintUnitCell(u,u.cell);
  let allowedSteps=plan.path.length;
  const actionDuration=Math.max(350,Math.min(1400,plan.path.length/5*1000))/B.speed;
  const guidePoints=[u.cell,...plan.path].map(GameBattlefieldAdapter.cellToWorld);
  const motion=GameBrushMotion.create(guidePoints,{type:movementCurveType(u),seed:u.id});
  const paintOperations=curvePaintOperations(u,motion.points);
  let revealedPaint=0;
  let continuousEnemyAreaRemoved=0;
  let traversedMotion=0;
  let movementStarted=false;
  try{
    for(let step=0;step<allowedSteps;step++){
      const next=plan.path[step];
      if(u.dead)break;
      if(!canEnterCell(u,next))break;
      const penalty=triggerFortificationEntry(u,next);
      allowedSteps=Math.max(step,allowedSteps-penalty);
      if(step>=allowedSteps||u.dead)break;
      const from=u.cell;
      const segment=motion.segments[step];
      if(!movementStarted){
        movementStarted=true;
        u._displayPosition=segment.points[0];
        if(typeof playUnitAnimation==="function")playUnitAnimation(u,u.height===2?"fly":"move");
      }
      moveUnit(u,next,{continuousPaint:false});
      const revealPaint=progress=>{
        const globalProgress=motion.length?(traversedMotion+segment.length*progress)/motion.length:1;
        while(revealedPaint<paintOperations.length&&paintOperations[revealedPaint].progress<=globalProgress+1e-9){
          const operation=paintOperations[revealedPaint++];
          const paintResult=B.spatial.paint.apply(operation);
          continuousEnemyAreaRemoved+=paintResult.enemyAreaRemoved;
          invokeUnitEffect(u,"paintOperation",{operation,result:paintResult});
          B.dirty=true;
        }
      };
      const segmentDuration=motion.length?actionDuration*segment.length/motion.length:0;
      if(typeof animateUnitCurveSegment==="function")
        await animateUnitCurveSegment(u,segment.points,segmentDuration,revealPaint);
      else{
        revealPaint(1);
        await sleep(35/B.speed);
      }
      u._displayPosition=segment.points.at(-1);
      traversedMotion+=segment.length;
    }
  }finally{
    if(movementStarted){
      delete u._displayPosition;
      if(!u.dead&&typeof playUnitAnimation==="function")playUnitAnimation(u,"idle");
    }
  }
  attackAdjacent(u,plan.attackTarget);
  if(continuousEnemyAreaRemoved>0)invokeUnitEffect(u,"paintedArea",{enemyAreaRemoved:continuousEnemyAreaRemoved});
  u.silencedOnce=false;
  }finally{
    if(!u.dead)invokeUnitEffect(u,"afterUnitAct");
    if(!u.dead)GameStatusSystem.invoke(u,"afterAction",{api:GAME_API});
    u.effectMove=0;u.effectAttack=0;u.effectPaint=0;
  }
}

function canEnterCell(u,cell){
  if(!cell)return false;
  if(u.height===1)return !cell.well&&(!cell.ground||cell.ground===u);
  return !cell.air||cell.air===u;
}

function movementFor(u){
  const passive=unitPassiveBonuses(u);
  const base=Math.max(0,u.move+u.permanentMove+u.bonusMove+u.effectMove+(passive.move||0)+
    (u.height===2&&u.name==="侦查隼·B型"?2:0));
  return base*GameModifierSystem.multiplier(side(u.owner),"movement");
}

function nearestDistance(cell,list,cellFn=x=>x.cell){
  if(!list.length)return 99;
  return Math.min(...list.map(x=>hexDistance(cell,cellFn(x))));
}

function movementCurveType(unit){
  const shape=GameBrushProfiles.forUnit(unit,effectivePaint(unit)).shape;
  if(shape==="feather"||shape==="droplet"||shape==="fan")return "sweep";
  if(shape==="blade"||shape==="crystal")return "arc";
  return "flow";
}

function curvePaintOperations(unit,path){
  if(unit.height===2||effectivePaint(unit)<=0||!B?.spatial?.paint)return [];
  const brush=GameBrushProfiles.forUnit(unit,effectivePaint(unit));
  return GameContinuousBrushes.operations(brush,path,unit.owner===1?1:-1);
}

function paintDetectionRadius(unit){
  return Math.max(6,movementFor(unit)*2);
}

function paintFrontierTargets(unit){
  return B.cells.filter(cell=>!cell.well&&
    MapRules.ownerChange(cell,unit.owner,{kind:"paint",source:"unit"}).allowed);
}

function planSpiritAction(u){
  const frontierTargets=paintFrontierTargets(u);
  const context={
    enemies:B.units.filter(x=>!x.dead&&x.owner!==u.owner),
    neutralWells:B.wells.filter(w=>w.owner===0),
    strategicWells:B.wells.filter(w=>w.owner===0||w.owner===u.owner),
    enemyAreaDistance:buildDistanceField(B.cells.filter(c=>c.owner===enemyOf(u.owner))),
    frontierDistance:buildDistanceField(frontierTargets)
  };
  context.enemyIsClose=nearestDistance(u.cell,context.enemies)<=10;
  context.seekPaintFrontier=u.height===1&&effectivePaint(u)>0&&movementFor(u)>0&&
    frontierTargets.length>0&&!frontierTargets.some(cell=>
      hexDistance(u.cell,cell)<=paintDetectionRadius(u));
  const base={
    cell:u.cell,path:[],directions:[],paintCells:new Set(),
    visited:new Set([key(u.cell.r,u.cell.c)]),attackTarget:null,score:[]
  };
  scoreSpiritPlan(u,base,context);
  const candidates=[base];
  let frontier=[base];
  const beamWidth=96;

  for(let depth=0;depth<movementFor(u);depth++){
    const nextFrontier=[];
    for(const plan of frontier){
      for(let direction=0;direction<6;direction++){
        const next=neighborInDirection(plan.cell,direction);
        const nextKey=next?key(next.r,next.c):"";
        if(!next||!canEnterCell(u,next)||plan.visited.has(nextKey))continue;
        const paintCells=new Set(plan.paintCells);
        if(u.height===1)paintFootprint(plan.cell,next,effectivePaint(u)).forEach(c=>paintCells.add(c));
        const child={
          cell:next,path:[...plan.path,next],directions:[...plan.directions,direction],paintCells,
          visited:new Set(plan.visited),attackTarget:null,score:[]
        };
        child.visited.add(nextKey);
        scoreSpiritPlan(u,child,context);
        nextFrontier.push(child);
      }
    }
    if(!nextFrontier.length)break;
    nextFrontier.sort(compareSpiritPlans);
    frontier=nextFrontier.slice(0,beamWidth);
    candidates.push(...frontier);
  }

  const movingCandidates=candidates.filter(plan=>plan.path.length>0);
  const selectable=movingCandidates.length?movingCandidates:candidates;
  selectable.sort(compareSpiritPlans);
  const best=selectable[0];
  best.reason=`${context.seekPaintFrontier?"前线寻路":aiName(u.ai)}评分 ${best.score.join("/")}`;
  return best;
}

function aiName(ai){
  return ai==="avoid"?"避战":ai==="aggressive"?"好战":ai==="guard"?"协同":"扩张";
}

function scoreSpiritPlan(u,plan,context){
  const paintCells=plan.path.length?plan.paintCells:new Set(u.height===1&&effectivePaint(u)>0?[u.cell]:[]);
  const paintImpact=MapRules.inspectOwnerChanges([...paintCells],u.owner,{kind:"paint",source:"unit"});
  const newPaint=paintImpact.territory;
  const crystalWaste=paintImpact.blocked.length;
  plan.paintImpact={changed:paintImpact.changeable.length,territory:newPaint,crystalWaste};
  const wellApproach=scoreWellContribution(u,plan.cell,paintCells,context.neutralWells);
  const wellExpansion=scoreWellContribution(u,plan.cell,paintCells,context.strategicWells);
  const attack=selectBestAttack(u,plan.cell,context.enemies);
  plan.attackTarget=attack?.target||null;

  if(context.seekPaintFrontier){
    const progress=distanceProgress(context.frontierDistance,u.cell,plan.cell);
    const remaining=context.frontierDistance.get(plan.cell)??99;
    plan.score=[progress>0?1:0,progress,-remaining,newPaint,attack?1:0,
      -crystalWaste,-plan.path.length];
    return plan;
  }

  if(u.ai==="avoid"){
    if(context.enemyIsClose){
      const margin=threatMargin(u,plan.cell,context.enemies);
      const areaDistance=context.enemyAreaDistance.get(plan.cell)??99;
      const frontierProgress=distanceProgress(context.frontierDistance,u.cell,plan.cell);
      plan.score=[margin>=0?1:0,margin,areaDistance,wellApproach,newPaint,
        frontierProgress,-crystalWaste,-plan.path.length];
    }else plan.score=[wellApproach,newPaint,distanceProgress(context.frontierDistance,u.cell,plan.cell),
      -crystalWaste,-plan.path.length];
  }else if(u.ai==="aggressive"){
    const depth=(plan.cell.owner===enemyOf(u.owner)?100:0)+(u.owner===1?plan.cell.c:-plan.cell.c);
    const enemyApproach=nearestDistance(u.cell,context.enemies)-nearestDistance(plan.cell,context.enemies);
    const frontierProgress=distanceProgress(context.frontierDistance,u.cell,plan.cell);
    plan.score=[attack?1:0,attack?attack.kill:enemyApproach,
      attack?attack.survive:frontierProgress,attack?attack.netDamage:depth,
      newPaint,-crystalWaste,-plan.path.length];
  }else if(u.ai==="guard"){
    const partners=B.units.filter(other=>!other.dead&&other.owner===u.owner&&other!==u&&hasTag(other,"无人机"));
    const distance=nearestDistance(plan.cell,partners);
    const approach=nearestDistance(u.cell,partners)-distance;
    plan.score=[partners.length?1:0,distance<=3?1:0,approach,-distance,newPaint,
      -crystalWaste,-plan.path.length];
  }else{
    plan.score=[newPaint,wellExpansion,distanceProgress(context.frontierDistance,u.cell,plan.cell),
      -crystalWaste,-plan.path.length];
  }
  return plan;
}

function scoreWellContribution(u,cell,paintCells,wells){
  if(!wells.length)return 0;
  const approach=nearestDistance(u.cell,wells,w=>w.cell)-nearestDistance(cell,wells,w=>w.cell);
  let surround=0;
  wells.forEach(w=>neighbors(w.cell).forEach(c=>{
    if(paintCells.has(c)&&MapRules.ownerChange(c,u.owner,{kind:"paint",source:"unit"}).allowed)
      surround+=w.owner===0?20:15;
  }));
  return surround+approach;
}

function buildDistanceField(sources){
  const distance=new Map(),queue=[];
  sources.forEach(c=>{
    if(distance.has(c))return;
    distance.set(c,0);queue.push(c);
  });
  for(let i=0;i<queue.length;i++){
    const current=queue[i],nextDistance=distance.get(current)+1;
    neighbors(current).forEach(next=>{
      if(distance.has(next))return;
      distance.set(next,nextDistance);queue.push(next);
    });
  }
  return distance;
}

function distanceProgress(distanceField,from,to){
  const fromDistance=distanceField.get(from)??99;
  const toDistance=distanceField.get(to)??99;
  if(fromDistance===99&&toDistance===99)return 0;
  return fromDistance-toDistance;
}

function threatMargin(u,cell,enemies){
  if(u.height===2)return 99;
  if(!enemies.length)return 99;
  return Math.min(...enemies.map(e=>{
    const reach=e.rooted||e.skipMoveOnce?1:movementFor(e)+1;
    return hexDistance(cell,e.cell)-reach;
  }));
}

function attackTargetsAt(u,cell,enemies=null){
  const enemySet=enemies?new Set(enemies):null;
  return neighbors(cell).map(c=>c.ground).filter(target=>target&&!target.dead&&
    target.owner!==u.owner&&target.height===1&&(!enemySet||enemySet.has(target))&&
    !GameEffectRegistry.invoke(target.effectId,"blockAttack",{unit:target,attacker:u,api:GAME_API}));
}

function selectBestAttack(u,cell,enemies=null){
  const choices=attackTargetsAt(u,cell,enemies).map(target=>previewCombat(u,target));
  choices.sort((a,b)=>compareScoreArrays(b.score,a.score)||a.target.birth-b.target.birth);
  return choices[0]||null;
}

function previewCombat(attacker,target){
  let attack=attackFor(attacker);
  if(attacker.name==="铁喙啄木鸟"&&(target.rooted||target.skipMoveOnce||target.move===0))attack*=2;
  const targetVictim=redirectedCombatVictim(target);
  const attackerVictim=redirectedCombatVictim(attacker);
  const dealt=previewDamage(targetVictim,attack);
  const returned=previewDamage(attackerVictim,attackFor(target));
  const kill=dealt>=targetVictim.hp?1:0;
  const survive=returned<attackerVictim.hp?1:0;
  return {target,kill,survive,netDamage:dealt-returned,score:[kill,survive,dealt-returned,dealt,-target.hp]};
}

function redirectedCombatVictim(target){
  if(!target.resource)return target;
  return B.units.filter(u=>!u.dead&&u.owner===target.owner&&u.name==="图书馆活化石像")
    .sort((a,b)=>a.birth-b.birth)[0]||target;
}

function previewDamage(target,amount){
  if(target.shield>0)return 0;
  return target.halfDamage?Math.ceil(amount/2):amount;
}

function compareScoreArrays(a,b){
  const length=Math.max(a.length,b.length);
  for(let i=0;i<length;i++){
    const delta=(a[i]||0)-(b[i]||0);
    if(delta)return delta;
  }
  return 0;
}

function compareSpiritPlans(a,b){
  const scoreOrder=compareScoreArrays(b.score,a.score);
  if(scoreOrder)return scoreOrder;
  if(a.cell.c!==b.cell.c)return a.cell.c-b.cell.c;
  if(a.cell.r!==b.cell.r)return a.cell.r-b.cell.r;
  const length=Math.max(a.directions.length,b.directions.length);
  for(let i=0;i<length;i++){
    const delta=(a.directions[i]??-1)-(b.directions[i]??-1);
    if(delta)return delta;
  }
  return 0;
}

function moveUnit(u,dest,options={}){
  const settings={paint:true,continuousPaint:true,triggerStudy:true,updateFacing:true,teleport:false,...options};
  const from=u.cell;
  const direction=directionBetween(from,dest);
  if(direction<0&&!settings.teleport)return false;
  const origin=GameBattlefieldAdapter.cellToWorld(from);
  const destination=GameBattlefieldAdapter.cellToWorld(dest);
  const bodyRadius=u.body?.radius||.35;
  const enteredStudy=!continuousRegionTouchesCircle("study",origin,bodyRadius,u.owner)&&
    continuousRegionTouchesCircle("study",destination,bodyRadius,u.owner);
  refreshWallAura(u,()=>{
    if(u.height===1){from.ground=null;dest.ground=u}
    else{from.air=null;dest.air=u}
    u.cell=dest;
  });

  if(settings.updateFacing&&direction>=0)u.lastMoveDirection=direction;
  if(u.height===1&&settings.paint){
    paintStep(u,from,dest,{skipContinuous:!settings.continuousPaint});
  }
  if(u.height===1&&settings.triggerStudy&&enteredStudy)
    triggerStudy(u,dest);
  B.dirty=true;
  return true;
}

function paintStep(u,from,to,options={}){
  const paintRate=effectivePaint(u);
  if(u.height===2||paintRate<=0)return;
  paintFootprint(from,to,paintRate).forEach(c=>paintUnitCell(u,c,{skipContinuous:true}));
  if(!options.skipContinuous)applyContinuousPaint(to,u.owner,{
    unit:u,path:[GameBattlefieldAdapter.cellToWorld(from),GameBattlefieldAdapter.cellToWorld(to)]
  });
}

function paintFootprint(from,to,paintRate){
  if(paintRate<=0)return [];
  return to?[to]:[];
}

function paintUnitCell(u,c,context={}){
  if(!c)return;
  const previousOwner=c.owner;
  paintCell(c,u.owner,{unit:u,...context});
  if(c.owner===u.owner&&previousOwner!==u.owner)invokeUnitEffect(u,"painted",{cell:c,previousOwner});
  if(u.name==="幻影孔雀")paintContinuousArea(c,u.owner,1,{radiusU:1,style:"feather",seed:u.id+B.global+c.r*61+c.c});
}

function paintCell(c,owner,context={}){
  if(c.purified&&c.purified.owner!==owner&&B.global<=c.purified.until){
    const purifier=B.units.find(unit=>!unit.dead&&unit.id===c.purified.unitId);
    if(purifier)invokeUnitEffect(purifier,"blockedPaint",{count:1,cell:c});
    return false;
  }
  MapRules.tryChangeOwner(c,owner,{kind:"paint",source:"unit",...context});
  applyContinuousPaint(c,owner,context);
  B.dirty=true;
  return c.owner===owner;
}

function attackAdjacent(u,preferred=null){
  if(u.dead)return;
  const targets=attackTargetsAt(u,u.cell);
  if(!targets.length)return;
  const target=preferred&&targets.includes(preferred)?preferred:selectBestAttack(u,u.cell)?.target;
  if(target){
    if(typeof playUnitAnimation==="function")playUnitAnimation(u,"attack",360/B.speed);
    combat(u,target);
  }
}

function damage(u,amount){
  if(u.shield>0){u.shield--;return 0}
  if(u.halfDamage)amount=Math.ceil(amount/2);
  u.hp-=amount;
  if(amount>0&&u.hp>0&&typeof playUnitAnimation==="function")playUnitAnimation(u,"hurt",260/B.speed);
  return amount;
}

function damageRedirect(target,amount,source){
  const guardians=B.units.filter(unit=>!unit.dead&&unit.owner===target.owner&&unit!==target)
    .sort((a,b)=>a.birth-b.birth);
  for(const guardian of guardians){
    const redirect=GameEffectRegistry.invoke(guardian.effectId,"redirectDamage",{
      unit:guardian,target,amount,source,api:GAME_API
    });
    if(redirect)return redirect;
  }
  return target;
}

function dealEffectDamage(target,amount,source=null){
  const victim=damageRedirect(target,amount,source);
  const dealt=damage(victim,amount);
  if(victim!==target)invokeUnitEffect(victim,"redirectedDamage",{amount:dealt,source});
  if(victim.hp<=0)removeUnit(victim);
  return dealt;
}

function combat(a,d){
  if(a.dead||d.dead||d.height===2)return;
  let ad=attackFor(a);
  let dd=attackFor(d);
  if(a.name==="铁喙啄木鸟"&&(d.rooted||d.skipMoveOnce||d.move===0))ad*=2;

  const dealt=damageCombatTarget(d,ad,a);
  const returned=damageCombatTarget(a,dd,d);
  addLog(`「${a.name}」与「${d.name}」交战：${dealt}/${returned} 伤害。`,"s");

  if(a.hp<=0)removeUnit(a);
  if(d.hp<=0)removeUnit(d);
  if(!a.dead&&d.dead&&a.name==="铁喙啄木鸟")makeFlying(a,cardCostByUnit(a)/2);
  if(!d.dead&&a.dead&&d.name==="铁喙啄木鸟")makeFlying(d,cardCostByUnit(d)/2);
}

function damageCombatTarget(target,amount,source=null){
  const redirected=damageRedirect(target,amount,source);
  if(redirected!==target){
    const dealt=damage(redirected,amount);
    invokeUnitEffect(redirected,"redirectedDamage",{amount:dealt,source});
    addLog(`「${redirected.name}」替「${target.name}」承受了 ${dealt} 伤害。`,"b");
    if(redirected.hp<=0)removeUnit(redirected);
    return dealt;
  }
  if(target.resource){
    const statue=B.units.filter(u=>!u.dead&&u.owner===target.owner&&u.name==="图书馆活化石像")
      .sort((a,b)=>a.birth-b.birth)[0];
    if(statue){
      const dealt=damage(statue,amount);
      addLog(`「${statue.name}」替「${target.name}」承受了 ${dealt} 伤害。`,"b");
      if(statue.hp<=0)removeUnit(statue);
      return dealt;
    }
  }
  return damage(target,amount);
}

function effectivePaint(unit){
  const passive=unitPassiveBonuses(unit);
  const base=Math.max(0,unit.paint+unit.effectPaint+(passive.paint||0));
  return base*GameModifierSystem.multiplier(side(unit.owner),"paint");
}

function triggerFortificationEntry(unit,next){
  const nextCenter=GameBattlefieldAdapter.cellToWorld(next);
  const bodyRadius=unit.body?.radius||.35;
  const fort=B.units.filter(other=>!other.dead&&other.owner!==unit.owner&&hasTag(other,"工事"))
    .find(other=>GameContinuousGeometry.intersectsCircle(
      other.fortificationShape||GameContinuousGeometry.rect(GameBattlefieldAdapter.unitPosition(other),2,.8),
      nextCenter,bodyRadius+1
    ));
  if(!fort)return 0;
  const dealt=damage(unit,1);
  fort.hp-=1;
  addLog(`防御工事拦截「${unit.name}」，造成${dealt}伤害并使其移动力-2。`,"s");
  if(unit.hp<=0)removeUnit(unit);
  if(fort.hp<=0)removeUnit(fort);
  return 2;
}

function pushAway(u,origin,steps){
  if(u.eternal)return [u.cell];
  const traversed=[];
  for(let i=0;i<steps;i++){
    const opts=neighbors(u.cell).filter(c=>{
      if(u.height===1)return !c.ground&&!c.well;
      return !c.air;
    });
    opts.sort((a,b)=>hexDistance(b,origin)-hexDistance(a,origin)||a.c-b.c||a.r-b.r);
    if(!opts.length||hexDistance(opts[0],origin)<=hexDistance(u.cell,origin))break;
    moveUnit(u,opts[0],{paint:false,triggerStudy:false,updateFacing:false});
    traversed.push(u.cell);
  }
  return traversed.length?traversed:[u.cell];
}

function chargeForward(u,steps,collisionDamage,damageAmount=1){
  const direction=Number.isInteger(u.lastMoveDirection)?u.lastMoveDirection:(u.owner===1?0:3);
  for(let i=0;i<steps;i++){
    const dest=neighborInDirection(u.cell,direction);
    if(!dest)break;
    const blocker=u.height===1?dest.ground:dest.air;
    if(blocker||u.height===1&&dest.well){
      if(collisionDamage&&blocker&&blocker.owner!==u.owner){
        damage(blocker,damageAmount);
        if(blocker.hp<=0)removeUnit(blocker);
      }
      break;
    }
    moveUnit(u,dest);
  }
}

function cleanupDead(){
  B.units=B.units.filter(u=>!u.dead);
}

