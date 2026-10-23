import {ReaderPlayer,validateReaderStory,validateReaderSnapshot} from './reader.js';
import {ProgramPlayer,validateProgramStory,validateProgramSnapshot} from './program-player.js';

export function validatePlaybackStory(story){return story?.program?validateProgramStory(story):validateReaderStory(story);}
export function createPlayer(story,options){return story?.program?new ProgramPlayer(story,options):new ReaderPlayer(story,options);}
export function validatePlaybackSnapshot(story,snapshot){
  if(story?.program){if(snapshot?.type!=='story-player-program')throw new Error('流程进度类型与演出包不一致。');return validateProgramSnapshot(story,snapshot);}
  return validateReaderSnapshot(story,snapshot);
}

/** Show all declared routes; the running program separately filters eligible choices. */
export function graphStory(story){
  if(!story?.program)return story;
  const result=structuredClone(story),nodes=result.program.nodes;
  const scenes=new Map(result.scenes.map(scene=>[scene.id,scene])),alias=id=>scenes.get(id)?.mapGroup||id,returns=new Set();
  const scan=exit=>{if(exit?.type==='call')returns.add(exit.returnTo);if(exit?.then)scan(exit.then);for(const branch of exit?.branches||[])scan(branch.then);if(exit?.else)scan(exit.else);for(const item of [...(exit?.items||[]),...(exit?.outcomes||[])])scan(item.then);};
  Object.values(nodes).forEach(node=>scan(node.exit));
  for(const scene of result.scenes){scene.next=undefined;scene.choices=[];}
  const add=(from,target,label)=>{const scene=scenes.get(alias(from)),to=alias(nodes[target]?.sceneId);if(!scene||!to||scene.id===to)return;if(!scene.choices.some(choice=>choice.target===to&&choice.label===label))scene.choices.push({target:to,label});};
  const visit=(from,exit,label='')=>{
    if(!exit)return;
    if(exit.type==='goto')add(from,exit.target,label);
    else if(exit.type==='call'){add(from,exit.target,label||'子程序');add(from,exit.returnTo,'返回后继续');}
    else if(exit.type==='return')for(const target of returns)add(from,target,'返回');
    else if(exit.type==='set')visit(from,exit.then,label);
    else if(exit.type==='if'){for(const branch of exit.branches)visit(from,branch.then,label||branch.when);visit(from,exit.else,label||'其他条件');}
    else if(exit.type==='choices')for(const item of exit.items)visit(from,item.then,item.label);
    else if(exit.type==='signal')for(const item of exit.outcomes)visit(from,item.then,item.label);
  };
  Object.values(nodes).forEach(node=>visit(node.sceneId,node.exit));
  result.scenes=result.scenes.filter(scene=>!scene.mapGroup||scene.mapGroup===scene.id);
  return result;
}
