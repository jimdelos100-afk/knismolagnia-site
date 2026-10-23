import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';
import {ReaderPlayer,validateReaderSnapshot} from '../../private/story-player/src/reader.js';

const copy=value=>structuredClone(value);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const results=[];
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
function storyFor(definitions){
  const scenes=definitions.map(({id,events,commands})=>({id,title:id,duration:1000,entry:{background:{asset:'black'},characters:[],audio:[]},events,commands:commands||events.map((event,eventIndex)=>({type:event.type==='dialogue'?'dialogue':'event',eventIndex}))}));
  const ids=new Set(definitions.flatMap(({events})=>events.filter(event=>event.textId).map(event=>event.textId)));
  return {type:'story-player',schemaVersion:1,id:'history-fixture',title:'History fixture',gameFingerprint:'history-fixture-1',stage:{width:1280,height:720},startScene:scenes[0].id,assets:['black','alice','bob','cg'].map(id=>({id,type:'image',src:id+'.png'})).concat([{id:'music',type:'audio',src:'music.ogg'}]),texts:[...ids].map(id=>({id,source:id+' dialogue.',speaker:'Original speaker'})),scenes,program:{version:1,entry:scenes[0].id,variables:{score:0},nodes:Object.fromEntries(definitions.map(({id,exit},index)=>[id,{sceneId:id,entryMode:index?'carry':'reset',exit}]))}};
}
const line=textId=>({type:'dialogue',at:0,textId});
function branchStory(){return storyFor([
  {id:'intro',events:[{type:'audio',id:'bgm',asset:'music',offset:5,duration:1000,loop:true,at:0},{type:'character',kind:'character',id:'alice',asset:'alice',at:0},line('a1'),line('a2')],exit:{type:'choices',items:[{id:'wrong',label:'Wrong',then:{type:'goto',target:'wrong'}},{id:'right',label:'Right',then:{type:'set',assign:{score:'1'},then:{type:'goto',target:'right'}}}]}},
  {id:'wrong',events:[line('unread')],exit:{type:'end'}},
  {id:'right',events:[{type:'character',kind:'character',id:'bob',asset:'bob',at:0},line('b1'),line('b2')],exit:{type:'call',target:'cg',returnTo:'join'}},
  {id:'cg',events:[{type:'mode',eventMode:true,at:0},{type:'character',kind:'background',id:'cg-slot',asset:'cg',at:0},line('c1')],exit:{type:'return'}},
  {id:'join',events:[line('j1')],exit:{type:'end'}}
]);}
function bulkStory(count=42){return storyFor([{id:'bulk',events:Array.from({length:count},(_,i)=>line(`line-${i}`)),exit:{type:'end'}}]);}
function release(player,seconds=2){player.play();player.advance(seconds);if(player.next()==='reveal')player.next();}
function reachRight(player){release(player);release(player);assert.equal(player.state.waiting,'choice');player.choose('right');assert.equal(player.state.dialogue.textId,'b1');}
function art(state){return {eventMode:state.eventMode,characters:state.characters,background:state.background,audio:state.audio.map(({id,asset,position})=>({id,asset,position}))};}

await check('history includes only the preceding 30 lines oldest to newest and never includes the current or future line',()=>{
  for(const Constructor of [ReaderPlayer,ProgramPlayer]){
    const player=new Constructor(bulkStory());assert.deepEqual(player.getDialogueHistory(),[]);
    for(let n=0;n<40;n++)release(player);
    const history=player.getDialogueHistory(30);assert.equal(history.length,30);assert.deepEqual(history.map(item=>item.textId),Array.from({length:30},(_,i)=>`line-${i+10}`));assert.equal(player.state.dialogue.textId,'line-40');
    assert.equal(new Set(history.map(item=>item.token)).size,30);assert.equal(player.getDialogueHistory(99999).length,30);assert.deepEqual(player.getDialogueHistory(0),[]);assert.throws(()=>player.getDialogueHistory(-1));player.dispose();
  }
});
await check('progress is per block, stable while waiting, has a pre-first-line zero and marks the actual completed block',()=>{
  const story=storyFor([{id:'delayed',events:[line('a1'),line('a2')],commands:[{type:'wait',duration:2},{type:'dialogue',eventIndex:0},{type:'dialogue',eventIndex:1}],exit:{type:'end'}}]);
  for(const Constructor of [ReaderPlayer,ProgramPlayer]){
    const player=new Constructor(story);assert.deepEqual(player.getDialogueProgress(),{current:0,total:2,ratio:0,complete:false});player.play();player.advance(1);assert.equal(player.getDialogueProgress().ratio,0);player.advance(1);assert.deepEqual(player.getDialogueProgress(),{current:1,total:2,ratio:.5,complete:false});
    player.advance(20);assert.equal(player.getDialogueProgress().ratio,.5);player.next();assert.deepEqual(player.getDialogueProgress(),{current:2,total:2,ratio:1,complete:false});release(player);assert.deepEqual(player.getDialogueProgress(),{current:2,total:2,ratio:1,complete:true});
    const snapshot=player.snapshot();for(let n=0;n<1000;n++)player.getDialogueProgress();assert.deepEqual(player.snapshot(),snapshot);player.dispose();
  }
});
await check('a block without dialogue remains finite and completes only after its wait',()=>{
  const story=storyFor([{id:'empty',events:[],commands:[{type:'wait',duration:2}],exit:{type:'end'}}]);
  for(const Constructor of [ReaderPlayer,ProgramPlayer]){const player=new Constructor(story);assert.deepEqual(player.getDialogueProgress(),{current:0,total:0,ratio:0,complete:false});player.play();player.advance(2);assert.deepEqual(player.getDialogueProgress(),{current:0,total:0,ratio:1,complete:true});assert.deepEqual(player.getDialogueHistory(),[]);player.dispose();}
});
await check('history follows the actually selected branch across chapters and rewinds exact art audio variables and call stack',()=>{
  const story=branchStory(),player=new ProgramPlayer(story);reachRight(player);player.play();player.advance(3);const b1Art=art(player.state);player.next();release(player,4);assert.equal(player.state.sceneId,'cg');assert.equal(player.state.program.stackDepth,1);
  release(player,5);assert.equal(player.state.sceneId,'join');const history=player.getDialogueHistory(30);assert.deepEqual(history.map(item=>item.textId),['a1','a2','b1','b2','c1']);assert.ok(history.every(item=>item.textId!=='unread'));assert.equal(history.find(item=>item.textId==='b1').sceneId,'right');
  const stale=history.find(item=>item.textId==='c1').token;player.rewindToDialogue(history.find(item=>item.textId==='b1').token);assert.equal(player.state.dialogue.textId,'b1');assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);assert.equal(player.state.program.variables.score,1);assert.equal(player.state.program.stackDepth,0);assert.deepEqual(art(player.state),b1Art);validateProgramSnapshot(story,player.snapshot());
  assert.throws(()=>player.rewindToDialogue(stale));const prior=player.getDialogueHistory();assert.deepEqual(prior.map(item=>item.textId),['a1','a2']);player.rewindToDialogue(prior[0].token);assert.equal(player.state.program.variables.score,0);assert.equal(player.state.program.stackDepth,0);assert.deepEqual(player.state.characters.map(item=>item.id),['alice']);near(player.state.audio[0].position,7);assert.deepEqual(player.getDialogueHistory(),[]);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('rewinding a CG line restores its active call frame and reopening a choice clears its selected future',()=>{
  const story=branchStory(),player=new ProgramPlayer(story);reachRight(player);release(player);release(player);release(player);assert.equal(player.state.sceneId,'join');let history=player.getDialogueHistory();player.rewindToDialogue(history.find(item=>item.textId==='c1').token);assert.equal(player.state.program.stackDepth,1);assert.equal(player.state.eventMode,true);assert.equal(player.state.characters.find(item=>item.id==='cg-slot').asset,'cg');validateProgramSnapshot(story,player.snapshot());
  player.next();assert.equal(player.state.sceneId,'join');history=player.getDialogueHistory();player.rewindToDialogue(history.find(item=>item.textId==='a2').token);player.next();assert.equal(player.state.waiting,'choice');assert.equal(player.state.program.variables.score,0);assert.equal(player.state.choices.length,2);assert.deepEqual(player.getDialogueHistory().map(item=>item.textId),['a1']);player.choose('wrong');assert.equal(player.state.sceneId,'wrong');assert.deepEqual(player.getDialogueHistory().map(item=>item.textId),['a1','a2']);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('a paused/full automatic-page rewind does not advance until explicitly resumed',()=>{
  const story=bulkStory(3);story.scenes[0].commands[0].pageCtrl='Next';const player=new ReaderPlayer(story);player.play();player.advance(1);assert.equal(player.state.dialogue.textId,'line-1');const token=player.getDialogueHistory()[0].token;player.rewindToDialogue(token);assert.equal(player.state.dialogue.textId,'line-0');assert.equal(player.state.dialogue.textComplete,true);player.advance(100);assert.equal(player.state.dialogue.textId,'line-0');assert.equal(player.playing,false);validateReaderSnapshot(story,player.snapshot());player.next();assert.equal(player.state.dialogue.textId,'line-1');player.dispose();
});
await check('loop occurrences receive distinct opaque tokens while the block history and token registry stay bounded',()=>{
  const story=bulkStory(1);story.program.nodes.bulk.exit={type:'goto',target:'bulk'};const player=new ProgramPlayer(story);for(let n=0;n<300;n++)release(player,1);assert.equal(player._backBlocks.length,256);const history=player.getDialogueHistory();assert.equal(history.length,30);assert.equal(new Set(history.map(item=>item.token)).size,30);assert.ok(history.every(item=>item.sceneId==='bulk'&&item.textId==='line-0'));assert.equal(player._historyTokens.size,30);
  player.rewindToDialogue(history[0].token);assert.equal(player.snapshot().trace.length,270);assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('history API accepts no state payload, rejects forged and stale tokens and leaves playback unchanged on rejection',()=>{
  const player=new ProgramPlayer(branchStory());reachRight(player);const history=player.getDialogueHistory(),snapshot=player.snapshot();
  for(const token of [null,{},history[0],JSON.stringify({sceneId:'wrong',commandIndex:0}),globalThis.crypto.randomUUID()]){assert.throws(()=>player.rewindToDialogue(token));assert.deepEqual(player.snapshot(),snapshot);}
  player.enter('join');assert.deepEqual(player.getDialogueHistory(),[]);assert.throws(()=>player.rewindToDialogue(history[0].token));assert.equal(player.canPreviousDialogue(),false);player.dispose();
});
await check('save import reconstructs history from validated trace without changing the schema or carrying token state',()=>{
  const story=branchStory(),player=new ProgramPlayer(story);reachRight(player);release(player);release(player);const before=player.snapshot(),history=player.getDialogueHistory(),saved=player.snapshot();assert.deepEqual(saved,before);assert.equal(saved.schemaVersion,1);assert.ok(!('history' in saved)&&!('historyTokens' in saved));
  const restored=new ProgramPlayer(story);restored.restore(saved);assert.deepEqual(restored.getDialogueHistory().map(({sceneId,textId})=>({sceneId,textId})),history.map(({sceneId,textId})=>({sceneId,textId})));assert.throws(()=>restored.rewindToDialogue(history[0].token));restored.rewindToDialogue(restored.getDialogueHistory()[0].token);assert.equal(restored.state.dialogue.textId,'a1');validateProgramSnapshot(story,restored.snapshot());
  const forged=copy(saved);forged.dialogueHistory=[{sceneId:'wrong',entry:{characters:[]}}];assert.throws(()=>validateProgramSnapshot(story,forged));player.dispose();restored.dispose();
});
await check('standalone reader imports preserve progress and history tokens survive forward movement but not rewind',()=>{
  const story=bulkStory(5),player=new ReaderPlayer(story);release(player);release(player);const saved=player.snapshot(),history=player.getDialogueHistory(),token=history[0].token;release(player);assert.ok(player.getDialogueHistory().some(item=>item.token===token));player.rewindToDialogue(token);assert.equal(player.state.dialogue.textId,'line-0');assert.equal(player.getDialogueProgress().current,1);assert.throws(()=>player.rewindToDialogue(token));player.restore(saved);assert.deepEqual(player.getDialogueHistory().map(item=>item.textId),['line-0','line-1']);validateReaderSnapshot(story,player.snapshot());player.dispose();
});

if(process.argv.includes('--real')){
  const story=JSON.parse(await readFile(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8'));
  await check('unchanged 1.1 runtime save imports with its original revision and supports history token rewind',async()=>{
    const saved=JSON.parse(await readFile(new URL('./fixtures/program-1.1-chapter26.json',import.meta.url),'utf8'));assert.equal(saved.programRevision,'program-2:f4970d4f51acdfe9');const player=new ProgramPlayer(story);player.restore(saved);assert.equal(player.snapshot().programRevision,saved.programRevision);assert.equal(player.state.dialogue.index,3);const history=player.getDialogueHistory();assert.equal(history.length,3);player.rewindToDialogue(history[1].token);assert.equal(player.state.dialogue.index,1);assert.equal(player.state.dialogue.textComplete,true);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('real CG history rewind restores the selected full-size resource without stacking',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-26-row-1');player.seekDialogue(28);const currentProgress=player.getDialogueProgress();assert.equal(currentProgress.current,29);assert.equal(currentProgress.total,player.state.dialogue.count);const history=player.getDialogueHistory();assert.equal(history.length,28);player.rewindToDialogue(history.at(-1).token);assert.equal(player.state.dialogue.index,27);const cgs=player.state.characters.filter(item=>item.kind==='background');assert.equal(cgs.length,1);assert.equal(cgs[0].asset,'texture:resources.assets:683');assert.equal(player.playing,false);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
}
console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results},null,2));
if(results.some(item=>!item.passed))process.exitCode=1;
