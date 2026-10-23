import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';
import {evaluateScene,validateStory} from '../../private/story-player/src/engine.js';

const copy=value=>structuredClone(value);
function fixture(){
  const scene=(id,events=[],commands=events.map((event,index)=>({type:event.type==='dialogue'?'dialogue':'event',eventIndex:index})))=>({id,title:id,duration:20,entry:{background:{asset:'neutral'},characters:[],audio:[]},events,commands});
  const line={type:'dialogue',at:0,textId:'text'};
  return {type:'story-player',schemaVersion:1,id:'neutral-map-test',title:'Neutral map test',gameFingerprint:'neutral-2',stage:{width:1280,height:720},startScene:'start',
    assets:['neutral','alice','bob','cg'].map(id=>({id,type:'image',src:id+'.png'})).concat([{id:'music',type:'audio',src:'music.ogg'}]),texts:[{id:'text',source:'Hello!'}],
    scenes:[scene('start',[{type:'audio',at:0,id:'bgm',asset:'music',loop:true,duration:100}]),scene('a',[{type:'character',kind:'character',id:'alice',asset:'alice',at:0},line]),scene('b',[{type:'character',kind:'character',id:'bob',asset:'bob',at:0},line]),scene('join',[line]),scene('empty'),scene('cg',[{type:'mode',at:0,eventMode:true},{type:'character',kind:'background',id:'cg-slot',asset:'cg',at:0},line]),scene('after',[{type:'character',kind:'character',id:'alice',asset:'alice',at:0},line]),scene('out',[{type:'mode',eventMode:false,at:0},{type:'character',kind:'character',id:'alice',asset:'alice',at:0},line])],
    program:{version:1,entry:'start',variables:{count:0},nodes:{
      start:{sceneId:'start',entryMode:'reset',exit:{type:'choices',items:[{id:'left',label:'Left',then:{type:'goto',target:'a'}},{id:'right',label:'Right',then:{type:'goto',target:'b'}}]}},
      a:{sceneId:'a',entryMode:'carry',exit:{type:'goto',target:'join'}},b:{sceneId:'b',entryMode:'carry',exit:{type:'goto',target:'join'}},join:{sceneId:'join',entryMode:'carry',exit:{type:'goto',target:'empty'}},empty:{sceneId:'empty',entryMode:'carry',exit:{type:'goto',target:'cg'}},cg:{sceneId:'cg',entryMode:'carry',exit:{type:'goto',target:'after'}},after:{sceneId:'after',entryMode:'carry',exit:{type:'goto',target:'out'}},out:{sceneId:'out',entryMode:'carry',exit:{type:'end'}}}}
  };
}
function finish(player){const sceneId=player.state.sceneId;for(let count=0;count<1000&&player.state.sceneId===sceneId&&player.state.waiting==='dialogue';count++){player.next();}return player.state;}
const results=[];
function check(name,fn){try{fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}

check('direct branch draws only its selected path and preserves music',()=>{
  const player=new ProgramPlayer(fixture());player.enter('b');assert.equal(player.state.sceneId,'b');assert.deepEqual(player.state.characters.map(item=>item.id),['bob']);assert.equal(player.state.audio[0].asset,'music');assert.equal(player.snapshot().trace.length,0);assert.equal(player.snapshot().mapRoute.steps[0].picks[0],'right');player.dispose();
});
check('a visited merge uses the actual chosen incoming branch',()=>{
  const player=new ProgramPlayer(fixture());player.choose('right');finish(player);assert.equal(player.state.sceneId,'join');assert.deepEqual(player.state.characters.map(item=>item.id),['bob']);player.enter('join');assert.equal(player.state.program.mapRoute.preference,'visited');assert.deepEqual(player.state.characters.map(item=>item.id),['bob']);player.dispose();
});
check('an unvisited merge uses a deterministic valid route',()=>{
  const player=new ProgramPlayer(fixture());player.enter('join');assert.equal(player.state.program.mapRoute.preference,'canonical');assert.deepEqual(player.state.characters.map(item=>item.id),['alice']);player.dispose();
});
check('empty map nodes remain selected until continuation',()=>{
  const story=fixture(),player=new ProgramPlayer(story);player.enter('empty');assert.equal(player.state.sceneId,'empty');assert.equal(player.state.waiting,'node');const restored=new ProgramPlayer(story);restored.restore(player.snapshot());assert.equal(restored.state.sceneId,'empty');assert.equal(restored.state.waiting,'node');player.next();assert.equal(player.state.sceneId,'cg');restored.restore(player.snapshot());assert.equal(restored.state.sceneId,'cg');player.dispose();restored.dispose();
});
check('empty decision nodes expose their choices immediately',()=>{
  const player=new ProgramPlayer(fixture());player.enter('start');assert.equal(player.state.sceneId,'start');assert.equal(player.state.waiting,'choice');assert.equal(player.state.choices.length,2);player.choose('right');assert.equal(player.state.sceneId,'b');validateProgramSnapshot(fixture(),player.snapshot());player.dispose();
});
check('event mode removes portraits and suppresses later ordinary draws across blocks',()=>{
  const story=fixture(),player=new ProgramPlayer(story);player.enter('after');assert.equal(player.state.eventMode,true);assert.deepEqual(player.state.characters.map(item=>item.id),['cg-slot']);const restored=new ProgramPlayer(story);restored.restore(player.snapshot());assert.equal(restored.state.eventMode,true);assert.deepEqual(restored.state.characters.map(item=>item.id),['cg-slot']);player.enter('out');assert.equal(player.state.eventMode,false);assert.deepEqual(player.state.characters.map(item=>item.id),['cg-slot','alice']);player.dispose();restored.dispose();
});
check('background replacement and native off remove the current objects dynamically',()=>{
  const story=fixture(),scene=story.scenes[1];scene.entry.characters=[{kind:'background',id:'slot',asset:'neutral'},{kind:'sprite',id:'logo',layerName:'Layer_20',asset:'cg'}];
  scene.events=[{type:'character',kind:'background',id:'slot',asset:'cg',at:0},{type:'character',kind:'background',id:'slot',asset:'neutral',at:1},{type:'clearActors',kind:'sprite',layerName:'Layer_20',at:2},{type:'clearActors',kind:'background',at:3}];scene.commands=undefined;validateStory(story);
  assert.equal(evaluateScene(scene,1).characters.filter(item=>item.id==='slot').length,1);assert.equal(evaluateScene(scene,1).characters.find(item=>item.id==='slot').asset,'neutral');assert.equal(evaluateScene(scene,3).characters.length,0);
});
check('route saves reject injected art, illegal decisions, variables, route source and target',()=>{
  const story=fixture(),player=new ProgramPlayer(story);player.enter('b');const save=player.snapshot();
  for(const mutate of [s=>{s.mapRoute.steps[0].picks=['unknown'];},s=>{s.mapRoute.sourceSceneId='b';},s=>{s.mapRoute.steps[0].entry={characters:[]};},s=>{s.variables.count=99;},s=>{s.entrySceneId='a';},s=>{s.reader.entryOverride={};},s=>{s.programRevision=s.programRevision.replace('program-2:','program-1:');}]){const changed=copy(save);mutate(changed);assert.throws(()=>validateProgramSnapshot(story,changed));}player.dispose();
});
check('conditional paths and call-return stacks rebuild canonically',()=>{
  const story=fixture();story.program.nodes.start.exit={type:'set',assign:{count:'1'},then:{type:'if',branches:[{when:'count == 1',then:{type:'call',target:'b',returnTo:'join'}}],else:{type:'goto',target:'a'}}};story.program.nodes.b.exit={type:'return'};
  const player=new ProgramPlayer(story);player.enter('join');assert.equal(player.state.program.variables.count,1);assert.equal(player.state.program.stackDepth,0);assert.deepEqual(player.state.characters.map(item=>item.id),['bob']);validateProgramSnapshot(story,player.snapshot());player.dispose();
});
check('map reconstruction timing is independent of translated typewriter lengths',()=>{
  const story=fixture(),player=new ProgramPlayer(story);player.setTextLengths({text:9999});player.enter('join');const original=player.state.audio[0].position,restored=new ProgramPlayer(story);restored.restore(player.snapshot());assert.equal(restored.state.audio[0].position,original);player.dispose();restored.dispose();
});
check('detached annotations open from their own clean entry and restore safely',()=>{
  const story=fixture();story.scenes.push({id:'detached',title:'Detached annotation',duration:1,entry:{background:{asset:'neutral'},characters:[]},events:[],commands:[]});story.program.nodes.detached={sceneId:'detached',entryMode:'carry',exit:{type:'end'}};
  const player=new ProgramPlayer(story);player.enter('b');player.enter('detached');assert.equal(player.state.sceneId,'detached');assert.equal(player.state.program.mapRoute.preference,'isolated');assert.deepEqual(player.state.characters,[]);const restored=new ProgramPlayer(story);restored.restore(player.snapshot());assert.equal(restored.state.sceneId,'detached');assert.deepEqual(restored.state.characters,[]);player.enter('detached');assert.equal(player.state.sceneId,'detached');player.next();assert.equal(player.state.ended,true);restored.restore(player.snapshot());assert.equal(restored.state.ended,true);player.dispose();restored.dispose();
});

if(process.argv.includes('--real')){
  const story=JSON.parse(await readFile(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8'));
  check('XP2 chapter 02 row 21 direct jump excludes actors from sibling branches',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-02-row-21');assert.equal(player.state.sceneId,'chapter-02-row-21');assert.equal(player.state.characters.filter(item=>item.kind==='character'&&item.opacity>0).length,1);
    assert.deepEqual(player.snapshot().mapRoute.steps.flatMap(item=>item.picks).slice(-2),['chapter-02-row-17-false','chapter-02-row-20-true']);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  check('XP2 detached chapter 02 row 52 annotation is browsable without sibling actors',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-02-row-52');assert.equal(player.state.sceneId,'chapter-02-row-52');assert.equal(player.state.program.mapRoute.preference,'isolated');assert.deepEqual(player.state.characters,[]);validateProgramSnapshot(story,player.snapshot());player.dispose();
  });
  check('XP2 chapter 26 opening keeps the preceding chapter art when jumped directly',()=>{
    const player=new ProgramPlayer(story);player.enter('chapter-25-row-1');player._reader.completeCanonical();player._settle();assert.equal(player.state.sceneId,'chapter-26-row-1');
    const picture=state=>({eventMode:state.eventMode,background:state.background,characters:state.characters,overlay:state.overlay,camera:state.camera});
    const sequential=picture(player.state);
    const direct=new ProgramPlayer(story);direct.enter('chapter-26-row-1');assert.deepEqual(picture(direct.state),sequential);direct.play();direct.advance(1);assert.equal(direct.state.waiting,'dialogue');validateProgramSnapshot(story,direct.snapshot());player.dispose();direct.dispose();
  });
  check('XP2 carried chapter anchors preserve prior portraits and music on direct jump',()=>{
    const player=new ProgramPlayer(story),direct=new ProgramPlayer(story);
    const art=state=>({eventMode:state.eventMode,characters:state.characters.map(({id,asset,x,y,opacity})=>({id,asset,x,y,opacity})),audio:state.audio.map(item=>item.asset)});
    for(const [previous,target] of [['chapter-36-row-341','chapter-38-row-1'],['chapter-39-row-644','chapter-40-row-1'],['chapter-52-row-507','chapter-53-row-1']]){
      player.enter(previous);player.next();assert.equal(player.state.sceneId,target);direct.enter(target);assert.equal(direct.state.program.mapRoute.preference,'canonical');assert.ok(direct.snapshot().mapRoute.steps.length>0);assert.deepEqual(art(direct.state),art(player.state),target);assert.ok(direct.state.characters.length>0,target);validateProgramSnapshot(story,direct.snapshot());
    }
    player.dispose();direct.dispose();
  });
  if(process.argv.includes('--all')){
    check('every exported XP2 node is directly reachable and remains selected',()=>{
      const player=new ProgramPlayer(story);let selected=0;
      for(const scene of story.scenes){player.enter(scene.id);assert.equal(player.state.sceneId,scene.id,scene.id);selected++;if(selected%100===0)console.log(`Verified ${selected}/${story.scenes.length} map destinations`);}
      assert.equal(selected,story.scenes.length);player.dispose();
    });
  }
}
console.log(JSON.stringify({passed:results.filter(result=>result.passed).length,total:results.length,results},null,2));
if(results.some(result=>!result.passed))process.exitCode=1;
