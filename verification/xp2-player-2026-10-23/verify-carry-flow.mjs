/** Neutral fixture: no game script, media or translations are used. */
import assert from 'node:assert/strict';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';
import {createProgress,parseProgress} from '../../private/story-player/src/progress.js';

const copy=value=>structuredClone(value);
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-8,`${label}: expected ${expected}, got ${actual}`);
function fixture(exitType='choices'){
  const entry=()=>({background:{asset:'red'},characters:[{id:'guide',asset:'figure',x:100}],audio:[]});
  const scene=(id,events=[{type:'dialogue',at:0,textId:'line'}],commands=[{type:'dialogue',eventIndex:0}])=>({id,title:id,duration:10,entry:entry(),events,commands});
  const a=scene('a',[{type:'character',at:0,id:'guide',x:30},{type:'dialogue',at:2,textId:'line'}],[{type:'event',eventIndex:0},{type:'wait',duration:2},{type:'dialogue',eventIndex:1}]);
  a.entry.background.asset='blue';a.entry.audio=[{id:'bgm',asset:'tone',offset:5,duration:100,loop:true,volume:.6}];
  const jump={type:'goto',target:'c'},reset={type:'goto',target:'d'};
  const exit=exitType==='choices'?{type:'choices',items:[{id:'continue',label:'Continue',then:jump},{id:'reset',label:'Reset',then:reset}]}:{type:'signal',id:'ready',outcomes:[{id:'continue',label:'Continue',then:jump}]};
  return {type:'story-player',schemaVersion:1,id:'neutral-carry-fixture',gameFingerprint:'neutral-1',title:'Neutral carry fixture',stage:{width:1280,height:720},startScene:'a',assets:[{id:'blue',type:'image',src:'blue.png'},{id:'red',type:'image',src:'red.png'},{id:'figure',type:'image',src:'figure.png'},{id:'tone',type:'audio',src:'tone.wav'}],texts:[{id:'line',source:'Hello.'}],scenes:[a,scene('b'),scene('c'),scene('d')],program:{version:1,entry:'a',variables:{score:0},nodes:{a:{sceneId:'a',entryMode:'reset',exit:{type:'goto',target:'b'}},b:{sceneId:'b',entryMode:'carry',exit},c:{sceneId:'c',entryMode:'carry',exit:{type:'goto',target:'d'}},d:{sceneId:'d',entryMode:'reset',exit:{type:'end'}}}}};
}
function toB(player){player.play();player.advance(3);player.next();assert.equal(player.state.sceneId,'b');}
function finishB(player){player.advance(2);player.next();assert.equal(player.state.waiting,'choice');}
const results=[];
function check(name,fn){try{fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.message});}}

check('automatic carry preserves evaluated art and media offset',()=>{
  const player=new ProgramPlayer(fixture());toB(player);assert.equal(player.state.background.asset,'blue');assert.equal(player.state.characters[0].x,30);near(player.state.audio[0].position,8,'carried audio');player.advance(2);near(player.state.audio[0].position,10,'continued audio');player.dispose();
});
check('automatic carry restores identically from save replay',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toB(player);player.advance(2);const saved=player.snapshot(),restored=new ProgramPlayer(story);restored.restore(saved);assert.equal(restored.state.background.asset,'blue');near(restored.state.audio[0].position,player.state.audio[0].position,'restored audio');assert.equal(restored.playing,false);player.dispose();restored.dispose();
});
check('choice dwell survives carry and progress import',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toB(player);finishB(player);player.advance(4);near(player.state.audio[0].position,14,'audio while choosing');player.choose('continue');near(player.state.audio[0].position,14,'audio after choice');
  const saved=createProgress(story,player.state,[],{reader:player.snapshot()}),parsed=parseProgress(story,saved),restored=new ProgramPlayer(story);restored.restore(parsed.reader);near(restored.state.audio[0].position,14,'restored choice audio');player.dispose();restored.dispose();
});
check('signal dwell survives carry and save replay',()=>{
  const story=fixture('signal'),player=new ProgramPlayer(story);toB(player);player.advance(2);player.next();assert.equal(player.state.waiting,'signal');player.advance(4);const token=player.state.signal.token;player.completeSignal(token,'continue');near(player.state.audio[0].position,14,'audio after signal');
  const restored=new ProgramPlayer(story);restored.restore(player.snapshot());near(restored.state.audio[0].position,14,'restored signal audio');player.dispose();restored.dispose();
});
check('reset branch clears prior art and audio',()=>{
  const player=new ProgramPlayer(fixture());toB(player);finishB(player);player.choose('reset');assert.equal(player.state.background.asset,'red');assert.equal(player.state.characters[0].x,100);assert.deepEqual(player.state.audio,[]);player.dispose();
});
check('map entry rebuilds valid preceding route and preserves its art and media',()=>{
  const player=new ProgramPlayer(fixture());toB(player);player.enter('c');assert.equal(player.state.background.asset,'blue');assert.equal(player.state.characters[0].x,30);assert.equal(player.state.audio[0].asset,'tone');assert.equal(player.state.program.mapRoute.preference,'canonical');player.dispose();
});
check('canonical review retains carried entry within active block',()=>{
  const player=new ProgramPlayer(fixture());toB(player);player.advance(2);player.seekDialogue(0);assert.equal(player.state.background.asset,'blue');near(player.state.audio[0].position,8,'reviewed entry offset');player.dispose();
});
check('call and return carry media with replayed return stack',()=>{
  const story=fixture();story.program.nodes.b.exit.items[0].then={type:'call',target:'c',returnTo:'d'};story.program.nodes.c.exit={type:'return'};story.program.nodes.d.entryMode='carry';
  const player=new ProgramPlayer(story);toB(player);finishB(player);player.advance(4);player.choose('continue');assert.equal(player.state.program.stackDepth,1);
  const restored=new ProgramPlayer(story);restored.restore(player.snapshot());assert.equal(restored.state.program.stackDepth,1);near(restored.state.audio[0].position,14,'restored called block');
  player.advance(1);player.next();assert.equal(player.state.sceneId,'d');assert.equal(player.state.program.stackDepth,0);near(player.state.audio[0].position,15,'returned audio');
  restored.restore(player.snapshot());assert.equal(restored.state.sceneId,'d');near(restored.state.audio[0].position,15,'restored returned audio');player.dispose();restored.dispose();
});
check('tampered variables trace payload and scene position are rejected',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toB(player);const snapshot=player.snapshot();
  for(const mutate of [s=>{s.variables.score=99;},s=>{s.reader.sceneId='d';},s=>{s.reader.entryOverride={background:{asset:'red'}};},s=>{s.trace[0].reader.executions[0].at=999;},s=>{s.phase='end';}]){const changed=copy(snapshot);mutate(changed);assert.throws(()=>validateProgramSnapshot(story,changed));}
  player.dispose();
});
check('choice dwell snapshots cannot inject art scene commands or rewind time',()=>{
  const story=fixture(),player=new ProgramPlayer(story);toB(player);finishB(player);player.advance(4);player.choose('continue');const snapshot=player.snapshot();
  for(const mutate of [reader=>{reader.entryOverride={background:{asset:'red'}};},reader=>{reader.sceneId='d';},reader=>{reader.executions[0].releaseAt=3;},reader=>{reader.stageTime=1;}]){
    const changed=copy(snapshot),action=changed.trace.find(item=>item.kind==='choice');mutate(action.reader);assert.throws(()=>validateProgramSnapshot(story,changed));
  }
  player.dispose();
});
console.log(JSON.stringify({passed:results.filter(result=>result.passed).length,total:results.length,results},null,2));
if(results.some(result=>!result.passed))process.exitCode=1;
