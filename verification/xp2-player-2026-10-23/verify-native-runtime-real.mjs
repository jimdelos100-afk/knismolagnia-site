import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ReaderPlayer,validateReaderSnapshot} from '../../private/story-player/src/reader.js';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';

const load=name=>readFile(new URL('../../private/story-player/data/'+name,import.meta.url),'utf8').then(JSON.parse);
const [story,manifest]=await Promise.all([load('story.json'),load('native-presentation.json')]);
const scenes=new Map(story.scenes.map(scene=>[scene.id,scene]));
const clone=value=>structuredClone(value),results=[],metrics={};
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b),q=p=>Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(3));return {count:values.length,p50Ms:q(.5),p95Ms:q(.95),peakMs:q(1),sumMs:Number(values.reduce((a,b)=>a+b,0).toFixed(3))};};
const textEvents=scene=>scene.events.map((event,index)=>({event,index})).filter(({event})=>event.type==='dialogue');
function inspect(state){
 assert.equal(state.sceneId,typeof state.sceneId==='string'?state.sceneId:null);assert(Number.isFinite(state.stageTime));
 const ids=new Set();
 for(const actor of state.characters){
  assert(!ids.has(actor.id),`Duplicate graphic object ${actor.id}`);ids.add(actor.id);
  for(const field of ['x','y','width','height','opacity','layer'])assert(Number.isFinite(actor[field]),`${state.sceneId}/${actor.id}: nonfinite ${field}`);
  assert(actor.width>0&&actor.height>0);assert(Math.abs(actor.x)<100000&&Math.abs(actor.y)<100000);
 }
 assert(state.characters.filter(actor=>actor.id==='bg:'+manifest.defaults.defaultLayers.Bg).length<=1,'Default CG graphic slot must be unique.');
 if(state.eventMode)assert.equal(state.characters.filter(actor=>actor.kind==='character').length,0,'Event mode must hide ordinary portraits.');
 for(const value of Object.values(state.nativeEffects.messageWindow))if(typeof value==='number')assert(Number.isFinite(value));
 assert(Number.isFinite(state.nativeEffects.inputWaitUntil));
}
function expectedBackgrounds(scene,eventIndex){
 const result=new Map((scene.entry.characters||[]).filter(actor=>actor.kind==='background').map(actor=>[actor.id,actor.asset]));
 for(const event of scene.events.slice(0,eventIndex+1)){
  if(event.type==='clearActors'&&event.kind==='background'){
   if(event.id)result.delete(event.id);else if(!event.layerName)result.clear();else result.delete('bg:'+event.layerName);
  }
  if(event.type==='character'&&event.kind==='background')event.remove?result.delete(event.id):result.set(event.id,event.asset);
 }
 return result;
}

await check('all257 native scenes: real Reader first/middle/last previews are finite, source-aligned and have one graphic per native background slot',()=>{
 const player=new ReaderPlayer(story,{nativeEffects:manifest});let previews=0,noDialogue=0;const timings=[];
 for(const sceneId of Object.keys(manifest.scenes)){
  const scene=scenes.get(sceneId);player.enter(sceneId);inspect(player.state);
  const lines=textEvents(scene);if(!lines.length){noDialogue++;continue;}
  const before=player.snapshot();
  for(const index of new Set([0,Math.floor((lines.length-1)/2),lines.length-1])){
   const start=performance.now(),frame=player.previewDialogue(index);timings.push(performance.now()-start);inspect(frame);previews++;
   assert.equal(frame.dialogue.textId,lines[index].event.textId);assert.equal(frame.dialogue.index,index);assert.equal(frame.dialogue.textComplete,true);assert.equal(frame.playing,false);
   assert.equal(frame.nativeEffects.speakerActorId??null,manifest.dialogueSpeakers[sceneId][lines[index].index].actorId??null);
   assert.deepEqual(new Map(frame.characters.filter(actor=>actor.kind==='background').map(actor=>[actor.id,actor.asset])),expectedBackgrounds(scene,lines[index].index));
   if(index>0)assert.equal(frame.nativeEffects.motions.length,0,'A future scrub frame must settle preceding NoWait moves.');
  }
  assert.deepEqual(player.snapshot(),before,'Previews must not modify saved cursors or reader history.');
 }
 metrics.readerCoverage={nativeScenes:Object.keys(manifest.scenes).length,previews,noDialogue,...summary(timings)};player.dispose();
});

await check('largest440-dialogue native block: every preview remains detached and replay/cache costs are measured without DOM or media loading',()=>{
 const player=new ReaderPlayer(story,{nativeEffects:manifest});player.enter('chapter-53-row-1');const before=player.snapshot();let snapshots=0;const snapshot=player.snapshot.bind(player);player.snapshot=()=>{snapshots++;return snapshot();};
 const times=[];
 for(let index=0;index<440;index++){
  const start=performance.now(),frame=player.previewDialogue(index);times.push(performance.now()-start);inspect(frame);assert.equal(frame.dialogue.index,index);assert.equal(frame.sceneId,'chapter-53-row-1');assert.equal('readerSnapshot' in frame,false);assert(player._previewCache.size<=8);
 }
 assert.equal(snapshots,0);assert.deepEqual(snapshot(),before);metrics.heavy440={...summary(times),commands:player._commands.length,cacheLimit:8,snapshotCallsDuringPreview:0};
 player.commitDialogue(220);const first=player.state;const frameTimes=[],start=performance.now();
 for(let index=0;index<1000;index++){const frameStart=performance.now(),frame=player.state;frameTimes.push(performance.now()-frameStart);assert.equal(frame.dialogue.textId,first.dialogue.textId);}
 metrics.repeatedState1000={...summary(frameTimes),wallMs:Number((performance.now()-start).toFixed(3)),nodeOnly:true,domOrMediaLoads:0};player.dispose();
});

await check('real Program map jumps preserve native CG A-B-A resources, source speaker and old1.4 snapshot compatibility',async()=>{
 const player=new ProgramPlayer(story,{nativeEffects:manifest});const routeTimes=[];
 for(const sceneId of Object.keys(manifest.scenes)){
  const start=performance.now();player.enter(sceneId);routeTimes.push(performance.now()-start);inspect(player.state);
  const count=player.getDialogueProgress().total;if(count){const frame=player.previewDialogue(Math.floor((count-1)/2));inspect(frame);assert.equal(frame.sceneId,player.state.sceneId);}
 }
 player.enter('chapter-26-row-1');const before=player.snapshot();
 for(const [index,asset] of [[26,'texture:resources.assets:973'],[27,'texture:resources.assets:683'],[28,'texture:resources.assets:973'],[27,'texture:resources.assets:683']]){
  const frame=player.previewDialogue(index),cgs=frame.characters.filter(actor=>actor.kind==='background');assert.equal(cgs.length,1);assert.equal(cgs[0].asset,asset);assert.equal(frame.nativeEffects.transitions.length,0);
 }
 assert.deepEqual(player.snapshot(),before);player.commitDialogue(27);const nativeSaved=validateProgramSnapshot(story,player.snapshot());player.restore(nativeSaved);assert.equal(player.state.dialogue.index,27);inspect(player.state);
 const legacy=JSON.parse(await readFile(new URL('./fixtures/program-1.1-chapter26.json',import.meta.url),'utf8'));assert.equal('nativeTimingRevision' in legacy,false);player.restore(clone(legacy));assert.equal(player.snapshot().programRevision,legacy.programRevision);assert.equal('nativeTimingRevision' in player.snapshot(),false);inspect(player.state);validateReaderSnapshot(story,player.snapshot().reader,{validatedStory:true});
 metrics.programRoutes={scenes:routeTimes.length,...summary(routeTimes),priorReleaseFixtureRestored:true,nativeSnapshotRestored:true};player.dispose();
});

console.log(JSON.stringify({passed:results.filter(row=>row.passed).length,total:results.length,metrics,results,scope:'Node CPU replay measurements only; no browser rendering, image decoding, network, audio or DOM operations are performed.'},null,2));
if(results.some(row=>!row.passed))process.exitCode=1;
