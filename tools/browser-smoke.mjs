import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

const browserPath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find(existsSync);
if (!browserPath) throw new Error("Chrome or Edge is required for the browser smoke test.");

const debugPort = 9237;
const profileDir = await mkdtemp(join(tmpdir(), "inkbound-smoke-"));
const gameUrl = pathToFileURL(resolve("index.html")).href;
const spinePreviewUrl = pathToFileURL(resolve("spine-preview.html")).href;
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
  gameUrl
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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
    cards20735: CARDS["20735"].length,
    totalCards:Object.values(CARDS).flat().length,
    spatialCards:GameSpatialEffectProfiles.cards().length,
    spatialSkills:GameSpatialEffectProfiles.skills().length,
    brushProfiles:GameBrushProfiles.all().length,
    motionTypes:GameBrushMotion.types,
    physicalSpineBundles:Object.keys(GameSpineAssets).length,
    missingSpatialCards:Object.values(CARDS).flat().filter(card=>!GameSpatialEffectProfiles.get(card.name)).map(card=>card.name)
  })`);

  await client.evaluate(`showScreen("roles")`);
  await delay(100);
  registration.roleCards = await client.evaluate(`document.querySelectorAll("#roleGrid .role-card").length`);
  registration.has20735 = await client.evaluate(`document.getElementById("roleGrid").textContent.includes("20735")`);
  const spineRuntime = await client.evaluate(`(async()=>{
    const canvas=document.createElement("canvas");
    const gl=canvas.getContext("webgl2")||canvas.getContext("webgl");
    if(!gl)throw new Error("Spine smoke test requires WebGL");
    const names=["spawn","idle","move","attack","hurt","death"];
    const profile={id:"smoke.spirit",textureFile:"texture.png",scale:1};
    const asset={
      skeleton:{
        skeleton:{hash:"smoke",spine:"4.2.43",x:0,y:0,width:1,height:1},
        bones:[{name:"root"}],
        animations:Object.fromEntries(names.map(name=>[name,{}]))
      },
      atlas:"texture.png\\nsize: 1,1\\nformat: RGBA8888\\nfilter: Nearest,Nearest\\nrepeat: none\\n",
      textureDataUrl:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    };
    const entity=await GameSpineRuntimeAdapter.create({gl,profile,assets:{[profile.id]:asset}});
    entity.update(1/60);
    const result={
      adapterVersion:GameSpineRuntimeAdapter.version,
      animation:entity.state.getCurrent(0)?.animation?.name||null,
      skeletonVersion:entity.skeletonData.version||"4.2.43"
    };
    entity.dispose();
    return result;
  })()`);
  const spineAssetCoverage = await client.evaluate(`(async()=>{
    const canvas=document.createElement("canvas");
    const gl=canvas.getContext("webgl2")||canvas.getContext("webgl");
    if(!gl)throw new Error("Spine asset coverage requires WebGL");
    const rows=[];
    for(const profile of GameSpiritVisualProfiles.all()){
      const entity=await GameSpineRuntimeAdapter.create({gl,profile});
      for(const animation of profile.requiredAnimations){
        entity.setAnimation(animation,false);
        entity.update(1/60);
      }
      rows.push({
        id:profile.id,
        assetId:profile.assetId,
        animations:profile.requiredAnimations.length,
        bones:entity.skeletonData.bones.length,
        slots:entity.skeletonData.slots.length
      });
      entity.dispose();
    }
    return {count:rows.length,independent:rows.every(row=>row.id===row.assetId),rows};
  })()`);
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
  for(let attempt=0;attempt<30;attempt++){
    if(await client.evaluate(`GameProductionBattlefield?.spineStage?.views?.size>=6`).catch(()=>false))break;
    await delay(100);
  }
  for(let attempt=0;attempt<30;attempt++){
    if(await client.evaluate(`GameProductionBattlefield?.terrainRenderer?.diagnostics?.().backgroundDraws>0`).catch(()=>false))break;
    await delay(100);
  }
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
      cardArtLoaded:cardArtUrl?await new Promise(resolve=>{
        const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=cardArtUrl;
      }):false,
      canvasPixels:document.getElementById("battleCanvas").width*document.getElementById("battleCanvas").height,
      layers:[...document.querySelectorAll("#fieldWrap [data-battlefield-layer]")].map(canvas=>({
        layer:canvas.dataset.battlefieldLayer,size:[canvas.width,canvas.height]
      })),
      controlField:[B.spatial.paint.width,B.spatial.paint.height],
      terrainResolution:Object.values(GameProductionBattlefield.terrainRenderer.resolution()),
      terrainDiagnostics:GameProductionBattlefield.terrainRenderer.diagnostics(),
      territory:B.spatial.paint.measure(),
      perspective:(()=>{
        const camera=GameProductionBattlefield.camera;
        const source={x:18.25,y:9.75};
        const restored=camera.screenToWorld(camera.worldToScreen(source));
        const aspectAt=y=>{
          const points=GameContinuousOverlayRenderer.projectedCirclePoints({x:30,y},.5,camera,128);
          const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
          return (Math.max(...xs)-Math.min(...xs))/(Math.max(...ys)-Math.min(...ys));
        };
        return {
          farRatio:camera.scaleAt({x:30,y:0})/camera.scaleAt({x:30,y:30}),
          roundTrip:GameWorldSpace.distance(source,restored),
          farGroundCircleAspect:aspectAt(1),
          nearGroundCircleAspect:aspectAt(29)
        };
      })(),
      wellIncomeDisplay:formatInk(INK_WELL_INCOME),
      initialBattleScale:GameSpiritVisualProfiles.all().filter(profile=>profile.id.startsWith("initial.")).map(profile=>profile.battleScale),
      otherBattleScale:GameSpiritVisualProfiles.all().filter(profile=>!profile.id.startsWith("initial.")).map(profile=>profile.battleScale),
      spineVisualOffsetYU:GameContinuousSpineStage.visualOffsetYU,
      initialJudgmentRadii:B.units.filter(unit=>["Spreader","Resource","Fighter"].includes(unit.name)).map(unit=>unit.body?.radius??.35),
      overlayRules:(()=>{
        const unit=B.units.find(candidate=>!candidate.dead);
        const center=GameBattlefieldAdapter.unitPosition(unit);
        const preview={kind:"circle",center,radiusU:1.5};
        return {
          wellFrames:[
            GameContinuousOverlayRenderer.wellStateFrame({owner:0,pending:0}),
            GameContinuousOverlayRenderer.wellStateFrame({owner:1,pending:0}),
            GameContinuousOverlayRenderer.wellStateFrame({owner:2,pending:0}),
            GameContinuousOverlayRenderer.wellStateFrame({owner:0,pending:1})
          ],
          wellSprite:GameContinuousOverlayRenderer.wellSpriteUrl,
          wellVisualSizeU:GameContinuousOverlayRenderer.wellVisualSizeU,
          wellBillboard:GameContinuousOverlayRenderer.wellBillboard,
          wellStateTransition:GameContinuousOverlayRenderer.wellStateTransition,
          spineBillboards:[...GameProductionBattlefield.spineStage.views.values()].every(view=>
            Math.abs(Math.abs(view.entity.skeleton.scaleX)-view.entity.skeleton.scaleY)<1e-9),
          previewTouches:GameContinuousOverlayRenderer.previewTouchesUnit(preview,unit),
          circleScaleRatio:GameProductionBattlefield.camera.scaleAt({x:30,y:0})/
            GameProductionBattlefield.camera.scaleAt({x:30,y:30}),
          circleProjectionMatches:(()=>{
            const camera=GameProductionBattlefield.camera;
            const points=GameContinuousOverlayRenderer.projectedCirclePoints(center,1,camera,4);
            const world=[{x:center.x+1,y:center.y},{x:center.x,y:center.y+1},{x:center.x-1,y:center.y},{x:center.x,y:center.y-1}]
              .map(camera.worldToScreen);
            return points.every((point,index)=>Math.hypot(point.x-world[index].x,point.y-world[index].y)<1e-9);
          })(),
          summonPreview:(()=>{
            const target=B.cells.find(cell=>!cell.well&&cell.c>=30);
            const preview=GameContinuousOverlayRenderer.summonIntentPreview({
              intents:[{cardTarget:"summon",target,name:"禁咒守卫",meaningful:true}]
            });
            return preview?.name==="禁咒守卫"&&preview.radiusU===.82&&
              GameWorldSpace.distance(preview.center,GameBattlefieldAdapter.cellToWorld(target))<1/256;
          })()
        };
      })(),
      spineViews:GameProductionBattlefield.spineStage.views.size,
      spineOpaquePixels:(()=>{
        const canvas=document.getElementById("spineCanvas");
        const gl=GameProductionBattlefield.stage.getLayer("spine").context;
        const pixels=new Uint8Array(canvas.width*canvas.height*4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let count=0;for(let index=3;index<pixels.length;index+=4)if(pixels[index])count++;
        return count;
      })()
    };
  })()`);
  if(registration.totalCards!==51||registration.spatialCards!==51||registration.spatialSkills!==3||
    registration.brushProfiles!==33||registration.motionTypes.join(",")!=="arc,sweep,flow"||
    registration.physicalSpineBundles!==33||registration.missingSpatialCards.length){
    throw new Error(`Content coverage failed: ${JSON.stringify(registration)}`);
  }
  if(spineAssetCoverage.count!==33||!spineAssetCoverage.independent||
    spineAssetCoverage.rows.some(row=>row.animations<6||row.bones<1||row.slots<5)){
    throw new Error(`Spine asset coverage failed: ${JSON.stringify(spineAssetCoverage)}`);
  }
  if(battle.layers.length!==3||new Set(battle.layers.map(layer=>layer.size.join("x"))).size!==1||
    battle.controlField.join("x")!=="1920x960"||battle.terrainResolution[0]<960||battle.terrainResolution[1]<480||
    !battle.terrainDiagnostics.backgroundReady||battle.terrainDiagnostics.backgroundUrl!=="images/battle_scroll_field.webp"||
    battle.terrainDiagnostics.backgroundWidthScale!==1.36||
    battle.terrainDiagnostics.backgroundHeightScale!==1.16||
    battle.terrainDiagnostics.backgroundVisualScale!==1.15||
    battle.terrainDiagnostics.backgroundOffsetYU!==-.5||
    battle.terrainDiagnostics.inkEdgeMode!=="brush-soft"||
    battle.terrainDiagnostics.inkEdgeFeatherU!==1.25||battle.terrainDiagnostics.battlefieldOutline!==false||
    Math.abs(battle.perspective.farRatio-.7)>1e-12||battle.perspective.roundTrip>1/256||
    battle.perspective.farGroundCircleAspect<1.3||
    Math.abs(battle.perspective.nearGroundCircleAspect-1)>.05||battle.wellIncomeDisplay!=="1"||
    battle.initialBattleScale.some(scale=>scale!==1)||battle.otherBattleScale.some(scale=>scale!==2.5)||
    battle.spineVisualOffsetYU!==1||
    battle.initialJudgmentRadii.some(radius=>radius!==.35)||
    battle.overlayRules.wellFrames.join(",")!=="0,1,2,3"||
    !battle.overlayRules.wellSprite.includes("ink_well_states_transparent.webp")||
    battle.overlayRules.wellVisualSizeU!==2.2||
    !battle.overlayRules.wellBillboard||battle.overlayRules.wellStateTransition!==false||!battle.overlayRules.spineBillboards||
    !battle.overlayRules.previewTouches||!battle.overlayRules.summonPreview||Math.abs(battle.overlayRules.circleScaleRatio-.7)>1e-12||
    !battle.overlayRules.circleProjectionMatches||battle.terrainDiagnostics.backgroundDraws<1||
    battle.spineViews<6||battle.spineOpaquePixels<100){
    throw new Error(`Production battlefield failed: ${JSON.stringify(battle)}`);
  }
  await screenshot(client, ".tmp-20735-battle.png");

  const unitHover = await client.evaluate(`(()=>{
    const unit=B.units.find(candidate=>!candidate.dead&&candidate.owner===1&&candidate.name==="Spreader");
    unit.effectAttack+=1;unit.effectMove-=1;
    const canvas=document.getElementById("overlayCanvas");
    const canvasRect=canvas.getBoundingClientRect();
    const screen=GameProductionBattlefield.camera.worldToScreen(GameBattlefieldAdapter.unitPosition(unit));
    const pointer={x:canvasRect.left+screen.x,y:canvasRect.top+screen.y};
    canvas.dispatchEvent(new MouseEvent("mousemove",{clientX:pointer.x,clientY:pointer.y,bubbles:true}));
    const popover=document.getElementById("unitHoverCard");
    const cardRect=popover.getBoundingClientRect();
    const positive=popover.querySelector(".unit-stat-delta.positive");
    const negative=popover.querySelector(".unit-stat-delta.negative");
    window.__hoverSmoke={unit,attack:unit.effectAttack,move:unit.effectMove,pointer};
    return {
      visible:!popover.hidden,
      unitId:Number(popover.dataset.unitId),
      expectedUnitId:unit.id,
      title:popover.querySelector(".card-title")?.textContent||"",
      positive:positive?.textContent||"",
      negative:negative?.textContent||"",
      positiveColor:positive?getComputedStyle(positive).color:"",
      negativeColor:negative?getComputedStyle(negative).color:"",
      diagonal:(cardRect.right<=pointer.x||cardRect.left>=pointer.x)&&
        (cardRect.bottom<=pointer.y||cardRect.top>=pointer.y),
      inViewport:cardRect.left>=0&&cardRect.top>=0&&cardRect.right<=innerWidth&&cardRect.bottom<=innerHeight
    };
  })()`);
  if(!unitHover.visible||unitHover.unitId!==unitHover.expectedUnitId||unitHover.title!=="Spreader"||
    unitHover.positive!=="(+1)"||unitHover.negative!=="(-1)"||
    unitHover.positiveColor===unitHover.negativeColor||!unitHover.diagonal||!unitHover.inViewport){
    throw new Error(`Unit hover card failed: ${JSON.stringify(unitHover)}`);
  }
  await screenshot(client, ".tmp-unit-hover-card.png");
  const spineHover = await client.evaluate(`(()=>{
    const canvas=document.getElementById("overlayCanvas"),rect=canvas.getBoundingClientRect();
    const visual=unitVisualHoverPoint(window.__hoverSmoke.unit);
    const screen=GameProductionBattlefield.camera.worldToScreen(visual);
    canvas.dispatchEvent(new MouseEvent("mousemove",{
      clientX:rect.left+screen.x,clientY:rect.top+screen.y,bubbles:true
    }));
    const popover=document.getElementById("unitHoverCard");
    return {visible:!popover.hidden,unitId:Number(popover.dataset.unitId),expectedUnitId:window.__hoverSmoke.unit.id};
  })()`);
  if(!spineHover.visible||spineHover.unitId!==spineHover.expectedUnitId){
    throw new Error(`Spine hover card failed: ${JSON.stringify(spineHover)}`);
  }
  const coordinateHover = await client.evaluate(`(()=>{
    const canvas=document.getElementById("overlayCanvas");
    const rect=canvas.getBoundingClientRect();
    const world={x:12.34,y:5.4};
    const screen=GameProductionBattlefield.camera.worldToScreen(world);
    const resolved=GameProductionBattlefield.camera.screenToWorld(screen);
    const expected="坐标 "+(Math.round(resolved.x*10)/10).toFixed(1)+"U, "+
      (Math.round(resolved.y*10)/10).toFixed(1)+"U";
    canvas.dispatchEvent(new MouseEvent("mousemove",{
      clientX:rect.left+screen.x,clientY:rect.top+screen.y,bubbles:true
    }));
    const display=document.getElementById("fieldCoordinates");
    const text=display.textContent;
    const visibleBeforeHide=!display.hidden;
    canvas.dispatchEvent(new MouseEvent("mouseleave",{bubbles:true}));
    return {text,expected,visibleBeforeHide,hiddenAfterLeave:display.hidden};
  })()`);
  if(!/^坐标 \d+\.\dU, \d+\.\dU$/.test(coordinateHover.text)||!coordinateHover.visibleBeforeHide||
    !coordinateHover.hiddenAfterLeave){
    throw new Error(`Field coordinate display failed: ${JSON.stringify(coordinateHover)}`);
  }
  unitHover.hidesForSelection = await client.evaluate(`(()=>{
    B.selected={kind:"card",def:B.player.hand.length?getDef(B.player.hand[0]):CARD_MAP.get("系统维护")};
    const canvas=document.getElementById("overlayCanvas"),point=window.__hoverSmoke.pointer;
    canvas.dispatchEvent(new MouseEvent("mousemove",{clientX:point.x,clientY:point.y,bubbles:true}));
    const hidden=document.getElementById("unitHoverCard").hidden;
    const {unit,attack,move}=window.__hoverSmoke;
    unit.effectAttack=attack-1;unit.effectMove=move+1;
    B.selected=null;delete window.__hoverSmoke;
    return hidden;
  })()`);
  if(!unitHover.hidesForSelection)throw new Error(`Unit hover card stayed visible during card selection: ${JSON.stringify(unitHover)}`);

  const wellHover = await client.evaluate(`(()=>{
    const livingUnits=B.units.filter(unit=>!unit.dead);
    const well=[...B.wells].sort((left,right)=>{
      const distance=current=>Math.min(...livingUnits.map(unit=>GameWorldSpace.distance(
        GameBattlefieldAdapter.cellToWorld(current.cell),GameBattlefieldAdapter.unitPosition(unit)
      )));
      return distance(right)-distance(left);
    })[0],canvas=document.getElementById("overlayCanvas");
    const canvasRect=canvas.getBoundingClientRect();
    const screen=GameProductionBattlefield.camera.worldToScreen(GameBattlefieldAdapter.cellToWorld(well.cell));
    const pointer={x:canvasRect.left+screen.x,y:canvasRect.top+screen.y};
    canvas.dispatchEvent(new MouseEvent("mousemove",{clientX:pointer.x,clientY:pointer.y,bubbles:true}));
    const popover=document.getElementById("unitHoverCard");
    const art=popover.querySelector(".card-art");
    window.__wellHoverSmoke={well,pointer};
    return {
      visible:!popover.hidden,
      wellId:Number(popover.dataset.wellId),
      expectedWellId:well.id,
      title:popover.querySelector(".card-title")?.textContent||"",
      rules:popover.querySelector(".card-rules")?.textContent||"",
      income:formatInk(INK_WELL_INCOME),
      role:popover.querySelector(".card-role")?.textContent||"",
      art:getComputedStyle(art).backgroundImage
    };
  })()`);
  if(!wellHover.visible||wellHover.wellId!==wellHover.expectedWellId||wellHover.title!=="墨井"||
    !wellHover.rules.includes("66%")||!wellHover.rules.includes("1 墨水")||wellHover.income!=="1"||
    !wellHover.art.includes("ink_well_card_art.webp")){
    throw new Error(`Ink well hover card failed: ${JSON.stringify(wellHover)}`);
  }
  await screenshot(client, ".tmp-ink-well-hover-card.png");
  wellHover.unitTakesPriority = await client.evaluate(`(()=>{
    const {well,pointer}=window.__wellHoverSmoke;
    const unit=B.units.find(candidate=>!candidate.dead);
    const originalPosition=unit._displayPosition;
    unit._displayPosition=GameBattlefieldAdapter.cellToWorld(well.cell);
    const canvas=document.getElementById("overlayCanvas");
    canvas.dispatchEvent(new MouseEvent("mousemove",{clientX:pointer.x,clientY:pointer.y,bubbles:true}));
    const popover=document.getElementById("unitHoverCard");
    const prioritized=Number(popover.dataset.unitId)===unit.id&&popover.querySelector(".card-title")?.textContent===unit.name;
    if(originalPosition)unit._displayPosition=originalPosition;else delete unit._displayPosition;
    canvas.dispatchEvent(new MouseEvent("mouseleave",{bubbles:true}));
    delete window.__wellHoverSmoke;
    return prioritized;
  })()`);
  if(!wellHover.unitTakesPriority)throw new Error(`Spirit did not take hover priority over ink well: ${JSON.stringify(wellHover)}`);

  const intentHover = await client.evaluate(`(()=>{
    const savedIntents=B.intents;
    const summonDef=CARD_MAP.get("修复无人机·Ω型");
    const target=B.cells.find(cell=>cell.c>=30&&!cell.ground&&!cell.well&&
      !continuousRegionAt("crystal",cell)&&!continuousRegionAt("spellBlock",cell));
    B.intents=[
      {instanceId:91001,name:summonDef.name,cardTarget:"summon",target,targetHint:describeIntentTarget(summonDef,target),meaningful:true},
      {instanceId:91002,name:"系统维护",cardTarget:"none",target:null,targetHint:"无目标",meaningful:true},
      {instanceId:91003,name:"备用能源调配",cardTarget:"own",target:B.units.find(unit=>unit.owner===2),targetHint:"己方书灵",meaningful:true}
    ];
    updateUI();
    const canvas=document.getElementById("overlayCanvas"),canvasRect=canvas.getBoundingClientRect();
    const screen=GameProductionBattlefield.camera.worldToScreen(GameBattlefieldAdapter.cellToWorld(target));
    canvas.dispatchEvent(new MouseEvent("mousemove",{
      clientX:canvasRect.left+screen.x,clientY:canvasRect.top+screen.y,bubbles:true
    }));
    const popover=document.getElementById("unitHoverCard");
    const battlefield={visible:!popover.hidden,title:popover.querySelector(".card-title")?.textContent,
      source:popover.dataset.intentSource};
    const hud=[];
    document.querySelectorAll("#intentRow .intent").forEach((element,index)=>{
      const rect=element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("mousemove",{
        clientX:(rect.left+rect.right)/2,clientY:(rect.top+rect.bottom)/2,bubbles:true
      }));
      hud.push({title:popover.querySelector(".card-title")?.textContent,source:popover.dataset.intentSource,index});
    });
    B.intents=savedIntents;updateUI();hideUnitHoverCard();
    return {battlefield,hud};
  })()`);
  if(!intentHover.battlefield.visible||intentHover.battlefield.title!=="修复无人机·Ω型"||
    intentHover.battlefield.source!=="battlefield"||
    intentHover.hud.map(item=>item.title).join(",")!=="修复无人机·Ω型,系统维护,备用能源调配"||
    intentHover.hud.some(item=>item.source!=="hud")){
    throw new Error(`Enemy intent hover cards failed: ${JSON.stringify(intentHover)}`);
  }

  const summonRetarget = await client.evaluate(`(()=>{
    const savedIntents=B.intents;
    const existingRepair=B.enemy.hand.find(instance=>instance.name==="修复无人机·Ω型");
    const repair=existingRepair||{...makeInstance(CARD_MAP.get("修复无人机·Ω型"),0),name:"修复无人机·Ω型"};
    if(!existingRepair)B.enemy.hand.push(repair);
    const blocked=B.cells.find(cell=>cell.c>=30&&!cell.ground&&!cell.well);
    const shape=GameContinuousGeometry.circle(GameBattlefieldAdapter.cellToWorld(blocked),1.5);
    const crystal=B.spatial.regions.add({id:"smoke-intent-crystal",type:"crystal",shape,owner:1,permanent:false});
    B.intents=[{instanceId:repair.id,name:repair.name,cardTarget:"summon",target:blocked,
      targetHint:describeIntentTarget(CARD_MAP.get(repair.name),blocked),meaningful:true}];
    const crystalAllowed=legalSummonCell(2,blocked);
    refreshSummonIntents();
    const crystalTargetKept=B.intents[0].target===blocked;
    B.spatial.regions.remove(crystal.id);
    const spellBlock=B.spatial.regions.add({id:"smoke-intent-spell-block",type:"spellBlock",shape,owner:1,permanent:false});
    const blockedRejected=!legalSummonCell(2,blocked);
    refreshSummonIntents();
    const retargeted=B.intents[0].target;
    const retargetedCenter=retargeted&&GameBattlefieldAdapter.cellToWorld(retargeted);
    const legal=retargeted&&retargeted!==blocked&&legalSummonCell(2,retargeted)&&retargetedCenter.x>=30;
    const playerHalf=B.cells.find(cell=>GameBattlefieldAdapter.cellToWorld(cell).x<30&&!cell.ground&&!cell.well);
    const playerHalfRejected=!legalSummonCell(2,playerHalf)&&
      summonUnit(2,"修复无人机·Ω型",playerHalf,CARD_MAP.get("修复无人机·Ω型").stats)===null;
    B.spatial.regions.remove(spellBlock.id);
    if(!existingRepair)B.enemy.hand.splice(B.enemy.hand.indexOf(repair),1);
    B.intents=savedIntents;
    return {crystalAllowed,crystalTargetKept,blockedRejected,legal,playerHalfRejected,
      archiveCadence:[1,3,5,7].map(GameOpponentIntentRules.shouldEnemyArchive)};
  })()`);
  if(!summonRetarget.crystalAllowed||!summonRetarget.crystalTargetKept||
    !summonRetarget.blockedRejected||!summonRetarget.legal||!summonRetarget.playerHalfRejected||
    summonRetarget.archiveCadence.join(",")!=="true,false,true,false"){
    throw new Error(`Enemy summon intent retarget failed: ${JSON.stringify(summonRetarget)}`);
  }

  const brushPreview = await client.evaluate(`(()=>{
    const ids=[
      "initial.spreader","initial.resource","initial.fighter",
      "sina.charging-sparrow","fine.ink-solidifier","20735.patrol-a","20735.cycle-pump"
    ];
    const field=GamePaintField.create();
    const rows=ids.map((id,index)=>{
      const y=3+index*4;
      const type=GameBrushMotion.types[index%GameBrushMotion.types.length];
      const motion=GameBrushMotion.create([
        {x:4,y},{x:21,y:y+(index%2?.7:-.7)},{x:39,y:y+(index%2?-.7:.7)},{x:56,y}
      ],{type,seed:id});
      const path=motion.points;
      const profile=GameBrushProfiles.atRate(id,2);
      const result=GameContinuousBrushes.apply(field,profile,path,index%2?1:-1);
      const gaps=path.filter(point=>field.sample(point)==0).length;
      let maxAngleStep=0;
      for(let stamp=1;stamp<result.operations.length;stamp++){
        const delta=result.operations[stamp].shape.angle-result.operations[stamp-1].shape.angle;
        maxAngleStep=Math.max(maxAngleStep,Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta))));
      }
      const peak=result.operations.reduce((best,operation)=>operation.pressure>best.pressure?operation:best);
      return {
        id,shape:profile.shape,type,stamps:result.operations.length,gaps,maxAngleStep,
        pressure:{start:result.operations[0].pressure,peak:peak.pressure,peakAt:peak.progress,end:result.operations.at(-1).pressure}
      };
    });
    const rateShapes=[1,2,3].map(rate=>GameContinuousBrushes.operations(
      GameBrushProfiles.atRate("sina.guardian-swan",rate),[{x:4,y:15},{x:8,y:15}],1
    ).reduce((best,operation)=>operation.pressure>best.pressure?operation:best).shape);
    const footprintCells=paintFootprint(B.cells[0],B.cells[1],3).length;
    window.__brushSmokePaint=B.spatial.paint;
    B.spatial.paint=field;
    B.dirty=true;
    drawBattle();
    window.__brushSmokeArchiveHidden=document.getElementById("archiveDock").hidden;
    document.getElementById("archiveDock").hidden=true;
    for(const layer of ["spine","overlay"]){
      GameProductionBattlefield.stage.getLayer(layer).canvas.style.visibility="hidden";
    }
    return {
      rows,
      rates:rateShapes.map(shape=>({length:shape.length,width:shape.width})),
      footprintCells,
      singleTrail:footprintCells===1&&new Set(rateShapes.map((shape,index)=>
        GameContinuousBrushes.operations(
          GameBrushProfiles.atRate("sina.guardian-swan",index+1),[{x:4,y:15},{x:8,y:15}],1
        ).length
      )).size===1
    };
  })()`);
  if(brushPreview.rows.some(row=>row.gaps>0||row.maxAngleStep>.35||row.pressure.start!==.22||
    row.pressure.peak!==1||row.pressure.end!==.22)||
    JSON.stringify(brushPreview.rates)!==JSON.stringify([
      {length:1.3984375,width:.71875},
      {length:2.80078125,width:1.44140625},
      {length:4.19921875,width:2.16015625}
    ])||!brushPreview.singleTrail){
    throw new Error(`Brush continuity failed: ${JSON.stringify(brushPreview)}`);
  }
  await screenshot(client, ".tmp-brush-styles.png");
  await client.evaluate(`(()=>{
    B.spatial.paint=window.__brushSmokePaint;
    delete window.__brushSmokePaint;
    document.getElementById("archiveDock").hidden=window.__brushSmokeArchiveHidden;
    delete window.__brushSmokeArchiveHidden;
    for(const layer of ["spine","overlay"]){
      GameProductionBattlefield.stage.getLayer(layer).canvas.style.visibility="";
    }
    B.dirty=true;drawBattle();
  })()`);

  const motionPlayback = await client.evaluate(`(async()=>{
    const unit=B.units.find(candidate=>!candidate.dead&&candidate.owner===1&&movementFor(candidate)>0);
    const originalAnimate=animateUnitCurveSegment;
    const originalPlay=playUnitAnimation;
    const calls=[];
    const animations=[];
    animateUnitCurveSegment=async(current,path,duration,onProgress)=>{
      const startDistance=GameWorldSpace.distance(current._displayPosition,path[0]);
      const result=await originalAnimate(current,path,duration,progress=>{
        onProgress?.(progress);
        if(progress===0||progress===1)calls.push({progress,position:{...current._displayPosition}});
      });
      return {result,startDistance,endDistance:GameWorldSpace.distance(current._displayPosition,path.at(-1))};
    };
    playUnitAnimation=(current,animation,duration)=>{
      if(current===unit)animations.push(animation);
      return originalPlay(current,animation,duration);
    };
    const previousSpeed=B.speed;
    B.speed=10;
    try{await unitAct(unit)}finally{
      B.speed=previousSpeed;
      animateUnitCurveSegment=originalAnimate;
      playUnitAnimation=originalPlay;
    }
    return {
      samples:calls.length,
      movementStarts:animations.filter(animation=>animation==="move"||animation==="fly").length,
      movementStops:animations.filter(animation=>animation==="idle").length,
      displayPositionCleared:!("_displayPosition" in unit)
    };
  })()`);
  if(!motionPlayback.samples||motionPlayback.movementStarts!==1||motionPlayback.movementStops!==1||
    !motionPlayback.displayPositionCleared){
    throw new Error(`Smooth movement playback failed: ${JSON.stringify(motionPlayback)}`);
  }

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
          if(def.name==="防御矩阵"){
            const matrixCenter=GameBattlefieldAdapter.cellToWorld(target);
            B.spatial.paint.apply({shape:GameContinuousGeometry.circle(matrixCenter,1.8),owner:1,kind:"paint",strength:1});
            target=B.cells.find(cell=>canPlaceFortification(1,cell))||target;
          }
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
    const interior=B.cells.find(cell=>cell.c===12&&cell.r===15&&!cell.ground&&!cell.well);
    const matrixCenter=GameBattlefieldAdapter.cellToWorld(interior);
    B.spatial.paint.apply({shape:GameContinuousGeometry.circle(matrixCenter,2),owner:1,kind:"paint",strength:1});
    const edge=B.cells.find(cell=>GameWorldSpace.distance(matrixCenter,GameBattlefieldAdapter.cellToWorld(cell))>1&&
      canPlaceFortification(1,cell));
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

  const areaPurgePerformance = await client.evaluate(`(()=>{
    const previousSpatial=B.spatial;
    const regions=GameContinuousRegions.create();
    const paint=GamePaintField.create({regions});
    B.spatial={regions,paint};
    paint.apply({
      shape:GameContinuousGeometry.rect({x:30,y:15},10,30),owner:-1,kind:"paint",strength:1,skipRegionChecks:true
    });
    for(let index=0;index<80;index++){
      const x=25.5+(index%8)*1.25;
      const y=.75+Math.floor(index/8)*3.1;
      regions.add({
        id:"purge-stress-"+index,type:index%2?"spellBlock":"crystal",owner:index%3-1,
        shape:GameContinuousGeometry.circle({x,y},.48),permanent:true
      });
    }
    const started=performance.now();
    let outcome;
    try{
      const result=GAME_API.applySpatialEffect("区域净化协议",{x:30,y:15},{
        owner:1,mode:"neutralize",kind:"effect",source:"card"
      });
      const durationMs=performance.now()-started;
      outcome={
        durationMs,changedSamples:result.changedSamples,
        crystalPreserved:paint.sample({x:25.5,y:.75})<-.9,
        spellBlockPreserved:paint.sample({x:26.75,y:.75})<-.9,
        openBandNeutralized:Math.abs(paint.sample({x:30,y:2.2}))<.01
      };
    }catch(error){
      outcome={durationMs:performance.now()-started,error:String(error?.stack||error)};
    }
    B.spatial=previousSpatial;
    return outcome;
  })()`);
  if(areaPurgePerformance.durationMs>300||!areaPurgePerformance.changedSamples||
    !areaPurgePerformance.crystalPreserved||!areaPurgePerformance.spellBlockPreserved||
    !areaPurgePerformance.openBandNeutralized){
    throw new Error(`Area purge performance failed: ${JSON.stringify(areaPurgePerformance)}`);
  }

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
    const seeker=summonUnit(1,"前线寻路测试",origin,{attack:0,hp:2,move:3,paint:1,ai:"expand"},{initial:true});
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

  await client.send("Emulation.setDeviceMetricsOverride", {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
  const materialEffects = await client.evaluate(`(()=>{
    const captureWell=B.wells[0];
    const captureRing=neighbors(captureWell.cell);
    captureWell.owner=0;captureWell.pending=0;
    captureRing.forEach((cell,index)=>{cell.owner=index<4?1:0});
    updateWells();
    const pendingAtFourOfSix=captureWell.pending===1&&captureWell.owner===0;
    updateWells();
    const capturedAtFourOfSix=captureWell.owner===1;
    B.spatial.paint.apply({
      shape:GameContinuousGeometry.pathStroke([{x:5,y:6},{x:18,y:7.5},{x:28,y:5.5}],1.25),
      owner:1,kind:"paint",strength:1
    });
    B.spatial.paint.apply({
      shape:GameContinuousGeometry.pathStroke([{x:55,y:22},{x:43,y:20},{x:32,y:23}],1.4),
      owner:-1,kind:"paint",strength:1
    });
    B.spatial.paint.apply({
      shape:GameContinuousGeometry.rect({x:.75,y:15},1.5,20),
      owner:1,kind:"paint",strength:1
    });
    B.spatial.regions.add({
      id:"smoke-study",type:"study",owner:1,
      shape:GameContinuousGeometry.circle({x:20,y:18},3),permanent:true
    });
    B.spatial.regions.add({
      id:"smoke-crystal",type:"crystal",owner:-1,
      shape:GameContinuousGeometry.rect({x:40,y:10},7,5),permanent:true
    });
    [
      {id:"smoke-neutral-a",center:{x:13.5,y:23}},
      {id:"smoke-neutral-b",center:{x:14.5,y:23}},
      {id:"smoke-neutral-c",center:{x:14,y:24}}
    ].forEach(item=>B.spatial.regions.add({
      id:item.id,type:"crystal",owner:0,
      shape:GameContinuousGeometry.circle(item.center,.52),permanent:true
    }));
    B.dirty=true;
    drawBattle();
    const fullTerrain=GameProductionBattlefield.terrainRenderer.diagnostics();
    const patchPoint={x:10,y:15};
    const patchOwner=B.spatial.paint.sample(patchPoint)>=0?-1:1;
    B.spatial.paint.apply({
      shape:GameContinuousGeometry.circle(patchPoint,.35),owner:patchOwner,kind:"paint",strength:1
    });
    B.dirty=true;
    drawBattle();
    const partialTerrain=GameProductionBattlefield.terrainRenderer.diagnostics();
    const crystalGroups=GameContinuousTerrainRenderer.crystalGroups(B);
    const neutralCrystal=crystalGroups.find(group=>group.owner===0);
    const previewUnit=B.units.find(unit=>!unit.dead);
    B._targetPreview={kind:"circle",center:GameBattlefieldAdapter.unitPosition(previewUnit),radiusU:2.5,valid:true};
    drawBattle();
    return {
      inkMaterial:GameContinuousTerrainRenderer.materialVersion,
      inkMode:GameContinuousTerrainRenderer.inkMode,
      inkEdgeMode:GameContinuousTerrainRenderer.inkEdgeMode,
      inkEdgeFeatherU:GameContinuousTerrainRenderer.inkEdgeFeatherU,
      battlefieldOutline:GameContinuousTerrainRenderer.battlefieldOutline,
      edgeCapturePreserved:B.spatial.paint.sample({x:.1,y:15})>.9,
      edgeVisualAlpha:GameContinuousTerrainRenderer.inkEdgeAlpha(.1,15),
      innerVisualAlpha:GameContinuousTerrainRenderer.inkEdgeAlpha(2,15),
      crystalOverflowU:GameContinuousTerrainRenderer.crystalOverflowU,
      crystalOverlayAnimated:GameContinuousOverlayRenderer.crystalOverlayAnimated,
      fullTerrain,
      partialTerrain,
      pendingAtFourOfSix,
      capturedAtFourOfSix,
      studyRegions:B.spatial.regions.list("study").length,
      crystalRegions:B.spatial.regions.list("crystal").length,
      crystalGroups:crystalGroups.length,
      neutralCrystalShapes:neutralCrystal?.shapes.length||0
    };
  })()`);
  await delay(180);
  const materialFrameA = await client.evaluate(`(()=>{
    const stats=id=>{
      const canvas=document.querySelector('[data-battlefield-layer="'+id+'"]');
      let data;
      try{data=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data}
      catch(error){return {opaque:-1,hash:0,tainted:error.name==="SecurityError"}}
      let opaque=0,hash=2166136261;
      for(let index=0;index<data.length;index+=4){
        if(data[index+3])opaque++;
        hash^=data[index];hash=Math.imul(hash,16777619);
        hash^=data[index+1];hash=Math.imul(hash,16777619);
        hash^=data[index+2];hash=Math.imul(hash,16777619);
        hash^=data[index+3];hash=Math.imul(hash,16777619);
      }
      return {opaque,hash:hash>>>0};
    };
    return {terrain:stats("terrain"),overlay:stats("overlay")};
  })()`);
  await delay(180);
  const materialFrameB = await client.evaluate(`(()=>{
    const canvas=document.querySelector('[data-battlefield-layer="overlay"]');
    let data;
    try{data=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data}
    catch(error){return {opaque:-1,hash:0,tainted:error.name==="SecurityError"}}
    let opaque=0,hash=2166136261;
    for(let index=0;index<data.length;index+=4){
      if(data[index+3])opaque++;
      hash^=data[index];hash=Math.imul(hash,16777619);
      hash^=data[index+1];hash=Math.imul(hash,16777619);
      hash^=data[index+2];hash=Math.imul(hash,16777619);
      hash^=data[index+3];hash=Math.imul(hash,16777619);
    }
    return {opaque,hash:hash>>>0};
  })()`);
  Object.assign(materialEffects,{frameA:materialFrameA,frameB:materialFrameB});
  if(materialEffects.inkMaterial!==5||materialEffects.inkMode!=="fibered-wash"||
    materialEffects.inkEdgeMode!=="brush-soft"||materialEffects.inkEdgeFeatherU!==1.25||
    materialEffects.battlefieldOutline!==false||!materialEffects.edgeCapturePreserved||
    materialEffects.edgeVisualAlpha>=materialEffects.innerVisualAlpha||materialEffects.crystalOverflowU!==.12||
    materialEffects.crystalOverlayAnimated!==false||materialEffects.fullTerrain.lastMode!=="full"||
    materialEffects.partialTerrain.lastMode!=="partial"||
    !materialEffects.fullTerrain.inkTextureLookup||
    materialEffects.partialTerrain.crystalRebuilds!==materialEffects.fullTerrain.crystalRebuilds||
    materialEffects.partialTerrain.lastRasterPixels>=materialEffects.fullTerrain.lastRasterPixels/10||
    materialEffects.crystalGroups>=materialEffects.crystalRegions||materialEffects.neutralCrystalShapes<4||
    !materialEffects.pendingAtFourOfSix||!materialEffects.capturedAtFourOfSix||
    materialEffects.studyRegions<1||materialEffects.crystalRegions<1||
    (!materialFrameA.terrain.tainted&&materialFrameA.terrain.opaque<1000)||
    (!materialFrameA.overlay.tainted&&materialFrameA.overlay.opaque<100)||
    (!materialFrameA.overlay.tainted&&!materialFrameB.tainted&&materialFrameA.overlay.hash===materialFrameB.hash)){
    throw new Error(`Ink, crystal, or study material failed: ${JSON.stringify(materialEffects)}`);
  }
  await screenshot(client, ".tmp-ink-crystal-study.png");
  const fineContinuousEffects = await client.evaluate(`(()=>{
    showScreen("roles");
    chooseRole("fine");
    enterRoom();
    chooseOpponent("sina");
    startBattle();
    B.busy=false;B.current=1;B.player.skillCd=0;B.player.sacrifices=0;
    const unit=B.units.find(candidate=>candidate.owner===1&&!candidate.dead);
    const studyCenter=GameBattlefieldAdapter.unitPosition(unit);
    B.spatial.paint.apply({
      shape:GameContinuousGeometry.circle(studyCenter,.45),owner:1,kind:"paint",strength:1
    });
    const canStudy=canUseCloseReadingAt(studyCenter,B.player);
    const originalSubmit=submitAction;
    submitAction=()=>{};
    useSkill();
    const selectedStudy=B.selected?.kind==="skill";
    const usedStudy=executeSkill(studyCenter);
    submitAction=originalSubmit;
    const study=B.spatial.regions.list("study").at(-1);

    const silenceCell=B.cells.find(cell=>cell.c===15&&cell.r===15);
    executeCard(CARD_MAP.get("噤声"),1,silenceCell);
    const silence=B.spatial.regions.list("spellBlock").at(-1);
    const silenceRegionCount=B.spatial.regions.list("spellBlock").length;

    const freshRegions=GameContinuousRegions.create();
    B.spatial={regions:freshRegions,paint:GamePaintField.create({regions:freshRegions})};
    B.spatial.paint.apply({shape:GameContinuousGeometry.circle({x:10,y:10},2),owner:1,kind:"paint",strength:1});
    B.spatial.paint.apply({shape:GameContinuousGeometry.circle({x:22,y:20},.7),owner:1,kind:"paint",strength:1});
    const arcaneStarted=performance.now();
    executeCard(CARD_MAP.get("奥术结晶界"),1,null);
    const durationMs=performance.now()-arcaneStarted;
    const arcane=B.spatial.regions.list("crystal").at(-1);
    const arcaneDrawStarted=performance.now();
    drawBattle();
    const drawDurationMs=performance.now()-arcaneDrawStarted;
    const postArcaneResonanceStarted=performance.now();
    executeCard(CARD_MAP.get("结晶共鸣"),1,null);
    const resonanceDurationMs=performance.now()-postArcaneResonanceStarted;
    const resonanceDrawStarted=performance.now();
    drawBattle();
    const resonanceDrawDurationMs=performance.now()-resonanceDrawStarted;
    return {
      closeReading:{canStudy,selectedStudy,usedStudy,kind:study?.shape.kind,radius:study?.shape.radius},
      silence:{kind:silence?.shape.kind,radius:silence?.shape.radius,regions:silenceRegionCount},
      arcaneBoundary:{kind:arcane?.shape.kind,large:!!arcane&&GameContinuousGeometry.containsPoint(arcane.shape,{x:10,y:10}),small:!!arcane&&GameContinuousGeometry.containsPoint(arcane.shape,{x:22,y:20}),skipNext:B.player.skipNext,durationMs,drawDurationMs,resonanceDurationMs,resonanceDrawDurationMs}
    };
  })()`);
  if(!fineContinuousEffects.closeReading.canStudy||!fineContinuousEffects.closeReading.selectedStudy||
    !fineContinuousEffects.closeReading.usedStudy||fineContinuousEffects.closeReading.kind!=="circle"||
    fineContinuousEffects.closeReading.radius!==1.5||fineContinuousEffects.silence.kind!=="circle"||
    fineContinuousEffects.silence.radius!==2.5||fineContinuousEffects.arcaneBoundary.kind!=="rasterMask"||
    !fineContinuousEffects.arcaneBoundary.large||!fineContinuousEffects.arcaneBoundary.small||
    !fineContinuousEffects.arcaneBoundary.skipNext||fineContinuousEffects.arcaneBoundary.durationMs>1000||
    fineContinuousEffects.arcaneBoundary.drawDurationMs>1000||
    fineContinuousEffects.arcaneBoundary.resonanceDurationMs>1000||
    fineContinuousEffects.arcaneBoundary.resonanceDrawDurationMs>1000){
    throw new Error(`Fine continuous effects failed: ${JSON.stringify(fineContinuousEffects)}`);
  }
  const fineCardAudit = await client.evaluate(`(async()=>{
    const checks={};
    const reset=()=>{
      B.cells.forEach(cell=>{
        cell.owner=0;cell.crystal=false;cell.studied=false;cell.permanentCrystal=false;
        cell.permanentStudied=false;cell.spellBlocked=false;cell.ground=null;cell.air=null;cell.well=null;
      });
      B.wells=[];B.units=[];B.birth=0;B.global=0;B.current=1;B.busy=false;
      B.player.ink=0;B.player.cap=100;B.player.spellRefunds=0;B.player.skipNext=false;
      const regions=GameContinuousRegions.create();
      B.spatial={regions,paint:GamePaintField.create({regions})};
    };
    const cell=(x,y)=>GameBattlefieldAdapter.worldToCell({x,y},B.cells);
    const center=unit=>GameBattlefieldAdapter.unitPosition(unit);
    const paint=(point,radius,owner=1)=>B.spatial.paint.apply({
      shape:GameContinuousGeometry.circle(point,radius),owner,kind:"paint",strength:1
    });
    const summon=(name,x,y,owner=1)=>{
      const def=CARD_MAP.get(name);
      executeCard(def,owner,cell(x,y));
      return B.units.at(-1);
    };

    reset();
    paint({x:8.5,y:8.5},.8,1);
    const shelf=summon("流动书架",8.5,8.5);
    processTurnStartResources(1);
    checks.movingBookshelf=shelf.deployedFriendly===true&&B.player.ink===6;

    reset();
    const candle=summon("沉思蜡烛",9.5,9.5);
    paint(center(candle),.7,1);
    crystallizeInkInCircle(candle,1,{owner:1,source:"audit"});
    processTurnStartResources(1);
    checks.meditationCandle=B.player.ink===8;

    reset();
    summon("真理循环装置",9.5,9.5);
    const effect=CARD_MAP.get("结晶共鸣");
    refundSpellSystems(1,effect);refundSpellSystems(1,effect);refundSpellSystems(1,effect);
    checks.truthLoop=B.player.ink===4&&B.player.spellRefunds===2;

    reset();
    summon("真理馆长",9.5,9.5);
    const curatorCrystal=GameContinuousGeometry.rect({x:12,y:12},10,1);
    addContinuousShapeRegion("crystal",curatorCrystal,{owner:1});
    addContinuousShapeRegion("crystal",GameContinuousGeometry.rect({x:42,y:15},20,10),{owner:2});
    processEndResources(1);
    checks.truthCurator=B.player.ink===4;

    reset();
    const guard=summon("禁咒守卫",9.5,9.5);
    const guardHp=guard.maxHp;
    triggerStudy(guard,guard.cell,false);
    checks.spellGuard=guard.shield===1&&guard.maxHp===guardHp+2&&guard.hp===guard.maxHp;

    reset();
    const solidifier=summon("墨水凝固者",10.5,10.5);
    paint(center(solidifier),1.6,1);
    await unitAct(solidifier);
    checks.inkSolidifier=B.spatial.regions.list("crystal").some(region=>
      region.owner===1&&GameContinuousGeometry.containsPoint(region.shape,center(solidifier))
    );

    reset();
    const statue=summon("图书馆活化石像",10.5,10.5);
    const resource=summon("流动书架",12.5,10.5);
    statue.hp-=2;
    markStudyCircle(center(statue),1.5,{owner:1});
    processTurnStartResources(1);
    checks.livingStatue=statue.hp===statue.maxHp-1&&redirectedCombatVictim(resource)===statue;

    reset();
    const bottle=summon("禁锢墨水瓶",10.5,10.5);
    paint({x:10.25,y:10.5},.22,1);paint({x:10.75,y:10.5},.22,-1);
    triggerStudy(bottle,bottle.cell,false);
    const bottleOwners=new Set(B.spatial.regions.list("crystal").map(region=>region.owner));
    checks.bindingBottle=bottleOwners.has(1)&&bottleOwners.has(-1);

    reset();
    const recorder=summon("奥术记录仪",10.5,10.5);
    paint(center(recorder),.8,1);
    removeUnit(recorder,true);
    checks.arcaneRecorder=B.spatial.regions.list("crystal").some(region=>
      GameContinuousGeometry.containsPoint(region.shape,center(recorder))
    );

    reset();
    paint({x:10.2,y:10.5},.35,1);paint({x:10.9,y:10.5},.3,-1);
    const wallDef=CARD_MAP.get("真理之墙");
    const wallCard=makeInstance(wallDef,200);
    B.player.hand=[wallCard];B.player.ink=100;
    B.selected={kind:"card",inst:wallCard,def:wallDef};
    let wallSubmitCalls=0;
    const wallSubmit=submitAction;
    submitAction=()=>{wallSubmitCalls++};
    const wallPlayed=playSelectedCard(cell(10.5,10.5));
    submitAction=wallSubmit;
    const wall=B.units.find(unit=>unit.name==="真理之墙");
    const wallStudy=B.spatial.regions.list("study").at(-1);
    const wallCrystal=B.spatial.regions.list("crystal").at(-1);
    const wallCenter=center(wall);
    const wallStudyActive=continuousRegionTouchesUnit("study",wall,1);
    const wallSummonCell=B.cells.find(current=>!current.ground&&!current.well&&
      GameContinuousGeometry.containsPoint(wallCrystal.shape,GameBattlefieldAdapter.cellToWorld(current)));
    const wallSummonAllowed=!!wallSummonCell&&legalSummonCell(1,wallSummonCell);
    removeUnit(wall,true);
    const wallAuraCleared=!B.spatial.regions.has("study",wallCenter)&&!B.spatial.regions.has("crystal",wallCenter);
    checks.wallOfTruth=wallPlayed&&wallSubmitCalls===1&&B.selected===null&&
      !B.player.hand.includes(wallCard)&&B.player.discard.includes(wallCard)&&!!wall&&
      wallStudy?.shape.kind==="circle"&&wallStudy.shape.radius===3&&
      wallCrystal?.shape.kind==="circle"&&wallCrystal.shape.radius===3&&wallStudyActive&&
      wallSummonAllowed&&wallAuraCleared;

    reset();
    const indexed=summon("禁咒守卫",42.5,12.5,2);
    markStudyCircle(center(indexed),1.5,{owner:1});
    executeCard(CARD_MAP.get("索引重排"),1,indexed);
    checks.indexReorder=indexed.skipMoveOnce===true&&indexed.cell.c>=30;

    reset();
    paint({x:10,y:10},.5,1);
    crystallizeInkInCircle({x:10,y:10},1,{owner:1,source:"audit"});
    const resonanceCrystalCount=B.spatial.regions.list("crystal").length;
    const resonanceStarted=performance.now();
    executeCard(CARD_MAP.get("结晶共鸣"),1,null);
    const resonanceDurationMs=performance.now()-resonanceStarted;
    checks.crystalResonance=B.spatial.regions.list("crystal").length===resonanceCrystalCount&&
      B.spatial.paint.sample({x:11.35,y:10})>0&&resonanceDurationMs<1000;

    reset();
    const first=summon("禁咒守卫",9.5,9.5);
    const second=summon("墨水凝固者",13.5,9.5);
    paint(center(first),.5,1);paint(center(second),.5,1);
    markStudyCircle(center(second),1.5,{owner:1});
    first.hp-=2;
    const firstCell=first.cell,secondCell=second.cell;
    executeCard(CARD_MAP.get("逻辑重构"),1,{first,second});
    checks.logicRebuild=first.cell===secondCell&&second.cell===firstCell&&first.hp===first.maxHp;

    reset();
    const quietTarget={x:15,y:15};
    const quietEnemy=summon("禁咒守卫",42.5,15,2);
    quietEnemy._displayPosition={x:17.3,y:15};
    executeCard(CARD_MAP.get("“保持安静”"),1,quietTarget);
    delete quietEnemy._displayPosition;
    checks.keepQuiet=quietEnemy.skipMoveOnce===true&&quietEnemy.silencedOnce===true;

    reset();
    executeCard(CARD_MAP.get("噤声"),1,{x:15,y:15});
    const silence=B.spatial.regions.list("spellBlock").at(-1);
    checks.silence=silence?.shape.kind==="circle"&&silence.shape.radius===2.5;

    reset();
    paint({x:10,y:10},2,1);paint({x:22,y:20},.7,1);
    executeCard(CARD_MAP.get("奥术结晶界"),1,null);
    const boundary=B.spatial.regions.list("crystal").at(-1);
    checks.arcaneBoundary=boundary?.shape.kind==="rasterMask"&&
      GameContinuousGeometry.containsPoint(boundary.shape,{x:10,y:10})&&
      GameContinuousGeometry.containsPoint(boundary.shape,{x:22,y:20})&&B.player.skipNext;

    reset();
    const eternal=summon("墨水凝固者",10.5,10.5);
    paint(center(eternal),.45,1);
    executeCard(CARD_MAP.get("最终论文：永恒结晶"),1,eternal);
    checks.eternalCrystal=eternal.eternal&&eternal.move===0&&eternal.attack===0&&eternal.shield===1&&
      B.spatial.regions.list("crystal").some(region=>
        region.shape.kind==="circle"&&region.shape.radius===2.5&&
        GameContinuousGeometry.containsPoint(region.shape,{x:center(eternal).x+2.4,y:center(eternal).y})
      );

    return {checks,passed:Object.values(checks).filter(Boolean).length,total:CARDS.fine.length,
      timings:{resonanceDurationMs}};
  })()`);
  if(fineCardAudit.total!==17||fineCardAudit.passed!==17){
    throw new Error(`Fine card audit failed: ${JSON.stringify(fineCardAudit)}`);
  }
  const sinaCardAudit = await client.evaluate(`(()=>{
    const checks={};
    const reset=()=>{
      B.cells.forEach(cell=>{
        cell.owner=0;cell.crystal=false;cell.studied=false;cell.permanentCrystal=false;
        cell.permanentStudied=false;cell.spellBlocked=false;cell.ground=null;cell.air=null;cell.well=null;
      });
      B.wells=[];B.units=[];B.birth=0;B.global=0;B.current=1;B.busy=false;
      B.player.role="sina";B.player.ink=0;B.player.cap=100;B.player.skillCd=0;
      B.player.sacrifices=0;B.player.landedThisTurn=false;B.player.hand=[];B.player.deck=[];B.player.discard=[];
      B.enemy.ink=0;B.enemy.cap=100;B.enemy.landedThisTurn=false;
      const regions=GameContinuousRegions.create();
      B.spatial={regions,paint:GamePaintField.create({regions})};
    };
    const cell=(x,y)=>GameBattlefieldAdapter.worldToCell({x,y},B.cells);
    const point=unit=>GameBattlefieldAdapter.unitPosition(unit);
    const paint=(center,radius,owner=1)=>B.spatial.paint.apply({
      shape:GameContinuousGeometry.circle(center,radius),owner,kind:"paint",strength:1
    });
    const playSummon=(name,x,y)=>{
      executeCard(CARD_MAP.get(name),1,cell(x,y));
      return B.units.at(-1);
    };
    const fixture=(name,targetCell,owner=1,stats={attack:0,hp:4,move:2,paint:1,ai:"avoid"})=>
      summonUnit(owner,name,targetCell,stats,{initial:true,resource:false});

    reset();
    const messenger=playSummon("小天鹅信使",8.5,8.5);
    makeFlying(messenger,2);processTurnStartResources(1);
    checks.swanMessenger=messenger.duration===3&&messenger.height===2&&B.player.ink===6;

    reset();
    const rally=playSummon("湖光集结",8.5,8.5);
    const rallyBird=fixture("测试飞鸟",cell(11.5,8.5));makeFlying(rallyBird,2);processEndResources(1);
    checks.lakeRally=rally.duration===3&&B.player.ink===6;

    reset();
    const pump=playSummon("羽翼泵动站",8.5,8.5);
    const pumpBird=fixture("测试飞鸟",cell(11.5,8.5));makeFlying(pumpBird,2);
    const takeoffInk=B.player.ink;processTurnStartResources(1);
    checks.wingPump=pump.duration===4&&takeoffInk===2&&B.player.ink===6;

    reset();
    const rest=playSummon("天鹅湖休息区",8.5,8.5);
    B.player.landedThisTurn=true;processEndResources(1);
    const armed=rest.restBonus===true&&B.player.ink===6;
    B.player.landedThisTurn=false;processEndResources(1);
    checks.restArea=armed&&rest.duration===3&&rest.restBonus===false&&B.player.ink===16;

    reset();
    const chargeOrigin=cell(8.5,10.5);
    const sparrow=playSummon("冲锋白雀",8.5,10.5);
    checks.chargingSparrow=hexDistance(chargeOrigin,sparrow.cell)>=3;

    reset();
    const swan=playSummon("护卫大天鹅",8.5,12.5);makeFlying(swan,2);
    const swanDestination=cell(14.5,12.5);
    const pushed=fixture("推动目标",neighborInDirection(swanDestination,0),2,{attack:0,hp:5,move:1,paint:0,ai:"avoid"});
    const pushedStart=point(pushed),swanCenter=GameBattlefieldAdapter.cellToWorld(swanDestination);
    paint(swanCenter,3.2,1);landUnit(swan,swanDestination);
    checks.guardianSwan=swan.height===1&&GameWorldSpace.distance(pushedStart,point(pushed))>1&&
      Math.abs(B.spatial.paint.sample(swanCenter))<.1;

    reset();
    const scoutCenter=GameBattlefieldAdapter.cellToWorld(cell(9.5,9.5));paint(scoutCenter,.8,1);
    const scout=playSummon("侦查隼·B型",9.5,9.5);
    checks.scoutFalcon=scout.height===2&&movementFor(scout)===7;

    reset();
    const goose=playSummon("重力白鹅",8.5,9.5);makeFlying(goose,2);
    const crushCell=cell(13.5,9.5);
    const crushTarget=fixture("脆弱目标",crushCell,2,{attack:0,hp:2,move:1,paint:0,ai:"avoid"});
    landUnit(goose,crushCell);
    checks.gravityGoose=crushTarget.dead===true&&goose.height===1&&goose.cell===crushCell;

    reset();
    const peacock=playSummon("幻影孔雀",8.5,11.5);makeFlying(peacock,2);
    const beforePeacock=B.spatial.paint.measure().player;landUnit(peacock,cell(13.5,11.5));
    checks.phantomPeacock=B.spatial.paint.measure().player>beforePeacock&&B.spatial.paint.sample(point(peacock))>0;

    reset();
    const woodpecker=playSummon("铁喙啄木鸟",9.5,13.5);
    const woodTarget=fixture("禁行目标",neighborInDirection(woodpecker.cell,0),2,{attack:0,hp:5,move:0,paint:0,ai:"avoid"});
    woodTarget.rooted=true;combat(woodpecker,woodTarget);
    checks.ironWoodpecker=woodTarget.dead===true&&woodpecker.height===2;

    reset();
    const emergencySwan=playSummon("护卫大天鹅",10.5,14.5);makeFlying(emergencySwan,2);
    const emergencyCenter=point(emergencySwan),expandedPoint={x:emergencyCenter.x+2.7,y:emergencyCenter.y};
    paint(emergencyCenter,3.2,1);
    const paintedBefore=B.spatial.paint.sample(expandedPoint)>0;
    executeCard(CARD_MAP.get("紧急着陆指令"),1,null);
    checks.emergencyLanding=paintedBefore&&emergencySwan.height===1&&Math.abs(B.spatial.paint.sample(expandedPoint))<.1;

    reset();
    const dancer=playSummon("重力白鹅",9.5,9.5);
    executeCard(CARD_MAP.get("轻盈之舞"),1,dancer);
    const dancedIntoAir=dancer.height===2;
    executeCard(CARD_MAP.get("轻盈之舞"),1,dancer);
    checks.lightDance=dancedIntoAir&&dancer.extraActions===1;

    reset();
    const charger=fixture("突击测试",cell(8.5,15.5),1,{attack:1,hp:4,move:3,paint:1,ai:"aggressive"});
    charger.lastMoveDirection=0;
    const chargeStep=neighborInDirection(charger.cell,0);
    const collisionCell=neighborInDirection(chargeStep,0);
    const collisionTarget=fixture("碰撞目标",collisionCell,2,{attack:0,hp:3,move:1,paint:0,ai:"avoid"});
    executeCard(CARD_MAP.get("莽撞突击"),1,null);
    checks.recklessCharge=charger.cell===chargeStep&&collisionTarget.hp===2;

    reset();
    const ascentA=fixture("升空甲",cell(8.5,8.5));
    const ascentB=fixture("升空乙",cell(11.5,11.5));
    executeCard(CARD_MAP.get("全体升空！"),1,null);
    checks.massTakeoff=[ascentA,ascentB].every(unit=>unit.height===2&&unit.flying===2&&unit.bonusMove===2);

    reset();
    const diver=playSummon("重力白鹅",8.5,10.5);makeFlying(diver,2);
    const diveCell=cell(14.5,10.5);
    executeCard(CARD_MAP.get("精准俯冲"),1,{unit:diver,cell:diveCell});
    checks.precisionDive=diver.height===1&&diver.cell===diveCell&&diver.bonusAttack===1;

    reset();
    const protectedUnit=playSummon("护卫大天鹅",9.5,9.5);
    protectedUnit.hp=4;protectedUnit.lastLanded=true;
    executeCard(CARD_MAP.get("白羽防护罩"),1,protectedUnit);
    const protectedHp=protectedUnit.hp;damage(protectedUnit,3);
    checks.featherShield=protectedUnit.halfDamage===true&&protectedHp===6&&protectedUnit.hp===4;

    reset();
    const stormPlayer=fixture("风暴甲",cell(9.5,8.5),1);makeFlying(stormPlayer,2);
    const stormEnemy=fixture("风暴乙",cell(42.5,20.5),2);makeFlying(stormEnemy,2);
    executeCard(CARD_MAP.get("乱序风暴"),1,null);
    const stormTerritory=B.spatial.paint.measure();
    checks.disorderStorm=stormPlayer.height===1&&stormEnemy.height===1&&
      stormTerritory.player>10&&stormTerritory.enemy>10;

    reset();
    const skillTarget=playSummon("重力白鹅",9.5,9.5);
    let submitCalls=0;const originalSubmit=submitAction;submitAction=()=>{submitCalls++};
    const skillUsed=executeSkill(skillTarget);submitAction=originalSubmit;
    const skill={used:skillUsed,height:skillTarget.height,cooldown:B.player.skillCd,submitCalls};

    return {checks,passed:Object.values(checks).filter(Boolean).length,total:CARDS.sina.length,skill};
  })()`);
  if(sinaCardAudit.total!==17||sinaCardAudit.passed!==17||!sinaCardAudit.skill.used||
    sinaCardAudit.skill.height!==2||sinaCardAudit.skill.cooldown!==1||sinaCardAudit.skill.submitCalls!==1){
    throw new Error(`Sina card audit failed: ${JSON.stringify(sinaCardAudit)}`);
  }
  await client.evaluate(`B.ended=false;endBattle(1,"自动化结算")`);
  await delay(350);
  const settlementUi=await client.evaluate(`(()=>{
    const modal=document.getElementById("modal"),dock=document.getElementById("battleResultDock");
    const full=modal.classList.contains("open")&&modal.classList.contains("battle-result-open")&&
      document.getElementById("modalBox").textContent.includes("战斗胜利");
    handleModalBackdropClick({target:modal});
    const minimized=!modal.classList.contains("open")&&!dock.hidden&&dock.textContent.includes("点击展开结算");
    dock.click();
    const restored=modal.classList.contains("open")&&modal.classList.contains("battle-result-open")&&dock.hidden;
    return {full,minimized,restored};
  })()`);
  if(!settlementUi.full||!settlementUi.minimized||!settlementUi.restored){
    throw new Error(`Settlement UI failed: ${JSON.stringify(settlementUi)}`);
  }
  await client.send("Page.navigate", {url: spinePreviewUrl});
  let previewReady = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    await delay(100);
    previewReady = await client.evaluate(`document.body?.dataset?.previewReady || false`).catch(() => false);
    if (previewReady === "true" || previewReady === "error") break;
  }
  if (previewReady !== "true") {
    const message = await client.evaluate(`document.getElementById("previewStatus")?.textContent || "preview did not initialize"`).catch(() => "preview did not initialize");
    throw new Error(`Spine preview failed: ${message}`);
  }
  await delay(500);
  const previewIdle = await client.evaluate(`GameSpinePreview.snapshot()`);
  await screenshot(client, ".tmp-spine-preview-idle.png");
  await client.evaluate(`GameSpinePreview.setAnimation("move")`);
  await delay(350);
  const previewMove = await client.evaluate(`GameSpinePreview.snapshot()`);
  await screenshot(client, ".tmp-spine-preview-move.png");
  await client.evaluate(`GameSpinePreview.setAnimation("attack")`);
  await delay(220);
  const previewAttack = await client.evaluate(`GameSpinePreview.snapshot()`);
  await screenshot(client, ".tmp-spine-preview.png");
  if ([...previewIdle, ...previewMove, ...previewAttack].some(item => item.opaquePixels < 1000)) {
    throw new Error(`Spine preview rendered a blank or nearly blank canvas: ${JSON.stringify({previewIdle, previewMove, previewAttack})}`);
  }
  const spinePreview = {ready: previewReady, idle: previewIdle, move: previewMove, attack: previewAttack};

  const runtimeErrors = client.events.filter(event => event.method === "Runtime.exceptionThrown")
    .map(event => event.params.exceptionDetails.text);
  console.log(JSON.stringify({registration, spineRuntime, spineAssetCoverage, deck, room, battle, unitHover, spineHover, coordinateHover, wellHover, brushPreview, motionPlayback, effects, droneUi, archive, narrow, archiveResolution, archiveRules, matrixRules, crystalImmunity, areaPurgePerformance, frontierSeeking, materialEffects, fineContinuousEffects, fineCardAudit, sinaCardAudit, settlementUi, spinePreview, runtimeErrors}, null, 2));
  client.close();
} finally {
  browser.kill();
  await delay(300);
  await rm(profileDir, {recursive: true, force: true}).catch(() => {});
}
