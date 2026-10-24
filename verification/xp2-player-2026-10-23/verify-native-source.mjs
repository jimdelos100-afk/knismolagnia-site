import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const analysis=process.argv[2]||process.env.XP2_ANALYSIS_DIR;
assert(analysis,'Pass the read-only player-analysis directory as the first argument.');
const data=path.join(repo,'private/story-player/data');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const story=read(path.join(data,'story.json')),manifest=read(path.join(data,'native-presentation.json'));
const grids=read(path.join(analysis,'grids.json')),settings=read(path.join(analysis,'main-settings.json'));
const scenes=new Map(story.scenes.map(scene=>[scene.id,scene]));
const sourceRows=new Map();
for(const grid of grids){const headers=grid.rows[0].strings;for(const row of grid.rows.slice(1)){if(row.isEmpty||row.isCommentOut)continue;sourceRows.set(`${grid.name}|${row.rowIndex}`,Object.fromEntries(headers.map((header,index)=>[header,row.strings[index]||''])));}}
const settingRows=kind=>settings.filter(grid=>grid.name.endsWith(':'+kind)).flatMap(grid=>grid.rows.slice(1).filter(row=>!row.isEmpty&&!row.isCommentOut).map(row=>Object.fromEntries(grid.rows[0].strings.map((header,index)=>[header,row.strings[index]||'']))));
const textures=new Map(settingRows('Texture').map(row=>[row.Label,row]));
const characters=new Map(settingRows('Character').map(row=>[`${row.CharacterName}|${row.Pattern||''}`,row]));
for(const row of settingRows('Character'))if(!characters.has(`${row.CharacterName}|`))characters.set(`${row.CharacterName}|`,row);
const num=(value,fallback=0)=>value===''||value===undefined?fallback:Number(value);
assert.equal(manifest.type,'xp2-native-presentation');assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.sourceStorySha256,hash(path.join(data,'story.json')),'Sidecar must match the exact existing story file.');
for(const [name,expected] of Object.entries(manifest.sourceHashes)){
 const file=name==='prepare-xp2.py'?path.join(repo,'scripts',name):name==='unity-index.json'?path.join(data,name):path.join(analysis,name);
 assert.equal(hash(file),expected,`${name} source hash changed.`);
}
assert.deepEqual(manifest.defaults.stage,{width:1280,height:720});
assert.equal(manifest.defaults.tween.ease,'easeOutExpo');assert.equal(manifest.defaults.tween.isLocal,false);assert.equal(manifest.defaults.tween.waitType,'Default');
const counts={},waits={},ids=new Set(),tweenInvocations=new Set();let missingTween=0,endAnchors=0,offEntries=0,drawEntries=0,replacedShakes=0;
for(const [sceneId,actions] of Object.entries(manifest.scenes)){
 const scene=scenes.get(sceneId);assert(scene,`Missing scene ${sceneId}`);let previousRow=-1,previousCommand=-1;
 for(const action of actions){
  assert(!ids.has(action.id),`Duplicate native action ${action.id}`);ids.add(action.id);
  assert(action.sourceRow>previousRow,`${sceneId}: source order is not strict.`);previousRow=action.sourceRow;
  assert(action.beforeCommandIndex>=previousCommand,`${sceneId}: anchors go backwards.`);previousCommand=action.beforeCommandIndex;
  assert(Number.isInteger(action.beforeCommandIndex)&&action.beforeCommandIndex>=0&&action.beforeCommandIndex<=scene.commands.length);
  if(action.beforeCommandIndex===scene.commands.length)endAnchors++;
  const source=sourceRows.get(`${action.sourceGrid}|${action.sourceRow}`);assert(source,`Source row missing for ${action.id}`);
  assert.equal(source.Command||'Character',action.command);assert.equal(source.Arg1||'',action.target);
  assert.deepEqual(action.rawArgs,Array.from({length:6},(_,index)=>source['Arg'+(index+1)]||''));
  assert.equal(action.waitType,source.WaitType||'Default');
  assert.equal(action.hasWaitSemantics,['Tween','Shake'].includes(action.command));
  for(let index=0;index<action.commandIndexes.length;index++)assert.equal(action.commandIndexes[index],action.beforeCommandIndex+index);
  for(const index of action.commandIndexes)assert(scene.commands[index]);
  for(const index of action.eventIndexes){assert(scene.events[index]);assert(action.commandIndexes.some(commandIndex=>scene.commands[commandIndex].eventIndex===index));}
  counts[action.command]=(counts[action.command]||0)+1;
  if(['Tween','Shake'].includes(action.command)){
   const parsed=Object.fromEntries([...source.Arg3.matchAll(/([a-zA-Z]+)=([-+.0-9]+)/g)].map(([,key,value])=>[key,Number(value)]));
   assert.deepEqual(action.parameters,parsed);assert.equal(action.duration,parsed.time??1);
   assert.equal(action.ease,source.Arg4||'easeOutExpo');assert.equal(action.loop,source.Arg5||'none');
   assert.equal(action.coordinateSpace,'world-center-origin-y-up');assert.equal(action.isLocal,false);assert.equal(action.pixelToWorld,100);
   waits[action.command]??={};waits[action.command][action.waitType]=(waits[action.command][action.waitType]||0)+1;
   if(action.command==='Tween'){
    assert(['MoveTo','MoveBy'].includes(action.operation));assert.equal(action.operation,source.Arg2);
    assert.deepEqual(Object.keys(parsed).sort(),['time','x']);
    tweenInvocations.add(JSON.stringify([action.target,action.operation,source.Arg3]));
    if(!action.eventIndexes.length)missingTween++;
   }else{
    assert.equal(action.target,'MessageWindow');assert.equal(action.targetKind,'messageWindow');assert.equal(action.normalizedTarget,'messageWindow');
    assert.equal(action.operation,'ShakePosition');assert.equal(action.replaceEventIndexes.length,1);
    assert.equal(scene.events[action.replaceEventIndexes[0]].type,'camera');replacedShakes++;
   }
  }else if(action.command==='GuiActive')assert.equal(action.active,source.Arg2.toUpperCase()==='TRUE');
  else{
   assert.equal(action.duration,num(source.Arg6,.2));
   if(action.operation==='clear'){offEntries++;for(const index of action.fadeEventIndexes)assert(['clearActors','mode'].includes(scene.events[index].type));}
   else{
    drawEntries++;let nativeSettings;
    if(action.command==='Character')nativeSettings=characters.get(`${source.Arg1}|${source.Arg2||''}`)||characters.get(`${source.Arg1}|`)||{};
    else nativeSettings=textures.get(action.command==='Sprite'?(source.Arg2||source.Arg1):source.Arg1)||{};
    assert.deepEqual(action.textureOffset,{x:num(nativeSettings.X),y:num(nativeSettings.Y)});
    for(const index of action.fadeEventIndexes){const event=scene.events[index];if(event.type!=='character')continue;const binding=manifest.bindings[event.id];const variants=binding.offsetVariants[event.asset];assert(variants.some(value=>JSON.stringify(value)===JSON.stringify(action.textureOffset)));if(variants.length===1)assert.deepEqual(binding.assets[event.asset],action.textureOffset);else assert.equal(binding.assets[event.asset],undefined,'Ambiguous child offsets must not have a global last-value fallback.');}
   }
  }
 }
}
assert.equal(counts.Tween,1137);assert.equal(counts.Shake,1188);assert.equal(counts.GuiActive,150);
assert.equal(missingTween,324);assert.equal(replacedShakes,1188);assert.equal(tweenInvocations.size,57);
assert.deepEqual(waits.Tween,{Add:518,NoWait:515,Default:104});assert.deepEqual(waits.Shake,{Add:1188});
assert.equal(manifest.audit.verifiedSceneAnchors,1083);assert.equal(manifest.audit.presentationEntries,8962);
let speakers=0;
for(const [sceneId,map] of Object.entries(manifest.dialogueSpeakers))for(const [index,binding] of Object.entries(map)){
 const event=scenes.get(sceneId).events[Number(index)];assert.equal(event.type,'dialogue');
 const parts=event.textId.split('|'),row=sourceRows.get(parts.slice(0,2).join('|'));assert(row);
 assert.equal(binding.sourceRow,Number(parts[1]));assert.equal(binding.sourceLabel,row.Arg1||'');assert.equal(binding.actorId,row.Arg1?'char:'+row.Arg1:null);speakers++;
}
assert.equal(speakers,5614);
const grayout=manifest.nativeUiSettings.AdvCharacterGrayOutController.data;
assert.equal(grayout.m_Enabled,1);assert.equal(grayout.mask,1);assert.deepEqual(grayout.mainColor,{r:1,g:1,b:1,a:1});assert.deepEqual(grayout.subColor,{r:.5,g:.5,b:.5,a:1});assert(Math.abs(grayout.fadeTime-.2)<1e-7);assert.equal(grayout.enableChangeOrder,0);
console.log(JSON.stringify({verified:true,storySha256:manifest.sourceStorySha256,scenes:Object.keys(manifest.scenes).length,actions:ids.size,counts,waits,missingTween,endAnchors,offEntries,drawEntries,speakers,uniqueTweenInvocations:tweenInvocations.size,randomness:'Native Unity per-frame RNG is approximated deterministically; amplitudes, target, duration and decay are source-derived.'},null,2));
