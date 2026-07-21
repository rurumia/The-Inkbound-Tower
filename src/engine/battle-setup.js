"use strict";

/* =========================================================
   战斗初始化
========================================================= */

function createCells(){
  const cells=[],map=new Map();
  for(let r=0;r<RULES.rows;r++){
    for(let c=0;c<rowLength(r);c++){
      const x={
        r,c,owner:0,crystal:false,studied:false,
        permanentCrystal:false,permanentStudied:false,
        wallCrystalSources:new Set(),studySources:new Set(),
        spellBlocked:false,ground:null,air:null,well:null
      };
      cells.push(x);map.set(key(r,c),x);
    }
  }
  return {cells,map};
}

function createSide(owner,role,deck,rng){
  const draw=shuffle(deck.map(x=>({...x,id:uid++})),rng);
  return {
    owner,role,ink:RULES.initialInk,cap:RULES.initialCap,
    draw,hand:[],discard:[],archiveZone:[],skillCd:0,
    sacrifices:0,spellRefunds:0,landedThisTurn:false,
    skipNext:false,skipTurns:0,playedAggressive:false,bonusPlayAfterSacrifice:false,
    cooledUnitIds:new Set(),coolingProtocolComplete:false
  };
}

function startBattle(){
  const seed=(Date.now()&0x7fffffff);
  const rng=seeded(seed);
  const map=createCells();
  const enemyRole=opponentRole(run.role);

  B={
    seed,rng,
    cells:map.cells,cellMap:map.map,
    wells:[],units:[],
    player:createSide(1,run.role,run.decks[run.role],rng),
    enemy:createSide(2,enemyRole,defaultDeck(enemyRole),rng),
    current:1,
    global:0,round:0,birth:0,
    busy:false,ended:false,
    selected:null,targetStep:0,targetData:null,archivePreview:null,droneLinks:[],
    intents:[],
    frenzyStart:battleSettings.frenzy,
    fastFrenzyStart:battleSettings.frenzy+20,
    settlementLimit:battleSettings.settlement,
    speed:1,
    camera:{scale:1,ox:0,oy:0},
    dirty:true
  };

  generateWells();
  spawnInitialUnits();
  drawTo(B.player,5);
  drawTo(B.enemy,5);
  refillIntents();

  showScreen("battle");
  syncBattleSettingControls();
  setupCanvas();
  centerCamera();
  startTurn(1);
}

function generateWells(){
  const ranges=[[5,18],[22,38],[42,55]];
  ranges.forEach((range,i)=>{
    let cell;
    do{
      const r=4+Math.floor(B.rng()*22);
      const c=range[0]+Math.floor(B.rng()*(range[1]-range[0]+1));
      cell=cellAt(r,Math.min(c,rowLength(r)-1));
    }while(!cell||cell.well);
    const well={id:i,cell,owner:0,pending:0};
    cell.well=well;
    B.wells.push(well);
  });
}

function spawnInitialUnits(){
  const p=[[13,4],[15,4],[14,7]];
  const e=[[13,55],[15,55],[14,52]];
  const defs=[
    ["Spreader",{attack:1,hp:3,move:2,paint:2,ai:"avoid"}],
    ["Resource",{attack:1,hp:4,move:2,paint:1,ai:"expand"}],
    ["Fighter",{attack:3,hp:2,move:2,paint:1,ai:"aggressive"}]
  ];
  defs.forEach((d,i)=>{
    summonUnit(1,d[0],cellAt(...p[i]),d[1],{initial:true});
    summonUnit(2,d[0],cellAt(...e[i]),d[1],{initial:true});
  });
}

