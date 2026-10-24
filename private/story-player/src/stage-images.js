import {actorVisualStyle} from './visual-style.js';

const transitions=state=>state?.nativeEffects?.transitions||[];
export const visualAssetIds=state=>[...new Set([state?.background?.asset,...(state?.characters||[]).map(actor=>actor.asset),...transitions(state).flatMap(item=>[item.from?.asset,item.to?.asset])].filter(Boolean))];
const signature=(state,revision)=>JSON.stringify([revision,state?.background?.asset||null,(state?.characters||[]).map(actor=>[actor.id,actor.asset]),transitions(state).map(item=>[item.id,item.actorId,item.from?.asset,item.to?.asset])]);
function speakerFilter(actor,state,lighting){
  const fx=state.nativeEffects;
  if(!lighting?.m_Enabled||actor.kind!=='character'||!fx||!Object.hasOwn(fx,'speakerActorId'))return 'none';
  const main=lighting.mainColor?.r??1,sub=lighting.subColor?.r??.5,duration=lighting.fadeTime??.2;
  const progress=duration>0?Math.max(0,Math.min(1,((state.stageTime??state.time??0)-(fx.speakerChangedAt??0))/duration)):1;
  const previous=actor.id===fx.previousSpeakerActorId?main:sub,current=actor.id===fx.speakerActorId?main:sub;
  return `brightness(${previous+(current-previous)*progress})`;
}

/** Decode the entire next image composition before replacing the visible frame. */
export class AtomicStageImages{
  constructor(backgroundLayer,actorLayer,library,{onReady=()=>{},onError=()=>{},createImage=()=>new Image(),lighting=null}={}){
    Object.assign(this,{backgroundLayer,actorLayer,library,onReady,onError,createImage,lighting});
    this.generation=0;this.revision=0;this.committed=null;this.committedKey=null;this.pendingKey=null;this.task=null;this.nodes=[];this.ghosts=[];this.disposed=false;
  }
  get retained(){return [...new Set([...visualAssetIds(this.committed),...visualAssetIds(this.desired)])];}
  pending(state=this.desired){return !this.disposed&&!!state&&signature(state,this.revision)!==this.committedKey;}
  sync(state,{revision=this.revision}={}){
    if(this.disposed)return this.committed;
    if(this.revision!==revision)this.failedKey=null;
    this.revision=revision;this.desired=state;const key=signature(state,revision);
    if(key===this.committedKey){if(this.pendingKey&&this.pendingKey!==key){this.generation++;this.pendingKey=null;this.task=null;}this.committed=state;this.apply(state);return state;}
    if(key!==this.pendingKey&&key!==this.failedKey)this.prepare(state,key);
    return this.committed;
  }
  prepare(state,key){
    const generation=++this.generation;this.pendingKey=key;
    const task=(async()=>{
      const ids=visualAssetIds(state);await this.library.preload(ids);
      if(this.disposed||generation!==this.generation)return false;
      const images=[];
      const make=async(asset,className)=>{
        const src=this.library.resolve(asset);if(!src)throw new Error(`本地图片 ${asset} 未能读取，请重新选择原游戏目录。`);
        const img=this.createImage();img.className=className;img.alt='';img.draggable=false;if(img.dataset)img.dataset.assetId=asset;img.src=src;
        if(typeof img.decode==='function')await img.decode();
        else if(!img.complete)await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
        if(!img.naturalWidth||!img.naturalHeight)throw new Error('图片解码失败，原画面已保留。');
        images.push(img);return img;
      };
      const background=state.background?.asset?make(state.background.asset,'background-image'):Promise.resolve(null);
      const actors=(state.characters||[]).map(actor=>make(actor.asset,'actor-image'));
      const fades=transitions(state).filter(item=>item.from?.asset),ghostTasks=fades.map(item=>make(item.from.asset,'actor-image native-transition-from'));
      const [bg,cast,ghostNodes]=await Promise.all([background,Promise.all(actors),Promise.all(ghostTasks)]);
      if(this.disposed||generation!==this.generation)return false;
      // Both replaceChildren calls occur within this task, before the browser paints.
      const ghosts=fades.map((item,index)=>({id:item.id,actorId:item.actorId,node:ghostNodes[index]})),composite=[];
      for(let index=0;index<cast.length;index++){const actor=state.characters[index];for(const ghost of ghosts)if(ghost.actorId===actor.id)composite.push(ghost.node);composite.push(cast[index]);}
      for(const ghost of ghosts)if(!state.characters.some(actor=>actor.id===ghost.actorId))composite.push(ghost.node);
      this.backgroundLayer.replaceChildren(...(bg?[bg]:[]));this.actorLayer.replaceChildren(...composite);
      this.nodes=cast;this.ghosts=ghosts;this.committedKey=key;this.pendingKey=null;
      this.committed=this.desired&&signature(this.desired,this.revision)===key?this.desired:state;
      this.apply(this.committed);this.onReady(this.committed);return true;
    })().catch(error=>{if(!this.disposed&&generation===this.generation){this.pendingKey=null;this.failedKey=key;this.onError(error);}return false;});
    this.task=task;
  }
  apply(state){
    if(!state)return;
    this.backgroundLayer.style.opacity=String(state.background?.opacity??1);
    const active=transitions(state),byActor=new Map(active.map(item=>[item.actorId,item]));
    for(let index=0;index<this.nodes.length;index++){
      const actor=state.characters[index],fade=byActor.get(actor.id),style=actorVisualStyle(actor,state.layers||[]);
      style.filter=speakerFilter(actor,state,this.lighting);
      if(fade?.to)style.opacity=String((Number(style.opacity)||0)*fade.progress);
      Object.assign(this.nodes[index].style,style);
    }
    for(const ghost of this.ghosts){
      const fade=active.find(item=>item.id===ghost.id);if(!fade?.from){ghost.node.style.opacity='0';continue;}
      const style=actorVisualStyle(fade.from,state.layers||[]);
      style.filter=speakerFilter(fade.from,state,this.lighting);
      // Native swap fade holds the complete old picture beneath the incoming
      // one. Fading both pictures would expose the stage colour in the middle.
      if(!fade.to)style.opacity=String((Number(style.opacity)||0)*(1-fade.progress));
      Object.assign(ghost.node.style,style);
    }
  }
  async waitFor(state){if(this.disposed)return false;this.sync(state);if(!this.pending(state))return true;return this.task?await this.task:false;}
  invalidate(){this.generation++;this.committedKey=null;this.pendingKey=null;this.failedKey=null;}
  dispose(){this.disposed=true;this.generation++;this.desired=null;this.committed=null;this.nodes=[];this.ghosts=[];}
}
