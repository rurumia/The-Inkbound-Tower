"use strict";

/* =========================================================
   基础常量与工具
========================================================= */

const RULES={
  rows:30,
  short:60,
  long:61,
  total:1815,
  handLimit:5,
  initialInk:40,
  initialCap:40,
  frenzy:50,
  fastFrenzy:70,
  settlement:90,
  winTiles:1453
};

const OWNER={N:0,P:1,E:2};

/* 角色注册表：新增角色时在这里注册资料，并在 CARDS 中提供同 id 卡组。 */
const ROLE_DEFS={
  sina:{
    id:"sina",name:"茜娜",fallback:"茜",
    images:{selection:"images/茜娜立绘.png",avatar:"images/茜娜头像.jpg"},
    accent:"#9ec9ee",opponents:["fine"],
    summary:"天鹅、飞行、降落、高机动与爆发。",
    skill:{id:"tailwind",name:"起风",cooldown:1,
      description:"选择一个己方地面书灵，使其进入飞行。",
      prompt:"点击一个己方地面书灵。"},
    traits:["飞行书灵免疫普通攻击","飞行期间不进行被动涂色","降落可以触发多种额外效果"]
  },
  fine:{
    id:"fine",name:"菲涅",fallback:"菲",
    images:{selection:"images/菲涅立绘.png",avatar:"images/菲涅头像.jpg"},
    accent:"#d7bd78",opponents:["sina"],
    summary:"结晶化、防御、精研与资源控制。",
    skill:{id:"closeReading",name:"精读",cooldown:2,
      description:"将半径 1 的完整 7 格设为精研区域，并为区域内己方书灵提供护盾。",
      prompt:"点击己方控制区域中心格。"},
    traits:["结晶格无法被普通涂色改变","精研可以强化书灵","擅长建立永久控制区"]
  }
};
for(const module of window.GameContentModules?.characters||[]){
  ROLE_DEFS[module.role.id]=module.role;
}
const ROLE_IDS=Object.keys(ROLE_DEFS);
const ROLE_NAME=Object.fromEntries(ROLE_IDS.map(id=>[id,ROLE_DEFS[id].name]));

function roleDef(role){return ROLE_DEFS[role]}
function opponentRole(role){
  return GameOpponentSelection.resolve(role,run?.opponentRole,ROLE_IDS,CARDS);
}
function rolePortrait(role,className="",variant="selection"){
  const d=roleDef(role);
  if(!d)return "";
  return `<div class="role-portrait ${className}" aria-label="${d.name}头像">
    <span class="role-portrait-fallback">${d.fallback||d.name.slice(0,1)}</span>
    <img src="${d.images?.[variant]||d.images?.selection||""}" alt="${d.name}" onload="this.parentElement.classList.add('loaded')"
      onerror="this.remove()">
  </div>`;
}

let run={
  role:null,
  opponentRole:null,
  decks:Object.fromEntries(ROLE_IDS.map(id=>[id,[]])),
  rewards:0,
  battles:0
};

let B=null;
let uid=1;
let drag={active:false,x:0,y:0};
let modalAction=null;
let battleSettings={frenzy:RULES.frenzy,settlement:RULES.settlement};

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function deepClone(v){return JSON.parse(JSON.stringify(v))}
function formatInk(h){return Number.isInteger(h/2)?String(h/2):`${Math.floor(h/2)}½`}
function key(r,c){return `${r},${c}`}
function cellAt(r,c){return B?.cellMap.get(key(r,c))}
function rowLength(r){return r%2===0?60:61}
function enemyOf(o){return o===1?2:1}
function ownerName(o){return o===1?"玩家":o===2?"敌人":"中立"}

// Clockwise axial directions: E, SE, SW, W, NW, NE.
const HEX_DIRECTIONS=[
  {q:1,r:0,name:"东"},{q:0,r:1,name:"东南"},{q:-1,r:1,name:"西南"},
  {q:-1,r:0,name:"西"},{q:0,r:-1,name:"西北"},{q:1,r:-1,name:"东北"}
];

function offsetToAxial(cell){
  return {q:cell.c-Math.ceil(cell.r/2),r:cell.r};
}

function axialToOffset(q,r){
  return {r,c:q+Math.ceil(r/2)};
}

function neighborInDirection(cell,direction){
  const a=offsetToAxial(cell),d=HEX_DIRECTIONS[(direction+6)%6];
  const o=axialToOffset(a.q+d.q,a.r+d.r);
  return cellAt(o.r,o.c)||null;
}

function directionBetween(from,to){
  const a=offsetToAxial(from),b=offsetToAxial(to);
  const dq=b.q-a.q,dr=b.r-a.r;
  return HEX_DIRECTIONS.findIndex(d=>d.q===dq&&d.r===dr);
}

function setBattleSetting(kind,value){
  const min=kind==="frenzy"?1:2;
  const next=clamp(Math.round(Number(value)||min),min,999);
  battleSettings[kind]=next;
  if(B&&!B.ended){
    if(kind==="frenzy"){
      B.frenzyStart=next;
      B.fastFrenzyStart=next+20;
    }else B.settlementLimit=next;
    updateUI();
  }
  syncBattleSettingControls();
}

function adjustBattleSetting(kind,delta){
  setBattleSetting(kind,battleSettings[kind]+delta);
}

function syncBattleSettingControls(){
  const frenzy=document.getElementById("frenzySetting");
  const settlement=document.getElementById("settlementSetting");
  if(frenzy)frenzy.value=battleSettings.frenzy;
  if(settlement)settlement.value=battleSettings.settlement;
}

function seeded(seed){
  let s=seed>>>0;
  return function(){
    s=(s+0x6D2B79F5)|0;
    let t=Math.imul(s^s>>>15,1|s);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

function shuffle(arr,rng=Math.random){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function neighbors(cell){
  return HEX_DIRECTIONS.map((_,i)=>neighborInDirection(cell,i)).filter(Boolean);
}

function hexDistance(a,b){
  const A=offsetToAxial(a),C=offsetToAxial(b);
  return (Math.abs(A.q-C.q)+Math.abs(A.q+A.r-C.q-C.r)+Math.abs(A.r-C.r))/2;
}

function cellsRadius(center,rad){
  return B.cells.filter(x=>hexDistance(x,center)<=rad);
}

function rectCells(center,size){
  const h=Math.floor(size/2),out=[];
  for(let r=center.r-h;r<=center.r+h;r++)
    for(let c=center.c-h;c<=center.c+h;c++){
      const x=cellAt(r,c);if(x)out.push(x);
    }
  return out;
}

/* 地图机制注册表：规则执行与 AI 预测共用同一组拦截器。 */
const MapRules=(()=>{
  const mechanics=[];
  function register(mechanic){mechanics.push(mechanic)}
  function ownerChange(cell,toOwner,context={}){
    if(!cell)return {allowed:false,reason:"missing"};
    if(cell.owner===toOwner)return {allowed:false,reason:"unchanged"};
    for(const mechanic of mechanics){
      const reason=mechanic.blockOwnerChange?.(cell,toOwner,context);
      if(reason)return {allowed:false,reason:mechanic.id||reason};
    }
    return {allowed:true,reason:null};
  }
  function inspectOwnerChanges(cells,toOwner,context={}){
    const result={changeable:[],blocked:[],unchanged:[],territory:0};
    [...new Set(cells.filter(Boolean))].forEach(cell=>{
      const verdict=ownerChange(cell,toOwner,context);
      if(verdict.allowed){
        result.changeable.push(cell);
        result.territory+=toOwner===OWNER.N?1:cell.owner===OWNER.N?1:2;
      }else if(verdict.reason==="unchanged")result.unchanged.push(cell);
      else result.blocked.push(cell);
    });
    return result;
  }
  function tryChangeOwner(cell,toOwner,context={}){
    if(!ownerChange(cell,toOwner,context).allowed)return false;
    cell.owner=toOwner;
    return true;
  }
  function inspectCrystallize(cells,context={}){
    const result={changeable:[],blocked:[],unchanged:[]};
    [...new Set(cells.filter(Boolean))].forEach(cell=>{
      if(cell.crystal){result.unchanged.push(cell);return}
      const blocked=mechanics.some(x=>x.blockCellEffect?.(cell,{...context,effect:"crystallize"}));
      (blocked?result.blocked:result.changeable).push(cell);
    });
    return result;
  }
  return {register,ownerChange,inspectOwnerChanges,tryChangeOwner,inspectCrystallize};
})();

MapRules.register({
  id:"crystal",
  blockOwnerChange(cell){return cell.crystal?"crystal":null}
});
MapRules.register({
  id:"spell-block",
  blockOwnerChange(cell,toOwner,context){
    return cell.spellBlocked&&(context.source==="card"||context.source==="skill")?"spell-block":null;
  },
  blockCellEffect(cell,context){
    return cell.spellBlocked&&(context.source==="card"||context.source==="skill");
  }
});

function showScreen(id){
  if(id==="roles")renderRoleSelection();
  document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function openModal(html){
  document.getElementById("modalBox").innerHTML=html;
  document.getElementById("modal").classList.add("open");
}

function closeModal(){
  document.getElementById("modal").classList.remove("open");
  modalAction=null;
}

function openHelp(){
  openModal(`
    <h1>墨缚之塔</h1>
    <p>每个行动回合只能进行一次有效操作：打出一张牌、使用技能、完成牺牲流程或结束回合。</p>
    <ul>
      <li>书灵会按照出生顺序自动移动、涂色并攻击。</li>
      <li>书灵攻击时双方同时造成伤害。</li>
      <li>每牺牲一张牌获得 0.5 墨水，每回合最多牺牲两张。</li>
      <li>墨井被全部相邻格包围后改变归属，并在回合开始提供墨水。</li>
      <li>完整轮结束时，任一方超过 80% 区域即获胜。</li>
      <li>第 50 个行动后进入狂热，第 70 个行动后进入 3 倍速。</li>
      <li>第 90 个行动后按格数结算，平局玩家胜利。</li>
    </ul>
    <button onclick="closeModal()">关闭</button>
  `);
}

