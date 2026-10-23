import {ReaderPlayer,validateReaderStory,validateReaderSnapshot} from './reader.js';
import {ProgramPlayer,validateProgramStory,validateProgramSnapshot} from './program-player.js';

export function validatePlaybackStory(story){return story?.program?validateProgramStory(story):validateReaderStory(story);}
export function createPlayer(story,options){return story?.program?new ProgramPlayer(story,options):new ReaderPlayer(story,options);}
export function validatePlaybackSnapshot(story,snapshot){
  if(story?.program){if(snapshot?.type!=='story-player-program')throw new Error('流程进度类型与演出包不一致。');return validateProgramSnapshot(story,snapshot);}
  return validateReaderSnapshot(story,snapshot);
}

/** The map preserves every program clip and route, independent of playback eligibility. */
export function graphStory(story){
  if(!story?.program)return story;
  const nodes=story.program.nodes,graphEdges=[],calls=[],returnNodes=[];
  const result={...story,scenes:story.scenes.map(scene=>({...scene,next:undefined,choices:[],
    category:scene.category||(/^(archive-|reference-)/.test(scene.id)?'reference':'story'),
    sourceId:scene.id,sourceIds:[...new Set((scene.events||[]).filter(event=>event.textId).map(event=>event.textId))],
  })),graphEdges};
  const scenes=new Map(result.scenes.map(scene=>[scene.id,scene]));
  for(const [id,node] of Object.entries(nodes)){const scene=scenes.get(node.sceneId);if(scene)scene.sourceNodeId=id;}
  const add=(from,target,label='',kind='next',condition='')=>{
    const scene=scenes.get(from),to=nodes[target]?.sceneId;
    if(!scene||!scenes.has(to))return;
    const edge={id:`route-${graphEdges.length}`,from,to,label:String(label||''),kind,...(condition?{condition}:{}),targetNodeId:target};
    graphEdges.push(edge);scene.choices.push({target:to,label:edge.label});
  };
  const visit=(from,exit,label='',kind='next',condition='')=>{
    if(!exit)return;
    if(exit.type==='goto')add(from,exit.target,label,kind,condition);
    else if(exit.type==='end'&&label){
      // A labelled terminal choice is a real branch even though it has no next clip.
      const edge={id:`route-${graphEdges.length}`,from,to:from,label:String(label),kind:'end',terminal:true};
      graphEdges.push(edge);scenes.get(from)?.choices.push({target:from,label:edge.label,terminal:true});
    }
    else if(exit.type==='call'){add(from,exit.target,label||'进入子剧情','call',condition);calls.push({target:exit.target,returnTo:exit.returnTo});}
    else if(exit.type==='return')returnNodes.push(from);
    else if(exit.type==='set')visit(from,exit.then,label,kind,condition);
    else if(exit.type==='if'){
      for(const branch of exit.branches)visit(from,branch.then,label||'条件成立','condition',String(branch.when||''));
      visit(from,exit.else,label||'其他条件','condition');
    }
    else if(exit.type==='choices')for(const item of exit.items)visit(from,item.then,item.label,'choice',item.when||'');
    else if(exit.type==='signal')for(const item of exit.outcomes)visit(from,item.then,item.label,'signal',item.when||'');
  };
  Object.values(nodes).forEach(node=>visit(node.sceneId,node.exit));
  // A return belongs only to callers whose routine can reach it, not every caller in the game.
  const adjacency=new Map();for(const edge of graphEdges){if(!adjacency.has(edge.from))adjacency.set(edge.from,[]);adjacency.get(edge.from).push(edge.to);}
  const returnSet=new Set(returnNodes);
  for(const call of calls){
    const pending=[nodes[call.target]?.sceneId],seen=new Set();
    while(pending.length){const id=pending.pop();if(!id||seen.has(id))continue;seen.add(id);
      if(returnSet.has(id)){add(id,call.returnTo,'返回主剧情','return');continue;}
      for(const target of adjacency.get(id)||[])pending.push(target);
    }
  }
  return result;
}
