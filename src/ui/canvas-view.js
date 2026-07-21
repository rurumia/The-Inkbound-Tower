"use strict";

/* =========================================================
   Canvas 地图、拾取、缩放与拖动
========================================================= */

const canvas=document.getElementById("battleCanvas");
const ctx=canvas.getContext("2d");
const HEX=9;
const HEX_W=Math.sqrt(3)*HEX;
const ROW_H=1.5*HEX;

function setupCanvas(){
  resizeCanvas();
  window.addEventListener("resize",resizeCanvas);
  canvas.onwheel=e=>{
    e.preventDefault();
    const old=B.camera.scale;
    B.camera.scale=clamp(old*(e.deltaY<0?1.12:.89),.55,3.2);
    drawBattle();
  };
  canvas.onmousedown=e=>{
    if(e.button===1||e.button===0&&!B.selected){
      drag.active=true;drag.x=e.clientX;drag.y=e.clientY;
    }
  };
  window.onmouseup=e=>{
    if(drag.active){drag.active=false;return}
  };
  canvas.onmousemove=e=>{
    if(drag.active){
      B.camera.ox+=e.clientX-drag.x;
      B.camera.oy+=e.clientY-drag.y;
      drag.x=e.clientX;drag.y=e.clientY;
      drawBattle();
    }
  };
  canvas.onclick=canvasClick;
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
}

function resizeCanvas(){
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(1,Math.floor(rect.width*devicePixelRatio));
  canvas.height=Math.max(1,Math.floor(rect.height*devicePixelRatio));
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  drawBattle();
}

function centerCamera(){
  if(!B)return;
  const rect=canvas.getBoundingClientRect();
  const mapW=61*HEX_W;
  const mapH=29*ROW_H+HEX*2;
  B.camera.scale=Math.min((rect.width-35)/mapW,(rect.height-35)/mapH);
  B.camera.ox=(rect.width-mapW*B.camera.scale)/2;
  B.camera.oy=(rect.height-mapH*B.camera.scale)/2;
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
  const p=worldPos(c);
  return {
    x:p.x*B.camera.scale+B.camera.ox,
    y:p.y*B.camera.scale+B.camera.oy
  };
}

function nearestCellAtScreen(x,y){
  let best=null,dist=Infinity;
  for(const c of B.cells){
    const p=screenPos(c);
    const d=(p.x-x)**2+(p.y-y)**2;
    if(d<dist){dist=d;best=c}
  }
  return dist<(HEX*B.camera.scale*1.3)**2?best:null;
}

function canvasClick(e){
  if(drag.active||B.busy||B.current!==1)return;
  const rect=canvas.getBoundingClientRect();
  const c=nearestCellAtScreen(e.clientX-rect.left,e.clientY-rect.top);
  if(!c)return;

  if(B.selected?.kind==="archiveTarget"){
    const d=B.selected.def;
    const target=d.target==="cell"||d.target==="summon"?c:unitAt(c);
    commitArchiveSelection(target);
  }else if(B.selected?.kind==="card"){
    const d=B.selected.def;
    const target=d.target==="cell"||d.target==="summon"?c:unitAt(c);
    playSelectedCard(target);
  }else if(B.selected?.kind==="skill"){
    const skill=roleDef(B.player.role)?.skill;
    if(skill?.target!=="hand")executeSkill(skill?.target==="cell"||B.player.role==="fine"?c:unitAt(c));
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
      :`格子 ${c.r},${c.c}<br>归属：${ownerName(c.owner)}<br>${c.crystal?"结晶化 ":""}${c.studied?"精研 ":""}${c.spellBlocked?"噤声":""}`;
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

function drawBattle(){
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

