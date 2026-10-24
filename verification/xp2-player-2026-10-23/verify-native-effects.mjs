import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ReaderPlayer,validateReaderSnapshot} from '../../private/story-player/src/reader.js';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';
import {compileNativeEffects,carryNativeEffects} from '../../private/story-player/src/native-effects.js';

const results=[],copy=value=>structuredClone(value),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
async function check(name,run){try{await run();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
function fixture(){
  const line=textId=>({type:'dialogue',at:0,textId});
  const actor=(id,asset,kind='character',extra={})=>({id,asset,kind,x:340,y:230,width:100,height:200,layerName:'people',...extra});
  const bg=actor('bg','bgA','background',{x:0,y:0,width:1280,height:720,layerName:'back'});
  const events=[{type:'character',at:0,...actor('p','happy')},{type:'tween',at:0,target:'character:p',to:{x:999},duration:1},{type:'camera',at:0,shake:{amplitude:80,frequency:10,duration:2}},line('a1'),{type:'character',at:0,...actor('p','wrong','character',{x:900,y:99})},line('a2'),{type:'character',at:0,...bg,asset:'bgB'},line('a3'),{type:'clearActors',at:0,kind:'background',id:'bg'},line('a4')];
  const scene=(id,events,characters=[bg])=>({id,title:id,duration:30,entry:{background:{asset:'black'},characters,audio:[]},events,commands:events.map((event,eventIndex)=>({type:event.type==='dialogue'?'dialogue':'event',eventIndex,...(event.type==='tween'?{block:true}:{})}))});
  const scenes=[scene('main',events),scene('world',[line('w1'),line('w2')],[actor('p','happy','character',{x:690})]),scene('tail',[line('t1'),line('t2')],[])];
  const story={type:'story-player',schemaVersion:1,id:'native-effects-fixture',title:'Native effects fixture',gameFingerprint:'native-effects-fixture-1',stage:{width:1280,height:720},startScene:'main',assets:['black','happy','wrong','bgA','bgB'].map(id=>({id,type:'image',src:id+'.png'})),texts:['a1','a2','a3','a4','w1','w2','t1','t2'].map(id=>({id,source:id+' dialogue'})),scenes,program:{version:1,entry:'main',variables:{},nodes:{main:{sceneId:'main',entryMode:'reset',exit:{type:'goto',target:'tail'}},world:{sceneId:'world',entryMode:'reset',exit:{type:'end'}},tail:{sceneId:'tail',entryMode:'carry',exit:{type:'end'}}}}};
  const row=(id,ci,command,extra={})=>({id,beforeCommandIndex:ci,command,commandIndexes:[ci],eventIndexes:[ci],duration:0,...extra});
  const manifest={type:'xp2-native-presentation',schemaVersion:1,storyId:story.id,sourceStorySha256:'a'.repeat(64),defaults:{tween:{time:1,ease:'easeOutExpo'}},layers:{people:{x:80,y:0}},bindings:{p:{assets:{happy:{x:20,y:-30}}}},scenes:{main:[
    row('draw-p',0,'Character',{operation:'draw',rawArgs:['p','happy'],textureOffset:{x:20,y:-30},duration:.2}),
    row('move-p',1,'Tween',{targetKind:'actor',targetIds:['p'],operation:'MoveBy',parameters:{x:100},duration:1,ease:'easeOutExpo',waitType:'Default',replaceEventIndexes:[1]}),
    row('shake-window',2,'Shake',{targetKind:'messageWindow',parameters:{x:30,y:15},duration:2,waitType:'Add',replaceEventIndexes:[2]}),
    row('retain-p',4,'Character',{operation:'draw',rawArgs:['p','',''],textureOffset:{x:0,y:0},duration:.2}),
    row('swap-bg',6,'Bg',{operation:'draw',duration:.5,textureOffset:{x:0,y:0},waitType:'Default'}),
    row('off-bg',8,'BgOff',{operation:'clear',duration:.5,waitType:'Default'}),
    row('end-gui',10,'GuiActive',{eventIndexes:[],commandIndexes:[],operation:'SetActive',target:'Config',active:false})
  ],world:[row('world-p',0,'Tween',{eventIndexes:[],commandIndexes:[],targetKind:'actor',targetIds:['p'],operation:'MoveTo',parameters:{x:100},duration:1,ease:'easeOutExpo',waitType:'NoWait'})]},dialogueSpeakers:{main:{3:{actorId:'p'},5:{actorId:'p'},7:{actorId:null},9:{actorId:null}},world:{0:{actorId:'p'},1:{actorId:null}},tail:{0:{actorId:'p'},1:{actorId:null}}}};
  return {story,manifest};
}
const p=player=>player.state.characters.find(actor=>actor.id==='p');
function release(player){if(!player.state.dialogue.textComplete)player.next();return player.next();}

await check('Default waits hold subsequent commands and use native exponential easing without changing original story revisions',()=>{
  const {story,manifest}=fixture(),original=copy(story),legacy=new ReaderPlayer(story),player=new ReaderPlayer(story,{nativeEffects:manifest});
  assert.equal(player.snapshot().readerRevision,legacy.snapshot().readerRevision);assert.deepEqual(story,original);assert.equal(player.state.waiting,'wait');assert.equal(player.state.dialogue.textId,null);player.play();player.advance(.5);near(p(player).x,436.875);assert.equal(player.state.dialogue.textId,null);player.advance(.5);assert.equal(player.state.dialogue.textId,'a1');near(player.snapshot().executions[3].at,1);near(p(player).x,440);validateReaderSnapshot(story,player.snapshot());player.dispose();legacy.dispose();
});
await check('MessageWindow Shake replaces the erroneous camera cue and deterministically decays within native amplitudes',()=>{
  const {story,manifest}=fixture(),player=new ReaderPlayer(story,{nativeEffects:manifest});player.play();player.advance(1.25);const frame=player.state,fx=frame.nativeEffects;assert.equal(frame.camera.shakeX,0);assert.equal(frame.camera.shakeY,0);assert.ok(Math.abs(fx.messageWindow.offsetX)<=30*.875);assert.ok(Math.abs(fx.messageWindow.offsetY)<=15*.875);assert.deepEqual(player.state.nativeEffects.messageWindow,fx.messageWindow);assert.equal(fx.inputWaiting,true);assert.equal(fx.defaultWaiting,false);player.advance(1.75);near(player.state.nativeEffects.messageWindow.offsetX,0);near(player.state.nativeEffects.messageWindow.offsetY,0);player.dispose();
});
await check('Add runs beside dialogue, remembers a full-line advance click and releases only at the original input gate',()=>{
  const {story,manifest}=fixture(),player=new ReaderPlayer(story,{nativeEffects:manifest});player.play();player.advance(1);assert.equal(player.state.dialogue.textId,'a1');assert.equal(player.next(),'reveal');assert.equal(player.next(),'wait');player.advance(1.5);assert.equal(player.state.dialogue.textId,'a1');player.advance(.5);assert.equal(player.state.dialogue.textId,'a2');near(player.snapshot().executions[3].releaseAt,3);assert.equal(p(player).asset,'happy');near(p(player).x,440);near(p(player).y,230);validateReaderSnapshot(story,player.snapshot());player.dispose();
});
await check('native image swap and off expose logical-clock old/new transitions without introducing graphic wait barriers',()=>{
  const {story,manifest}=fixture(),player=new ReaderPlayer(story,{nativeEffects:manifest});player.play();player.advance(3);release(player);assert.equal(player.state.dialogue.textId,'a2');release(player);assert.equal(player.state.dialogue.textId,'a3');let swap=player.state.nativeEffects.transitions.find(item=>item.actorId==='bg');assert.equal(swap.from.asset,'bgA');assert.equal(swap.to.asset,'bgB');near(swap.progress,0);assert.equal(player.state.waiting,'dialogue');player.advance(.25);near(player.state.nativeEffects.transitions.find(item=>item.actorId==='bg').progress,.5);release(player);assert.equal(player.state.dialogue.textId,'a4');const off=player.state.nativeEffects.transitions.find(item=>item.actorId==='bg');assert.equal(off.from.asset,'bgB');assert.equal(off.to,null);assert.equal(player.state.characters.some(actor=>actor.id==='bg'),false);player.advance(.5);assert.equal(player.state.nativeEffects.transitions.length,0);player.dispose();
});
await check('world MoveTo drops layer translation, retains the actual texture child offset, and NoWait never blocks input',()=>{
  const {story,manifest}=fixture(),player=new ReaderPlayer(story,{nativeEffects:manifest});player.enter('world');assert.equal(player.state.waiting,'dialogue');assert.equal(player.state.nativeEffects.inputWaiting,false);player.play();player.advance(.5);near(p(player).x,709.375);player.advance(.5);near(p(player).x,710);release(player);assert.equal(player.state.dialogue.textId,'w2');player.dispose();
});
await check('speaker timing changes only with the native label, settles future previews and carries independently of draw fallback',()=>{
  const {story,manifest}=fixture(),player=new ProgramPlayer(story,{nativeEffects:manifest});assert.equal('speakerActorId' in player.state.nativeEffects,false);player.play();player.advance(3);assert.equal(player.state.nativeEffects.speakerActorId,'p');near(player.state.nativeEffects.speakerChangedAt,1);release(player);near(player.state.nativeEffects.speakerChangedAt,1);const preview=player.previewDialogue(2);assert.equal(preview.nativeEffects.speakerActorId,null);assert.equal(preview.nativeEffects.previousSpeakerActorId,'p');assert.ok(preview.stageTime>=preview.nativeEffects.speakerChangedAt+.2-1e-7);player.commitDialogue(3);assert.equal(player.state.dialogue.textId,'a4');release(player);assert.equal(player.state.sceneId,'tail');assert.equal(player.state.nativeEffects.guiActive.Config,false);assert.equal(player.state.nativeEffects.speakerActorId,'p');near(player.state.nativeEffects.speakerChangedAt,0);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('native snapshots validate timing barriers, restore attached effects, and reject forged time/revision fields',()=>{
  const {story,manifest}=fixture(),player=new ReaderPlayer(story,{nativeEffects:manifest}),saved=player.snapshot();assert.ok(saved.nativeTimingRevision);validateReaderSnapshot(story,saved);const restored=new ReaderPlayer(story);restored.restore(saved);assert.ok(restored.state.nativeEffects);assert.deepEqual(restored.snapshot(),saved);
  const bad=copy(saved);bad.wait.until=.5;assert.throws(()=>validateReaderSnapshot(story,bad));const wrong=copy(saved);wrong.nativeTimingRevision='native-1:'+'b'.repeat(64);assert.throws(()=>validateReaderSnapshot(story,wrong));player.dispose();restored.dispose();
});
await check('old records retain their clock and revision until a fresh explicit scene entry upgrades native timing',()=>{
  const {story,manifest}=fixture(),legacy=new ProgramPlayer(story);legacy.play();legacy.advance(1);const old=legacy.snapshot(),player=new ProgramPlayer(story,{nativeEffects:manifest});player.restore(old);assert.equal('nativeTimingRevision' in player.snapshot(),false);assert.equal(player.state.nativeEffects.inputWaiting,true);release(player);assert.equal(player.state.dialogue.textId,'a2');assert.equal(player.snapshot().programRevision,old.programRevision);validateProgramSnapshot(story,player.snapshot());player.enter('world');assert.ok(player.snapshot().nativeTimingRevision);validateProgramSnapshot(story,player.snapshot());legacy.dispose();player.dispose();
});
await check('text speed is local presentation state, accepts instant reveal and leaves canonical source clock unchanged',()=>{
  const {story,manifest}=fixture();story.texts.find(text=>text.id==='w1').source='x'.repeat(80);const player=new ReaderPlayer(story,{nativeEffects:manifest});player.enter('world');player.setTextSpeed(20);player.play();player.advance(1);assert.equal(player.state.dialogue.visibleCharacters,20);const saved=player.snapshot();player.setTextSpeed(Infinity);assert.equal(player.state.dialogue.visibleCharacters,80);assert.deepEqual(player.snapshot(),saved);const slow=player.previewDialogue(1);player.setTextSpeed(96);near(player.previewDialogue(1).stageTime,slow.stageTime);assert.throws(()=>player.setTextSpeed(7));player.dispose();
});
await check('preview and commit preserve actual history and deterministic native state across rewind and save restore',()=>{
  const {story,manifest}=fixture(),player=new ProgramPlayer(story,{nativeEffects:manifest});player.play();player.advance(3);release(player);player.advance(.4);const atA2=player.state;release(player);player.advance(.3);const saved=player.snapshot();player.previewDialogue(3);assert.deepEqual(player.snapshot(),saved);player.previousDialogue();assert.equal(player.state.dialogue.textId,'a2');assert.equal(p(player).asset,'happy');near(p(player).x,p({state:atA2}).x);assert.equal(player.state.nativeEffects.speakerActorId,'p');const restored=new ProgramPlayer(story,{nativeEffects:manifest});restored.restore(player.snapshot());assert.deepEqual(restored.state.nativeEffects,player.state.nativeEffects);assert.deepEqual(restored.getDialogueHistory().map(row=>row.textId),['a1']);validateProgramSnapshot(story,restored.snapshot());player.dispose();restored.dispose();
});

await check('automatic page advance respects Add effects and timing validation rejects a forged early input release',()=>{
  const {story,manifest}=fixture();story.scenes[0].commands[3].pageCtrl='Next';const player=new ReaderPlayer(story,{nativeEffects:manifest});player.play();player.advance(2.9);assert.equal(player.state.dialogue.textId,'a1');player.advance(.1);assert.equal(player.state.dialogue.textId,'a2');const forged=player.snapshot();forged.executions[3].releaseAt=2;for(const item of forged.executions.slice(4))item.at=2;assert.throws(()=>validateReaderSnapshot(story,forged));player.dispose();
});
await check('carry shifts all native clock anchors and sidecar semantic changes alter the optional timing revision',()=>{
  const shifted=carryNativeEffects({waitUntil:9,inputWaitUntil:10,defaultBarrier:9,speakerChangedAt:3,motions:[{at:4}],transitions:[{at:5}],shakes:[{at:6}],waits:[{at:7}]},4);assert.equal(shifted.waitUntil,5);assert.equal(shifted.inputWaitUntil,6);assert.equal(shifted.defaultBarrier,5);assert.equal(shifted.speakerChangedAt,-1);assert.deepEqual(['motions','transitions','shakes','waits'].map(key=>shifted[key][0].at),[0,1,2,3]);
  const {story,manifest}=fixture(),first=compileNativeEffects(story,manifest),edited=copy(manifest);edited.scenes.main[1].duration=1.2;const second=compileNativeEffects(story,edited);assert.notEqual(first.revision,second.revision);const evidenceOnly=copy(manifest);evidenceOnly.evidence={note:'new audit evidence'};assert.equal(compileNativeEffects(story,evidenceOnly).revision,first.revision);
});

if(process.argv.includes('--real')){
  const story=JSON.parse(await readFile(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8')),manifest=JSON.parse(await readFile(new URL('../../private/story-player/data/native-presentation.json',import.meta.url),'utf8'));
  await check('real app installation attaches native presentation after player creation and text lengths without rewriting its startup trace',()=>{
    const player=new ProgramPlayer(story),before=player.snapshot();player.setNativeEffects(manifest);player.setTextLengths({});assert.deepEqual(player.snapshot(),before);assert.ok(player.state.nativeEffects);validateProgramSnapshot(story,player.snapshot());player.enter('chapter-25-row-1');assert.ok(player.snapshot().nativeTimingRevision);player.setNativeEffects(manifest);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('real Default MoveBy chapter has the two native wait gates and round-trips its timing-aware record',()=>{
    const player=new ProgramPlayer(story,{nativeEffects:manifest});player.enter('chapter-24-row-21');assert.equal(player.state.waiting,'wait');const first=player.snapshot().reader.wait.until;assert.ok(first>0);player.play();player.advance(first);assert.equal(player.state.waiting,'wait');const saved=validateProgramSnapshot(story,player.snapshot()),restored=new ProgramPlayer(story,{nativeEffects:manifest});restored.restore(saved);assert.deepEqual(restored.snapshot(),saved);restored.play();restored.advance(5);validateProgramSnapshot(story,restored.snapshot());player.dispose();restored.dispose();
  });
  await check('real chapter25 dialogue14 only shakes the message window and future CG previews finish native transitions',()=>{
    const player=new ProgramPlayer(story,{nativeEffects:manifest});player.enter('chapter-25-row-1');player.seekDialogue(14);const frame=player.state;assert.equal(frame.dialogue.index,14);assert.equal(frame.camera.shakeX,0);assert.equal(frame.camera.shakeY,0);assert.ok(frame.nativeEffects.shakes.some(item=>item.target==='messageWindow'));player.enter('chapter-26-row-1');for(const [index,asset] of [[26,'texture:resources.assets:973'],[27,'texture:resources.assets:683'],[28,'texture:resources.assets:973']]){const preview=player.previewDialogue(index),bg=preview.characters.filter(actor=>actor.kind==='background');assert.equal(bg.length,1);assert.equal(bg[0].asset,asset);assert.equal(preview.nativeEffects.transitions.length,0);assert.ok(preview.stageTime>=preview.nativeEffects.speakerChangedAt+.2-1e-7);}player.commitDialogue(27);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('original 1.1 record still imports under native presentation without revision or historical clock migration',async()=>{
    const old=JSON.parse(await readFile(new URL('./fixtures/program-1.1-chapter26.json',import.meta.url),'utf8')),player=new ProgramPlayer(story,{nativeEffects:manifest});player.restore(old);assert.equal(player.snapshot().programRevision,'program-2:f4970d4f51acdfe9');assert.equal('nativeTimingRevision' in player.snapshot(),false);assert.deepEqual(player.snapshot(),old);player.previewDialogue(28);validateProgramSnapshot(story,player.snapshot());player.enter('chapter-26-row-1');assert.ok(player.snapshot().nativeTimingRevision);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
}
console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results},null,2));if(results.some(item=>!item.passed))process.exitCode=1;

