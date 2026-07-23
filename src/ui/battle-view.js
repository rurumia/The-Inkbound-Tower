"use strict";

/* =========================================================
   UI 与日志
========================================================= */

function updateUI(){
  if(!B)return;
  const c=counts();
  const pPct=(c.p/RULES.total*100).toFixed(1);
  const ePct=(c.e/RULES.total*100).toFixed(1);

  document.getElementById("playerHud").innerHTML=
    `<div class="hud-character">
      ${rolePortrait(B.player.role,"hud-portrait","avatar")}
      <div class="hud-copy"><b>${ROLE_NAME[B.player.role]} · 玩家</b><br>
       墨水 ${formatInk(B.player.ink)}/${formatInk(B.player.cap)}
       　区域 ${c.p.toFixed(1)}U²（${pPct}%）
       　书灵 ${B.units.filter(u=>!u.dead&&u.owner===1).length}
       　归档 ${GameArchiveSystem.entries(B.player).length}</div>
    </div>`;

  document.getElementById("enemyHud").innerHTML=
    `<div class="hud-character">
      ${rolePortrait(B.enemy.role,"hud-portrait","avatar")}
      <div class="hud-copy"><b>敌人 · ${ROLE_NAME[B.enemy.role]}</b><br>
       墨水 ${formatInk(B.enemy.ink)}/${formatInk(B.enemy.cap)}
       　区域 ${c.e.toFixed(1)}U²（${ePct}%）
       　书灵 ${B.units.filter(u=>!u.dead&&u.owner===2).length}
       　归档 ${GameArchiveSystem.entries(B.enemy).length}</div>
    </div>`;

  document.getElementById("mapStats").innerHTML=
    `完整轮：${B.round}<br>全局行动：${B.global}/${B.settlementLimit}<br>
     狂热：${B.frenzyStart}（3×：${B.fastFrenzyStart}）<br>
     中立面积：${c.n.toFixed(1)}U²<br>速度：${B.speed}×<br>
     墨井：玩家 ${B.wells.filter(w=>w.owner===1).length} /
     敌人 ${B.wells.filter(w=>w.owner===2).length}`;

  document.getElementById("intentRow").innerHTML=B.intents.map((x,i)=>
    `<div class="intent ${i===0?"next":""}" data-intent-index="${i}" data-instance-id="${x.instanceId}"
      aria-label="敌方意图 ${i+1}：${x.name}，${x.targetHint}">
      ${i+1}. ${x.name}<br><span class="small">${x.targetHint}</span>
    </div>`).join("");

  renderHand();
  renderSkill();
  renderArchiveDock();
  renderTurnPanel();
  setPhase(B.busy
    ?`${ownerName(B.current)}结算中`
    :B.current===1
      ?B.player.bonusPlayAfterSacrifice?"精炼协议：可使用一张牌或结束回合":
        B.player.sacrifices===1?"牺牲流程：可再牺牲一张或结束回合":"玩家操作阶段"
      :"敌人操作阶段");
  drawBattle();
}

function renderHand(){
  const root=document.getElementById("hand");
  root.innerHTML="";
  B.player.hand.forEach((inst,i)=>{
    const d=getDef(inst);
    const skillHandMode=B.selected?.kind==="skill"&&roleDef(B.player.role)?.skill?.target==="hand";
    const archiveTargetMode=B.selected?.kind==="archiveTarget";
    const canPlayAfterSacrifice=B.player.sacrifices===0||B.player.bonusPlayAfterSacrifice;
    const playable=B.player.ink>=d.cost&&!B.busy&&B.current===1&&canPlayAfterSacrifice&&!skillHandMode&&!archiveTargetMode;
    const archiveCandidate=skillHandMode&&!B.busy&&B.current===1;
    const el=document.createElement("div");
    el.className=`game-card role-${d.role} hand-card ${playable||archiveCandidate?"":"unplayable"} ${archiveCandidate?"archive-candidate":""} ${B.selected?.inst===inst?"selected":""}`;
    el.innerHTML=cardBody(d,{
      headExtra:`<div class="drop ${inst.protected?"protected":""}">${inst.protected?"◆":"💧"}</div>
        <div class="priority">${inst.priority}</div>
        `,
      actions:`<div class="hand-actions">
        <button ${skillHandMode?`onclick="selectSkillHandCard(${inst.id})"`:`${!playable?"disabled":""} onclick="selectCard(${inst.id})"`}>${skillHandMode?"归档":"使用"}</button>
        <button ${B.busy||B.current!==1||inst.protected||B.player.sacrifices>=2||skillHandMode||archiveTargetMode?"disabled":""}
          onclick="sacrificeCard(${inst.id})">牺牲</button>
        <button onclick="showCardDetail('${d.name.replaceAll("'","\\'")}')">详情</button>
      </div>`
    });
    if(playable||archiveCandidate){
      const art=el.querySelector(".card-art");
      art.classList.add("card-use-trigger");
      art.setAttribute("role","button");
      art.setAttribute("aria-label",`${archiveCandidate?"归档":"使用"}卡牌：${d.name}`);
      art.tabIndex=0;
      const activate=()=>archiveCandidate?selectSkillHandCard(inst.id):selectCard(inst.id);
      art.addEventListener("click",activate);
      art.addEventListener("keydown",event=>{
        if(event.key!=="Enter"&&event.key!==" ")return;
        event.preventDefault();activate();
      });
    }
    root.appendChild(el);
  });
}

function renderSkill(){
  const s=B.player;
  const skill=roleDef(s.role).skill;
  const noSkillTarget=skill.target==="hand"&&!s.hand.length;
  document.getElementById("skillPanel").innerHTML=`
    <h3>${ROLE_NAME[s.role]} · ${skill.name}</h3>
    <button onclick="useSkill()" ${B.busy||B.current!==1||s.skillCd>0||s.sacrifices>0||noSkillTarget?"disabled":""}>使用技能</button>
    <p class="small">${skill.description}</p>
    <p>${skill.cooldown?`冷却：${s.skillCd}`:"无冷却 · 消耗本回合行动"}</p>
  `;
}

function archiveDockModel(entry){
  const target=entry.source==="skill"?resolveStoredArchiveTarget(entry,1):null;
  const def=getDef(entry.instance);
  const invalid=entry.source==="skill"&&def.target!=="none"&&!validateTarget(def,1,target);
  return {
    order:entry.order,
    name:def.name,
    remaining:entry.remaining,
    invalid,
    source:entry.source,
    targetLabel:entry.source==="skill"
      ?GameArchiveTargetSnapshot.describe(entry.targetSnapshot,{units:()=>B.units.filter(unit=>!unit.dead)})
      :"发动时自动选择"
  };
}

function renderArchiveDock(){
  const root=document.getElementById("archiveDock");
  const visible=B.player.role==="20735";
  root.hidden=!visible;
  if(!visible){root.innerHTML="";return}
  root.innerHTML=GameArchiveView.dock(GameArchiveSystem.entries(B.player).map(archiveDockModel));
}

function previewArchiveTarget(order,active){
  if(!B)return;
  if(!active){B.archivePreview=null;drawBattle();return}
  const entry=GameArchiveSystem.entries(B.player).find(candidate=>candidate.order===order);
  if(!entry||entry.source!=="skill"){B.archivePreview=null;drawBattle();return}
  const def=getDef(entry.instance),target=resolveStoredArchiveTarget(entry,1);
  const valid=def.target==="none"||validateTarget(def,1,target);
  let cell=null;
  if(entry.targetSnapshot?.kind==="cell")cell=Number.isFinite(entry.targetSnapshot.x)
    ?GameBattlefieldAdapter.worldToCell(entry.targetSnapshot,B.cells)
    :cellAt(entry.targetSnapshot.r,entry.targetSnapshot.c);
  if(entry.targetSnapshot?.kind==="unit")cell=B.units.find(unit=>unit.id===entry.targetSnapshot.unitId)?.cell||null;
  B.archivePreview={cell,valid};
  drawBattle();
}

function showArchiveEntry(order){
  const entry=GameArchiveSystem.entries(B.player).find(candidate=>candidate.order===order);
  if(!entry)return;
  const model=archiveDockModel(entry),def=getDef(entry.instance);
  openModal(`<h1>${def.name}</h1>
    <p><b>剩余 ${entry.remaining} 回合</b></p>
    <p>锁定目标：${model.targetLabel}</p>
    <p>${model.invalid?"目标当前已失效；倒计时结束时若仍非法，本牌不产生效果并进入弃牌堆。":"倒计时结束时会在该目标免费发动。"}</p>
    <button onclick="closeModal()">关闭</button>`);
}

function renderTurnPanel(){
  const s=B.player;
  document.getElementById("turnPanel").innerHTML=`
    <h3>行动控制</h3>
    <p>牌堆：${s.draw.length}<br>弃牌：${s.discard.length}<br>本回合牺牲：${s.sacrifices}/2</p>
    <button onclick="endTurn()" ${B.busy||B.current!==1?"disabled":""}>结束回合</button>
    <button onclick="pauseMenu()">暂停</button>
    <div class="card-operation-help">
      <strong>卡牌操作</strong>
      点击卡图或“使用”。有目标卡随后点击战场目标；无目标卡立即使用。
    </div>
  `;
}

function setPhase(text){
  document.getElementById("phaseText").textContent=text;
}

function addLog(text,type="s"){
  if(!document.getElementById("log"))return;
  const d=document.createElement("div");
  d.className=`log-${type}`;
  d.textContent=`[${B?B.global:0}] ${text}`;
  const log=document.getElementById("log");
  log.appendChild(d);log.scrollTop=log.scrollHeight;
}

function pauseMenu(){
  if(!B||B.ended)return;
  const oldBusy=B.busy;
  B.busy=true;updateUI();
  openModal(`
    <h1>游戏暂停</h1>
    <button onclick="B.busy=${oldBusy};closeModal();updateUI()">继续</button>
    <button onclick="closeModal();B.ended=true;showScreen('menu')">放弃战斗并返回主菜单</button>
  `);
}

