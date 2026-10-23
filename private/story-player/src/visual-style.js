// Flat DOM rendering of a validated, parented 2D scene. No browser globals required.
const IDENTITY=Object.freeze([1,0,0,1,0,0]);
const numericFields=['x','y','scale','scaleX','scaleY','rotation','opacity','layer'];
const fail=message=>{throw new Error(`画面变换无效：${message}`);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
function validateNumber(value,key){
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>100000)fail(`${key}必须是范围内的有限数字`);
  if(['width','height','scale','scaleX','scaleY'].includes(key)&&value<=0)fail(`${key}必须大于零`);
  if(['opacity','pivotX','pivotY'].includes(key)&&(value<0||value>1))fail(`${key}必须为0至1`);
}
function validateFields(value,actor=false){
  if(!object(value))fail('对象必须是普通字段集合');
  const fields=actor?[...numericFields,'width','height','pivotX','pivotY']:numericFields;
  const allowed=new Set(['id',...fields,'flip','flipY','visible',...(actor?['asset','layerId','kind','layerName']:['parentId'])]);
  for(const [key,entry] of Object.entries(value)){
    if(!allowed.has(key))fail(`不支持字段 ${key}`);
    if(entry===undefined)continue;
    if(fields.includes(key))validateNumber(entry,key);
    if(['flip','flipY','visible'].includes(key)&&typeof entry!=='boolean')fail(`${key}必须为布尔值`);
    if(key==='kind'&&!['character','background','sprite'].includes(entry))fail('角色类型无效');
    if(key==='layerName'&&!validId(entry))fail('原生图层名称无效');
  }
  const reference=actor?value.layerId:value.parentId;
  if(reference!==undefined&&reference!==null&&!validId(reference))fail('图层引用编号无效');
}
function multiply(a,b){
  const result=[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  if(!result.every(Number.isFinite))fail('复合变换超出有限数值范围');
  return result;
}
function localTransform(value,{actor=false}={}){
  const scale=value.scale??1,sx=scale*(value.scaleX??1)*(value.flip?-1:1),sy=scale*(value.scaleY??1)*(value.flipY?-1:1);
  const radians=(value.rotation??0)*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const a=cos*sx,b=sin*sx,c=-sin*sy,d=cos*sy;
  // Normalized Y pivots are bottom-up. Package coordinates themselves stay top-down.
  const px=actor?(value.pivotX??.5)*(value.width??360):0,py=actor?(1-(value.pivotY??.5))*(value.height??600):0;
  const x=value.x??(actor?400:0),y=value.y??(actor?90:0);
  return [a,b,c,d,x+px-a*px-c*py,y+py-b*px-d*py];
}
function layerResolver(layers){
  if(!Array.isArray(layers)||layers.length>256)fail('图层列表无效或超过256项');
  const byId=new Map(),cache=new Map(),visiting=new Set();
  for(const layer of layers){validateFields(layer);if(!validId(layer.id)||byId.has(layer.id))fail('图层编号无效或重复');byId.set(layer.id,layer);}
  for(const layer of layers){
    const seen=new Set([layer.id]);let current=layer;
    while(current.parentId!==undefined&&current.parentId!==null){
      if(!byId.has(current.parentId))fail(`图层不存在 ${current.parentId}`);
      if(seen.has(current.parentId))fail('图层父子关系存在循环');
      seen.add(current.parentId);if(seen.size>64)fail('图层层级超过64');current=byId.get(current.parentId);
    }
  }
  const root={matrix:[...IDENTITY],opacity:1,visible:true,layer:0};
  const resolve=(id,depth=0)=>{
    if(id===undefined||id===null)return root;
    if(!byId.has(id))fail(`图层不存在 ${id}`);
    if(visiting.has(id))fail('图层父子关系存在循环');
    if(depth>=64)fail('图层层级超过64');
    if(cache.has(id))return cache.get(id);
    visiting.add(id);const layer=byId.get(id),parent=resolve(layer.parentId,depth+1);
    const result={matrix:multiply(parent.matrix,localTransform(layer)),opacity:parent.opacity*(layer.opacity??1),visible:parent.visible&&layer.visible!==false,layer:parent.layer+(layer.layer??0)};
    visiting.delete(id);cache.set(id,result);return result;
  };
  // Validate even unrelated layers, so an unsupported tree never renders partially.
  for(const id of byId.keys())resolve(id);
  return resolve;
}

/** Returns [a,b,c,d,e,f] mapping image-local pixels to scene pixels. */
export function resolveActorVisual(actor,layers=[]){
  validateFields(actor,true);const parent=layerResolver(layers)(actor.layerId);
  return {matrix:multiply(parent.matrix,localTransform(actor,{actor:true})),opacity:parent.opacity*(actor.opacity??1),visible:parent.visible&&actor.visible!==false,layer:parent.layer+(actor.layer??1),width:actor.width??360,height:actor.height??600};
}

/** Resolves a named layer through all ancestors. A null id means the scene root. */
export function resolveLayerVisual(layerId,layers=[]){return structuredClone(layerResolver(layers)(layerId));}

const matrixString=matrix=>`matrix(${matrix.map(value=>Math.abs(value)<1e-12?0:Number(value.toPrecision(14))).join(',')})`;
function styleFor(visual){return {left:'0px',top:'0px',opacity:String(visual.opacity),visibility:visual.visible?'visible':'hidden',zIndex:String(Math.round(visual.layer)),transformOrigin:'0px 0px',transform:matrixString(visual.matrix)};}

/** Apply to an absolutely positioned image in a scene-sized flat actor container. */
export function actorVisualStyle(actor,layers=[]){const visual=resolveActorVisual(actor,layers);return {...styleFor(visual),width:`${visual.width}px`,height:`${visual.height}px`};}

/** Apply only to a standalone flat layer visualization, never also to an actor's parent. */
export function layerVisualStyle(layerId,layers=[]){return styleFor(resolveLayerVisual(layerId,layers));}
