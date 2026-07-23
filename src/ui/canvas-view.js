"use strict";

/* =========================================================
   Canvas 地图、拾取、缩放与拖动
========================================================= */

const canvas=document.getElementById("battleCanvas");
const ctx=canvas.getContext("2d");
const spineCanvas=document.getElementById("spineCanvas");
const overlayCanvas=document.getElementById("overlayCanvas");
const unitHoverCard=document.getElementById("unitHoverCard");
const fieldCoordinates=document.getElementById("fieldCoordinates");
const continuousCamera=GameContinuousCamera.create({
  width:1,height:1,padding:18,
  fitWidthScale:GameContinuousTerrainRenderer.backgroundWidthScale,
  fitHeightScale:GameContinuousTerrainRenderer.backgroundHeightScale
});
let continuousStage=null;
let terrainRenderer=null;
let overlayRenderer=null;
let spineStage=null;
let battlefieldFrame=0;
let previousBattlefieldFrame=performance.now();
let previousOverlayFrame=0;
let unitHoverState={id:null,signature:""};
const HEX=9;
const HEX_W=Math.sqrt(3)*HEX;
const ROW_H=1.5*HEX;

function setupCanvas(){
  if(!continuousStage){
    continuousStage=GameContinuousBattlefieldStage.create({
      container:document.getElementById("fieldWrap"),camera:continuousCamera,
      canvases:{terrain:canvas,spine:spineCanvas,overlay:overlayCanvas},fit:false
    });
    terrainRenderer=GameContinuousTerrainRenderer.create({
      context:continuousStage.getLayer("terrain").context,camera:continuousCamera,
      onInvalidate:()=>{
        if(!B)return;
        B.dirty=true;
        requestAnimationFrame(()=>drawBattle());
      }
    });
    overlayRenderer=GameContinuousOverlayRenderer.create({context:continuousStage.getLayer("overlay").context,camera:continuousCamera});
    spineStage=GameContinuousSpineStage.create({canvas:spineCanvas,gl:continuousStage.getLayer("spine").context,camera:continuousCamera});
    window.GameProductionBattlefield=Object.freeze({camera:continuousCamera,stage:continuousStage,terrainRenderer,spineStage});
    setupIntentHoverCards();
  }
  resizeCanvas();
  window.addEventListener("resize",resizeCanvas);
  overlayCanvas.onwheel=e=>{
    e.preventDefault();
    const rect=overlayCanvas.getBoundingClientRect();
    continuousCamera.zoomAt({x:e.clientX-rect.left,y:e.clientY-rect.top},e.deltaY<0?1.12:.89);
    drawBattle();
  };
  overlayCanvas.onmousedown=e=>{
    hideUnitHoverCard();
    if(e.button===1||e.button===0&&!B.selected){
      drag.active=true;drag.x=e.clientX;drag.y=e.clientY;
    }
  };
  window.onmouseup=e=>{
    if(drag.active){drag.active=false;return}
  };
  overlayCanvas.onmousemove=e=>{
    updateFieldCoordinates(e);
    if(drag.active){
      hideUnitHoverCard();
      continuousCamera.pan(e.clientX-drag.x,e.clientY-drag.y);
      drag.x=e.clientX;drag.y=e.clientY;
      drawBattle();
      return;
    }
    const skill=roleDef(B?.player?.role)?.skill;
    const areaCard=(B?.selected?.kind==="card"||B?.selected?.kind==="archiveTarget")
      ?GameSpatialEffectProfiles.get(B.selected.def.name):null;
    if(B?.selected?.kind==="skill"&&skill?.id==="closeReading"||areaCard?.shape==="circle"){
      const rect=overlayCanvas.getBoundingClientRect();
      const center=continuousCamera.screenToWorld({x:e.clientX-rect.left,y:e.clientY-rect.top});
      const radiusU=areaCard?.radiusU??FINE_CONTINUOUS_RADIUS.study;
      const valid=areaCard?validateTarget(B.selected.def,1,center):canUseCloseReadingAt(center,B.player);
      B._targetPreview={kind:"circle",center,radiusU,valid};
    }else if(B?._targetPreview)B._targetPreview=null;
    updateUnitHoverCard(e);
  };
  overlayCanvas.onmouseleave=()=>{
    if(B?._targetPreview)B._targetPreview=null;
    if(fieldCoordinates)fieldCoordinates.hidden=true;
    hideUnitHoverCard();
  };
  overlayCanvas.onclick=canvasClick;
  window.onkeydown=e=>{
    if(e.code==="Space"){e.preventDefault();centerCamera()}
    if(e.key==="Escape"){
      if(document.getElementById("modal").classList.contains("open")&&modalAction)cancelSpecialCard();
      else if(document.getElementById("modal").classList.contains("open"))closeModal();
      else if(B?.selected?.kind==="archiveTarget"||B?.selected?.kind==="skill")cancelArchiveSelection();
      else if(B&&!B.ended)pauseMenu();
    }
    if("12345".includes(e.key)&&B?.current===1){
      const i=+e.key-1;
      if(B.player.hand[i])selectCard(B.player.hand[i].id);
    }
  };
  if(!battlefieldFrame)battlefieldFrame=requestAnimationFrame(renderBattlefieldFrame);
}

function updateFieldCoordinates(event){
  if(!fieldCoordinates||!overlayCanvas||!event)return;
  const rect=overlayCanvas.getBoundingClientRect();
  const world=continuousCamera.screenToWorld({x:event.clientX-rect.left,y:event.clientY-rect.top});
  if(world.x<0||world.x>GameWorldSpace.width||world.y<0||world.y>GameWorldSpace.height){
    fieldCoordinates.hidden=true;
    return;
  }
  const x=Math.round(world.x*10)/10;
  const y=Math.round(world.y*10)/10;
  fieldCoordinates.textContent=`坐标 ${x.toFixed(1)}U, ${y.toFixed(1)}U`;
  fieldCoordinates.hidden=false;
}

function formatUnitCardStat(value){
  const number=Number(value)||0;
  return Number.isInteger(number)?String(number):number.toFixed(1).replace(/\.0$/,"");
}

function unitCardStatHtml(label,current,base){
  const normalizedCurrent=Math.round((Number(current)||0)*10)/10;
  const normalizedBase=Math.round((Number(base)||0)*10)/10;
  const delta=Math.round((normalizedCurrent-normalizedBase)*10)/10;
  const change=Math.abs(delta)<.05?"":` <span class="unit-stat-delta ${delta>0?"positive":"negative"}">(${delta>0?"+":""}${formatUnitCardStat(delta)})</span>`;
  return `<span class="card-stat"><b>${label}</b> ${formatUnitCardStat(normalizedCurrent)}${change}</span>`;
}

function unitVisualHoverPoint(unit){
  const position=GameBattlefieldAdapter.unitPosition(unit);
  if(!position||!continuousCamera)return position;
  const screen=continuousCamera.worldToScreen(position);
  const localScale=continuousCamera.scaleAt(position);
  const spineOffset=(typeof GameContinuousSpineStage!=="undefined"?
    GameContinuousSpineStage.visualOffsetYU:1)+(unit.height===2?.7:0);
  return continuousCamera.screenToWorld({x:screen.x,y:screen.y-spineOffset*localScale});
}

function unitHoverDefinition(unit){
  const existing=defForUnit(unit);
  if(existing)return existing;
  const base=unitBaseStats(unit);
  const profile=GameSpiritVisualProfiles.get(GameBattlefieldAdapter.visualProfileId(unit));
  const role=side(unit.owner)?.role||B?.player?.role||"sina";
  return {
    role,name:unit.name,cost:0,
    type:hasTag(unit,"工事")?"防御工事":"初始书灵",
    text:hasTag(unit,"工事")?"部署在墨迹边缘的战场工事。":"随法师进入战场的初始书灵。",
    stats:base,keywords:[],
    art:profile?{image:`${profile.assetRoot}/${profile.previewFile}`,position:"center"}:null
  };
}

function unitHoverFooter(unit){
  const base=unitBaseStats(unit),current=currentUnitStats(unit);
  return [
    unitCardStatHtml("攻",current.attack,base.attack),
    unitCardStatHtml("耐",current.hp,base.hp),
    unitCardStatHtml("移",current.move,base.move),
    unitCardStatHtml("涂",current.paint,base.paint)
  ].join("");
}

function unitAtHoverPoint(screenPoint){
  if(!B)return null;
  const worldPoint=continuousCamera.screenToWorld(screenPoint);
  let match=null,best=Infinity;
  for(const unit of B.units){
    if(unit.dead)continue;
    const position=GameBattlefieldAdapter.unitPosition(unit);
    const visualPosition=unitVisualHoverPoint(unit);
    const bodyDistance=GameWorldSpace.distance(position,worldPoint);
    const visualDistance=visualPosition?GameWorldSpace.distance(visualPosition,worldPoint):Infinity;
    const profile=typeof GameSpiritVisualProfiles!=="undefined"
      ?GameSpiritVisualProfiles.get?.(GameBattlefieldAdapter.visualProfileId(unit)):null;
    const hitRadius=Math.max(.92,(unit.body?.radius??.62)+.3,
      .65+(profile?.battleScale??1)*.24);
    if(bodyDistance>hitRadius&&visualDistance>hitRadius)continue;
    const distance=Math.min(bodyDistance,visualDistance);
    const score=distance-(unit.height===2?.05:0);
    if(score<best){match=unit;best=score}
  }
  return match;
}

function wellAtHoverPoint(screenPoint){
  if(!B)return null;
  const worldPoint=continuousCamera.screenToWorld(screenPoint);
  let match=null,best=Infinity;
  for(const well of B.wells){
    const distance=GameWorldSpace.distance(GameBattlefieldAdapter.cellToWorld(well.cell),worldPoint);
    const hitRadius=1.08;
    if(distance<=hitRadius&&distance<best){match=well;best=distance}
  }
  return match;
}

function summonIntentAtHoverPoint(screenPoint){
  if(!B)return null;
  const worldPoint=continuousCamera.screenToWorld(screenPoint);
  return GameContinuousOverlayRenderer.summonIntentAtPoint(B,worldPoint);
}

function wellHoverDefinition(){
  return {
    role:"neutral",name:"墨井",cost:0,type:"战场设施",
    text:"周围占领环达到 66% 己方墨迹后开始占领，连续两次结算满足即可归属该阵营。敌方达到 66% 时，已占领墨井先转为中立。每口己方墨井在己方回合开始提供 1 墨水。",
    stats:null,keywords:["区域控制"],art:{image:"images/ink_well_card_art.png",position:"center"}
  };
}

function positionUnitHoverCard(event){
  const gap=14,margin=8;
  const width=unitHoverCard.offsetWidth,height=unitHoverCard.offsetHeight;
  const rightSpace=innerWidth-event.clientX-gap,leftSpace=event.clientX-gap;
  const bottomSpace=innerHeight-event.clientY-gap,topSpace=event.clientY-gap;
  const placeRight=rightSpace>=width||rightSpace>=leftSpace;
  const placeBelow=bottomSpace>=height||bottomSpace>=topSpace;
  const left=placeRight?event.clientX+gap:event.clientX-width-gap;
  const top=placeBelow?event.clientY+gap:event.clientY-height-gap;
  unitHoverCard.style.left=`${Math.max(margin,Math.min(innerWidth-width-margin,left))}px`;
  unitHoverCard.style.top=`${Math.max(margin,Math.min(innerHeight-height-margin,top))}px`;
}

function intentDefinition(intent){
  return intent?.name?CARD_MAP.get(intent.name)||null:null;
}

function showIntentHoverCard(intent,event,source="intent"){
  if(!unitHoverCard||!B||B.selected||B.ended||!intent){hideUnitHoverCard();return false}
  const definition=intentDefinition(intent);
  if(!definition){hideUnitHoverCard();return false}
  const id=`intent-${intent.instanceId??intent.name}`;
  const signature=["intent",intent.instanceId,intent.name,intent.targetHint,intent.meaningful].join(":");
  if(unitHoverState.id!==id||unitHoverState.signature!==signature){
    unitHoverCard.innerHTML=cardVisual(definition,{className:"unit-hover-game-card intent-hover-game-card"});
    unitHoverCard.dataset.intentId=String(intent.instanceId??intent.name);
    unitHoverCard.dataset.intentSource=source;
    unitHoverCard.removeAttribute("data-unit-id");
    unitHoverCard.removeAttribute("data-well-id");
    unitHoverState={id,signature};
  }else unitHoverCard.dataset.intentSource=source;
  unitHoverCard.hidden=false;
  positionUnitHoverCard(event);
  return true;
}

function setupIntentHoverCards(){
  const row=document.getElementById("intentRow");
  if(!row||row.dataset.hoverCardsReady)return;
  row.dataset.hoverCardsReady="true";
  row.addEventListener("mousemove",event=>{
    const element=event.target.closest?.(".intent[data-intent-index]");
    if(!element||!row.contains(element)){hideUnitHoverCard();return}
    const intent=B?.intents?.[Number(element.dataset.intentIndex)];
    showIntentHoverCard(intent,event,"hud");
  });
  row.addEventListener("mouseleave",()=>{
    if(unitHoverCard?.dataset.intentSource==="hud")hideUnitHoverCard();
  });
}

function hideUnitHoverCard(){
  if(!unitHoverCard)return;
  unitHoverCard.hidden=true;
  unitHoverCard.removeAttribute("data-unit-id");
  unitHoverCard.removeAttribute("data-well-id");
  unitHoverCard.removeAttribute("data-intent-id");
  unitHoverCard.removeAttribute("data-intent-source");
  unitHoverState={id:null,signature:""};
}

function updateUnitHoverCard(event){
  if(!unitHoverCard||!B||B.selected||B.ended){hideUnitHoverCard();return}
  const rect=overlayCanvas.getBoundingClientRect();
  const screenPoint={x:event.clientX-rect.left,y:event.clientY-rect.top};
  const unit=unitAtHoverPoint(screenPoint);
  if(unit){
    const base=unitBaseStats(unit),current=currentUnitStats(unit);
    const signature=["unit",current.attack,current.hp,current.maxHp,current.move,current.paint,base.attack,base.hp,base.move,base.paint].join(":");
    if(unitHoverState.id!==unit.id||unitHoverState.signature!==signature){
      const definition=unitHoverDefinition(unit);
      unitHoverCard.innerHTML=cardVisual(definition,{className:"unit-hover-game-card",footerHtml:unitHoverFooter(unit)});
      unitHoverCard.dataset.unitId=unit.id;
      unitHoverCard.removeAttribute("data-well-id");
      unitHoverCard.removeAttribute("data-intent-id");
      unitHoverCard.removeAttribute("data-intent-source");
      unitHoverState={id:unit.id,signature};
    }
  }else{
    const well=wellAtHoverPoint(screenPoint);
    if(well){
      const signature=`well:${well.owner}:${well.pending}`;
      if(unitHoverState.id!==`well-${well.id}`||unitHoverState.signature!==signature){
        unitHoverCard.innerHTML=cardVisual(wellHoverDefinition(),{
          className:"unit-hover-game-card well-hover-game-card",
          footerHtml:'<span class="card-keyword">区域控制</span>',costHtml:"井",
          roleLabel:well.owner===1?"玩家控制":well.owner===2?"敌人控制":"中立"
        });
        unitHoverCard.dataset.wellId=well.id;
        unitHoverCard.removeAttribute("data-unit-id");
        unitHoverCard.removeAttribute("data-intent-id");
        unitHoverCard.removeAttribute("data-intent-source");
        unitHoverState={id:`well-${well.id}`,signature};
      }
    }else{
      const intent=summonIntentAtHoverPoint(screenPoint);
      if(!intent){hideUnitHoverCard();return}
      showIntentHoverCard(intent,event,"battlefield");
      return;
    }
  }
  unitHoverCard.hidden=false;
  positionUnitHoverCard(event);
}

function resizeCanvas(){
  if(!continuousStage)return;
  const rect=document.getElementById("fieldWrap").getBoundingClientRect();
  continuousStage.resize(rect.width,rect.height,{pixelRatio:devicePixelRatio});
  drawBattle();
}

function centerCamera(){
  if(!B)return;
  continuousCamera.fit();
  drawBattle();
}

function worldPos(c){
  const axial=offsetToAxial(c);
  return {
    x:(axial.q+axial.r/2+0.5)*HEX_W,
    y:c.r*ROW_H+HEX
  };
}

function screenPos(c){
  return continuousCamera.worldToScreen(GameBattlefieldAdapter.cellToWorld(c));
}

function nearestCellAtScreen(x,y){
  return GameBattlefieldAdapter.worldToCell(continuousCamera.screenToWorld({x,y}),B.cells);
}

function canvasClick(e){
  if(drag.active||B.busy||B.current!==1)return;
  const rect=overlayCanvas.getBoundingClientRect();
  const screenPoint={x:e.clientX-rect.left,y:e.clientY-rect.top};
  const worldPoint=continuousCamera.screenToWorld(screenPoint);
  const c=nearestCellAtScreen(screenPoint.x,screenPoint.y);
  const selectedSkill=roleDef(B.player.role)?.skill;
  const continuousSkill=B.selected?.kind==="skill"&&selectedSkill?.id==="closeReading";
  const selectedProfile=B.selected?.def&&GameSpatialEffectProfiles.get(B.selected.def.name);
  const continuousCard=(B.selected?.kind==="card"||B.selected?.kind==="archiveTarget")&&selectedProfile?.target==="point";
  if(!c&&!continuousSkill&&!continuousCard)return;

  if(B.selected?.kind==="archiveTarget"){
    const d=B.selected.def;
    const target=d.target==="cell"&&selectedProfile?.target==="point"?worldPoint:
      d.target==="cell"||d.target==="summon"?c:unitAt(c);
    commitArchiveSelection(target);
  }else if(B.selected?.kind==="card"){
    const d=B.selected.def;
    const profile=GameSpatialEffectProfiles.get(d.name);
    const target=d.target==="cell"&&profile?.target==="point"?worldPoint:
      d.target==="cell"||d.target==="summon"?c:unitAt(c);
    playSelectedCard(target);
  }else if(B.selected?.kind==="skill"){
    const skill=roleDef(B.player.role)?.skill;
    if(skill?.target!=="hand")executeSkill(skill?.id==="closeReading"?worldPoint:skill?.target==="cell"?c:unitAt(c));
  }else if(B.selected?.kind==="dive"){
    finishDive(c);
  }else if(B.selected?.kind==="swap"){
    finishSwap(unitAt(c));
  }else{
    const u=unitAt(c);
    const statuses=u?[u.rooted||u.skipMoveOnce?"禁行":"",u.silencedOnce?"沉默":"",
      u.halfDamage?"伤害减半":"",u.eternal?"永恒结晶":"",
      GameStatusSystem.has(u,"20735.cooling")?"冷却":""].filter(Boolean):[];
    document.getElementById("selectionInfo").innerHTML=u
      ?unitDetailHtml(u,statuses)
      :`格子 ${c.r},${c.c}<br>归属：${ownerName(c.owner)}<br>${c.crystal?"结晶化 · 不受任何地块效果影响<br>":""}${c.studied?"精研 ":""}${c.spellBlocked?"噤声":""}`;
  }
}

function statDetail(label,base,current,enhanced){
  return enhanced
    ?`${label} ${base} → <span class="enhanced-stat">${current}</span>`
    :`${label} ${current}`;
}

function unitDetailHtml(unit,statuses=[]){
  const base=unitBaseStats(unit),current=currentUnitStats(unit);
  const hpCurrent=`${current.hp}/${current.maxHp}`;
  return `<b>${unit.name}</b><br>阵营：${ownerName(unit.owner)}<br>
    ${statDetail("攻击",base.attack,current.attack,current.attack>base.attack)} ·
    ${statDetail("耐久",base.hp,hpCurrent,current.maxHp>base.hp)}<br>
    ${statDetail("移动",base.move,current.move,current.move>base.move)} ·
    ${statDetail("涂色",base.paint,current.paint,current.paint>base.paint)}<br>
    高度：${unit.height===2?"空中":"地面"} · 护盾 ${unit.shield}${unit.duration?` · 剩余 ${unit.duration} 回合`:""}${statuses.length?`<br>状态：${statuses.join("、")}`:""}`;
}

function hexPath(x,y,size){
  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=Math.PI/180*(60*i-30);
    const px=x+size*Math.cos(a),py=y+size*Math.sin(a);
    if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  }
  ctx.closePath();
}

function drawLegacyBattle(){
  if(!B||!canvas.width)return;
  const rect=canvas.getBoundingClientRect();
  ctx.clearRect(0,0,rect.width,rect.height);
  ctx.fillStyle="#d9c28c";
  ctx.fillRect(0,0,rect.width,rect.height);

  for(const c of B.cells){
    const p=screenPos(c),s=HEX*B.camera.scale;
    if(p.x<-s||p.y<-s||p.x>rect.width+s||p.y>rect.height+s)continue;
    hexPath(p.x,p.y,s*.95);

    if(c.owner===1)ctx.fillStyle=c.crystal?"#4a91b8":"#1b355e";
    else if(c.owner===2)ctx.fillStyle=c.crystal?"#a85884":"#772947";
    else ctx.fillStyle="#eadbae";
    ctx.fill();

    ctx.strokeStyle=c.spellBlocked?"#111":c.studied?"#e8c75d":"#8f815f";
    ctx.lineWidth=c.studied?1.8:0.5;
    ctx.stroke();

    if(c.crystal){
      ctx.fillStyle="#b9f3ff66";
      ctx.beginPath();ctx.arc(p.x,p.y,s*.38,0,Math.PI*2);ctx.fill();
    }
  }

  if(B.archivePreview?.cell){
    const p=screenPos(B.archivePreview.cell),s=HEX*B.camera.scale;
    ctx.save();
    hexPath(p.x,p.y,s*1.12);
    ctx.fillStyle=B.archivePreview.valid?"#62d99644":"#ff5d6c44";
    ctx.fill();
    ctx.strokeStyle=B.archivePreview.valid?"#78f0ae":"#ff6b78";
    ctx.lineWidth=Math.max(2,s*.2);
    ctx.stroke();
    ctx.restore();
  }

  for(const w of B.wells){
    const p=screenPos(w.cell),s=HEX*B.camera.scale;
    ctx.beginPath();ctx.arc(p.x,p.y,s*.62,0,Math.PI*2);
    ctx.fillStyle=w.owner===1?"#56a6ff":w.owner===2?"#ec5b83":"#e0c165";
    ctx.fill();
    ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle="#111";ctx.font=`bold ${Math.max(7,s*.75)}px sans-serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("井",p.x,p.y);
  }

  const nextIntent=B.intents[0];
  if(nextIntent?.cardTarget==="summon"&&nextIntent.target){
    const p=screenPos(nextIntent.target),s=HEX*B.camera.scale;
    ctx.save();
    ctx.setLineDash([Math.max(2,s*.28),Math.max(2,s*.2)]);
    ctx.beginPath();ctx.arc(p.x,p.y,s*.82,0,Math.PI*2);
    ctx.fillStyle="#777c8799";ctx.fill();
    ctx.strokeStyle="#e0e2e7";ctx.lineWidth=2;ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle="#f1f2f4";ctx.font=`bold ${Math.max(8,s*.72)}px sans-serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(nextIntent.name[0],p.x,p.y);
    ctx.restore();
  }

  const links=GameDroneLinkSystem.active(B);
  for(const link of links){
    if(!link.from.cell||!link.to.cell)continue;
    const from=screenPos(link.from.cell),to=screenPos(link.to.cell);
    const fromY=from.y-(link.from.height===2?HEX*B.camera.scale*.9:0);
    const toY=to.y-(link.to.height===2?HEX*B.camera.scale*.9:0);
    ctx.save();
    ctx.setLineDash([7,5]);
    ctx.lineDashOffset=-((Date.now()-link.startedAt)/35)%12;
    ctx.strokeStyle="#62f0a1";
    ctx.shadowColor="#36d982";
    ctx.shadowBlur=8;
    ctx.lineWidth=Math.max(2,HEX*B.camera.scale*.22);
    ctx.beginPath();ctx.moveTo(from.x,fromY);ctx.lineTo(to.x,toY);ctx.stroke();
    ctx.restore();
  }

  const units=[...B.units].filter(u=>!u.dead).sort((a,b)=>a.height-b.height);
  for(const u of units){
    const p=screenPos(u.cell),s=HEX*B.camera.scale;
    const y=p.y-(u.height===2?s*.9:0);
    ctx.beginPath();ctx.arc(p.x,y,s*.72,0,Math.PI*2);
    ctx.fillStyle=u.owner===1?"#cce8ff":"#ffc1cf";ctx.fill();
    ctx.strokeStyle=u.owner===1?"#132d59":"#77152f";ctx.lineWidth=2;ctx.stroke();

    const letter=u.name==="Spreader"?"S":u.name==="Resource"?"R":u.name==="Fighter"?"F":u.name[0];
    ctx.fillStyle="#111";ctx.font=`bold ${Math.max(7,s*.78)}px sans-serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(letter,p.x,y);

    if(u.height===2){
      ctx.fillStyle="#fff";ctx.font=`${Math.max(7,s*.55)}px sans-serif`;
      ctx.fillText("▲",p.x,y-s*.85);
    }
    if(u.shield>0){
      ctx.strokeStyle="#72e6ff";ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(p.x,y,s*.92,0,Math.PI*2);ctx.stroke();
    }
    if(u.rooted||u.skipMoveOnce||u.silencedOnce){
      ctx.fillStyle="#ffe47a";ctx.font=`bold ${Math.max(8,s*.65)}px sans-serif`;
      ctx.fillText("!",p.x+s*.72,y-s*.65);
    }
    if(B.camera.scale>.75){
      ctx.fillStyle="#e33e4f";ctx.font=`bold ${Math.max(7,s*.42)}px sans-serif`;
      ctx.fillText(`${attackFor(u)}/${u.hp}`,p.x,y+s*.95);
    }
  }
}

function drawBattle(){
  if(!B||!continuousStage)return;
  const size=continuousStage.snapshot();
  terrainRenderer.draw(B,size);
  overlayRenderer.draw(B,size);
  previousOverlayFrame=performance.now();
  B.dirty=false;
}

function renderBattlefieldFrame(now){
  const delta=Math.min(.1,Math.max(0,(now-previousBattlefieldFrame)/1000));
  previousBattlefieldFrame=now;
  if(B&&continuousStage){
    if(B.selected&&!unitHoverCard.hidden)hideUnitHoverCard();
    const size=continuousStage.snapshot();
    if(B.dirty){terrainRenderer.draw(B,size);B.dirty=false}
    if(now-previousOverlayFrame>=1000/30){
      overlayRenderer.draw(B,size,now);
      previousOverlayFrame=now;
    }
    spineStage.draw(B,size,delta);
  }
  battlefieldFrame=requestAnimationFrame(renderBattlefieldFrame);
}

function playUnitAnimation(unit,animation,durationMs=0){
  return spineStage?.play(unit,animation,durationMs)||false;
}

function animateUnitCurveSegment(unit,path,durationMs,onProgress){
  if(!unit||!path?.length)return sleep(durationMs);
  const started=performance.now();
  return new Promise(resolve=>{
    function frame(now){
      const progress=Math.min(1,(now-started)/Math.max(1,durationMs));
      unit._displayPosition=GameBrushMotion.pointAt(path,progress);
      onProgress?.(progress);
      if(progress<1)requestAnimationFrame(frame);
      else resolve();
    }
    onProgress?.(0);
    requestAnimationFrame(frame);
  });
}

