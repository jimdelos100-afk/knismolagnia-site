import assert from 'node:assert/strict';
import fs from 'node:fs';
import {graphStory} from '../../private/story-player/src/playback.js';
import {layoutGraph} from '../../private/story-player/src/graph.js';

const raw=JSON.parse(fs.readFileSync(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8'));
const story=graphStory(raw),originalSceneIds=raw.scenes.map(scene=>scene.id);
assert.deepEqual(story.scenes.map(scene=>scene.id),originalSceneIds,'no scene is collapsed or discarded');
const expected=[];
function scan(from,exit,label=''){
  if(!exit)return;
  if(exit.type==='goto')expected.push([from,raw.program.nodes[exit.target].sceneId,label,false]);
  if(exit.type==='end'&&label)expected.push([from,from,label,true]);
  if(exit.type==='set')scan(from,exit.then,label);
  if(exit.type==='choices')for(const item of exit.items)scan(from,item.then,item.label);
  if(exit.type==='signal')for(const item of exit.outcomes)scan(from,item.then,item.label);
  if(exit.type==='if'){for(const branch of exit.branches)scan(from,branch.then,label||'条件成立');scan(from,exit.else,label||'其他条件');}
}
for(const node of Object.values(raw.program.nodes))scan(node.sceneId,node.exit);
assert.deepEqual(story.graphEdges.map(edge=>[edge.from,edge.to,edge.label,!!edge.terminal]),expected,'every declared target/terminal branch is mapped exactly once');
const reports=[];
for(const category of ['story','reference']){
  const scenes=story.scenes.filter(scene=>scene.category===category),ids=new Set(scenes.map(scene=>scene.id));
  const layout=layoutGraph({...story,scenes,graphEdges:story.graphEdges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to))});
  assert.equal(layout.positions.size,scenes.length);
  for(const point of layout.positions.values())for(const value of [point.x,point.y])assert(Number.isFinite(value)&&value>=0);
  const points=[...layout.positions.entries()];
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)assert(!(Math.abs(points[i][1].x-points[j][1].x)<184&&Math.abs(points[i][1].y-points[j][1].y)<70),`overlap: ${points[i][0]} / ${points[j][0]}`);
  for(const edge of layout.edges)assert(layout.positions.has(edge.from)&&layout.positions.has(edge.to));
  reports.push({category,...layout.summary,width:layout.width,height:layout.height,nodeOverlaps:0});
}
assert.equal(reports[0].nodes,1083);assert.equal(reports[0].forks,202);assert.equal(reports[0].edges,1224);assert.equal(reports[1].nodes,359);
const cyclic=layoutGraph({scenes:[{id:'a',mapGroup:'all'},{id:'b',mapGroup:'all'},{id:'c',mapGroup:'all'},{id:'d',mapGroup:'all'}],graphEdges:[{from:'a',to:'b',label:'one'},{from:'a',to:'c',label:'two'},{from:'b',to:'d',label:''},{from:'c',to:'d',label:''},{from:'d',to:'a',label:'cycle'},{from:'c',to:'c',label:'self'}]});
assert.equal(cyclic.positions.size,4);assert.equal(cyclic.summary.cycles,1);assert.equal(cyclic.edges.length,6);
console.log(JSON.stringify({passed:true,reports,syntheticCycleEdges:cyclic.edges.length},null,2));
