/** Declarative native cues are evaluated only against trusted executed commands. */
const copy=value=>structuredClone(value),finite=value=>typeof value==='number'&&Number.isFinite(value),plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(`原作演出配置无效：${message}`);};
const clamp=value=>Math.max(0,Math.min(1,value));
const registered=new Map();
const compiledManifests=new WeakMap();
const registryKey=(story,revision)=>`${story.id}|${story.gameFingerprint}|${revision}`;
const stable=value=>value===undefined?'null':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
function semanticRevision(manifest){const source=stable({defaults:manifest.defaults,layers:manifest.layers,bindings:manifest.bindings,scenes:manifest.scenes,dialogueSpeakers:manifest.dialogueSpeakers,nativeUiSettings:manifest.nativeUiSettings});let a=2166136261,b=5381;for(let i=0;i<source.length;i++){const c=source.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}return(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
const fresh=()=>({messageWindow:{offsetX:0,offsetY:0,opacity:1,visible:true},messageWindowPosition:{offsetX:0,offsetY:0},guiActive:{},transitions:[],motions:[],shakes:[],waits:[],textureOffsets:{}});
const hash=text=>{let value=2166136261;for(const char of String(text))value=Math.imul(value^char.charCodeAt(0),16777619);return value>>>0;};
function random(seed,step){let n=(seed^Math.imul(step+1,0x9e3779b9))>>>0;n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);return((n^(n>>>16))>>>0)/4294967296;}
const commandEnd=(scene,command,execution)=>execution.releaseAt??execution.at+(command.type==='wait'?command.duration:command.type==='event'&&command.block?scene.events[command.eventIndex].duration||0:0);

export class NativeEffectsRuntime{
  constructor(story,manifest){
    if(!plain(manifest)||manifest.type!=='xp2-native-presentation'||manifest.schemaVersion!==1||manifest.storyId!==story.id||!plain(manifest.scenes))fail('类型、版本或剧情编号不匹配');
    const scenes=new Map(story.scenes.map(scene=>[scene.id,scene]));this.sourceScenes=scenes;this.storyId=story.id;this.defaults=copy(manifest.defaults||{});this.layers=copy(manifest.layers||{});this.bindings=copy(manifest.bindings||{});this.scenes=new Map();this.speakers=new Map();for(const [sceneId,entries] of Object.entries(manifest.dialogueSpeakers||{})){const scene=scenes.get(sceneId);if(!scene)fail('说话人场景无效');const values=new Map();for(const [index,speaker] of Object.entries(entries)){const event=scene.events[Number(index)];if(event?.type!=='dialogue'||!event.textId)fail('说话人对白锚点无效');values.set(event.textId,copy(speaker));}this.speakers.set(sceneId,values);}let count=0;
    for(const [sceneId,rows] of Object.entries(manifest.scenes)){
      const scene=scenes.get(sceneId);if(!scene||!Array.isArray(rows)||rows.length>20000)fail('效果场景或指令数量无效');
      const ids=new Set(),compiled=[];
      for(const source of rows){
        const row=copy(source);if(!plain(row)||typeof row.id!=='string'||ids.has(row.id)||!Number.isInteger(row.beforeCommandIndex)||row.beforeCommandIndex<0||row.beforeCommandIndex>scene.commands.length)fail('原作指令锚点或编号无效');ids.add(row.id);
        if(!['Tween','Shake','GuiActive','Bg','BgEvent','BgOff','BgEventOff','Sprite','SpriteOff','CharacterOff','Character'].includes(row.command))fail('未支持的原作指令');
        if(row.duration!==undefined&&(!finite(row.duration)||row.duration<0||row.duration>86400))fail('动画时长无效');
        for(const index of [...(row.eventIndexes||[]),...(row.replaceEventIndexes||[])])if(!Number.isInteger(index)||index<0||index>=scene.events.length)fail('原作事件锚点超出片段');
        const p=row.parameters||{};for(const field of ['x','y','z','time','delay'])if(p[field]!==undefined&&(!finite(p[field])||Math.abs(p[field])>100000))fail('原作动画参数无效');
        if(row.command==='Tween'&&!['MoveTo','MoveBy'].includes(row.operation))fail('原作位移类型无效');
        if(row.command==='Tween'&&row.ease!=='easeOutExpo')fail('尚未核实的原作缓动');
        row._sequence=compiled.length;compiled.push(row);if(++count>50000)fail('原作效果总量超限');
      }
      this.scenes.set(sceneId,compiled);
    }
    if(!/^[a-f0-9]{64}$/.test(manifest.sourceStorySha256||''))fail('原作来源版本校验无效');this.count=count;this.revision='native-1:'+manifest.sourceStorySha256+':'+semanticRevision(manifest);registered.set(registryKey(story,this.revision),this);if(registered.size>4)registered.delete(registered.keys().next().value);
  }
  base(entry){return entry?.nativeEffects?{...fresh(),...copy(entry.nativeEffects)}:fresh();}
  timeline(scene,commands,executions,{ended=false}={}){
    const rows=this.scenes.get(scene.id)||[],skip=new Set(),events=[];
    for(const row of rows){
      const anchor=executions[row.beforeCommandIndex];if(!anchor&&!(ended&&row.beforeCommandIndex===commands.length))continue;
      const at=anchor?.at??(executions.length?commandEnd(scene,commands.at(-1),executions.at(-1)):0);
      for(const index of row.replaceEventIndexes||[])skip.add(index);if(row.command==='Character')for(const index of row.eventIndexes||[])if(scene.events[index].type==='character')skip.add(index);
      events.push({type:'nativeEffect',at,native:row,_order:row.beforeCommandIndex*2+row._sequence/100000});
    }
    for(const execution of executions){const command=commands[execution.commandIndex];if(command.eventIndex===undefined||skip.has(command.eventIndex))continue;events.push({...scene.events[command.eventIndex],at:execution.at,_order:execution.commandIndex*2+1});}
    return events.sort((a,b)=>a.at-b.at||a._order-b._order).map(({_order,...event})=>event);
  }
  targets(state,row){
    if(row.targetKind==='messageWindow')return ['messageWindow'];
    const ids=row.targetIds||[];const present=ids.filter(id=>state.characters.some(actor=>actor.id===id));
    return (row.targetKind==='background'?present.slice(0,1):present).map(id=>`character:${id}`);
  }
  apply(state,row,at,{animate,actorState,resolveTarget,patchActor}){
    const fx=state.nativeEffects,delay=row.parameters?.delay||0,duration=row.duration??row.parameters?.time??this.defaults.tween?.time??1;
    if(row.command==='GuiActive'){fx.guiActive[row.target]=row.active===true;return;}
    if(row.command==='Shake'){
      if(row.targetKind!=='messageWindow')return;
      fx.shakes=fx.shakes.filter(item=>item.target!=='messageWindow');fx.shakes.push({id:row.id,target:'messageWindow',at:at+delay,duration,x:row.parameters?.x??30,y:row.parameters?.y??30,seed:hash(row.id)});
    }else if(row.command==='Tween'){
      if(row.targetKind==='unresolved')return;
      for(const targetName of this.targets(state,row)){
        const target=resolveTarget(state,targetName);if(!target)continue;const to={},p=row.parameters||{};
        if(targetName==='messageWindow'){
          if(p.x!==undefined)to.offsetX=row.operation==='MoveBy'?target.offsetX+p.x:p.x;
          if(p.y!==undefined)to.offsetY=row.operation==='MoveBy'?target.offsetY-p.y:-p.y;
        }else{
          const actorId=targetName.slice(10),binding=fx.textureOffsets[actorId]||this.bindings[actorId]?.assets?.[target.asset]||{x:0,y:0};
          if(p.x!==undefined)to.x=row.operation==='MoveBy'?target.x+p.x:640+p.x+(binding.x||0)-(target.width||0)/2;
          if(p.y!==undefined)to.y=row.operation==='MoveBy'?target.y-p.y:360-p.y-(binding.y||0)-(target.height||0)/2;
        }
        if(Object.keys(to).length)animate(targetName,to,at+delay,duration,row.ease||'easeOutExpo',true);
      }
    }else if(row.operation==='draw'){
      const draws=(row.eventIndexes||[]).map(index=>this._scene.events[index]).filter(event=>event.type==='character'&&event.asset);
      for(const event of draws){
        if(state.eventMode&&event.kind==='character')continue;
        const old=state.characters.find(actor=>actor.id===event.id),next=actorState(Object.fromEntries(Object.entries(event).filter(([key])=>!['type','at','eventId'].includes(key))));
        if(row.command==='Character'&&old&&!row.rawArgs?.[1]&&(!row.rawArgs?.[2]||old.layerName===row.rawArgs[2])){
          const patch={type:'character',at,id:old.id},offset=fx.textureOffsets[old.id]||this.bindings[old.id]?.assets?.[old.asset]||{x:0,y:0},layer=this.layers[old.layerName]||{};
          if(row.positionX!==undefined)patch.x=640+(layer.x||0)+row.positionX+(offset.x||0)-old.width/2;
          if(row.positionY!==undefined)patch.y=360-(layer.y||0)-row.positionY-(offset.y||0)-old.height/2;
          if(patch.x!==undefined||patch.y!==undefined)patchActor(patch);continue;
        }
        fx.textureOffsets[event.id]=copy(row.textureOffset||{x:0,y:0});
        if(duration>0&&(!old||old.asset!==next.asset)){fx.transitions=fx.transitions.filter(item=>item.actorId!==event.id);fx.transitions.push({id:row.id+':'+event.id,actorId:event.id,kind:event.kind||'character',from:old?copy(old):null,to:next,at,duration});}
        if(row.command==='Character')patchActor(event);
      }
      if(row.command==='BgEvent'&&duration>0)for(const actor of state.characters.filter(actor=>actor.kind==='character')){fx.transitions=fx.transitions.filter(item=>item.actorId!==actor.id);fx.transitions.push({id:row.id+':off:'+actor.id,actorId:actor.id,kind:'character',from:copy(actor),to:null,at,duration});}
    }else if(row.operation==='clear'){
      for(const index of row.eventIndexes||[]){const event=this._scene.events[index];if(event.type!=='clearActors')continue;
        for(const actor of state.characters.filter(actor=>actor.kind===event.kind&&(event.id===undefined||actor.id===event.id)&&(event.layerName===undefined||actor.layerName===event.layerName))){fx.transitions=fx.transitions.filter(item=>item.actorId!==actor.id);if(duration>0)fx.transitions.push({id:row.id+':'+actor.id,actorId:actor.id,kind:actor.kind,from:copy(actor),to:null,at,duration});}
      }
    }
    if(['Tween','Shake'].includes(row.command)&&['Default','Add'].includes(row.waitType)&&duration>0){fx.waits.push({id:row.id,at:at+delay,duration,waitType:row.waitType});if(row.waitType==='Default')fx.defaultBarrier=fx.waits.reduce((end,item)=>Math.max(end,item.at+item.duration),at);}
  }
  begin(scene){this._scene=this.sourceScenes.get(scene.id)||scene;}
  finish(state,time,tweens){
    const fx=state.nativeEffects;
    fx.transitions=fx.transitions.map(item=>({...item,progress:clamp((time-item.at)/item.duration)})).filter(item=>item.progress<1);
    fx.shakes=fx.shakes.filter(item=>time<item.at+item.duration);fx.waits=fx.waits.filter(item=>time<item.at+item.duration);
    const position=fx.messageWindowPosition;let x=position.offsetX||0,y=position.offsetY||0;
    for(const item of fx.shakes){if(time<item.at)continue;const elapsed=time-item.at,envelope=1-clamp(elapsed/item.duration),step=Math.floor(elapsed*60);x+=(random(item.seed,step*2)*2-1)*item.x*envelope;y-=(random(item.seed,step*2+1)*2-1)*item.y*envelope;}
    fx.messageWindow={offsetX:x,offsetY:y,opacity:1,visible:true};fx.motions=tweens.filter(item=>item.native&&Object.keys(item.to).length&&time<item.at+item.duration).map(item=>copy(item));
    fx.waitUntil=Math.max(time,fx.defaultBarrier||0);fx.defaultWaiting=fx.waitUntil>time+1e-7;fx.waiting=fx.defaultWaiting;fx.inputWaitUntil=fx.waits.reduce((end,item)=>Math.max(end,item.at+item.duration),time);fx.inputWaiting=fx.inputWaitUntil>time+1e-7;
  }
  onDialogue(state,event,at){const speaker=this.speakers.get(state.sceneId)?.get(event.textId);if(!speaker)return;const fx=state.nativeEffects,next=speaker.actorId||null;if(fx.speakerActorId!==next){fx.previousSpeakerActorId=fx.speakerActorId||null;fx.speakerActorId=next;fx.speakerChangedAt=at;}}
  inputWaitUntil(scene,executions,commandIndex,at){
    let until=at;for(const row of this.scenes.get(scene.id)||[]){if(!['Tween','Shake'].includes(row.command)||!['Default','Add'].includes(row.waitType)||row.targetKind==='unresolved'||row.beforeCommandIndex>commandIndex)continue;const execution=executions[row.beforeCommandIndex];if(execution)until=Math.max(until,execution.at+(row.parameters?.delay||0)+(row.duration||0));}return until;
  }
  blockDuration(scene,commandIndex,executions){
    const rows=this.scenes.get(scene.id)||[],current=rows.find(row=>['Tween','Shake'].includes(row.command)&&(row.commandIndexes||[]).includes(commandIndex));
    if(!current)return null;if(current.waitType!=='Default')return 0;
    const at=executions[commandIndex].at;let until=at;
    for(const row of rows){
      if(!['Tween','Shake'].includes(row.command)||!['Default','Add'].includes(row.waitType)||row.targetKind==='unresolved'||row._sequence>current._sequence)continue;
      const execution=executions[row.beforeCommandIndex];if(!execution||row.beforeCommandIndex>commandIndex)continue;until=Math.max(until,execution.at+(row.parameters?.delay||0)+(row.duration||0));
    }
    return Math.max(0,until-at);
  }
  settleTime(scene,commands,executions,{ended=false}={}){
    let until=0;for(const row of this.scenes.get(scene.id)||[]){const execution=executions[row.beforeCommandIndex];if(!execution&&!(ended&&row.beforeCommandIndex===commands.length))continue;const at=execution?.at??(executions.length?commandEnd(scene,commands.at(-1),executions.at(-1)):0);until=Math.max(until,at+(row.parameters?.delay||0)+(row.duration||0));}const speakerFade=.2;for(const execution of executions){const command=commands[execution.commandIndex];if(command.type==='dialogue'&&this.speakers.get(scene.id)?.has(scene.events[command.eventIndex].textId))until=Math.max(until,execution.at+speakerFade);}return until;
  }
}
export function compileNativeEffects(story,manifest){if(manifest instanceof NativeEffectsRuntime){if(manifest.storyId!==story.id)fail('配置与剧情不匹配');return manifest;}if(!plain(manifest))fail('缺少配置');let byStory=compiledManifests.get(manifest);if(!byStory){byStory=new WeakMap();compiledManifests.set(manifest,byStory);}let runtime=byStory.get(story);if(!runtime){runtime=new NativeEffectsRuntime(story,manifest);byStory.set(story,runtime);}registered.set(registryKey(story,runtime.revision),runtime);return runtime;}
export function carryNativeEffects(effects,elapsed){if(!effects)return undefined;const result=copy(effects);for(const key of ['transitions','motions','shakes','waits'])for(const item of result[key]||[])item.at-=elapsed;result.waitUntil=Math.max(0,(result.waitUntil||0)-elapsed);result.inputWaitUntil=Math.max(0,(result.inputWaitUntil||0)-elapsed);result.defaultBarrier=Math.max(0,(result.defaultBarrier||0)-elapsed);if(result.speakerChangedAt!==undefined)result.speakerChangedAt-=elapsed;return result;}

export function nativeEffectsFor(story,revision){const runtime=registered.get(registryKey(story,revision));if(!runtime)fail('此浏览记录需要先载入匹配的原作演出配置');return runtime;}
