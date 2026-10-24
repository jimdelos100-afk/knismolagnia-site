import assert from 'node:assert/strict';
import {AutoReader,autoReadDelay} from '../../private/story-player/src/auto-reader.js';
import {ReaderPlayer} from '../../private/story-player/src/reader.js';
import {ProgramPlayer} from '../../private/story-player/src/program-player.js';

const results=[];
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
const state=(overrides={})=>({sceneId:'chapter-a',stageTime:0,time:0,playing:true,ended:false,waiting:'dialogue',dialogue:{textId:'line-a',index:0,startedAt:0,textComplete:true},...overrides});
function tick(auto,current,seconds,options={}){
  let advances=0;
  for(let remaining=seconds;remaining>1e-8;){const delta=Math.min(.1,remaining);remaining-=delta;if(auto.update(current,{delta,lineLength:18,...options}))advances++;}
  return advances;
}
function fixture({loop=false,automaticFirst=false}={}){
  const scene=(id,events,commands=events.map((event,eventIndex)=>({type:event.type==='dialogue'?'dialogue':'event',eventIndex})))=>({id,title:id,duration:30,entry:{background:{asset:'black'},characters:[],audio:[]},events,commands});
  const a=scene('a',[{type:'dialogue',at:0,textId:'one'},{type:'dialogue',at:.6,textId:'two'}],[{type:'dialogue',eventIndex:0,...(automaticFirst?{pageCtrl:'Next'}:{})},{type:'wait',duration:.6},{type:'dialogue',eventIndex:1}]);
  const b=scene('b',[{type:'dialogue',at:0,textId:'three'}]);
  const final=scene('final',[{type:'dialogue',at:0,textId:'last'}]);
  const story={type:'story-player',schemaVersion:1,id:'auto-neutral',title:'Neutral auto reading fixture',gameFingerprint:'auto-neutral-1',stage:{width:1280,height:720},startScene:'a',assets:[{id:'black',type:'image',src:'black.png'}],texts:['one','two','three','last'].map(id=>({id,source:'中文测试台词'})),scenes:[a,b,final],program:{version:1,entry:'a',variables:{},nodes:{a:{sceneId:'a',entryMode:'reset',exit:{type:'goto',target:'b'}},b:{sceneId:'b',entryMode:'carry',exit:{type:'choices',items:[{id:'finish',label:'Finish',then:{type:'goto',target:'final'}}]}},final:{sceneId:'final',entryMode:'carry',exit:{type:'end'}}}}};
  if(loop){story.scenes=[b];story.startScene='b';story.program.entry='b';story.program.nodes={b:{sceneId:'b',entryMode:'reset',exit:{type:'goto',target:'b'}}};}
  return story;
}
function playFrames(auto,player,seconds,{ready=true,blocked=false}={}){
  let advances=0;
  for(let remaining=seconds;remaining>1e-8;){
    const delta=Math.min(.05,remaining);remaining-=delta;
    if(ready&&!blocked)player.advance(delta);
    const current=player.state;
    if(auto.update(current,{delta,ready,blocked,lineLength:6})){player.next();advances++;}
  }
  return advances;
}

await check('default and refreshed controllers never autoplay without an explicit enable',()=>{
  const auto=new AutoReader();assert.equal(auto.enabled,false);assert.equal(tick(auto,state(),30),0);
  auto.setEnabled(true);assert.equal(auto.enabled,true);auto.setEnabled(false);assert.equal(tick(auto,state(),30),0);assert.equal(new AutoReader().enabled,false);
});
await check('reading delay uses translated length and remains bounded',()=>{
  assert.equal(autoReadDelay(0),1.2);assert.equal(autoReadDelay(18),2.2);assert.equal(autoReadDelay(1800),8);
  assert.equal(autoReadDelay(-9),1.2);assert.equal(autoReadDelay(NaN),1.2);assert.equal(autoReadDelay(Infinity),1.2);
});
await check('typewriter time never counts toward the delay after full reveal',()=>{
  const auto=new AutoReader();auto.setEnabled(true);const partial=state({dialogue:{textId:'line-a',index:0,startedAt:0,textComplete:false}});
  assert.equal(tick(auto,partial,10),0);const complete=state();assert.equal(auto.update(complete,{delta:.4,lineLength:18}),false);
  assert.equal(tick(auto,complete,2.1),0);assert.equal(tick(auto,complete,.1),1);
});
await check('one line emits only one next action, including repeated zero-time calls',()=>{
  const auto=new AutoReader();auto.setEnabled(true);const current=state();assert.equal(tick(auto,current,30),1);
  for(let n=0;n<1000;n++)assert.equal(auto.update(current,{delta:0,lineLength:0}),false);
  assert.equal(tick(auto,current,30),0);
  assert.equal(tick(auto,state({dialogue:{...current.dialogue,index:1}}),3),1);
});
await check('resource waits, busy overlays and focus blocks accrue no reading time',()=>{
  for(const block of [{ready:false},{blocked:true}]){
    const auto=new AutoReader();auto.setEnabled(true);const current=state();assert.equal(tick(auto,current,2),0);assert.equal(tick(auto,current,60,block),0);
    assert.equal(tick(auto,current,2.2),0);assert.equal(tick(auto,current,.1),1);
  }
});
await check('paused player and large frame gaps require a fresh dwell',()=>{
  const auto=new AutoReader();auto.setEnabled(true);const current=state();assert.equal(tick(auto,current,2),0);
  assert.equal(tick(auto,state({playing:false}),20),0);assert.equal(tick(auto,current,2.2),0);assert.equal(tick(auto,current,.1),1);
  auto.reset();assert.equal(tick(auto,current,2),0);assert.equal(auto.update(current,{delta:50,lineLength:18}),false);assert.equal(tick(auto,current,2.1),0);assert.equal(tick(auto,current,.1),1);
});
await check('choice, external outcome, direct map control and final end disable auto',()=>{
  for(const boundary of [{waiting:'choice'},{waiting:'signal'},{waiting:'node'},{ended:true}]){
    const auto=new AutoReader();auto.setEnabled(true);assert.equal(tick(auto,state(),2),0);assert.equal(auto.update(state(boundary),{delta:.5,lineLength:0}),false);assert.equal(auto.enabled,false);
    assert.equal(tick(auto,state(),20),0);
  }
});
await check('line identity covers command position and repeated text without reading snapshots',()=>{
  const auto=new AutoReader();auto.setEnabled(true);const current=state();Object.defineProperty(current,'readerSnapshot',{get:()=>{throw new Error('must not read snapshots in frame loop');}});
  assert.equal(tick(auto,current,3),1);
  for(const next of [state({sceneId:'chapter-b'}),state({sceneId:'chapter-b',program:{nodeId:'node-b'}}),state({sceneId:'chapter-b',program:{nodeId:'node-b'},dialogue:{...current.dialogue,index:1}}),state({sceneId:'chapter-b',program:{nodeId:'node-b'},dialogue:{...current.dialogue,index:1,startedAt:2}})])assert.equal(tick(auto,next,3),1);
});
await check('dialogue hiding and presentation-only metadata never stop auto reading',()=>{
  const auto=new AutoReader();auto.setEnabled(true);assert.equal(tick(auto,state({dialogue:{textId:'line-a',index:0,startedAt:0,textComplete:true,visible:false},fullscreen:true,dialogueHidden:true}),3),1);assert.equal(auto.enabled,true);
});
await check('wait animations remain player-controlled and automatic pages are never manually skipped',()=>{
  const player=new ReaderPlayer(fixture({automaticFirst:true})),auto=new AutoReader();auto.setEnabled(true);player.play();
  assert.equal(player.state.waiting,'text');assert.equal(playFrames(auto,player,.3),0);assert.equal(player.state.waiting,'wait');assert.equal(playFrames(auto,player,.4),0);assert.equal(player.state.waiting,'wait');
  assert.equal(playFrames(auto,player,.5),0);assert.equal(player.state.dialogue.textId,'two');assert.equal(playFrames(auto,player,3),1);assert.equal(player.state.ended,true);assert.equal(auto.enabled,false);player.dispose();
});
await check('program advances linear scenes, then stops for an actual branch choice',()=>{
  const player=new ProgramPlayer(fixture()),auto=new AutoReader();auto.setEnabled(true);player.play();const advances=playFrames(auto,player,20);
  assert.equal(advances,3);assert.equal(player.state.sceneId,'b');assert.equal(player.state.waiting,'choice');assert.equal(auto.enabled,false);
  assert.equal(playFrames(auto,player,20),0);assert.equal(player.state.waiting,'choice');player.choose('finish');assert.equal(playFrames(auto,player,10),0);
  auto.setEnabled(true);player.play();assert.equal(playFrames(auto,player,6),1);assert.equal(player.state.ended,true);assert.equal(auto.enabled,false);player.dispose();
});
await check('identical one-line self loops reset their delay on each actual visit',()=>{
  const player=new ProgramPlayer(fixture({loop:true})),auto=new AutoReader();auto.setEnabled(true);player.play();
  const advances=playFrames(auto,player,12);assert.ok(advances>=4&&advances<=6,`${advances} automatic releases`);assert.equal(auto.enabled,true);assert.equal(player.state.sceneId,'b');player.dispose();
});
await check('explicit off and rewind reset prevent any pending automatic next action',()=>{
  const player=new ProgramPlayer(fixture()),auto=new AutoReader();auto.setEnabled(true);player.play();playFrames(auto,player,1.4);auto.setEnabled(false);const before=player.state.dialogue.textId;
  assert.equal(playFrames(auto,player,20),0);assert.equal(player.state.dialogue.textId,before);auto.setEnabled(true);assert.equal(playFrames(auto,player,.5),0);
  player.next();player.advance(.8);assert.equal(player.state.dialogue.textId,'two');auto.setEnabled(false);player.previousDialogue();assert.equal(player.state.dialogue.textId,'one');assert.equal(playFrames(auto,player,10),0);player.dispose();
});

await check('user speed adjusts dwell time without changing the player stage or audio rate',()=>{
  const fast=new AutoReader(),normal=new AutoReader(),slow=new AutoReader();for(const reader of [fast,normal,slow]){reader.setEnabled(true);reader.update(state(),{delta:0,lineLength:0});}
  let quick=0,ordinary=0,delayed=0;for(let i=0;i<4;i++){quick+=Number(fast.update(state(),{delta:.1,lineLength:0,speed:4}));ordinary+=Number(normal.update(state(),{delta:.1,lineLength:0,speed:1}));delayed+=Number(slow.update(state(),{delta:.1,lineLength:0,speed:.25}));}
  assert.equal(quick,1);assert.equal(ordinary,0);assert.equal(delayed,0);for(let i=0;i<50;i++)delayed+=Number(slow.update(state(),{delta:.1,lineLength:0,speed:.25}));assert.equal(delayed,1);
});
console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results},null,2));
if(results.some(item=>!item.passed))process.exitCode=1;
