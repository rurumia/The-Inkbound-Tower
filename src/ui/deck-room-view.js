"use strict";

/* =========================================================
   构筑、房间与预览
========================================================= */

function renderRoleSelection(){
  const root=document.getElementById("roleGrid");
  if(!root)return;
  root.innerHTML=ROLE_IDS.filter(role=>CARDS[role]).map(role=>{
    const d=roleDef(role);
    return `<article class="role-card" style="--role-accent:${d.accent}">
      ${rolePortrait(role)}
      <h2>${d.name}</h2>
      <p>${d.summary}</p>
      <h3>角色技能：${d.skill.name}</h3>
      <p>${d.skill.description} 冷却 ${d.skill.cooldown}。</p>
      <ul>${d.traits.map(x=>`<li>${x}</li>`).join("")}</ul>
      <button onclick="chooseRole('${role}')">选择${d.name}</button>
    </article>`;
  }).join("");
}

function chooseRole(role){
  if(!ROLE_DEFS[role]||!CARDS[role])return;
  run.role=role;
  run.opponentRole=GameOpponentSelection.resolve(role,run.opponentRole,ROLE_IDS,CARDS);
  if(!run.decks[role])run.decks[role]=[];
  if(!run.decks[role].length)run.decks[role]=defaultDeck(role);
  renderDeck();
  showScreen("deck");
}

function renderDeck(){
  const role=run.role;
  document.getElementById("deckRole").textContent=`当前角色：${ROLE_NAME[role]} · ${run.decks[role].length} 张`;
  document.getElementById("archivePriorityHelp").hidden=role!=="20735";
  const root=document.getElementById("deckList");
  root.innerHTML="";
  run.decks[role].forEach((inst,i)=>{
    const d=getDef(inst);
    const el=document.createElement("div");
    el.className="deck-item";
    el.innerHTML=`${cardVisual(d,{className:"deck-card"})}
      <div class="deck-controls">
        <button ${i===0?"disabled":""} onclick="moveDeck(${i},-1)">↑</button>
        <button ${i===run.decks[role].length-1?"disabled":""} onclick="moveDeck(${i},1)">↓</button>
        <label class="priority-control"><span>${role==="20735"?"自动归档顺序":"自动出牌顺序"}</span>
          <select aria-label="${role==="20735"?"自动归档顺序":"自动出牌顺序"}" onchange="setPriority(${i},this.value)">
            ${Array.from({length:10},(_,n)=>`<option ${inst.priority===n?"selected":""}>${n}</option>`).join("")}
          </select>
        </label>
        <button onclick="toggleProtect(${i})">${inst.protected?"🔒 锁":"💧 蓝"}</button>
        <button onclick="showCardDetail('${d.name.replaceAll("'","\\'")}')">详情</button>
      </div>`;
    root.appendChild(el);
  });
}

function moveDeck(i,d){
  const a=run.decks[run.role],j=i+d;
  [a[i],a[j]]=[a[j],a[i]];
  a.forEach((x,n)=>x.order=n);
  renderDeck();
}
function setPriority(i,v){run.decks[run.role][i].priority=+v;renderDeck()}
function toggleProtect(i){
  run.decks[run.role][i].protected=!run.decks[run.role][i].protected;
  renderDeck();
}

function showCardDetail(name){
  const d=CARD_MAP.get(name);
  openModal(`
    <div class="card-detail-layout">
      ${cardVisual(d,{className:"card-detail-preview"})}
      <div class="card-detail-copy">
        <h1>${d.name}</h1>
        <p><b>${ROLE_NAME[d.role]} · ${d.type}</b></p>
        <p>费用：${formatInk(d.cost)} 墨水</p>
        <p>${d.text}</p>
        ${d.stats?`<p>攻击 ${d.stats.attack} · 耐久 ${d.stats.hp} · 移动 ${d.stats.move} · 涂色 ${d.stats.paint}</p>`:""}
        <p>${d.keywords.map(x=>`<span class="badge">${x}</span>`).join("")}</p>
        <button onclick="closeModal()">关闭</button>
      </div>
    </div>
  `);
}

function enterRoom(){
  showScreen("room");
  renderOpponentSelection();
  document.getElementById("runInfo").textContent=
    `角色：${ROLE_NAME[run.role]}　卡组：${run.decks[run.role].length} 张　对手：${ROLE_NAME[opponentRole(run.role)]}　已胜利：${run.rewards} 场`;
}

function renderOpponentSelection(){
  run.opponentRole=GameOpponentSelection.resolve(run.role,run.opponentRole,ROLE_IDS,CARDS);
  const root=document.getElementById("opponentGrid");
  root.innerHTML=GameOpponentSelection.available(ROLE_IDS,CARDS).map(role=>{
    const d=roleDef(role),selected=role===run.opponentRole;
    return `<button type="button" class="opponent-option ${selected?"selected":""}"
      style="--role-accent:${d.accent}" aria-pressed="${selected}" onclick="chooseOpponent('${role}')">
      ${rolePortrait(role,"","avatar")}
      <span class="opponent-copy"><b>${d.name}${role===run.role?" · 镜像":""}</b><span>${d.summary}</span></span>
    </button>`;
  }).join("");
}

function chooseOpponent(role){
  if(!ROLE_DEFS[role]||!CARDS[role])return;
  run.opponentRole=role;
  renderOpponentSelection();
  document.getElementById("runInfo").textContent=
    `角色：${ROLE_NAME[run.role]}　卡组：${run.decks[run.role].length} 张　对手：${ROLE_NAME[role]}　已胜利：${run.rewards} 场`;
}

function previewEnemy(){
  const role=opponentRole(run.role);
  openModal(`
    <h1>敌人：${ROLE_NAME[role]}</h1>
    <p>敌人使用所选角色的完整起始卡组与角色技能。</p>
    <div style="columns:2">${CARDS[role].map(x=>`<p>• ${x.name}（${formatInk(x.cost)}）</p>`).join("")}</div>
    <button onclick="closeModal()">关闭</button>
  `);
}

