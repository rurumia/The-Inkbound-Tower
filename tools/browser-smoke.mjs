import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const browserPath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find(existsSync);
if (!browserPath) throw new Error("Chrome or Edge is required for the browser smoke test.");

const debugPort = 9237;
const profileDir = await mkdtemp(join(tmpdir(), "inkbound-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--no-first-run",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=1440,1000",
  "http://127.0.0.1:4173/"
], {stdio: "ignore"});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserTarget() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const targets = await response.json();
      const page = targets.find(target => target.type === "page");
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error("Edge DevTools endpoint did not become ready.");
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, {once: true});
      this.socket.addEventListener("error", reject, {once: true});
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({id, method, params}));
    return new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function screenshot(client, file) {
  const result = await client.send("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
  await writeFile(file, Buffer.from(result.data, "base64"));
}

try {
  const target = await browserTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await delay(700);

  const registration = await client.evaluate(`({
    ready: document.readyState,
    roles: ROLE_IDS,
    cards20735: CARDS["20735"].length
  })`);

  await client.evaluate(`showScreen("roles")`);
  await delay(100);
  registration.roleCards = await client.evaluate(`document.querySelectorAll("#roleGrid .role-card").length`);
  registration.has20735 = await client.evaluate(`document.getElementById("roleGrid").textContent.includes("20735")`);
  await screenshot(client, ".tmp-20735-roles.png");

  const deck = await client.evaluate(`chooseRole("20735"); ({
    screen: document.querySelector(".screen.active").id,
    role: run.role,
    deckSize: run.decks[run.role].length,
    renderedCards: document.querySelectorAll("#deckList .deck-item").length,
    archivePriorityHelpVisible: !document.getElementById("archivePriorityHelp").hidden,
    archivePriorityLabels: [...document.querySelectorAll(".priority-control span")]
      .filter(element=>element.textContent.includes("自动归档顺序")).length
  })`);
  await screenshot(client, ".tmp-20735-deck.png");

  const room = await client.evaluate(`enterRoom(); chooseOpponent("fine"); ({
    screen: document.querySelector(".screen.active").id,
    opponent: run.opponentRole,
    opponentOptions: document.querySelectorAll("#opponentGrid .opponent-option").length,
    selectedText: document.querySelector("#opponentGrid .selected").textContent.trim()
  })`);
  await delay(100);
  await screenshot(client, ".tmp-20735-room.png");

  await client.evaluate(`startBattle()`);
  await delay(900);
  const battle = await client.evaluate(`(async()=>{
    const cardArt=getComputedStyle(document.querySelector("#hand .card-art")).backgroundImage;
    const cardArtUrl=cardArt.match(/url\\(["']?(.*?)["']?\\)/)?.[1]||"";
    return {
      screen:document.querySelector(".screen.active").id,
      playerRole:B.player.role,
      enemyRole:B.enemy.role,
      playerDeckTotal:B.player.draw.length+B.player.hand.length+B.player.discard.length,
      enemyDeckTotal:B.enemy.draw.length+B.enemy.hand.length+B.enemy.discard.length,
      handCards:document.querySelectorAll("#hand .hand-card").length,
      cardArt,
      cardArtLoaded:cardArtUrl?await fetch(cardArtUrl).then(response=>response.ok).catch(()=>false):false,
      canvasPixels:document.getElementById("battleCanvas").width*document.getElementById("battleCanvas").height
    };
  })()`);
  await screenshot(client, ".tmp-20735-battle.png");

  const effects = await client.evaluate(`(async()=>{
    const results=[];
    B.speed=100;
    let summonColumn=6;
    for(const def of CARDS["20735"]){
      try{
        const source=makeInstance(def,99);
        let target=null;
        if(def.target==="summon"){
          target=B.cells.find(cell=>cell.c===summonColumn&&!cell.ground&&!cell.well);
          summonColumn++;
        }else if(def.target==="own"){
          target=B.units.find(unit=>!unit.dead&&unit.owner===1&&
            (def.name!=="系统维护"||unit.resource))||B.units.find(unit=>!unit.dead&&unit.owner===1);
        }else if(def.target==="cell"){
          target=B.cells.find(cell=>cell.c===18&&!cell.ground&&!cell.well);
          target.owner=1;
          neighbors(target).forEach(cell=>cell.owner=1);
        }else if(def.target==="overloadChoice"){
          target={payOverload:false};
        }else if(def.target==="discardArchive"){
          const choices=CARDS["20735"].slice(0,3).map((card,index)=>makeInstance(card,70+index));
          B.player.discard.push(...choices);target={instances:choices};
        }
        executeCard(def,1,target,{sourceInstance:source});
        results.push({name:def.name,ok:true});
      }catch(error){results.push({name:def.name,ok:false,error:error.message})}
    }
    try{processTurnStartResources(1);processEndResources(1)}catch(error){results.push({name:"资源钩子",ok:false,error:error.message})}
    const drones=B.units.filter(unit=>!unit.dead&&unit.owner===1&&hasTag(unit,"无人机"));
    for(const drone of drones){try{await unitAct(drone)}catch(error){results.push({name:drone.name+"行动",ok:false,error:error.message})}}
    return {passed:results.filter(item=>item.ok).length,failed:results.filter(item=>!item.ok),units:B.units.filter(unit=>!unit.dead&&unit.owner===1).length,archiveZone:B.player.archiveZone.length};
  })()`);

  const droneUi = await client.evaluate(`(()=>{
    const firstCell=B.cells.find(cell=>cell.c===20&&!cell.ground&&!cell.well);
    const secondCell=cellsRadius(firstCell,3).find(cell=>hexDistance(firstCell,cell)===3&&!cell.ground&&!cell.well);
    const mass=summonUnit(1,"量产无人机",firstCell,CARD_MAP.get("量产无人机").stats);
    const painting=summonUnit(1,"涂装无人机·Δ型",secondCell,CARD_MAP.get("涂装无人机·Δ型").stats);
    GameEffectRegistry.invoke(mass.effectId,"beforeUnitAct",{unit:mass,api:GAME_API});
    const stats=currentUnitStats(mass),base=unitBaseStats(mass);
    document.getElementById("selectionInfo").innerHTML=unitDetailHtml(mass);
    drawBattle();
    return {
      distance:hexDistance(mass.cell,painting.cell),
      linked:GameDroneLinkSystem.active(B).length>0,
      attackBoosted:stats.attack>base.attack,
      paintBoosted:stats.paint>base.paint,
      enhancedDetail:document.querySelectorAll("#selectionInfo .enhanced-stat").length>=2
    };
  })()`);
  await screenshot(client, ".tmp-20735-drone-link.png");

  const archive = await client.evaluate(`(async()=>{
    const target=B.player.hand.find(instance=>{
      const def=getDef(instance);
      if(def.target!=="summon")return false;
      const choice=archiveAutoTarget(def,1);
      return validateTarget(def,1,choice);
    });
    const def=getDef(target);
    const lockedTarget=archiveAutoTarget(def,1);
    const unitsBefore=B.units.filter(unit=>!unit.dead).length;
    const inkBefore=B.player.ink;
    const originalSubmit=submitAction;
    submitAction=async()=>{};
    useSkill();
    selectSkillHandCard(target.id);
    const enteredTargetMode=B.selected?.kind==="archiveTarget";
    commitArchiveSelection(lockedTarget);
    submitAction=originalSubmit;
    const entry=GameArchiveSystem.entries(B.player).find(candidate=>candidate.instance===target);
    previewArchiveTarget(entry.order,true);
    const hoverPreview=!!B.archivePreview?.cell&&B.archivePreview.valid;
    previewArchiveTarget(entry.order,false);
    return {
      name:target.name,
      enteredTargetMode,
      removedFromHand:!B.player.hand.includes(target),
      entries:GameArchiveSystem.entries(B.player).length,
      activeHand:GameHandSystem.activeCount(B.player),
      totalHand:B.player.hand.length,
      inkUnchanged:B.player.ink===inkBefore,
      noImmediateEffect:B.units.filter(unit=>!unit.dead).length===unitsBefore,
      targetKind:entry.targetSnapshot.kind,
      dockVisible:!document.getElementById("archiveDock").hidden,
      targetLabel:document.querySelector('[data-archive-order="'+entry.order+'"] .archive-dock-target')?.textContent||"",
      hoverPreview
    };
  })()`);

  await client.send("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await delay(150);
  const narrow = await client.evaluate(`({
    viewport:[innerWidth,innerHeight],
    bodyOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    handWidth:document.getElementById("hand").getBoundingClientRect().width,
    canvasWidth:document.getElementById("battleCanvas").getBoundingClientRect().width,
    handBottom:document.getElementById("hand").getBoundingClientRect().bottom,
    cardBottom:document.querySelector("#hand .hand-card").getBoundingClientRect().bottom,
    viewportBottom:innerHeight,
    skillScrollable:document.getElementById("skillPanel").scrollHeight>=document.getElementById("skillPanel").clientHeight,
    archiveWithinField:(()=>{
      const dock=document.getElementById("archiveDock").getBoundingClientRect();
      const field=document.getElementById("fieldWrap").getBoundingClientRect();
      return dock.left>=field.left&&dock.right<=field.right&&dock.bottom<=field.bottom;
    })()
  })`);
  await screenshot(client, ".tmp-20735-narrow.png");

  const archiveResolution = await client.evaluate(`(()=>{
    const entry=GameArchiveSystem.entries(B.player).find(candidate=>candidate.source==="skill");
    const instance=entry.instance,def=getDef(instance);
    const lockedCell=cellAt(entry.targetSnapshot.r,entry.targetSnapshot.c);
    const matchingUnitsBefore=B.units.filter(unit=>!unit.dead&&unit.name===def.name).length;
    if(!lockedCell.ground)summonUnit(1,"归档阻挡物",lockedCell,{attack:0,hp:1,move:0,paint:0,ai:"avoid"});
    entry.remaining=1;
    const storedEntry=B.player.archiveZone.find(candidate=>candidate.instance===instance);
    storedEntry.remaining=1;
    B.player.archiveZone=[storedEntry];
    processArchiveEnd(1);
    return {
      released:!GameArchiveSystem.entries(B.player).some(candidate=>candidate.instance===instance),
      discarded:B.player.discard.includes(instance),
      invalidTargetFizzled:B.units.filter(unit=>!unit.dead&&unit.name===def.name).length===matchingUnitsBefore
    };
  })()`);

  const archiveRules = await client.evaluate(`(()=>{
    const def=CARD_MAP.get("效率优化指令");
    const snapshot={kind:"choice",payload:{payOverload:true}};
    const side={};
    const inkBefore=B.player.ink;
    GameEffectRegistry.invoke(def.effectId,"play",{
      owner:1,target:{payOverload:true},side,archived:true,archiveSource:"skill",api:GAME_API
    });
    return {
      wait:GameArchiveCastSystem.waitTurns(def,snapshot),
      inkUnchanged:B.player.ink===inkBefore,
      skipped:(side.skipTurns||0)===0
    };
  })()`);

  const matrixRules = await client.evaluate(`(()=>{
    const interior=B.cells.find(cell=>cell.c===12&&!cell.ground&&!cell.well&&neighbors(cell).length===6&&
      neighbors(cell).every(next=>!next.ground&&!next.well));
    interior.owner=1;
    neighbors(interior).forEach(cell=>cell.owner=1);
    const edge=B.cells.find(cell=>canPlaceFortification(1,cell));
    return {interiorRejected:!canPlaceFortification(1,interior),edgeAvailable:!!edge};
  })()`);

  const crystalImmunity = await client.evaluate(`(()=>{
    const cell=B.cells.find(current=>current.c===46&&!current.ground&&!current.well&&!current.crystal);
    cell.owner=2;
    cell.studied=false;
    cell.spellBlocked=false;
    crystallize(cell,{source:"test"});
    const ownerBefore=cell.owner;
    const neutralized=GAME_API.neutralize(cell,{source:"card"});
    const studied=markStudied(cell,{source:"skill"});
    const spellBlocked=MapRules.tryCellEffect(cell,"spell-block",current=>{
      current.spellBlocked=true;
    },{source:"card"});
    GameEffectRegistry.invoke("20735.area-purge","play",{
      owner:1,target:cell,side:B.player,api:GAME_API
    });
    return {
      neutralizeBlocked:neutralized===false,
      studyBlocked:studied===false,
      spellBlockBlocked:spellBlocked===false,
      ownerUnchanged:cell.owner===ownerBefore,
      crystalPreserved:cell.crystal===true,
      stateUnchanged:cell.studied===false&&cell.spellBlocked===false
    };
  })()`);

  const frontierSeeking = await client.evaluate(`(()=>{
    GameModifierSystem.startTurn(B.player);
    B.cells.forEach(cell=>{cell.owner=1});
    const origin=B.cells.find(cell=>{
      if(cell.ground||cell.well||cell.crystal)return false;
      let current=cell;
      for(let step=0;step<8;step++){
        current=neighborInDirection(current,0);
        if(!current||current.ground||current.well||current.crystal)return false;
      }
      return true;
    });
    let target=origin;
    for(let step=0;step<8;step++)target=neighborInDirection(target,0);
    target.owner=0;
    const seeker=summonUnit(1,"前线寻路测试",origin,{attack:0,hp:2,move:3,paint:1,ai:"expand"});
    const before=hexDistance(seeker.cell,target);
    const plan=planSpiritAction(seeker);
    return {
      detectionRadius:paintDetectionRadius(seeker),
      targetDistance:before,
      movedCloser:hexDistance(plan.cell,target)<before,
      pathLength:plan.path.length,
      usedFrontierMode:plan.reason.startsWith("前线寻路")
    };
  })()`);

  const runtimeErrors = client.events.filter(event => event.method === "Runtime.exceptionThrown")
    .map(event => event.params.exceptionDetails.text);
  console.log(JSON.stringify({registration, deck, room, battle, effects, droneUi, archive, narrow, archiveResolution, archiveRules, matrixRules, crystalImmunity, frontierSeeking, runtimeErrors}, null, 2));
  client.close();
} finally {
  browser.kill();
  await delay(300);
  await rm(profileDir, {recursive: true, force: true}).catch(() => {});
}
