"use strict";

/* =========================================================
   牌堆、墨水与书灵
========================================================= */

function side(owner){return owner===1?B.player:B.enemy}

function continuousShapeForCell(cell,radius=.5){
  return GameContinuousGeometry.circle(GameBattlefieldAdapter.cellToWorld(cell),radius);
}

function applyContinuousPaint(cell,owner,context={}){
  if(!B?.spatial?.paint||!cell)return null;
  if(context.skipContinuous)return null;
  if(context.unit){
    const paintValue=effectivePaint(context.unit);
    const baseBrush=GameBrushProfiles.forUnit(context.unit,paintValue);
    const widthBonus=Math.max(0,context.unit.landingExpansionU||0)*2;
    const brush=widthBonus?GameContinuousBrushes.define({...baseBrush,widthU:baseBrush.widthU+widthBonus}):baseBrush;
    const path=context.path?.length?context.path:[GameBattlefieldAdapter.cellToWorld(cell)];
    const applied=GameContinuousBrushes.apply(B.spatial.paint,brush,path,owner===1?1:-1,{
      facingAngle:context.facingAngle
    });
    return applied.result;
  }
  return B.spatial.paint.apply({
    shape:continuousShapeForCell(cell,.5),
    owner:owner===1?1:-1,
    kind:"paint",source:context.source||"unit",strength:1
  });
}

function neutralizeContinuous(cell,context={}){
  if(!B?.spatial?.paint||!cell)return null;
  return B.spatial.paint.apply({
    shape:continuousShapeForCell(cell,.52),owner:1,mode:"neutralize",
    kind:"effect",source:context.source||"card"
  });
}

function addContinuousRegion(type,cell,context={}){
  if(!B?.spatial?.regions||!cell)return null;
  return B.spatial.regions.add({
    type,shape:continuousShapeForCell(cell,.52),owner:context.owner??context.unit?.owner??0,
    permanent:context.permanent!==false,expiresAt:context.expiresAt??null
  });
}

const FINE_CONTINUOUS_RADIUS=Object.freeze({
  study:1.5,solidifier:1.5,recorder:1.5,wall:3,binding:.6,eternal:2.5,quiet:2.5,silence:2.5
});

const continuousShapeRasterCache=new WeakMap();

function ownerSign(owner){return owner===2||owner===-1?-1:owner===1?1:0}

function addContinuousShapeRegion(type,shape,context={}){
  if(!B?.spatial?.regions||!shape)return null;
  return B.spatial.regions.add({
    type,shape,owner:ownerSign(context.owner),id:context.id,
    permanent:context.permanent!==false,expiresAt:context.expiresAt??null,
    allowCrystal:context.allowCrystal===true
  });
}

function unitWorldCircle(unit){
  return {center:GameBattlefieldAdapter.unitPosition(unit),radius:unit.body?.radius||.35};
}

function continuousInkTouchesCircle(owner,center,radius=0){
  const paint=B?.spatial?.paint;
  if(!paint||!center)return false;
  const sign=ownerSign(owner);
  if(paint.touchesCircle)return paint.touchesCircle(center,radius,sign);
  const controlled=point=>paint.sample(point)*sign>0;
  if(controlled(center))return true;
  const rings=radius>0?[radius/2,radius]:[];
  return rings.some(distance=>Array.from({length:24},(_,index)=>index).some(index=>{
    const angle=index*Math.PI/12;
    return controlled({x:center.x+Math.cos(angle)*distance,y:center.y+Math.sin(angle)*distance});
  }));
}

function continuousInkTouchesUnit(owner,unit){
  if(!unit||unit.dead)return false;
  const body=unitWorldCircle(unit);
  return continuousInkTouchesCircle(owner,body.center,body.radius);
}

function continuousRegionTouchesCircle(type,center,radius=0,owner=null){
  if(!center||!B?.spatial?.regions)return false;
  const sign=owner==null?0:ownerSign(owner);
  const crystalBlocked=type!=="crystal"&&B.spatial.regions.list("crystal")
    .some(region=>GameContinuousGeometry.intersectsCircle(region.shape,center,radius));
  return B.spatial.regions.list(type)
    .filter(region=>!sign||region.owner===sign)
    .some(region=>(!crystalBlocked||region.allowCrystal)&&
      GameContinuousGeometry.intersectsCircle(region.shape,center,radius));
}

function continuousRegionTouchesUnit(type,unit,owner=type==="study"?unit?.owner:null){
  if(!unit||unit.dead)return false;
  const body=unitWorldCircle(unit);
  return continuousRegionTouchesCircle(type,body.center,body.radius,owner);
}

function continuousSpellBlockedUnit(unit){return continuousRegionTouchesUnit("spellBlock",unit,null)}

function continuousRegionAt(type,target){
  const point=GameSpatialEffectProfiles.centerOf(target);
  return !!point&&!!B?.spatial?.regions?.has(type,point);
}

function syncLegacyRegionFlags(type,shape){
  for(const cell of B.cells){
    if(!GameContinuousGeometry.containsPoint(shape,GameBattlefieldAdapter.cellToWorld(cell)))continue;
    if(type==="crystal"){
      cell.permanentCrystal=true;
      cell.crystal=true;
    }else if(type==="study"&&!cell.crystal){
      cell.permanentStudied=true;
      cell.studied=true;
    }
  }
}

function resyncLegacyRegionFlags(type,shape){
  const regions=B.spatial?.regions?.list(type)||[];
  for(const cell of B.cells){
    const point=GameBattlefieldAdapter.cellToWorld(cell);
    if(!GameContinuousGeometry.containsPoint(shape,point))continue;
    const active=regions.some(region=>GameContinuousGeometry.containsPoint(region.shape,point));
    if(type==="crystal")cell.permanentCrystal=cell.crystal=active;
    if(type==="study")cell.permanentStudied=cell.studied=active&&!cell.crystal;
  }
}

function rasterizeContinuousShape(shape){
  if(!shape||!B?.spatial?.paint)return null;
  const width=B.spatial.paint.width,height=B.spatial.paint.height;
  if(shape.kind==="rasterMask"&&shape.width===width&&shape.height===height)return shape;
  const cacheKey=`${width}x${height}`;
  let shapeCache=continuousShapeRasterCache.get(shape);
  if(shapeCache?.has(cacheKey))return shapeCache.get(cacheKey);
  if(!shapeCache){shapeCache=new Map();continuousShapeRasterCache.set(shape,shapeCache)}
  const bounds=GameContinuousGeometry.bounds(shape);
  const firstSample=(value,worldSize,samples)=>Math.max(0,Math.ceil(value/worldSize*samples-.5));
  const lastSample=(value,worldSize,samples)=>Math.min(samples-1,Math.floor(value/worldSize*samples-.5));
  const minColumn=firstSample(bounds.minX,GameWorldSpace.width,width);
  const maxColumn=lastSample(bounds.maxX,GameWorldSpace.width,width);
  const minRow=firstSample(bounds.minY,GameWorldSpace.height,height);
  const maxRow=lastSample(bounds.maxY,GameWorldSpace.height,height);
  if(maxColumn<minColumn||maxRow<minRow){shapeCache.set(cacheKey,null);return null}
  const rows=[];
  let firstColumn=width-1,lastColumn=0,firstRow=null,lastRow=null;
  for(let row=minRow;row<=maxRow;row++){
    const spans=[];
    if(shape.kind==="rect"){
      spans.push(minColumn,maxColumn);
    }else if(shape.kind==="circle"){
      const y=(row+.5)/height*GameWorldSpace.height;
      const halfWidth=Math.sqrt(Math.max(0,shape.radius**2-(y-shape.center.y)**2));
      const start=firstSample(shape.center.x-halfWidth,GameWorldSpace.width,width);
      const end=lastSample(shape.center.x+halfWidth,GameWorldSpace.width,width);
      if(start<=end)spans.push(start,end);
    }else{
      let start=null;
      for(let column=minColumn;column<=maxColumn;column++){
        const point={x:(column+.5)/width*GameWorldSpace.width,y:(row+.5)/height*GameWorldSpace.height};
        const included=GameContinuousGeometry.containsPoint(shape,point);
        if(included&&start==null)start=column;
        if((!included||column===maxColumn)&&start!=null){
          const end=included&&column===maxColumn?column:column-1;
          spans.push(start,end);start=null;
        }
      }
    }
    if(spans.length){
      firstColumn=Math.min(firstColumn,spans[0]);lastColumn=Math.max(lastColumn,spans.at(-1));
      firstRow??=row;lastRow=row;
    }
    rows.push(spans);
  }
  if(firstRow==null){shapeCache.set(cacheKey,null);return null}
  const mask=GameContinuousGeometry.rasterMask({
    width,height,minColumn:firstColumn,maxColumn:lastColumn,minRow:firstRow,maxRow:lastRow,
    rows:rows.slice(firstRow-minRow,lastRow-minRow+1)
  });
  shapeCache.set(cacheKey,mask);
  return mask;
}

function subtractContinuousShape(sourceShape,cutShape){
  const source=rasterizeContinuousShape(sourceShape);
  if(!source)return null;
  const rows=[];
  let firstColumn=source.width-1,lastColumn=0,firstRow=null,lastRow=null;
  for(let row=source.minRow;row<=source.maxRow;row++){
    const spans=[];
    let start=null;
    const sourceSpans=source.rows[row-source.minRow];
    for(let column=source.minColumn;column<=source.maxColumn;column++){
      let inSource=false;
      for(let index=0;index<sourceSpans.length;index+=2){
        if(column>=sourceSpans[index]&&column<=sourceSpans[index+1]){inSource=true;break}
      }
      const point={x:(column+.5)/source.width*GameWorldSpace.width,y:(row+.5)/source.height*GameWorldSpace.height};
      const included=inSource&&!GameContinuousGeometry.containsPoint(cutShape,point);
      if(included&&start==null)start=column;
      if((!included||column===source.maxColumn)&&start!=null){
        const end=included&&column===source.maxColumn?column:column-1;
        spans.push(start,end);firstColumn=Math.min(firstColumn,start);lastColumn=Math.max(lastColumn,end);
        firstRow??=row;lastRow=row;start=null;
      }
    }
    rows.push(spans);
  }
  if(firstRow==null)return null;
  return GameContinuousGeometry.rasterMask({
    width:source.width,height:source.height,minColumn:firstColumn,maxColumn:lastColumn,
    minRow:firstRow,maxRow:lastRow,rows:rows.slice(firstRow-source.minRow,lastRow-source.minRow+1)
  });
}

function crystallizeInkMask(mask,context={}){
  if(!mask||!B?.spatial?.paint||!B?.spatial?.regions)return null;
  const sign=ownerSign(context.owner);
  const region=addContinuousShapeRegion("crystal",mask,{...context,owner:sign});
  syncLegacyRegionFlags("crystal",mask);
  B.dirty=true;
  return region;
}

function crystallizeInkInCircle(target,radius,context={}){
  const center=GameSpatialEffectProfiles.centerOf(target);
  if(!center||!B?.spatial?.paint)return null;
  const boundary=GameContinuousGeometry.circle(center,radius);
  const signs=context.allOwners?[1,-1]:[ownerSign(context.owner)];
  const regions=signs.map(sign=>{
    const mask=B.spatial.paint.captureMask(boundary,{owner:sign,excludeCrystal:true});
    const id=context.allOwners&&context.id?`${context.id}-${sign}`:context.id;
    return crystallizeInkMask(mask,{...context,id,owner:sign});
  }).filter(Boolean);
  return regions.length===1?regions[0]:regions.length?regions:null;
}

function mergeRasterIntervals(intervals){
  const ordered=intervals.sort((left,right)=>left[0]-right[0]||left[1]-right[1]);
  const merged=[];
  for(const interval of ordered){
    const previous=merged.at(-1);
    if(previous&&interval[0]<=previous[1]+1)previous[1]=Math.max(previous[1],interval[1]);
    else merged.push(interval.slice());
  }
  return merged;
}

function unionRasterMasks(masks){
  const active=masks.filter(Boolean);
  if(!active.length)return null;
  const {width,height}=active[0];
  if(active.some(mask=>mask.width!==width||mask.height!==height))throw new Error("Raster mask dimensions must match.");
  const minRow=Math.min(...active.map(mask=>mask.minRow));
  const maxRow=Math.max(...active.map(mask=>mask.maxRow));
  let minColumn=width-1,maxColumn=0,hasContent=false;
  const rows=[];
  for(let row=minRow;row<=maxRow;row++){
    const intervals=[];
    for(const mask of active){
      if(row<mask.minRow||row>mask.maxRow)continue;
      const spans=mask.rows[row-mask.minRow];
      for(let index=0;index<spans.length;index+=2)intervals.push([spans[index],spans[index+1]]);
    }
    const merged=mergeRasterIntervals(intervals),flat=merged.flat();
    if(flat.length){hasContent=true;minColumn=Math.min(minColumn,flat[0]);maxColumn=Math.max(maxColumn,flat.at(-1))}
    rows.push(flat);
  }
  return hasContent?GameContinuousGeometry.rasterMask({width,height,minColumn,maxColumn,minRow,maxRow,rows}):null;
}

function subtractRasterMask(source,blocker){
  if(!source||!blocker)return source;
  const rows=[];
  let minColumn=source.width-1,maxColumn=0,firstRow=null,lastRow=null;
  for(let row=source.minRow;row<=source.maxRow;row++){
    const sourceSpans=source.rows[row-source.minRow];
    const blocked=row>=blocker.minRow&&row<=blocker.maxRow?blocker.rows[row-blocker.minRow]:[];
    const output=[];
    for(let index=0;index<sourceSpans.length;index+=2){
      let cursor=sourceSpans[index],end=sourceSpans[index+1];
      for(let blockIndex=0;blockIndex<blocked.length&&cursor<=end;blockIndex+=2){
        const blockStart=blocked[blockIndex],blockEnd=blocked[blockIndex+1];
        if(blockEnd<cursor)continue;
        if(blockStart>end)break;
        if(blockStart>cursor)output.push(cursor,Math.min(end,blockStart-1));
        cursor=Math.max(cursor,blockEnd+1);
      }
      if(cursor<=end)output.push(cursor,end);
    }
    if(output.length){
      firstRow??=row;lastRow=row;minColumn=Math.min(minColumn,output[0]);maxColumn=Math.max(maxColumn,output.at(-1));
    }
    rows.push(output);
  }
  if(firstRow==null)return null;
  return GameContinuousGeometry.rasterMask({
    width:source.width,height:source.height,minColumn,maxColumn,
    minRow:firstRow,maxRow:lastRow,rows:rows.slice(firstRow-source.minRow,lastRow-source.minRow+1)
  });
}

function permittedContinuousMask(shape,operation={}){
  const source=rasterizeContinuousShape(shape);
  const registry=B?.spatial?.regions;
  if(!source||!registry||operation.skipRegionChecks)return source;
  const candidates=registry.candidates?.(GameContinuousGeometry.bounds(shape))||registry.list();
  const blockers=candidates.filter(region=>
    region.type==="crystal"||
    ((operation.source==="card"||operation.source==="skill")&&region.type==="spellBlock")||
    (operation.kind==="paint"&&region.type==="purification"&&region.owner!==operation.owner)
  );
  if(!blockers.length)return source;
  return subtractRasterMask(source,unionRasterMasks(blockers.map(region=>rasterizeContinuousShape(region.shape))));
}

function crystallizeCompleteCircle(target,radius,context={}){
  const center=GameSpatialEffectProfiles.centerOf(target);
  if(!center)return null;
  const shape=GameContinuousGeometry.circle(center,radius);
  const region=addContinuousShapeRegion("crystal",shape,context);
  syncLegacyRegionFlags("crystal",shape);
  B.dirty=true;
  return region;
}

function markStudyCircle(target,radius,context={}){
  const center=GameSpatialEffectProfiles.centerOf(target);
  if(!center)return null;
  const shape=GameContinuousGeometry.circle(center,radius);
  const region=addContinuousShapeRegion("study",shape,context);
  syncLegacyRegionFlags("study",shape);
  B.dirty=true;
  return region;
}

function expandFriendlyCrystalInk(owner,distanceU){
  const sign=ownerSign(owner);
  const registry=B.spatial?.regions,paint=B.spatial?.paint;
  if(!registry||!paint)return 0;
  const crystals=registry.list("crystal");
  const crystalMasks=crystals.map(region=>({region,mask:rasterizeContinuousShape(region.shape)}));
  const source=unionRasterMasks(crystalMasks.filter(item=>item.region.owner===sign).map(item=>item.mask));
  if(!source)return 0;
  const expanded=GameContinuousGeometry.dilateRasterMask(source,distanceU);
  const spellMasks=registry.list("spellBlock").map(region=>rasterizeContinuousShape(region.shape));
  const blockers=unionRasterMasks([...crystalMasks.map(item=>item.mask),...spellMasks]);
  const paintable=subtractRasterMask(expanded,blockers);
  if(!paintable)return 0;
  const result=paint.apply({
    shape:paintable,owner:sign,kind:"effect",source:"card",strength:1,skipRegionChecks:true
  });
  if(result.changedSamples)B.dirty=true;
  return result.changedSamples;
}

function crystallizeAllFriendlyInkInHalf(owner,context={}){
  const sign=ownerSign(owner);
  const boundary=GameContinuousGeometry.rect({x:owner===1?15:45,y:15},30,30);
  const mask=B.spatial?.paint?.captureMask(boundary,{owner:sign});
  return crystallizeInkMask(mask,{...context,owner});
}

function paintContinuousArea(target,owner,targetArea,context={}){
  const center=GameSpatialEffectProfiles.centerOf(target);
  if(!center||!B?.spatial?.paint||!(targetArea>0))return null;
  const sign=ownerSign(owner);
  const envelopeRadius=context.radiusU||Math.sqrt(targetArea/Math.PI)*1.16;
  const strokeCount=Math.max(1,Math.ceil(targetArea/7));
  const angle=(context.angle??((context.seed||0)*2.399963229728653))%(Math.PI*2);
  const width=Math.max(.55,Math.min(envelopeRadius*1.1,targetArea/(strokeCount*Math.max(1,envelopeRadius*1.55))));
  const tangent={x:Math.cos(angle),y:Math.sin(angle)};
  const normal={x:-tangent.y,y:tangent.x};
  const span=Math.max(.25,envelopeRadius-width*.55);
  const profile=GameContinuousBrushes.define({
    id:`effect-${context.style||"round"}`,shape:context.style||"round",widthU:width,
    lengthRatio:1.08,widthRatio:.92,rotationMode:"normal",pressure:true,pressureMin:.35,spacingU:1/16
  });
  const total={changedSamples:0,ownAreaAdded:0,enemyAreaRemoved:0};
  for(let index=0;index<strokeCount;index++){
    const offset=(index-(strokeCount-1)/2)*Math.min(width*.7,envelopeRadius*1.45/strokeCount);
    const base={x:center.x+normal.x*offset,y:center.y+normal.y*offset};
    const from=GameWorldSpace.clampPoint({x:base.x-tangent.x*span,y:base.y-tangent.y*span},width/2);
    const to=GameWorldSpace.clampPoint({x:base.x+tangent.x*span,y:base.y+tangent.y*span},width/2);
    const operations=GameContinuousBrushes.operations(profile,[from,to],sign,{facingAngle:angle});
    operations.forEach(operation=>{
      const result=B.spatial.paint.apply({...operation,source:context.source||"unit"});
      total.changedSamples+=result.changedSamples;
      total.ownAreaAdded+=result.ownAreaAdded;
      total.enemyAreaRemoved+=result.enemyAreaRemoved;
    });
  }
  if(total.changedSamples)B.dirty=true;
  return Object.freeze(total);
}

function continuousShapeArea(shape){
  if(shape.kind==="circle")return Math.PI*shape.radius*shape.radius;
  if(shape.kind==="rect")return shape.width*shape.height;
  if(shape.kind==="rasterMask"){
    let samples=0;
    shape.rows.forEach(row=>{for(let index=0;index<row.length;index+=2)samples+=row[index+1]-row[index]+1});
    return samples*GameWorldSpace.width*GameWorldSpace.height/(shape.width*shape.height);
  }
  if(shape.kind==="pathStroke")return GameWorldSpace.pathLength(shape.points)*shape.radius*2+Math.PI*shape.radius*shape.radius;
  const bounds=GameContinuousGeometry.bounds(shape);
  return (bounds.maxX-bounds.minX)*(bounds.maxY-bounds.minY);
}

const continuousRegionAreaCache=new WeakMap();

function continuousRegionArea(type,owner){
  const sign=ownerSign(owner);
  const registry=B.spatial?.regions;
  if(!registry)return 0;
  let cache=continuousRegionAreaCache.get(registry);
  if(!cache){cache=new Map();continuousRegionAreaCache.set(registry,cache)}
  const revision=registry.version(type);
  const key=`${type}:${sign}:${revision}`;
  if(cache.has(key))return cache.get(key);
  const regions=registry.list(type).filter(region=>!sign||region.owner===sign);
  if(!regions.length){cache.set(key,0);return 0}
  const samplesPerU=8;
  const boxes=regions.map(region=>GameContinuousGeometry.bounds(region.shape));
  const minX=Math.max(0,Math.min(...boxes.map(box=>box.minX)));
  const maxX=Math.min(GameWorldSpace.width,Math.max(...boxes.map(box=>box.maxX)));
  const minY=Math.max(0,Math.min(...boxes.map(box=>box.minY)));
  const maxY=Math.min(GameWorldSpace.height,Math.max(...boxes.map(box=>box.maxY)));
  const firstColumn=Math.max(0,Math.floor(minX*samplesPerU));
  const lastColumn=Math.min(GameWorldSpace.width*samplesPerU-1,Math.ceil(maxX*samplesPerU)-1);
  const firstRow=Math.max(0,Math.floor(minY*samplesPerU));
  const lastRow=Math.min(GameWorldSpace.height*samplesPerU-1,Math.ceil(maxY*samplesPerU)-1);
  let samples=0;
  for(let row=firstRow;row<=lastRow;row++){
    const y=(row+.5)/samplesPerU;
    for(let column=firstColumn;column<=lastColumn;column++){
      const point={x:(column+.5)/samplesPerU,y};
      if(!regions.some(region=>GameContinuousGeometry.containsPoint(region.shape,point)))continue;
      samples++;
    }
  }
  const area=samples/(samplesPerU*samplesPerU);
  cache.set(key,area);
  return area;
}

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
  distance(a,b){
    if(typeof GameBattlefieldAdapter!=="undefined"){
      const from=GameSpatialEffectProfiles.centerOf(a),to=GameSpatialEffectProfiles.centerOf(b);
      if(from&&to)return GameWorldSpace.distance(from,to);
    }
    return hexDistance(a,b);
  },
  worldPoint(target){return GameSpatialEffectProfiles.centerOf(target)},
  spatialProfile(name){return GameSpatialEffectProfiles.get(name)},
  spatialShape(name,target){return GameSpatialEffectProfiles.geometry(name,target)},
  applySpatialEffect(name,target,operation={}){
    const shape=GameSpatialEffectProfiles.geometry(name,target);
    if(!shape||!B.spatial?.paint)return null;
    const paintOperation={owner:operation.owner===2?-1:1,...operation};
    const permittedMask=permittedContinuousMask(shape,paintOperation);
    if(!permittedMask)return Object.freeze({changedSamples:0,ownAreaAdded:0,enemyAreaRemoved:0});
    return B.spatial.paint.apply({...paintOperation,shape:permittedMask,skipRegionChecks:true});
  },
  paintArea(target,owner,area,context={}){return paintContinuousArea(target,owner,area,context)},
  protectShape(shape,unit){
    return addContinuousShapeRegion("purification",shape,{owner:unit.owner,permanent:false,expiresAt:B.global+2});
  },
  bodiesAdjacent(first,second,padding=.25){
    if(!first||!second)return false;
    const a=unitWorldCircle(first),b=unitWorldCircle(second);
    return GameWorldSpace.distance(a.center,b.center)-a.radius-b.radius<=padding;
  },
  unitsTouchingShape(shape,owner=null){
    return B.units.filter(unit=>!unit.dead&&(owner==null||unit.owner===owner)).filter(unit=>{
      const body=unitWorldCircle(unit);
      return GameContinuousGeometry.intersectsCircle(shape,body.center,body.radius);
    });
  },
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
    const changed=MapRules.tryCellEffect(cell,"purified",current=>{
      current.purified={owner:unit.owner,unitId:unit.id,until:B.global+2};
    },{source:"unit",unit});
    if(changed)addContinuousRegion("purification",cell,{owner:unit.owner,permanent:false,expiresAt:B.global+2});
    return changed;
  },
  neutralize(cell,context={source:"card"}){
    const changed=MapRules.tryCellEffect(cell,"neutralize",current=>{
      current.owner=0;
      current.studied=false;
      current.permanentStudied=false;
    },context);
    if(changed){neutralizeContinuous(cell,context);B.dirty=true}
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
    let best=null,bestEdgeDistance=Infinity,bestTravelDistance=Infinity;
    for(const cell of B.cells){
      const free=unit.height===1?!cell.ground&&!cell.well:!cell.air;
      if(!free||!(unit.owner===1?cell.c<30:cell.c>=30))continue;
      const edgeDistance=Math.abs(cell.c-targetColumn),travelDistance=hexDistance(cell,unit.cell);
      if(edgeDistance>bestEdgeDistance||(edgeDistance===bestEdgeDistance&&travelDistance>=bestTravelDistance))continue;
      best=cell;bestEdgeDistance=edgeDistance;bestTravelDistance=travelDistance;
    }
    if(best)moveUnit(unit,best,{paint:false,triggerStudy:false,updateFacing:false,teleport:true});
  },
  canPlaceFortification(owner,cell){return canPlaceFortification(owner,cell)},
  createFortification(owner,cell){return createFortification(owner,cell)},
  findFortificationTargetNear(owner,target){
    const center=GameSpatialEffectProfiles.centerOf(target);
    return B.cells.filter(cell=>cell!==target&&canPlaceFortification(owner,cell))
      .sort((a,b)=>GameWorldSpace.distance(center,GameBattlefieldAdapter.cellToWorld(a))-
        GameWorldSpace.distance(center,GameBattlefieldAdapter.cellToWorld(b))||a.r-b.r||a.c-b.c)[0]||null;
  },
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
  if(!cell||cell.ground||cell.well||!opt.initial&&!legalSummonCell(owner,cell))return null;
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
  if(name==="侦查隼·B型"&&continuousInkTouchesUnit(owner,u))makeFlying(u,2);
  if(name==="冲锋白雀"&&!opt.initial)chargeForward(u,4,false);

  invokeUnitEffect(u,"summon",{sourceInstance:opt.sourceInstance});
  if(typeof playUnitAnimation==="function")playUnitAnimation(u,"spawn",520/B.speed);

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
  if(death&&typeof playUnitAnimation==="function"){
    u._retainSpineUntil=performance.now()+620/B.speed;
    playUnitAnimation(u,"death",620/B.speed);
  }
  if(u.name==="真理之墙")removeWallAura(u);
  u.dead=true;
  if(u.height===1&&u.cell.ground===u)u.cell.ground=null;
  if(u.height===2&&u.cell.air===u)u.cell.air=null;
  (u.footprint||[]).forEach(cell=>{if(cell.ground===u)cell.ground=null});

  if(death&&u.name==="奥术记录仪"){
    crystallizeInkInCircle(u,FINE_CONTINUOUS_RADIUS.recorder,{allOwners:true,source:"death"});
  }
  if(death)invokeAllUnitEffects(u.owner,"unitDestroyed",{destroyed:u,event:{}});
  addLog(`「${u.name}」${death?"被摧毁":"退场"}。`,"s");
}

function unitAt(cell,preferGround=true){
  return preferGround?(cell.ground||cell.air):(cell.air||cell.ground);
}

function legalSummonCell(owner,cell){
  if(!cell||cell.ground||cell.well)return false;
  if(continuousRegionAt("spellBlock",cell))return false;
  const center=GameBattlefieldAdapter.cellToWorld(cell);
  return owner===1?center.x<GameWorldSpace.width/2:center.x>=GameWorldSpace.width/2;
}

function continuousFriendlyBoundary(owner,target){
  const point=GameSpatialEffectProfiles.centerOf(target);
  const paint=B.spatial?.paint,sign=ownerSign(owner);
  if(!point||!paint||paint.sample(point)*sign<.5)return false;
  return Array.from({length:16},(_,index)=>index).some(index=>{
    const angle=index*Math.PI/8;
    return paint.sample(GameWorldSpace.clampPoint({
      x:point.x+Math.cos(angle)*.8,y:point.y+Math.sin(angle)*.8
    }))*sign<.5;
  });
}

function fortificationPair(owner,cell){
  if(!cell||!continuousFriendlyBoundary(owner,cell)||cell.ground||cell.well)return null;
  const center=GameBattlefieldAdapter.cellToWorld(cell);
  const second=B.cells.filter(next=>next!==cell&&!next.ground&&!next.well&&continuousFriendlyBoundary(owner,next))
    .map(next=>({next,distance:GameWorldSpace.distance(center,GameBattlefieldAdapter.cellToWorld(next))}))
    .filter(entry=>entry.distance>=.65&&entry.distance<=1.35)
    .sort((a,b)=>a.distance-b.distance||a.next.r-b.next.r||a.next.c-b.next.c)[0]?.next;
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
  unit.body={kind:"rect",width:2,height:.8,radius:1};
  unit.fortificationShape=GameContinuousGeometry.brushStamp(
    GameBattlefieldAdapter.cellToWorld(footprint[0]),"page",2,.8,0
  );
  footprint.forEach(part=>part.ground=unit);
  return unit;
}

function crystallize(cell,context={}){
  if(!cell||cell.crystal)return false;
  const changed=MapRules.tryCellEffect(cell,"crystallize",current=>{
    current.permanentCrystal=true;
    current.crystal=true;
    B.dirty=true;
  },context);
  if(changed)addContinuousRegion("crystal",cell,{...context,owner:cell.owner===1?1:cell.owner===2?-1:0});
  return changed;
}

function applyWallAura(u){
  const center=GameBattlefieldAdapter.unitPosition(u);
  if(u.wallAuraCenter)return;
  u.wallAuraCenter=center;
  markStudyCircle(center,FINE_CONTINUOUS_RADIUS.wall,{
    source:"aura",owner:u.owner,id:`wall-study-${u.id}`,permanent:false,allowCrystal:true
  });
  crystallizeCompleteCircle(center,FINE_CONTINUOUS_RADIUS.wall,{
    source:"aura",owner:u.owner,id:`wall-crystal-${u.id}`,permanent:false
  });
}

function removeWallAura(u){
  if(!u.wallAuraCenter||!B.spatial?.regions?.remove)return;
  const shape=GameContinuousGeometry.circle(u.wallAuraCenter,FINE_CONTINUOUS_RADIUS.wall);
  B.spatial.regions.remove(`wall-study-${u.id}`);
  const affected=B.spatial.regions.list("crystal").filter(region=>
    GameContinuousGeometry.intersectsCircle(region.shape,u.wallAuraCenter,FINE_CONTINUOUS_RADIUS.wall)
  );
  affected.forEach(region=>{
    B.spatial.regions.remove(region.id);
    if(region.id===`wall-crystal-${u.id}`)return;
    const remainder=subtractContinuousShape(region.shape,shape);
    if(remainder)addContinuousShapeRegion("crystal",remainder,{
      ...region,id:`${region.id}-outside-${u.id}`,owner:region.owner
    });
  });
  resyncLegacyRegionFlags("study",shape);
  resyncLegacyRegionFlags("crystal",shape);
  u.wallAuraCenter=null;
  B.dirty=true;
}

function markStudied(cell,context={source:"skill"}){
  if(!cell)return false;
  const changed=MapRules.tryCellEffect(cell,"studied",current=>{
    current.permanentStudied=true;
    current.studied=true;
  },context);
  if(changed)addContinuousRegion("study",cell,{...context,owner:cell.owner===1?1:-1});
  return changed;
}

function refreshWallAura(u,move){
  return move();
}

function makeFlying(u,duration=2){
  if(u.dead||u.height===2||u.cell.air)return false;
  u.cell.ground=null;
  u.height=2;u.cell.air=u;
  u.flying=Math.max(u.flying,duration);
  addLog(`「${u.name}」进入飞行。`,"s");
  if(typeof playUnitAnimation==="function")playUnitAnimation(u,"takeoff",420/B.speed);

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
  if(typeof playUnitAnimation==="function")playUnitAnimation(u,"land",420/B.speed);
  triggerLanding(u);
  return true;
}

function triggerLanding(u){
  if(u.name==="冲锋白雀")chargeForward(u,8,true,2);
  if(u.name==="护卫大天鹅"){
    const radius=2+(u.landingExpansionU||0);
    const center=GameBattlefieldAdapter.unitPosition(u);
    const shape=GameContinuousGeometry.circle(center,radius);
    B.spatial.paint.apply({shape,owner:ownerSign(u.owner),mode:"neutralize",kind:"effect",source:"unit"});
    B.units.filter(x=>!x.dead&&x.owner!==u.owner).filter(x=>{
      const body=unitWorldCircle(x);
      return GameContinuousGeometry.intersectsCircle(shape,body.center,body.radius);
    }).forEach(x=>{
      const before=GameBattlefieldAdapter.unitPosition(x);
      const traversed=pushAway(x,u.cell,3);
      const path=[before,...traversed.map(GameBattlefieldAdapter.cellToWorld)];
      B.spatial.paint.apply({
        shape:GameContinuousGeometry.pathStroke(path,x.body?.radius||.35),owner:ownerSign(u.owner),
        mode:"neutralize",kind:"effect",source:"unit"
      });
    });
    B.dirty=true;
  }
  if(u.name==="幻影孔雀"){
    const baseRadius=Math.sqrt(1/Math.PI),radius=baseRadius+(u.landingExpansionU||0);
    paintContinuousArea(u,u.owner,Math.PI*radius*radius,{radiusU:radius,style:"feather",seed:u.id+B.global});
  }
}

function randomNeighbor(c){
  const n=neighbors(c);return n[Math.floor(B.rng()*n.length)]||c;
}

