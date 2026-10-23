// Independent, bounded 2D effects. Every frame is derived from scene time;
// no random global state, animation timer or executable effect source is used.
const BAD_KEYS=new Set(['__proto__','constructor','prototype']);
const COMMON=['id','type','at','duration'];
const FILTERS=[['grayscale','grayscale',0,1,''],['sepia','sepia',0,1,''],['blur','blur',0,32,'px'],['brightness','brightness',0,4,''],['saturate','saturate',0,4,''],['contrast','contrast',0,4,''],['hueRotate','hue-rotate',-360,360,'deg']];
const fail=message=>{throw new Error(`二维效果无效：${message}`);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const color=value=>typeof value==='string'&&/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
function shape(value,label){if(!record(value))fail(`${label}必须是普通对象`);}
function keys(value,allowed,label){for(const key of Object.keys(value))if(BAD_KEYS.has(key)||!allowed.includes(key))fail(`${label}含未支持字段 ${key}`);}
function identity(value,label){if(typeof value!=='string'||!value.trim()||value.length>256||/[\u0000-\u001f\u007f]/.test(value)||BAD_KEYS.has(value))fail(`${label}编号无效`);}
function number(value,label,min,max){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label}须为 ${min} 至 ${max} 的有限数字`);}
function integer(value,label,min,max){number(value,label,min,max);if(!Number.isInteger(value))fail(`${label}须为整数`);}
function optional(value,field,min,max,label){if(value[field]!==undefined)number(value[field],`${label}.${field}`,min,max);}
function boolean(value,field,label){if(value[field]!==undefined&&typeof value[field]!=='boolean')fail(`${label}.${field}须为布尔值`);}
function range(value,label,min,max){if(!Array.isArray(value)||value.length!==2)fail(`${label}须为两个数字的范围`);number(value[0],label,min,max);number(value[1],label,min,max);if(value[0]>value[1])fail(`${label}下限超过上限`);}
function point(value,label,{min=-32768,max=32768}={}){shape(value,label);keys(value,['x','y'],label);number(value.x,`${label}.x`,min,max);number(value.y,`${label}.y`,min,max);}
function seeded(seed){let state=seed>>>0;return()=>{state=(state+0x6d2b79f5)>>>0;let n=state;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
const interpolate=(range,unit)=>range[0]+(range[1]-range[0])*unit;
// Decimal cue times and (at + n/fps) can differ by a few binary ULPs.
// Normalize only that representation noise, not a visible interval of time.
const tolerance=(...values)=>4*Number.EPSILON*Math.max(1,...values.map(Math.abs));
const before=(a,b,reference=0)=>a<b&&b-a>tolerance(a,b,reference);
function floorBoundary(value,reference){const rounded=Math.round(value);return Math.abs(value-rounded)<=tolerance(value,reference)?rounded:Math.floor(value);}

function particleSpec(effect,label){
  keys(effect,[...COMMON,'seed','count','region','velocity','lifetime','size','colors','gravity','opacity','loop','fadeIn','fadeOut'],label);
  integer(effect.seed,`${label}.seed`,0,4294967295);integer(effect.count,`${label}.count`,1,256);
  shape(effect.region,`${label}.region`);keys(effect.region,['x','y','width','height'],`${label}.region`);
  for(const field of ['x','y'])number(effect.region[field],`${label}.region.${field}`,-32768,32768);
  for(const field of ['width','height'])number(effect.region[field],`${label}.region.${field}`,0,32768);
  shape(effect.velocity,`${label}.velocity`);keys(effect.velocity,['x','y'],`${label}.velocity`);
  for(const field of ['x','y'])range(effect.velocity[field],`${label}.velocity.${field}`,-2000,2000);
  range(effect.lifetime,`${label}.lifetime`,.05,120);range(effect.size,`${label}.size`,.1,512);
  if(!Array.isArray(effect.colors)||!effect.colors.length||effect.colors.length>8||effect.colors.some(value=>!color(value)))fail(`${label}.colors须为 1 至 8 个十六进制颜色`);
  if(effect.gravity!==undefined)point(effect.gravity,`${label}.gravity`,{min:-1000,max:1000});
  optional(effect,'opacity',0,1,label);optional(effect,'fadeIn',0,1,label);optional(effect,'fadeOut',0,1,label);boolean(effect,'loop',label);
  if((effect.fadeIn??0)+(effect.fadeOut??0)>1)fail(`${label}淡入与淡出寿命比例之和超过 1`);
  const particles=Array.from({length:effect.count},(_,index)=>{
    const random=seeded((effect.seed^Math.imul(index+1,0x9e3779b9))>>>0);
    return {index,x:effect.region.x+effect.region.width*random(),y:effect.region.y+effect.region.height*random(),vx:interpolate(effect.velocity.x,random()),vy:interpolate(effect.velocity.y,random()),lifetime:interpolate(effect.lifetime,random()),size:interpolate(effect.size,random()),color:effect.colors[Math.floor(random()*effect.colors.length)]};
  });
  return {...structuredClone(effect),particles};
}
function spriteSpec(effect,label,assets){
  keys(effect,[...COMMON,'asset','columns','rows','frameWidth','frameHeight','fps','frames','loop','x','y','width','height','opacity'],label);
  identity(effect.asset,`${label}资源`);if(assets.get(effect.asset)!=='image')fail(`${label}图集须引用图片资源`);
  for(const field of ['columns','rows'])integer(effect[field],`${label}.${field}`,1,32);
  for(const field of ['frameWidth','frameHeight'])integer(effect[field],`${label}.${field}`,1,4096);
  const atlasWidth=effect.columns*effect.frameWidth,atlasHeight=effect.rows*effect.frameHeight;
  if(atlasWidth>16384||atlasHeight>16384||atlasWidth*atlasHeight>67108864)fail(`${label}图集声明尺寸过大`);
  number(effect.fps,`${label}.fps`,.01,120);
  if(!Array.isArray(effect.frames)||!effect.frames.length||effect.frames.length>4096)fail(`${label}.frames须为 1 至 4096 个帧索引`);
  for(const frame of effect.frames)integer(frame,`${label}帧索引`,0,effect.columns*effect.rows-1);
  for(const field of ['x','y'])number(effect[field],`${label}.${field}`,-32768,32768);
  for(const field of ['width','height'])number(effect[field],`${label}.${field}`,.1,16384);
  optional(effect,'opacity',0,1,label);boolean(effect,'loop',label);
  return structuredClone(effect);
}
function filterSpec(effect,label){
  keys(effect,[...COMMON,'values'],label);shape(effect.values,`${label}.values`);keys(effect.values,FILTERS.map(([field])=>field),`${label}.values`);
  if(!Object.keys(effect.values).length)fail(`${label}缺少滤镜值`);
  for(const [field,,min,max]of FILTERS)optional(effect.values,field,min,max,label);
  return structuredClone(effect);
}
function compile(story){
  shape(story,'演出包');if(!Array.isArray(story.scenes)||!story.scenes.length||story.scenes.length>10000)fail('缺少有界场景目录');
  const sceneMap=new Map();
  for(const scene of story.scenes){shape(scene,'场景');identity(scene.id,'场景');number(scene.duration,'场景时长',.001,86400);if(sceneMap.has(scene.id))fail('场景编号重复');sceneMap.set(scene.id,{duration:scene.duration,effects:[]});}
  if(story.presentation===undefined)return sceneMap;
  shape(story.presentation,'presentation');keys(story.presentation,['version','scenes'],'presentation');
  if(story.presentation.version!==1)fail('不支持此 presentation 版本');shape(story.presentation.scenes,'presentation.scenes');
  const entries=Object.entries(story.presentation.scenes);if(entries.length>256)fail('效果场景数量超过 256');
  if(!Array.isArray(story.assets)||story.assets.length>50000)fail('资源目录无效');
  const assets=new Map();for(const asset of story.assets){shape(asset,'资源');identity(asset.id,'资源');if(assets.has(asset.id))fail('资源编号重复');assets.set(asset.id,asset.type);}
  let totalEffects=0,totalParticles=0,totalSprites=0;
  for(const [sceneId,effects]of entries){
    identity(sceneId,'效果场景');const scene=sceneMap.get(sceneId);if(!scene)fail(`效果引用不存在的场景 ${sceneId}`);
    if(!Array.isArray(effects)||effects.length>64)fail(`${sceneId}效果数量超过 64 或列表无效`);
    totalEffects+=effects.length;if(totalEffects>2048)fail('总效果数量超过 2048');
    const ids=new Set();let sceneParticles=0,sceneSprites=0,sceneFilters=0;
    for(const effect of effects){
      shape(effect,`${sceneId}效果`);identity(effect.id,'效果');const label=`${sceneId}/${effect.id}`;if(ids.has(effect.id))fail(`${label}编号重复`);ids.add(effect.id);
      number(effect.at,`${label}.at`,0,scene.duration);number(effect.duration,`${label}.duration`,.001,86400);
      // Permit only rounding noise when independently authored decimal times add.
      if(effect.at+effect.duration>scene.duration+1e-9)fail(`${label}结束时间超过场景时长`);
      let compiled;
      if(effect.type==='particles'){
        compiled=particleSpec(effect,label);sceneParticles+=effect.count;totalParticles+=effect.count;
        if(sceneParticles>512||totalParticles>8192)fail('粒子预算超过每场景 512 或全包 8192');
      }else if(effect.type==='sprite'){
        compiled=spriteSpec(effect,label,assets);sceneSprites++;totalSprites++;
        if(sceneSprites>32||totalSprites>512)fail('图集动画预算超过每场景 32 或全包 512');
      }else if(effect.type==='filter'){
        compiled=filterSpec(effect,label);if(++sceneFilters>16)fail('每场景滤镜效果数量超过 16');
      }else fail(`${label}含未支持类型 ${String(effect.type)}`);
      scene.effects.push(compiled);
    }
  }
  return sceneMap;
}

/** Validate without modifying the supplied story. Optional presentation is allowed. */
export function validatePresentation(story){compile(story);return story;}

function evaluate(compiled,sceneId,seconds){
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)fail('场景时间须为非负有限数字');
  const scene=compiled.get(sceneId);if(!scene)fail(`场景 ${String(sceneId)} 不存在`);
  const result={filter:'',particles:[],sprites:[]},filters=[];
  for(const effect of scene.effects){
    if(before(seconds,effect.at)||!before(seconds,effect.at+effect.duration))continue;
    const elapsed=Math.max(0,seconds-effect.at);
    if(effect.type==='filter'){
      // Declaration order composes overlapping effects; field order is fixed.
      for(const [field,css,,,unit]of FILTERS)if(effect.values[field]!==undefined)filters.push(`${css}(${effect.values[field]}${unit})`);
    }else if(effect.type==='sprite'){
      const step=floorBoundary(elapsed*effect.fps,Math.max(seconds,effect.at)*effect.fps),slot=effect.loop?step%effect.frames.length:Math.min(step,effect.frames.length-1),frame=effect.frames[slot];
      result.sprites.push({id:effect.id,asset:effect.asset,x:effect.x,y:effect.y,width:effect.width,height:effect.height,opacity:effect.opacity??1,frame,column:frame%effect.columns,row:Math.floor(frame/effect.columns),columns:effect.columns,rows:effect.rows,frameWidth:effect.frameWidth,frameHeight:effect.frameHeight});
    }else{
      for(const particle of effect.particles){
        if(!effect.loop&&!before(elapsed,particle.lifetime,seconds))continue;
        const cycle=effect.loop?floorBoundary(elapsed/particle.lifetime,Math.max(seconds,effect.at)/particle.lifetime):0,age=Math.max(0,elapsed-cycle*particle.lifetime),progress=age/particle.lifetime;
        let opacity=effect.opacity??1;
        if(effect.fadeIn)opacity*=Math.min(1,progress/effect.fadeIn);
        if(effect.fadeOut)opacity*=Math.min(1,(1-progress)/effect.fadeOut);
        result.particles.push({id:`${effect.id}:${particle.index}`,effectId:effect.id,x:particle.x+particle.vx*age+.5*(effect.gravity?.x??0)*age*age,y:particle.y+particle.vy*age+.5*(effect.gravity?.y??0)*age*age,size:particle.size,opacity,color:particle.color,age,cycle});
      }
    }
  }
  result.filter=filters.join(' ');return result;
}

/** Pure evaluation returns detached values. Seeking or re-entering has no history. */
export function evaluatePresentation(story,sceneId,seconds){return evaluate(compile(story),sceneId,seconds);}

function imageURL(library,id,document){
  const value=library.resolve(id);if(typeof value!=='string'||!value)fail(`图集资源 ${id} 不可用`);
  let url;try{url=new URL(value,document.baseURI||'http://localhost/');}catch{fail(`图集资源 ${id} 地址无效`);}
  if(!['http:','https:','file:','blob:'].includes(url.protocol))fail(`图集资源 ${id} 地址协议不支持`);
  return url.href;
}

/** DOM projection with bounded keyed nodes, and no animation timers.
 * Story configuration is compiled once per object identity. Replace the story
 * object to apply a changed configuration. The resource resolver remains live.
 */
export class PresentationRenderer{
  constructor(container,library){
    if(!container?.ownerDocument||typeof container.appendChild!=='function'||typeof library?.resolve!=='function')fail('渲染容器或资源库无效');
    this.container=container;this.library=library;this.nodes=new Map();this.story=null;this.compiled=null;this.disposed=false;
    this.root=container.ownerDocument.createElement('div');this.root.className='presentation-effects';this.root.setAttribute('aria-hidden','true');
    Object.assign(this.root.style,{position:'absolute',inset:'0',overflow:'hidden',pointerEvents:'none'});container.appendChild(this.root);
  }
  node(key,className){let node=this.nodes.get(key);if(!node){node=this.container.ownerDocument.createElement('div');node.className=className;Object.assign(node.style,{position:'absolute',pointerEvents:'none'});this.root.appendChild(node);this.nodes.set(key,node);}return node;}
  sync(story,state){
    if(this.disposed)fail('效果渲染器已经关闭');
    if(story!==this.story){const next=compile(story);this.story=story;this.compiled=next;}
    const result=evaluate(this.compiled,state?.sceneId,state?.stageTime??state?.time),wanted=new Set();
    // Resolve all assets first, so missing resources do not partially replace a frame.
    const sprites=result.sprites.map(sprite=>({...sprite,url:imageURL(this.library,sprite.asset,this.container.ownerDocument)}));
    let order=0;
    for(const particle of result.particles){
      const key=`particle:${particle.id}`;wanted.add(key);const node=this.node(key,'presentation-particle');
      Object.assign(node.style,{left:`${particle.x}px`,top:`${particle.y}px`,width:`${particle.size}px`,height:`${particle.size}px`,opacity:String(particle.opacity),backgroundColor:particle.color,borderRadius:'50%',transform:'translate(-50%, -50%)',zIndex:String(order++)});
    }
    for(const sprite of sprites){
      const key=`sprite:${sprite.id}`;wanted.add(key);const node=this.node(key,'presentation-sprite');
      Object.assign(node.style,{left:`${sprite.x}px`,top:`${sprite.y}px`,width:`${sprite.width}px`,height:`${sprite.height}px`,opacity:String(sprite.opacity),backgroundImage:`url(${JSON.stringify(sprite.url)})`,backgroundRepeat:'no-repeat',backgroundSize:`${sprite.columns*sprite.width}px ${sprite.rows*sprite.height}px`,backgroundPosition:`${-sprite.column*sprite.width}px ${-sprite.row*sprite.height}px`,zIndex:String(order++)});
    }
    for(const [key,node]of this.nodes)if(!wanted.has(key)){node.remove();this.nodes.delete(key);}
    return result.filter;
  }
  dispose(){if(this.disposed)return;this.root.remove();this.nodes.clear();this.story=null;this.compiled=null;this.disposed=true;}
}
