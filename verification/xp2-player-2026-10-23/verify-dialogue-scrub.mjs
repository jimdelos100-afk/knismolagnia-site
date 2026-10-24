import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ReaderPlayer,validateReaderSnapshot} from '../../private/story-player/src/reader.js';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';

const results=[],metrics={};
const copy=value=>structuredClone(value);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
function fixture(){
  const line=textId=>({type:'dialogue',at:0,textId});
  const a=[{type:'audio',id:'bgm',asset:'music',offset:7,loop:true,duration:1000,at:0},{type:'mode',eventMode:true,at:0},{type:'character',kind:'background',id:'cg-slot',asset:'cg1',at:0},line('a1'),{type:'fade',opacity:1,duration:.4,at:0},{type:'character',kind:'background',id:'cg-slot',asset:'cg2',at:0},{type:'fade',opacity:0,duration:.4,at:0},line('a2'),{type:'character',kind:'background',id:'cg-slot',asset:'cg3',at:0},line('a3')];
  const scene=(id,events)=>({id,title:id,duration:40,entry:{background:{asset:'black'},characters:[],audio:[]},events,commands:events.map((event,eventIndex)=>({type:event.type==='dialogue'?'dialogue':'event',eventIndex,...(eventIndex===4?{block:true}:{})}))});
  const scenes=[scene('start',[line('s1')]),scene('a',a),scene('b',[{type:'character',kind:'background',id:'cg-slot',asset:'other',at:0},line('b1'),line('b2')]),scene('join',[line('j1')])];
  return {type:'story-player',schemaVersion:1,id:'scrub-fixture',title:'Scrub fixture',gameFingerprint:'scrub-fixture-1',stage:{width:1280,height:720},startScene:'start',assets:['black','cg1','cg2','cg3','other'].map(id=>({id,type:'image',src:id+'.png'})).concat([{id:'music',type:'audio',src:'music.ogg'}]),texts:['s1','a1','a2','a3','b1','b2','j1'].map(id=>({id,source:id+' original dialogue.'})),scenes,program:{version:1,entry:'start',variables:{score:0},nodes:{start:{sceneId:'start',entryMode:'reset',exit:{type:'choices',items:[{id:'a',label:'A',then:{type:'set',assign:{score:'1'},then:{type:'call',target:'a',returnTo:'join'}}},{id:'b',label:'B',then:{type:'goto',target:'b'}}]}},a:{sceneId:'a',entryMode:'carry',exit:{type:'return'}},b:{sceneId:'b',entryMode:'carry',exit:{type:'goto',target:'join'}},join:{sceneId:'join',entryMode:'carry',exit:{type:'end'}}}}};
}
function release(player,seconds=3){player.play();player.advance(seconds);if(player.next()==='reveal')player.next();}
function toA(player){release(player);player.choose('a');assert.equal(player.state.sceneId,'a');}
function picture(state){return {background:state.background,characters:state.characters,eventMode:state.eventMode,overlay:state.overlay,camera:state.camera,audio:state.audio.map(({id,asset,position})=>({id,asset,position}))};}
const cg=state=>state.characters.find(item=>item.kind==='background')?.asset;

await check('preview is detached paused/full state and does not modify live cursors, callbacks, history or snapshots',()=>{
  const story=fixture();let updates=0,ends=0;const player=new ProgramPlayer(story,{onUpdate:()=>updates++,onEnd:()=>ends++});toA(player);const before=player.snapshot(),history=player.getDialogueHistory(),beforeUpdates=updates,beforeEnds=ends;
  const readerSnapshot=player._reader.snapshot.bind(player._reader);let snapshots=0;player._reader.snapshot=()=>{snapshots++;return readerSnapshot();};
  const preview=player.previewDialogue(2);assert.equal(cg(preview),'cg3');assert.equal(preview.dialogue.textId,'a3');assert.equal(preview.dialogue.textComplete,true);assert.equal(preview.playing,false);assert.equal(preview.audio[0].playing,false);assert.equal('readerSnapshot' in preview,false);assert.equal(snapshots,0);assert.equal(updates,beforeUpdates);assert.equal(ends,beforeEnds);assert.deepEqual(player.snapshot(),before);assert.deepEqual(player.getDialogueHistory(),history);
  preview.characters[0].asset='other';assert.equal(cg(player.previewDialogue(2)),'cg3');assert.equal(cg(player.state),'cg1');player.dispose();
});
await check('future previews apply exactly the requested CG and settle preceding visual transitions without executing future commands',()=>{
  const player=new ProgramPlayer(fixture());toA(player);assert.equal(cg(player.previewDialogue(0)),'cg1');const middle=player.previewDialogue(1);assert.equal(cg(middle),'cg2');near(middle.overlay.opacity,0);assert.equal(middle.dialogue.index,1);assert.equal(cg(player.previewDialogue(2)),'cg3');assert.equal(cg(player.previewDialogue(1)),'cg2');assert.equal(cg(player.state),'cg1');assert.equal(player.state.program.stackDepth,1);player.dispose();
});
await check('cancelled and invalid requests are rejected without changing the authoritative state',()=>{
  const player=new ProgramPlayer(fixture());toA(player);const before=player.snapshot(),controller=new AbortController();controller.abort();assert.throws(()=>player.previewDialogue(2,{signal:controller.signal}),{name:'AbortError'});
  for(const value of [-1,3,1.5,NaN,'1']){assert.throws(()=>player.previewDialogue(value));assert.throws(()=>player.commitDialogue(value));assert.deepEqual(player.snapshot(),before);}player.dispose();
});
await check('commit to first unread future line clears skipped local history and preserves provenance across save import',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toA(player);const expected=picture(player.previewDialogue(1));player.commitDialogue(1);assert.equal(player.state.dialogue.textId,'a2');assert.equal(player.state.dialogue.textComplete,true);assert.equal(player.playing,false);assert.deepEqual(picture(player.state),expected);assert.equal(player.state.program.variables.score,1);assert.equal(player.state.program.stackDepth,1);
  assert.deepEqual(player.getDialogueHistory().map(item=>item.textId),['s1']);assert.equal(player._reader.canPreviousDialogue(),false);const saved=validateProgramSnapshot(story,player.snapshot());assert.ok(saved.reader.historyStart>0);const restored=new ProgramPlayer(story);restored.restore(saved);assert.deepEqual(restored.getDialogueHistory().map(item=>item.textId),['s1']);assert.equal(restored._reader.canPreviousDialogue(),false);
  release(restored);assert.equal(restored.state.dialogue.textId,'a3');assert.deepEqual(restored.getDialogueHistory().map(item=>item.textId),['s1','a2']);restored.previousDialogue();assert.equal(restored.state.dialogue.textId,'a2');assert.equal(cg(restored.state),'cg2');validateProgramSnapshot(story,restored.snapshot());player.dispose();restored.dispose();
});
await check('committing an actually read location preserves its real art, music clock and history',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toA(player);player.play();player.advance(6);const first=picture(player.state);player.next();player.advance(.4);assert.equal(player.state.dialogue.textId,'a2');player.play();player.advance(4);player.next();assert.equal(player.state.dialogue.textId,'a3');const preview=player.previewDialogue(0);assert.deepEqual(picture(preview),first);player.commitDialogue(0);assert.deepEqual(picture(player.state),first);assert.equal(player.state.dialogue.textComplete,true);assert.equal('historyStart' in player.snapshot().reader,false);assert.deepEqual(player.getDialogueHistory().map(item=>item.textId),['s1']);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('preview caches remain bounded and changing branches or visits never reuses another carried entry',()=>{
  const story=fixture(),player=new ProgramPlayer(story);player.enter('a');assert.equal(cg(player.previewDialogue(2)),'cg3');player.enter('b');assert.equal(cg(player.previewDialogue(0)),'other');player.enter('a');assert.equal(cg(player.previewDialogue(0)),'cg1');
  const bulk=copy(story);bulk.scenes[1].events=Array.from({length:40},()=>({type:'dialogue',at:0,textId:'a1'}));bulk.scenes[1].commands=bulk.scenes[1].events.map((_,eventIndex)=>({type:'dialogue',eventIndex}));const reader=new ReaderPlayer(bulk);reader.enter('a');for(let n=0;n<40;n++)reader.previewDialogue(n);assert.equal(reader._previewCache.size,8);const plan=reader._seekPlan;reader.previewDialogue(39);assert.equal(reader._seekPlan,plan);reader.enter('b');assert.equal(reader._previewCache.size,0);assert.equal(reader._seekPlan,null);player.dispose();reader.dispose();
});
await check('scrubbing at a pending choice and final end can reopen the completed block without reusing its exit',()=>{
  const story=fixture(),player=new ProgramPlayer(story);release(player);assert.equal(player.state.waiting,'choice');const before=player.snapshot();assert.equal(player.previewDialogue(0).waiting,'dialogue');assert.deepEqual(player.snapshot(),before);player.commitDialogue(0);assert.equal(player.state.waiting,'dialogue');assert.equal(player.state.choices.length,0);validateProgramSnapshot(story,player.snapshot());player.next();assert.equal(player.state.waiting,'choice');player.choose('b');release(player);release(player);assert.equal(player.state.sceneId,'join');release(player);assert.equal(player.state.ended,true);player.commitDialogue(0);assert.equal(player.state.ended,false);assert.equal(player.state.waiting,'dialogue');assert.equal(player.state.dialogue.textId,'j1');validateProgramSnapshot(story,player.snapshot());player.dispose();
});
await check('history boundaries are strictly validated and older snapshots stay unchanged without optional fields',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toA(player);const old=player.snapshot();assert.equal('historyStart' in old.reader,false);assert.deepEqual(validateProgramSnapshot(story,old),old);player.commitDialogue(2);const saved=player.snapshot();
  for(const historyStart of [-1,NaN,999,1.5,0]){const forged=copy(saved);forged.reader.historyStart=historyStart;assert.throws(()=>validateProgramSnapshot(story,forged));}
  validateProgramSnapshot(story,saved);release(player);assert.equal(player.state.sceneId,'join');const completed=player.snapshot(),restored=new ProgramPlayer(story);restored.restore(completed);assert.deepEqual(restored.getDialogueHistory().map(item=>item.textId),['s1','a3']);restored.previousDialogue();assert.equal(restored.state.dialogue.textId,'a3');assert.equal(restored._reader.canPreviousDialogue(),false);validateProgramSnapshot(story,restored.snapshot());player.dispose();restored.dispose();
});
await check('legacy review seek retains its old clock while reusing the current-block command index',()=>{
  const story=fixture(),player=new ReaderPlayer(story);player.enter('a');player.seekDialogue(1);assert.equal(player.state.dialogue.index,1);near(player.state.stageTime,.4);const plan=player._seekPlan;player.seekDialogue(0);assert.equal(player._seekPlan,plan);near(player.state.stageTime,0);assert.equal(player.state.dialogue.textComplete,false);validateReaderSnapshot(story,player.snapshot());player.dispose();
});

if(process.argv.includes('--real')){
  const story=JSON.parse(await readFile(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8'));
  await check('real chapter26 CG preview and commit match A to B to A full-size resources without actor stacking',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-26-row-1');const saved=player.snapshot();
    for(const [index,asset] of [[26,'texture:resources.assets:973'],[27,'texture:resources.assets:683'],[28,'texture:resources.assets:973'],[27,'texture:resources.assets:683']]){const frame=player.previewDialogue(index),cgs=frame.characters.filter(item=>item.kind==='background');assert.equal(cgs.length,1);assert.equal(cgs[0].asset,asset);assert.equal(frame.dialogue.index,index);assert.equal(frame.dialogue.textComplete,true);assert.equal('readerSnapshot' in frame,false);}
    assert.deepEqual(player.snapshot(),saved);player.commitDialogue(27);assert.equal(player.state.characters.filter(item=>item.kind==='background').length,1);assert.equal(cg(player.state),'texture:resources.assets:683');assert.deepEqual(player.getDialogueHistory(),[]);const validated=validateProgramSnapshot(story,player.snapshot()),restored=new ProgramPlayer(story);restored.restore(validated);assert.deepEqual(restored.getDialogueHistory(),[]);assert.equal(restored.canPreviousDialogue(),false);assert.equal(cg(restored.state),'texture:resources.assets:683');player.dispose();restored.dispose();
  });
  await check('real prior-release timing and original1.1 save revision remain valid after scrub preview and commit',async()=>{
    const saved=JSON.parse(await readFile(new URL('./fixtures/program-1.1-chapter26.json',import.meta.url),'utf8')),player=new ProgramPlayer(story);player.restore(saved);assert.equal(saved.programRevision,'program-2:f4970d4f51acdfe9');const before=player.snapshot();player.previewDialogue(28);assert.deepEqual(player.snapshot(),before);const expected=picture(player.previewDialogue(1));player.commitDialogue(1);assert.deepEqual(picture(player.state),expected);assert.equal(player.snapshot().programRevision,saved.programRevision);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  await check('largest real block scrubs without rebuilding its index or hashing/copying full story snapshots per target',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-53-row-1');const before=player.snapshot();let snapshots=0;const original=player._reader.snapshot.bind(player._reader);player._reader.snapshot=()=>{snapshots++;return original();};const times=[];
    for(let n=0;n<120;n++){const index=(n*73)%440,start=performance.now(),frame=player.previewDialogue(index);times.push(performance.now()-start);assert.equal(frame.dialogue.index,index);assert.equal(frame.sceneId,'chapter-53-row-1');assert.equal(frame.playing,false);assert.equal('readerSnapshot' in frame,false);assert.ok(player._reader._previewCache.size<=8);}
    assert.equal(snapshots,0);assert.deepEqual(player.snapshot(),before);const ordered=[...times].sort((a,b)=>a-b);metrics.realScrub={commands:player._reader._commands.length,dialogues:440,previews:times.length,medianMs:Number(ordered[Math.floor(ordered.length/2)].toFixed(3)),p95Ms:Number(ordered[Math.floor(ordered.length*.95)].toFixed(3)),maxMs:Number(ordered.at(-1).toFixed(3)),cacheLimit:8,snapshotsDuringPreview:0};player.dispose();
  });
}
console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,metrics,results},null,2));
if(results.some(item=>!item.passed))process.exitCode=1;
