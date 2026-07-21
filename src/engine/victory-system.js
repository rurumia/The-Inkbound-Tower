"use strict";

/* =========================================================
   浸润、墨井与胜负
========================================================= */

function infiltration(){
  const snap=new Map(B.cells.map(c=>[key(c.r,c),c.owner]));
  const changes=[];

  for(const c of B.cells){
    if(c.crystal)continue;
    const ns=neighbors(c);
    let p=0,e=0;
    ns.forEach(n=>{
      const o=snap.get(key(n.r,n.c));
      if(o===1)p++;else if(o===2)e++;
    });
    if(p>=5&&e<5)changes.push([c,1]);
    else if(e>=5&&p<5)changes.push([c,2]);
  }

  changes.forEach(([c,o])=>MapRules.tryChangeOwner(c,o,{kind:"infiltration",source:"map"}));
  if(changes.length)addLog(`浸润改变了 ${changes.length} 个格子。`,"b");
}

function updateWells(){
  B.wells.forEach(w=>{
    const ns=neighbors(w.cell);
    const allP=ns.length&&ns.every(c=>c.owner===1);
    const allE=ns.length&&ns.every(c=>c.owner===2);
    const surrounded=allP?1:allE?2:0;
    if(!surrounded){w.pending=0;return}

    if(w.owner===0){
      if(w.pending===surrounded){
        w.owner=surrounded;w.pending=0;
        addLog(`墨井被${ownerName(surrounded)}占领。`,"b");
      }else w.pending=surrounded;
    }else if(w.owner!==surrounded){
      w.owner=0;w.pending=surrounded;
      addLog("墨井被敌对阵营包围，转为中立。","b");
    }
  });
}

function counts(){
  let p=0,e=0,n=0;
  B.cells.forEach(c=>{
    if(c.owner===1)p++;else if(c.owner===2)e++;else n++;
  });
  return {p,e,n};
}

function checkVictory(){
  const c=counts();
  if(c.p>=RULES.winTiles){endBattle(1,"玩家区域严格超过 80%");return true}
  if(c.e>=RULES.winTiles){endBattle(2,"敌人区域严格超过 80%");return true}
  return false;
}

function settleBattle(){
  const c=counts();
  endBattle(c.p>=c.e?1:2,`第 ${B.settlementLimit} 行动格数结算`);
}

function endBattle(winner,reason){
  if(B.ended)return;
  B.ended=true;B.busy=true;
  const c=counts();
  setTimeout(()=>{
    openModal(`
      <div class="result-big">${winner===1?"战斗胜利":"战斗失败"}</div>
      <h3>${reason}</h3>
      <p>玩家：${c.p} 格（${(c.p/RULES.total*100).toFixed(2)}%）</p>
      <p>敌人：${c.e} 格（${(c.e/RULES.total*100).toFixed(2)}%）</p>
      <p>中立：${c.n} 格</p>
      ${winner===1
        ?`<button onclick="showRewards()">选择奖励</button>`
        :`<button onclick="closeModal();enterRoom()">返回房间地图</button>`}
      <button onclick="closeModal();showScreen('menu')">返回主菜单</button>
    `);
  },300);
}

function showRewards(){
  const own=shuffle(CARDS[run.role],B.rng).slice(0,2);
  const enemy=shuffle(CARDS[opponentRole(run.role)],B.rng)
    .filter(x=>!own.some(y=>y.name===x.name)).slice(0,1);
  const rewards=[...own,...enemy];

  openModal(`
    <h1>选择一张奖励卡</h1>
    <div class="reward-grid">
      ${rewards.map(d=>cardVisual(d,{
        className:"reward-card",
        attributes:`onclick="takeReward('${d.name.replaceAll("'","\\'")}')" tabindex="0"`
      })).join("")}
    </div>
  `);
}

function takeReward(name){
  const d=CARD_MAP.get(name);
  const deck=run.decks[run.role];
  deck.push(makeInstance(d,deck.length));
  run.rewards++;run.battles++;
  closeModal();enterRoom();
}

