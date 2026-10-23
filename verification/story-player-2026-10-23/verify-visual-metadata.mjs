import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluateScene} from '../../private/story-player/src/engine.js';
import {actorVisualStyle} from '../../private/story-player/src/visual-style.js';

// Metadata must survive the engine-to-DOM boundary without affecting any CSS transform.
const actor={id:'cg:test',asset:'texture:test',x:14,y:22,width:1280,height:720,layer:10,pivotX:.5,pivotY:.5};
const expected=actorVisualStyle(actor);
for(const kind of ['character','background','sprite'])assert.deepEqual(actorVisualStyle({...actor,kind,layerName:'イベント CG_Layer_10'}),expected);
for(const kind of [null,'cg','',42,{},true])assert.throws(()=>actorVisualStyle({...actor,kind}),/角色类型无效/);
for(const layerName of [null,'',' ',42,{},'a\nb','x'.repeat(513)])assert.throws(()=>actorVisualStyle({...actor,layerName}),/原生图层名称无效/);
assert.throws(()=>actorVisualStyle({...actor,style:'color:red'}),/不支持字段/,'unrelated fields remain rejected');

const story=JSON.parse(fs.readFileSync(new URL('../../private/story-player/data/story.json',import.meta.url),'utf8'));
let states=0,actors=0,metadataActors=0;const kinds=new Set();
for(const scene of story.scenes){
  const times=new Set([0,scene.duration,...scene.events.map(event=>event.at)]);
  for(const event of scene.events)if(event.type==='tween'&&event.duration>0)times.add(Math.min(scene.duration,event.at+event.duration/2));
  for(const time of times){
    const state=evaluateScene(scene,time);states++;
    for(const current of state.characters){
      const style=actorVisualStyle(current,state.layers||[]);actors++;
      assert(!/NaN|Infinity/.test(style.transform),`${scene.id}@${time} has a finite transform`);
      assert(Number.isFinite(Number(style.zIndex)));assert(Number.isFinite(Number(style.opacity)));
      if(current.kind!==undefined||current.layerName!==undefined){metadataActors++;kinds.add(current.kind);}
    }
  }
}
assert(metadataActors>0,'actual migrated CG metadata is exercised');
assert(kinds.has('background')&&kinds.has('character')&&kinds.has('sprite'),'every actor category is exercised');
console.log(JSON.stringify({passed:true,scenes:story.scenes.length,states,actors,metadataActors,kinds:[...kinds]},null,2));
