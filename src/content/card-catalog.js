"use strict";

/* =========================================================
   卡牌定义
========================================================= */

function card(role,name,cost,type,text,target="none",stats=null,keywords=[],meta={}){
  return {...meta,role,name,cost:cost*2,type,text,target,stats,keywords:[...keywords],tags:[...(meta.tags||keywords)]};
}

const CARDS={
sina:[
card("sina","小天鹅信使",2,"资源书灵","持续3回合。回合开始产出2墨水；飞行时额外+1。","summon",null,["飞行","资源"]),
card("sina","湖光集结",3,"资源书灵","持续3回合。回合结束时，若存在飞行中的己方书灵，获得3墨水。","summon"),
card("sina","羽翼泵动站",4,"资源书灵","持续4回合。回合开始产出2墨水；己方书灵进入飞行时获得1墨水。","summon"),
card("sina","天鹅湖休息区",3,"资源书灵","持续3回合。回合结束产出3墨水；若本回合有书灵降落，下回合额外产出2。","summon"),
card("sina","冲锋白雀",3,"进攻书灵","攻击1、耐久2、移动3、涂色1。登场冲刺4格；降落时冲刺8格并对碰撞敌人造成2伤害。","summon",{attack:1,hp:2,move:3,paint:1,ai:"aggressive"}),
card("sina","护卫大天鹅",7,"进攻书灵","攻击2、耐久8、移动3、涂色3。降落时将范围2内敌人向外推动3格并重置其经过区域。","summon",{attack:2,hp:8,move:3,paint:3,ai:"expand"}),
card("sina","侦查隼·B型",2,"进攻书灵","攻击1、耐久2、移动5、涂色1。部署于己方格时飞行；飞行时移动力+2。","summon",{attack:1,hp:2,move:5,paint:1,ai:"avoid"}),
card("sina","重力白鹅",4,"进攻书灵","攻击2、耐久5、移动2、涂色2。降落时摧毁目标格上耐久≤2的敌人。","summon",{attack:2,hp:5,move:2,paint:2,ai:"aggressive"}),
card("sina","幻影孔雀",5,"进攻书灵","攻击1、耐久4、移动3、涂色3。每个涂色格随机扩散至一个相邻格；降落时额外触发一次。","summon",{attack:1,hp:4,move:3,paint:3,ai:"expand"}),
card("sina","铁喙啄木鸟",3,"进攻书灵","攻击3、耐久2、移动3、涂色1。对禁行目标伤害翻倍；本回合击杀后进入飞行。","summon",{attack:3,hp:2,move:3,paint:1,ai:"aggressive"}),
card("sina","紧急着陆指令",2,"效果卡","所有飞行己方书灵强制降落，并使其本次降落涂色范围增加1格。","none"),
card("sina","轻盈之舞",1,"效果卡","选择己方书灵：地面目标飞行；飞行目标额外行动一次。","own"),
card("sina","莽撞突击",4,"效果卡","所有己方书灵沿正前方移动最大距离，碰撞时造成1伤害。","none"),
card("sina","全体升空！",5,"效果卡","所有己方书灵进入飞行2回合，本回合移动力+2。","none"),
card("sina","精准俯冲",2,"效果卡","选择飞行己方书灵，再选择合法位置降落，本回合攻击+1。","flying"),
card("sina","白羽防护罩",3,"效果卡","选择地面己方书灵，获得伤害减半；刚降落则恢复2耐久。","groundOwn"),
card("sina","乱序风暴",6,"效果卡","随机移动全部飞行书灵，随后降落并涂色5×5区域。","none")
],
fine:[
card("fine","流动书架",3,"资源书灵","持续3回合。回合开始产出2墨水；若最初部署在己方控制区，额外+1。","summon"),
card("fine","沉思蜡烛",2,"资源书灵","持续3回合。回合开始产出2墨水；所在格结晶化时翻倍。","summon"),
card("fine","真理循环装置",4,"资源书灵","持续5回合。回合开始获得2墨水；效果卡返还1墨水，每回合最多2次。","summon"),
card("fine","真理馆长",5,"资源书灵","持续3回合。回合结束时每5个己方结晶格获得1墨水，最多4。","summon"),
card("fine","禁咒守卫",3,"进攻书灵","攻击0、耐久5、移动2、涂色1。登场获得1层护盾；精研时耐久上限+2。","summon",{attack:0,hp:5,move:2,paint:1,ai:"avoid"}),
card("fine","墨水凝固者",4,"进攻书灵","攻击1、耐久3、移动2、涂色2。周围均为己方时将区域结晶化。","summon",{attack:1,hp:3,move:2,paint:2,ai:"expand"}),
card("fine","图书馆活化石像",4,"进攻书灵","攻击1、耐久6、移动2、涂色1。替资源书灵承受攻击；精研区内每回合恢复1耐久。","summon",{attack:1,hp:6,move:2,paint:1,ai:"avoid"}),
card("fine","禁锢墨水瓶",3,"进攻书灵","攻击0、耐久3、移动3、涂色2。移动到精研区时结晶化落点。","summon",{attack:0,hp:3,move:3,paint:2,ai:"expand"}),
card("fine","奥术记录仪",5,"进攻书灵","攻击2、耐久4、移动3、涂色1。相邻格精研时扩展空白格；被摧毁时结晶化3×3区域。","summon",{attack:2,hp:4,move:3,paint:1,ai:"expand"}),
card("fine","真理之墙",2,"进攻书灵·屏障","攻击0、耐久4、移动0、涂色0。周围5×5为精研区并结晶化；死亡时解除自身范围。","summon",{attack:0,hp:4,move:0,paint:0,ai:"avoid"}),
card("fine","索引重排",2,"效果卡","将敌方书灵传送至其所属半场；若原格为精研格，使其下次行动无法移动。","enemy"),
card("fine","结晶共鸣",3,"效果卡","所有己方结晶格向外扩散1格并改为己方颜色。","none"),
card("fine","逻辑重构",3,"效果卡","交换两个位于己方控制区的己方书灵位置。","own"),
card("fine","“保持安静”",4,"效果卡","选择5×5区域，其中敌方书灵下次行动无法移动且不能释放技能。","cell"),
card("fine","噤声",5,"效果卡","指定5×5区域，本场战斗中该区域不受效果卡和角色技能影响。","cell"),
card("fine","奥术结晶界",7,"ACE效果卡","将己方半场最大的己方连通区域结晶化，并跳过下一个己方回合。","none",null,["ACE"]),
card("fine","最终论文：永恒结晶",8,"ACE效果卡","选择己方书灵，永久结晶化其半径2区域；目标固定并每回合提供护盾与2墨水。","own",null,["ACE"])
]};

for(const module of window.GameContentModules?.characters||[]){
  CARDS[module.role.id]=module.cards.map(raw=>card(
    module.role.id,raw.name,raw.cost,raw.type,raw.text,raw.target,raw.stats,raw.tags,raw
  ));
}

const CARD_MAP=new Map(Object.values(CARDS).flat().map(x=>[x.name,x]));

/* 卡图合集为 17 格横向切片；卡牌顺序与各角色 CARDS 定义一致。 */
function stripArt(sheet,index,total=17){
  return {sheet,index,total};
}
CARDS.sina.forEach((d,i)=>{
  d.art=stripArt("images/sina_card_art_set.png",i);
});
CARDS.fine.forEach((d,i)=>{
  d.art=stripArt("images/fine_card_art_set.png",i);
});
CARDS["20735"].forEach((d,i)=>{
  d.art=stripArt("images/20735_card_art_set.png",i);
});

function cardFooter(d){
  if(d.stats)return `<span class="card-stat"><b>攻</b> ${d.stats.attack}</span>
    <span class="card-stat"><b>耐</b> ${d.stats.hp}</span>
    <span class="card-stat"><b>移</b> ${d.stats.move}</span>
    <span class="card-stat"><b>涂</b> ${d.stats.paint}</span>`;
  if(d.keywords.length)return d.keywords.map(x=>`<span class="card-keyword">${x}</span>`).join("");
  return `<span class="card-keyword">效果</span>`;
}

function assetUrl(path){
  return new URL(path,document.baseURI).href;
}

function cardBody(d,{headExtra="",actions=""}={}){
  const art=d.art;
  const artStyle=art?.sheet
    ?`style="--card-art:url('${assetUrl(art.sheet)}');--art-size:${art.total*100}% auto;--art-x:${art.index*100/(art.total-1)}% center"`
    :art?.image
      ?`style="--card-art:url('${assetUrl(art.image)}');--art-size:cover;--art-x:${art.position||"center"}"`
    :"";
  return `<div class="card-head">
      <div class="card-cost">${formatInk(d.cost)}</div>
      <h3 class="card-title">${d.name}</h3>
      ${headExtra}
    </div>
    <div class="card-art" ${artStyle} role="img" aria-label="${d.name}卡图"></div>
    <div class="card-meta"><span>${d.type}</span><span class="card-role">${ROLE_NAME[d.role]}</span></div>
    <div class="card-rules">${d.text}</div>
    <div class="card-footer">${cardFooter(d)}</div>
    ${actions}`;
}

function cardVisual(d,{className="",attributes="",headExtra="",actions=""}={}){
  return `<article class="game-card role-${d.role} ${className}" ${attributes}>
    ${cardBody(d,{headExtra,actions})}
  </article>`;
}

function makeInstance(def,index){
  return {
    id:uid++,
    name:def.name,
    role:def.role,
    priority:index%10,
    order:index,
    protected:false,
    handTurns:0,
    archive:null
  };
}

function getDef(inst){return CARD_MAP.get(inst.name)}

function defaultDeck(role){
  return CARDS[role].map((d,i)=>makeInstance(d,i));
}

