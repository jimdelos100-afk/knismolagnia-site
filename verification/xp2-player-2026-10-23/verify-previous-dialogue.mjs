import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ProgramPlayer,validateProgramSnapshot,validateProgramStory} from '../../private/story-player/src/program-player.js';
import {ReaderPlayer,validateReaderSnapshot} from '../../private/story-player/src/reader.js';

const copy=value=>structuredClone(value);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
function fixture(){
  const image=id=>({id,type:'image',src:id+'.png'});
  const scene=(id,events,exit,commands=events.map((event,eventIndex)=>({type:event.type==='dialogue'?'dialogue':'event',eventIndex})))=>({id,title:id,duration:50,entry:{background:{asset:'black'},characters:[],audio:[]},events,commands,exit});
  const line=textId=>({type:'dialogue',at:0,textId});
  const intro=scene('chapter-1',[
    {type:'audio',id:'bgm',asset:'music',offset:5,duration:1000,loop:true,at:0},
    {type:'character',kind:'character',id:'alice',asset:'alice',at:0},line('a1'),
    {type:'mode',eventMode:true,at:2},{type:'character',kind:'background',id:'cg-slot',asset:'cg1',at:2},{type:'dialogue',textId:'a2',at:2}
  ],{type:'choices',items:[{id:'wrong',label:'Wrong',then:{type:'goto',target:'wrong'}},{id:'right',label:'Right',then:{type:'set',assign:{score:'1'},then:{type:'goto',target:'chapter-2'}}}]},
  [{type:'event',eventIndex:0},{type:'event',eventIndex:1},{type:'dialogue',eventIndex:2},{type:'wait',duration:2},{type:'event',eventIndex:3},{type:'event',eventIndex:4},{type:'dialogue',eventIndex:5}]);
  const branch=scene('chapter-2',[{type:'mode',eventMode:false,at:0},{type:'clearActors',kind:'background',at:0},{type:'character',kind:'character',id:'bob',asset:'bob',at:0},line('b1'),line('b2')],{type:'call',target:'cg',returnTo:'join'});
  const wrong=scene('wrong',[{type:'mode',eventMode:false,at:0},{type:'character',kind:'character',id:'wrong',asset:'wrong',at:0},line('wrong')],{type:'end'});
  const cg=scene('cg',[{type:'mode',eventMode:true,at:0},{type:'character',kind:'background',id:'cg-slot',asset:'cg2',at:0},line('c1')],{type:'return'});
  const join=scene('join',[line('j1')],{type:'end'});
  const scenes=[intro,wrong,branch,cg,join];
  const nodes=Object.fromEntries(scenes.map(({id,exit})=>[id,{sceneId:id,entryMode:id==='chapter-1'?'reset':'carry',exit}]));
  scenes.forEach(scene=>delete scene.exit);
  return {type:'story-player',schemaVersion:1,id:'neutral-previous-test',title:'Neutral previous test',gameFingerprint:'neutral-previous-1',stage:{width:1280,height:720},startScene:'chapter-1',assets:['black','alice','bob','wrong','cg1','cg2'].map(image).concat([{id:'music',type:'audio',src:'music.ogg'}]),texts:['a1','a2','b1','b2','c1','j1','wrong'].map(id=>({id,source:id+' dialogue.'})),scenes,program:{version:1,entry:'chapter-1',variables:{score:0},nodes}};
}
function release(player,seconds=1){player.play();player.advance(seconds);const result=player.next();if(result==='reveal')player.next();}
function reachSecond(player){release(player,3);player.advance(2);assert.equal(player.state.dialogue.textId,'a2');}
function reachRight(player){reachSecond(player);release(player,4);assert.equal(player.state.waiting,'choice');player.choose('right');assert.equal(player.state.dialogue.textId,'b1');}
function art(state){return {mode:state.eventMode,characters:state.characters.map(({id,asset,x,y,opacity})=>({id,asset,x,y,opacity})),background:state.background,audio:state.audio.map(({id,asset,position})=>({id,asset,position}))};}
const results=[];
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}

await check('first spoken line and empty entry disable previous',()=>{
  const story=fixture(),player=new ProgramPlayer(story);assert.equal(player.canPreviousDialogue(),false);const before=player.snapshot();player.previousDialogue();assert.deepEqual(player.snapshot(),before);
  const empty=copy(story);empty.scenes[0].events=[];empty.scenes[0].commands=[];empty.program.nodes['chapter-1'].exit={type:'end'};const p=new ProgramPlayer(empty);assert.equal(p.canPreviousDialogue(),false);p.previousDialogue();assert.equal(p.state.ended,true);p.dispose();player.dispose();
});
await check('mid-typewriter previous restores exact prior art audio clock and full line',()=>{
  const player=new ProgramPlayer(fixture());player.play();player.advance(3);const first=art(player.state);player.next();player.advance(2);assert.equal(player.state.dialogue.textId,'a2');assert.equal(player.state.dialogue.textComplete,false);assert.equal(player.state.eventMode,true);
  assert.equal(player.canPreviousDialogue(),true);player.previousDialogue();assert.equal(player.state.dialogue.textId,'a1');assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);assert.deepEqual(art(player.state),first);assert.equal(player.canPreviousDialogue(),false);validateProgramSnapshot(fixture(),player.snapshot());
  player.next();player.advance(2);assert.equal(player.state.dialogue.textId,'a2');assert.equal(player.state.characters.filter(item=>item.kind==='background').length,1);player.dispose();
});
await check('back during post-line animation restores the last released spoken line',()=>{
  const player=new ProgramPlayer(fixture());release(player,3);assert.equal(player.state.waiting,'wait');player.previousDialogue();assert.equal(player.state.dialogue.textId,'a1');assert.equal(player.state.eventMode,false);near(player.state.audio[0].position,8);player.dispose();
});
await check('actual branch and cross-chapter previous never visit an unselected sibling',()=>{
  const story=fixture(),player=new ProgramPlayer(story);reachRight(player);assert.equal(player.state.program.variables.score,1);assert.equal(player.state.eventMode,false);assert.deepEqual(player.state.characters.map(item=>item.id),['bob']);
  player.previousDialogue();assert.equal(player.state.sceneId,'chapter-1');assert.equal(player.state.dialogue.textId,'a2');assert.equal(player.state.program.variables.score,0);assert.equal(player.state.eventMode,true);assert.deepEqual(player.state.characters.map(item=>item.id),['cg-slot']);assert.equal(player.state.characters[0].asset,'cg1');validateProgramSnapshot(story,player.snapshot());
  player.next();assert.equal(player.state.waiting,'choice');player.choose('right');assert.equal(player.state.sceneId,'chapter-2');player.previousDialogue();player.previousDialogue();assert.equal(player.state.dialogue.textId,'a1');assert.equal(player.canPreviousDialogue(),false);assert.ok(player.snapshot().trace.every(item=>item.id!=='wrong'));player.dispose();
});
await check('CG call and return can rewind with stack and timing intact',()=>{
  const story=fixture(),player=new ProgramPlayer(story);reachRight(player);release(player,2);const b2=art(player.state);release(player,3);assert.equal(player.state.sceneId,'cg');assert.equal(player.state.program.stackDepth,1);assert.equal(player.state.eventMode,true);
  player.previousDialogue();assert.equal(player.state.dialogue.textId,'b2');assert.equal(player.state.program.stackDepth,0);assert.equal(player.state.eventMode,false);const expected=copy(b2);expected.audio[0].position+=3;assert.deepEqual(art(player.state),expected);validateProgramSnapshot(story,player.snapshot());
  player.next();assert.equal(player.state.sceneId,'cg');release(player,2);assert.equal(player.state.sceneId,'join');assert.equal(player.state.program.stackDepth,0);player.previousDialogue();assert.equal(player.state.sceneId,'cg');assert.equal(player.state.program.stackDepth,1);assert.equal(player.state.characters[0].asset,'cg2');validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('previous at an end or pending choice reopens its last full dialogue',()=>{
  const story=fixture(),player=new ProgramPlayer(story);reachSecond(player);release(player,4);assert.equal(player.state.waiting,'choice');player.previousDialogue();assert.equal(player.state.dialogue.textId,'a2');assert.equal(player.state.waiting,'dialogue');assert.equal(player.state.choices.length,0);validateProgramSnapshot(story,player.snapshot());
  player.next();player.choose('wrong');release(player,2);assert.equal(player.state.ended,true);player.previousDialogue();assert.equal(player.state.dialogue.textId,'wrong');assert.equal(player.state.ended,false);assert.equal(player.state.dialogue.textComplete,true);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('save import re-derives previous history and forged history payload is rejected',()=>{
  const story=fixture(),player=new ProgramPlayer(story);reachRight(player);release(player,2);release(player,3);const saved=player.snapshot(),restored=new ProgramPlayer(story);restored.restore(saved);assert.equal(restored.canPreviousDialogue(),true);restored.previousDialogue();assert.equal(restored.state.dialogue.textId,'b2');restored.previousDialogue();assert.equal(restored.state.dialogue.textId,'b1');restored.previousDialogue();assert.equal(restored.state.dialogue.textId,'a2');validateProgramSnapshot(story,restored.snapshot());
  const forged=copy(saved);forged.backBlocks=[{entry:{characters:[]}}];assert.throws(()=>validateProgramSnapshot(story,forged));player.dispose();restored.dispose();
});
await check('map jumps create no pretend previous lines from canonical reconstruction',()=>{
  const player=new ProgramPlayer(fixture());reachRight(player);player.enter('join');assert.equal(player.canPreviousDialogue(),false);assert.equal(player.state.dialogue.textId,'j1');player.previousDialogue();assert.equal(player.state.dialogue.textId,'j1');player.dispose();
});
await check('standalone reader back respects automatic pages while pausing for a full line',()=>{
  const story=fixture(),scene=story.scenes[0];scene.events=[{type:'dialogue',at:0,textId:'a1'},{type:'dialogue',at:0,textId:'a2'}];scene.commands=[{type:'dialogue',eventIndex:0,pageCtrl:'Next'},{type:'dialogue',eventIndex:1}];const player=new ReaderPlayer(story);assert.equal(player.canPreviousDialogue(),false);player.play();player.advance(.6);assert.equal(player.state.dialogue.textId,'a2');player.previousDialogue();assert.equal(player.state.dialogue.textId,'a1');assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);validateReaderSnapshot(story,player.snapshot());player.advance(100);assert.equal(player.state.dialogue.textId,'a1');player.next();assert.equal(player.state.dialogue.textId,'a2');player.dispose();
});
await check('back history is bounded and stores cursors instead of reader or story copies',()=>{
  const story=fixture();story.scenes=story.scenes.slice(0,1);story.scenes[0].events=[{type:'dialogue',at:0,textId:'a1'}];story.scenes[0].commands=[{type:'dialogue',eventIndex:0}];story.program.nodes={'chapter-1':{sceneId:'chapter-1',entryMode:'reset',exit:{type:'goto',target:'chapter-1'}}};const player=new ProgramPlayer(story);
  for(let n=0;n<300;n++)release(player,1);assert.equal(player._backBlocks.length,256);assert.ok(player._backBlocks.every(item=>Number.isInteger(item.traceIndex)&&!('reader' in item)&&!('story' in item)));
  const before=player._backBlocks.length;for(let n=0;n<1000;n++)player.canPreviousDialogue();assert.equal(player._backBlocks.length,before);
  let steps=0;while(player.canPreviousDialogue()){player.previousDialogue();steps++;assert.ok(steps<=256);}assert.equal(steps,256);assert.equal(player.state.dialogue.textId,'a1');player.dispose();
});
await check('reader snapshots are evaluated only on demand during rendering',()=>{
  const player=new ReaderPlayer(fixture());let snapshots=0;const original=player.snapshot.bind(player);player.snapshot=()=>{snapshots++;return original();};const state=player.state;assert.equal(snapshots,0);assert.equal(Object.keys(state).includes('readerSnapshot'),false);assert.equal(state.readerSnapshot.type,'story-player-reader');assert.equal(snapshots,1);player.dispose();
});

await check('flow shares one validated private script while public input stays isolated and strict',()=>{
  const story=fixture(),player=new ProgramPlayer(story);assert.equal(player._story,player._reader._story);assert.notEqual(player._story,story);
  story.scenes[0].events[1].asset='wrong';story.program.variables.score=99;assert.equal(player.state.characters[0].asset,'alice');assert.equal(player.state.program.variables.score,0);
  const exposed=player.story;exposed.scenes[0].events[1].asset='wrong';assert.equal(player.state.characters[0].asset,'alice');
  const badCommands=fixture();badCommands.scenes[0].commands[0].eventIndex=99999;assert.throws(()=>new ProgramPlayer(badCommands));assert.throws(()=>new ReaderPlayer(badCommands,{validatedStory:true}));assert.throws(()=>validateProgramStory(badCommands));
  const badProgram=fixture();badProgram.program.nodes['chapter-2'].exit.target='missing';assert.throws(()=>new ProgramPlayer(badProgram));assert.throws(()=>validateProgramStory(badProgram));player.dispose();
});
await check('cross-block previous keeps the currently selected reading speed',()=>{
  const player=new ProgramPlayer(fixture());reachRight(player);player.setRate(2);player.previousDialogue();assert.equal(player.state.sceneId,'chapter-1');assert.equal(player.rate,2);assert.equal(player.playing,false);validateProgramSnapshot(fixture(),player.snapshot());player.dispose();
});

if(process.argv.includes('--real')){
  const story=JSON.parse(await readFile(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8'));
  await check('actual 1.1.0 archive runtime save imports with original revision and supports previous',async()=>{
    const saved=JSON.parse(await readFile(new URL('./fixtures/program-1.1-chapter26.json',import.meta.url),'utf8'));
    assert.equal(saved.programRevision,'program-2:f4970d4f51acdfe9');const checked=validateProgramSnapshot(story,saved),player=new ProgramPlayer(story);player.restore(checked);assert.equal(player.state.dialogue.index,3);const expected=player.scene.events[story.scenes.find(item=>item.id===saved.reader.sceneId).commands.filter(item=>item.type==='dialogue')[2].eventIndex].textId;player.previousDialogue();assert.equal(player.state.dialogue.textId,expected);assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('real XP2 chapter 26 CG replacements rewind A to B to A without stacking',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-26-row-1');player.seekDialogue(28);
    const cgAsset=()=>{const cgs=player.state.characters.filter(item=>item.kind==='background');assert.equal(cgs.length,1);return cgs[0].asset;};
    assert.equal(cgAsset(),'texture:resources.assets:973');player.previousDialogue();assert.equal(player.state.dialogue.index,27);assert.equal(cgAsset(),'texture:resources.assets:683');player.previousDialogue();assert.equal(player.state.dialogue.index,26);assert.equal(cgAsset(),'texture:resources.assets:973');validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('real XP2 chapter 02 rewind follows the selected Otowa branch at its merge',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-02-row-17');player.choose('chapter-02-row-17-false');player.choose('chapter-02-row-20-true');assert.equal(player.state.sceneId,'chapter-02-row-21');let priorText,priorArt;
    for(let n=0;n<30&&player.state.sceneId==='chapter-02-row-21';n++){if(player.state.waiting==='dialogue'){player.play();player.advance(3);priorText=player.state.dialogue.textId;priorArt=art(player.state);if(player.next()==='reveal')player.next();}else{player.play();player.advance(30);}}
    assert.equal(player.state.sceneId,'chapter-02-row-47');player.previousDialogue();assert.equal(player.state.sceneId,'chapter-02-row-21');assert.equal(player.state.dialogue.textId,priorText);assert.deepEqual(art(player.state),priorArt);assert.deepEqual(player.snapshot().trace.filter(action=>action.kind==='choice').map(action=>action.id),['chapter-02-row-17-false','chapter-02-row-20-true']);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('real XP2 previous crosses chapter 26 back into the completed chapter 25 line',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-25-row-1');const last=player.state.dialogue.count-1;player.seekDialogue(last);const previousText=player.state.dialogue.textId;
    for(let n=0;n<30&&player.state.sceneId==='chapter-25-row-1';n++){if(player.state.waiting==='dialogue')release(player,3);else{player.play();player.advance(300);}}
    assert.equal(player.state.sceneId,'chapter-26-row-1');player.previousDialogue();assert.equal(player.state.sceneId,'chapter-25-row-1');assert.equal(player.state.dialogue.textId,previousText);assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
}
console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results},null,2));
if(results.some(item=>!item.passed))process.exitCode=1;
