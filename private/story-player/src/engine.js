const EVENT_TYPES=new Set(['background','character','layer','tween','camera','fade','dialogue','audio','stopAudio','video','stopVideo']);
const EASINGS={linear:t=>t,easeIn:t=>t*t,easeOut:t=>1-(1-t)*(1-t),easeInOut:t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2};
const ACTOR_NUMBERS=new Set(['x','y','width','height','scale','scaleX','scaleY','rotation','opacity','layer','pivotX','pivotY']);
const LAYER_NUMBERS=new Set(['x','y','scale','scaleX','scaleY','rotation','opacity','layer']);
const CAMERA_NUMBERS=new Set(['x','y','scale','rotation']);
const safeCopy=value=>structuredClone(value),clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const error=message=>{throw new Error(`演出包无效：${message}`);};
const idOK=value=>typeof value==='string'&&value.trim().length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
const colorOK=value=>typeof value==='string'&&/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value);

function audit(value){
  const queue=[{value,depth:0}];let count=0;
  while(queue.length){const item=queue.pop();if(++count>500000||item.depth>40)error('结构超过支持范围');
    if(item.value&&typeof item.value==='object')for(const [key,child] of Object.entries(item.value)){
      if(['__proto__','prototype','constructor'].includes(key))error('含不支持的字段名称');
      if(child&&typeof child==='object')queue.push({value:child,depth:item.depth+1});
    }
  }
}
function number(value,name,{min=-100000,max=100000}={}){if(!finite(value)||value<min||value>max)error(`${name}超出范围`);}
function identity(value,name){if(!idOK(value))error(`${name}不能为空或包含控制字符`);}
function shape(value,name){if(!plain(value))error(`${name}必须是对象`);}
function keys(value,allowed,name){for(const key of Object.keys(value))if(!allowed.includes(key))error(`${name}含未支持的字段 ${key}`);}
function assetReference(value,assetMap,type,name){identity(value,name);const entry=assetMap.get(value);if(!entry||type&&!type.includes(entry.type))error(`${name}引用了不匹配的资源 ${value}`);}
function visualNumber(value,field,name){
  number(value,`${name}.${field}`);
  if(['width','height','scale','scaleX','scaleY'].includes(field)&&value<=0)error(`${name}.${field}必须大于零`);
  if(['opacity','pivotX','pivotY'].includes(field)&&(value<0||value>1))error(`${name}.${field}必须为0至1`);
}
function layerReference(value,layers,name){if(value!==undefined&&value!==null){identity(value,`${name}图层编号`);if(!layers.has(value))error(`${name}引用了不存在的图层 ${value}`);}}
function layerPatch(value,name){
  shape(value,name);keys(value,['id','parentId',...LAYER_NUMBERS,'flip','flipY','visible'],name);identity(value.id,`${name}编号`);
  if(value.parentId!==undefined&&value.parentId!==null)identity(value.parentId,`${name}父图层编号`);
  for(const field of LAYER_NUMBERS)if(value[field]!==undefined)visualNumber(value[field],field,name);
  for(const field of ['flip','flipY','visible'])if(value[field]!==undefined&&typeof value[field]!=='boolean')error(`${name}.${field}必须为布尔值`);
}
function layerTree(layers){
  if(layers.size>256)error('图层数量超过256');
  for(const layer of layers.values()){
    const seen=new Set([layer.id]);let current=layer;
    while(current.parentId!==undefined&&current.parentId!==null){
      layerReference(current.parentId,layers,'父图层');if(seen.has(current.parentId))error('图层父子关系存在循环');
      seen.add(current.parentId);if(seen.size>64)error('图层层级超过64');current=layers.get(current.parentId);
    }
  }
}
function actorPatch(value,name,assetMap,{complete=false}={}){
  shape(value,name);keys(value,['id','asset',...ACTOR_NUMBERS,'flip','flipY','visible','remove','layerId'],name);identity(value.id,`${name}编号`);
  if(complete||value.asset!==undefined)assetReference(value.asset,assetMap,['image'],`${name}图片`);
  for(const field of ACTOR_NUMBERS)if(value[field]!==undefined)visualNumber(value[field],field,name);
  for(const field of ['flip','flipY','visible','remove'])if(value[field]!==undefined&&typeof value[field]!=='boolean')error(`${name}.${field}必须为布尔值`);
}
function cameraPatch(value,name){shape(value,name);keys(value,[...CAMERA_NUMBERS,'shake'],name);for(const field of CAMERA_NUMBERS)if(value[field]!==undefined){number(value[field],`${name}.${field}`);if(field==='scale'&&value[field]<=0)error('镜头缩放必须大于零');}
  if(value.shake!==undefined){shape(value.shake,`${name}.shake`);keys(value.shake,['amplitude','frequency','duration'],`${name}.shake`);number(value.shake.amplitude,'震动幅度',{min:0,max:300});number(value.shake.frequency,'震动频率',{min:.01,max:100});number(value.shake.duration,'震动时长',{min:.001,max:120});}
}
function backgroundPatch(value,name,assetMap){shape(value,name);keys(value,['asset','opacity'],name);assetReference(value.asset,assetMap,['image'],`${name}图片`);if(value.opacity!==undefined)number(value.opacity,`${name}透明度`,{min:0,max:1});}
function overlayPatch(value,name){shape(value,name);keys(value,['color','opacity'],name);if(value.color!==undefined&&!colorOK(value.color))error(`${name}颜色无效`);if(value.opacity!==undefined)number(value.opacity,`${name}透明度`,{min:0,max:1});}
function dialoguePatch(value,name,textMap){shape(value,name);keys(value,['textId','speaker','visible','startedAt'],name);if(value.visible!==undefined&&typeof value.visible!=='boolean')error(`${name}显示状态无效`);if(value.textId!==null&&value.textId!==undefined&&!textMap.has(value.textId))error(`${name}引用了不存在的原文`);if(value.speaker!==undefined&&typeof value.speaker!=='string')error(`${name}角色名无效`);if(value.startedAt!==undefined)number(value.startedAt,`${name}开始时间`,{min:0,max:86400});}
function mediaPatch(value,name,assetMap,type){
  shape(value,name);const common=['id','asset','offset','loop','volume','duration','fadeIn'];const visual=['visible','x','y','width','height','opacity'];keys(value,type==='video'?[...common,...visual]:common,name);identity(value.id,`${name}编号`);assetReference(value.asset,assetMap,[type],`${name}资源`);
  for(const field of ['offset','duration','fadeIn'])if(value[field]!==undefined)number(value[field],`${name}.${field}`,{min:0,max:86400});
  if(value.duration===0)error(`${name}时长必须大于零`);
  if(value.volume!==undefined)number(value.volume,`${name}音量`,{min:0,max:1});
  if(value.loop!==undefined&&typeof value.loop!=='boolean')error(`${name}循环状态无效`);
  if(type==='video'){
    for(const field of ['x','y','width','height'])if(value[field]!==undefined){number(value[field],`${name}.${field}`);if(['width','height'].includes(field)&&value[field]<=0)error(`${name}尺寸无效`);}
    if(value.opacity!==undefined)number(value.opacity,`${name}透明度`,{min:0,max:1});
    if(value.visible!==undefined&&typeof value.visible!=='boolean')error(`${name}显示状态无效`);
  }
}

/** Validate the entire package atomically; unsupported commands never silently disappear. */
export function validateStory(story){
  audit(story);shape(story,'演出包');if(story.type!=='story-player'||story.schemaVersion!==1)error('不是支持的第1版演出包');
  identity(story.id,'演出包编号');identity(story.gameFingerprint,'版本标识');if(typeof story.title!=='string')error('缺少标题');
  shape(story.stage,'画面尺寸');number(story.stage.width,'画面宽度',{min:1,max:16384});number(story.stage.height,'画面高度',{min:1,max:16384});
  if(!Array.isArray(story.assets)||!Array.isArray(story.texts)||!Array.isArray(story.scenes)||!story.scenes.length)error('缺少资源、原文或场景目录');
  const assets=new Map(),texts=new Map(),scenes=new Map();
  for(const asset of story.assets){shape(asset,'资源');identity(asset.id,'资源编号');if(assets.has(asset.id))error(`资源编号重复 ${asset.id}`);if(!['image','audio','video'].includes(asset.type))error(`资源类型不支持 ${asset.type}`);assets.set(asset.id,asset);}
  for(const text of story.texts){shape(text,'原文');identity(text.id,'原文编号');if(texts.has(text.id)||typeof text.source!=='string'||text.speaker!==undefined&&typeof text.speaker!=='string')error('原文编号重复或文字字段不完整');texts.set(text.id,text);}
  for(const scene of story.scenes){shape(scene,'场景');identity(scene.id,'场景编号');if(scenes.has(scene.id))error(`场景编号重复 ${scene.id}`);scenes.set(scene.id,scene);}
  if(!scenes.has(story.startScene))error('起始场景不存在');
  if(story.mapSize!==undefined){shape(story.mapSize,'地图尺寸');number(story.mapSize.width,'地图宽度',{min:1,max:100000});number(story.mapSize.height,'地图高度',{min:1,max:100000});}
  for(const scene of story.scenes){
    if(typeof scene.title!=='string')error(`场景 ${scene.id} 缺少标题`);number(scene.duration,`${scene.id}时长`,{min:.001,max:86400});
    if(!Array.isArray(scene.events)||scene.events.length>50000)error(`${scene.id}事件列表无效`);
    shape(scene.entry,`${scene.id}入口状态`);keys(scene.entry,['background','characters','layers','camera','overlay','dialogue','audio','video'],`${scene.id}入口状态`);
    backgroundPatch(scene.entry.background,'入口背景',assets);
    const layers=new Map();if(scene.entry.layers!==undefined){if(!Array.isArray(scene.entry.layers))error('入口图层列表无效');for(const layer of scene.entry.layers){layerPatch(layer,'入口图层');if(layers.has(layer.id))error('入口图层编号重复');layers.set(layer.id,{...layer});}layerTree(layers);}
    if(!Array.isArray(scene.entry.characters))error('入口人物列表无效');const actors=new Set();for(const actor of scene.entry.characters){actorPatch(actor,'入口人物',assets,{complete:true});layerReference(actor.layerId,layers,'入口人物');if(actors.has(actor.id))error('入口人物编号重复');actors.add(actor.id);}
    if(scene.entry.camera!==undefined)cameraPatch(scene.entry.camera,'入口镜头');if(scene.entry.overlay!==undefined)overlayPatch(scene.entry.overlay,'入口遮罩');
    if(scene.entry.dialogue!==undefined)dialoguePatch(scene.entry.dialogue,'入口台词',texts);
    if(scene.entry.audio!==undefined){if(!Array.isArray(scene.entry.audio))error('入口音轨列表无效');const channels=new Set();for(const track of scene.entry.audio){mediaPatch(track,'入口音轨',assets,'audio');if(channels.has(track.id))error('入口音轨编号重复');channels.add(track.id);}}
    if(scene.entry.video!==undefined&&scene.entry.video!==null)mediaPatch(scene.entry.video,'入口视频',assets,'video');
    if(scene.map!==undefined){shape(scene.map,'地图节点');number(scene.map.x,'地图节点横坐标');number(scene.map.y,'地图节点纵坐标');}
    if(scene.next!==undefined&&scene.next!==null&&!scenes.has(scene.next))error(`${scene.id}的下一场景不存在`);
    if(scene.choices!==undefined){if(!Array.isArray(scene.choices))error('分支列表无效');for(const choice of scene.choices){shape(choice,'分支');if(typeof choice.label!=='string'||!scenes.has(choice.target))error(`${scene.id}的分支目标不存在`);if(choice.conditionLabel!==undefined&&typeof choice.conditionLabel!=='string')error('分支说明无效');}}
    const eventIds=new Set();for(const {event} of scene.events.map((event,index)=>({event,index})).sort((a,b)=>(a.event?.at??0)-(b.event?.at??0)||a.index-b.index)){
      shape(event,'演出事件');if(!EVENT_TYPES.has(event.type))error(`场景 ${scene.id} 含未实现的指令 ${String(event.type)}`);number(event.at,'事件时间',{min:0,max:scene.duration});
      if(event.eventId!==undefined){identity(event.eventId,'事件编号');if(eventIds.has(event.eventId))error('同一场景含重复事件编号');eventIds.add(event.eventId);}
      const payload=Object.fromEntries(Object.entries(event).filter(([key])=>!['at','type','eventId'].includes(key)));
      if(event.type==='background')backgroundPatch(payload,'背景指令',assets);
      else if(event.type==='character'){
        actorPatch(payload,'人物指令',assets);layerReference(event.layerId,layers,'人物指令');if(!actors.has(event.id)&&event.asset===undefined&&!event.remove)error(`人物 ${event.id} 尚未入场`);
        if(event.remove)actors.delete(event.id);else actors.add(event.id);
      }else if(event.type==='layer'){
        layerPatch(payload,'图层指令');layers.set(event.id,{...layers.get(event.id),...payload});layerTree(layers);
      }else if(event.type==='camera')cameraPatch(payload,'镜头指令');
      else if(event.type==='fade'){keys(payload,['color','opacity','duration','easing'],'遮罩指令');overlayPatch(Object.fromEntries(Object.entries(payload).filter(([key])=>['color','opacity'].includes(key))),'遮罩指令');if(event.opacity===undefined)error('遮罩指令缺少目标透明度');if(event.duration!==undefined)number(event.duration,'遮罩时长',{min:0,max:scene.duration});if(event.easing!==undefined&&!Object.hasOwn(EASINGS,event.easing))error('遮罩曲线不支持');if(event.at+(event.duration||0)>scene.duration+.000001)error('遮罩动画超出场景时长');}
      else if(event.type==='dialogue')dialoguePatch(payload,'台词指令',texts);
      else if(event.type==='audio'||event.type==='video')mediaPatch(payload,event.type==='audio'?'音轨指令':'视频指令',assets,event.type);
      else if(event.type==='stopAudio'){keys(payload,['id','duration'],'停止音轨');identity(event.id,'音轨编号');if(event.duration!==undefined)number(event.duration,'淡出时长',{min:0,max:scene.duration});}
      else if(event.type==='stopVideo'){keys(payload,[],'停止视频');}
      else if(event.type==='tween'){
        keys(payload,['target','to','duration','easing'],'动画指令');identity(event.target,'动画目标');shape(event.to,'动画目标值');if(!Object.keys(event.to).length)error('动画缺少目标值');number(event.duration,'动画时长',{min:0,max:scene.duration});if(event.at+event.duration>scene.duration+.000001)error('动画超出场景时长');if(event.easing!==undefined&&!Object.hasOwn(EASINGS,event.easing))error('动画曲线不支持');
        let allowed;if(event.target.startsWith('character:')){if(!actors.has(event.target.slice(10)))error('动画引用了尚未入场的人物');allowed=ACTOR_NUMBERS;}else if(event.target.startsWith('layer:')){if(!layers.has(event.target.slice(6)))error('动画引用了尚未声明的图层');allowed=LAYER_NUMBERS;}else if(event.target==='camera')allowed=CAMERA_NUMBERS;else if(event.target==='overlay'||event.target==='background')allowed=new Set(['opacity']);else error(`动画目标不支持 ${event.target}`);
        for(const [key,value] of Object.entries(event.to)){if(!allowed.has(key))error(`动画字段不支持 ${key}`);visualNumber(value,key,'动画目标');}
      }
    }
  }
  return story;
}

function actorState(actor){const result={id:actor.id,asset:actor.asset,x:400,y:90,width:360,height:600,scale:1,scaleX:1,scaleY:1,pivotX:.5,pivotY:.5,rotation:0,opacity:1,layer:1,layerId:null,flip:false,flipY:false,...safeCopy(actor)};if(result.visible===false)result.opacity=0;delete result.visible;delete result.remove;return result;}
function layerState(layer){return {id:layer.id,parentId:null,x:0,y:0,scale:1,scaleX:1,scaleY:1,rotation:0,opacity:1,layer:0,flip:false,flipY:false,visible:true,...safeCopy(layer)};}
function mediaState(media,at,video=false){return {...(video?{visible:true,x:0,y:0,width:1280,height:720,opacity:1}:{}),offset:0,loop:false,volume:1,fadeIn:0,...safeCopy(media),startAt:at};}
function baseState(scene){
  const entry=scene.entry;
  return {sceneId:scene.id,time:0,duration:scene.duration,playing:false,rate:1,ended:false,
    background:{opacity:1,...safeCopy(entry.background)},characters:entry.characters.map(actorState),layers:(entry.layers||[]).map(layerState),
    camera:{x:0,y:0,scale:1,rotation:0,shakeX:0,shakeY:0,...safeCopy(entry.camera||{})},
    overlay:{color:'#000000',opacity:0,...safeCopy(entry.overlay||{})},
    dialogue:{textId:null,speaker:'',visible:false,startedAt:0,...safeCopy(entry.dialogue||{})},
    audio:(entry.audio||[]).map(track=>mediaState(track,0)),video:entry.video?mediaState(entry.video,0,true):null};
}
function resolveTarget(state,target){return target.startsWith('character:')?state.characters.find(actor=>actor.id===target.slice(10)):target.startsWith('layer:')?state.layers.find(layer=>layer.id===target.slice(6)):state[target];}

/** Replays from the explicit entry every time, so arbitrary seek never inherits a previous scene. */
export function evaluateScene(scene,time){
  if(!plain(scene)||!finite(time))throw new Error('场景或播放时间无效');
  const state=baseState(scene),endTime=clamp(time,0,scene.duration),tweens=[];let shake=state.camera.shake?{...state.camera.shake,at:0}:null;delete state.camera.shake;
  const cancel=(target,fields=null)=>{for(const tween of tweens)if(tween.target===target)for(const key of Object.keys(tween.to))if(!fields||fields.includes(key)){delete tween.to[key];delete tween.from[key];}};
  const materialize=at=>{for(const tween of tweens){const target=resolveTarget(state,tween.target);if(!target)continue;const progress=tween.duration?clamp((at-tween.at)/tween.duration,0,1):1,ratio=EASINGS[tween.easing](progress);for(const key of Object.keys(tween.to))target[key]=tween.from[key]+(tween.to[key]-tween.from[key])*ratio;}};
  const animate=(targetName,to,at,duration,easing='linear')=>{const target=resolveTarget(state,targetName);if(!target)return;cancel(targetName,Object.keys(to));const from=Object.fromEntries(Object.keys(to).map(key=>[key,Number(target[key])]));tweens.push({target:targetName,to:safeCopy(to),from,at,duration,easing});if(!duration)Object.assign(target,to);};
  const events=scene.events.map((event,index)=>({event,index})).sort((a,b)=>a.event.at-b.event.at||a.index-b.index);
  for(const {event} of events){
    if(!EVENT_TYPES.has(event.type))error(`未实现的指令 ${String(event.type)}`);if(event.at>endTime)break;materialize(event.at);const {at,type,eventId,...payload}=event;
    if(type==='background'){cancel('background');state.background={opacity:1,...payload};}
    else if(type==='character'){
      const index=state.characters.findIndex(actor=>actor.id===event.id);
      if(event.remove){cancel(`character:${event.id}`);if(index>=0)state.characters.splice(index,1);continue;}
      const patch={...payload};delete patch.visible;delete patch.remove;if(event.visible!==undefined)patch.opacity=event.visible?(event.opacity??1):0;
      cancel(`character:${event.id}`,Object.keys(patch));
      if(index<0)state.characters.push(actorState(patch));else Object.assign(state.characters[index],patch);
    }else if(type==='layer'){
      const index=state.layers.findIndex(layer=>layer.id===event.id);cancel(`layer:${event.id}`,Object.keys(payload));
      if(index<0)state.layers.push(layerState(payload));else Object.assign(state.layers[index],payload);
    }else if(type==='tween')animate(event.target,event.to,at,event.duration,event.easing);
    else if(type==='camera'){const patch={...payload};delete patch.shake;cancel('camera',Object.keys(patch));Object.assign(state.camera,patch);if(event.shake)shake={...event.shake,at};}
    else if(type==='fade'){if(event.color!==undefined)state.overlay.color=event.color;animate('overlay',{opacity:event.opacity},at,event.duration||0,event.easing);}
    else if(type==='dialogue')state.dialogue={...state.dialogue,...payload,speaker:event.speaker??(event.textId!==undefined?'':state.dialogue.speaker),visible:event.visible??true,startedAt:at};
    else if(type==='audio'){const track=mediaState(payload,at),index=state.audio.findIndex(item=>item.id===track.id);if(index<0)state.audio.push(track);else state.audio[index]=track;}
    else if(type==='stopAudio'){const track=state.audio.find(item=>item.id===event.id);if(track){track.stopAt=at;track.fadeOut=event.duration||0;}}
    else if(type==='video')state.video=mediaState(payload,at,true);
    else if(type==='stopVideo')state.video=null;
  }
  materialize(endTime);
  if(shake&&endTime>=shake.at&&endTime<shake.at+shake.duration){const elapsed=endTime-shake.at,envelope=1-elapsed/shake.duration;state.camera.shakeX=Math.sin(elapsed*shake.frequency*Math.PI*2)*shake.amplitude*envelope;state.camera.shakeY=Math.sin(elapsed*shake.frequency*Math.PI*2*1.31)*shake.amplitude*.6*envelope;}
  const finishMedia=track=>{
    const elapsed=Math.max(0,endTime-track.startAt),naturalEnd=track.duration!==undefined&&!track.loop&&elapsed>=track.duration;
    const stopped=track.stopAt!==undefined&&endTime>=track.stopAt+(track.fadeOut||0);
    let volume=track.volume;if(track.fadeIn>0)volume*=clamp(elapsed/track.fadeIn,0,1);if(track.stopAt!==undefined&&track.fadeOut>0)volume*=1-clamp((endTime-track.stopAt)/track.fadeOut,0,1);
    return {...track,volume,position:track.offset+(naturalEnd?track.duration:elapsed),playing:!naturalEnd&&!stopped,ended:naturalEnd||stopped};
  };
  state.audio=state.audio.map(finishMedia).filter(track=>!track.ended);
  if(state.video)state.video=finishMedia(state.video);
  state.time=endTime;state.ended=endTime>=scene.duration;state.characters.sort((a,b)=>a.layer-b.layer);return state;
}

/** Wall-clock independent controller. The host owns requestAnimationFrame and media synchronization. */
export class TimelinePlayer{
  constructor(story,{onUpdate=()=>{},onEnd=()=>{}}={}){
    validateStory(story);this._story=safeCopy(story);this._scenes=new Map(this._story.scenes.map(scene=>[scene.id,scene]));this._onUpdate=onUpdate;this._onEnd=onEnd;this._rate=1;this._playing=false;this._time=0;this._scene=this._scenes.get(story.startScene);this._endNotified=false;this._notify();
  }
  get story(){return safeCopy(this._story);}
  get scene(){return safeCopy(this._scene);}
  get playing(){return this._playing;}
  get rate(){return this._rate;}
  get state(){const state=evaluateScene(this._scene,this._time);state.playing=this._playing;state.rate=this._rate;for(const track of state.audio)track.playing=track.playing&&this._playing;if(state.video)state.video.playing=state.video.playing&&this._playing;return state;}
  _notify(){this._onUpdate(this.state);}
  enter(id){if(!this._scenes.has(id))throw new Error('选择的剧情节点不存在');this._scene=this._scenes.get(id);this._time=0;this._playing=false;this._endNotified=false;this._notify();return this.state;}
  play(){if(this._time>=this._scene.duration){this._time=0;this._endNotified=false;}this._playing=true;this._notify();return this.state;}
  pause(){this._playing=false;this._notify();return this.state;}
  seek(seconds){if(!finite(seconds))throw new Error('播放位置必须为有限数字');this._time=clamp(seconds,0,this._scene.duration);if(this._time<this._scene.duration)this._endNotified=false;else this._playing=false;this._notify();return this.state;}
  setRate(rate){if(!finite(rate)||rate<.25||rate>4)throw new Error('播放速度应为0.25至4倍');this._rate=rate;this._notify();return this.state;}
  advance(deltaSeconds){
    if(!finite(deltaSeconds)||deltaSeconds<0)throw new Error('时间增量必须是非负有限数字');if(!this._playing||!deltaSeconds)return this.state;
    this._time=Math.min(this._scene.duration,this._time+deltaSeconds*this._rate);
    if(this._time>=this._scene.duration)this._playing=false;
    this._notify();if(this._time>=this._scene.duration&&!this._endNotified){this._endNotified=true;this._onEnd(this.state,this.scene);}return this.state;
  }
  dispose(){this._playing=false;this._onUpdate=()=>{};this._onEnd=()=>{};}
}

export const supportedEventTypes=Object.freeze([...EVENT_TYPES]);
