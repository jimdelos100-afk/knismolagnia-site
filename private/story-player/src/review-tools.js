import {validatePlaybackStory,validatePlaybackSnapshot,graphStory} from './playback.js';
import {layoutGraph} from './graph.js';
import {validatePresentation} from './effects.js';

const SCOPE='independent-neutral-story';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(`校对文档无效：${message}`);};
const copy=value=>structuredClone(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const issue=(severity,code,message,extra={})=>({severity,code,message,...extra});
const statusOf=issues=>issues.some(item=>item.severity==='error')?'failed':issues.some(item=>item.severity==='warning')?'needs-review':'passed';
const counts=issues=>({errors:issues.filter(item=>item.severity==='error').length,warnings:issues.filter(item=>item.severity==='warning').length,infos:issues.filter(item=>item.severity==='info').length});
function string(value,name,max=512,{empty=false}={}){if(typeof value!=='string'||value.length>max||!empty&&!value.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(`${name}无效`);return value;}
function fields(value,allowed,name){if(!plain(value))fail(`${name}必须为对象`);for(const key of Object.keys(value))if(!allowed.includes(key))fail(`${name}含不支持的字段 ${key}`);}
function timestamp(value){const date=value===undefined?new Date():value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))fail('时间无效');return date.toISOString();}

// A deterministic revision identifier, not a cryptographic signature or authorization token.
function canonical(value,seen=new Set(),depth=0,budget={count:0}){
  if(++budget.count>600000||depth>64)fail('文档超过结构限制');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))fail('含非有限数字');return JSON.stringify(value);}
  if(typeof value!=='object'||seen.has(value))fail('含不支持的值或循环引用');
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)fail('含非普通对象');
  seen.add(value);let result;
  if(Array.isArray(value))result=`[${Array.from(value,item=>canonical(item,seen,depth+1,budget)).join(',')}]`;
  else result=`{${Object.keys(value).sort().map(key=>{if(['__proto__','prototype','constructor'].includes(key))fail('含不支持的字段名称');return `${JSON.stringify(key)}:${canonical(value[key],seen,depth+1,budget)}`;}).join(',')}}`;
  seen.delete(value);return result;
}
function digest(value){const source=canonical(value);let a=2166136261,b=5381,c=0x9e3779b9,d=0x85ebca6b;for(let n=0;n<source.length;n++){const v=source.charCodeAt(n);a=Math.imul(a^v,16777619);b=Math.imul(b,33)^v;c=Math.imul(c^v,0x5bd1e995);d=Math.imul(d+v,0x27d4eb2d);}return [a,b,c,d].map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');}
const revision=story=>`review-source-1:${digest(story)}`;
const visibleText=source=>source.replace(/<\/?(?:b|i|u|color|size)(?:=[^>]*)?>|<br\s*\/?>/gi,'');

/** Static potential reachability only; conditions, call stacks and all timing paths require manual runs. */
export function auditStory(story,{expectedEndings=[],longDialogueLimit=160}={}){
  const issues=[],scenes=[];
  const add=(severity,code,message,sceneId)=>{const entry=issue(severity,code,message,sceneId?{sceneId}:{});issues.push(entry);scenes.find(scene=>scene.id===sceneId)?.issues.push(entry);};
  const finish=valid=>({ok:!issues.some(entry=>entry.severity==='error'),summary:{validation:valid?'valid':'invalid',scenes:scenes.length,dialogues:scenes.reduce((sum,scene)=>sum+scene.dialogues,0),reachable:scenes.filter(scene=>scene.reachable===true).length,unreachable:scenes.filter(scene=>scene.reachable===false).length,...counts(issues)},scenes,issues});
  try{if(!Array.isArray(expectedEndings)||expectedEndings.some(id=>typeof id!=='string')||!Number.isInteger(longDialogueLimit)||longDialogueLimit<1||longDialogueLimit>1000000)fail('静态检查选项无效');validatePlaybackStory(story);}catch(error){add('error','INVALID_STORY',error.message);return finish(false);}
  try{validatePresentation(story);}catch(error){add('error','INVALID_PRESENTATION',error.message);return finish(false);}
  for(const scene of story.scenes)scenes.push({id:scene.id,title:scene.title,dialogues:scene.events.filter(event=>event.type==='dialogue').length,reachable:false,issues:[]});
  const sceneById=new Map(story.scenes.map(scene=>[scene.id,scene])),edges=new Map(story.scenes.map(scene=>[scene.id,new Set()])),texts=new Map(story.texts.map(text=>[text.id,text]));
  for(const id of expectedEndings)if(!sceneById.has(id))add('error','ENDING_SCENE_MISSING',`声明的结尾场景不存在：${id}`);
  try{layoutGraph(graphStory(story));}catch(error){add('error','INVALID_MAP',error.message);}
  let start=story.startScene;
  if(story.program){
    const {nodes}=story.program,returns=new Set();let conditional=false,hasReturn=false;
    const collect=exit=>{if(exit.type==='call')returns.add(exit.returnTo);if(exit.type==='if'||exit.type==='choices'&&exit.items.some(item=>item.when))conditional=true;if(exit.then)collect(exit.then);for(const branch of exit.branches||[])collect(branch.then);if(exit.else)collect(exit.else);for(const item of [...(exit.items||[]),...(exit.outcomes||[])])collect(item.then);};
    Object.values(nodes).forEach(node=>collect(node.exit));
    const visit=(from,exit)=>{const edge=target=>edges.get(from).add(nodes[target].sceneId);if(exit.type==='goto')edge(exit.target);else if(exit.type==='call'){edge(exit.target);edge(exit.returnTo);}else if(exit.type==='return'){hasReturn=true;for(const target of returns)edge(target);}else if(exit.type==='set')visit(from,exit.then);else if(exit.type==='if'){for(const branch of exit.branches)visit(from,branch.then);if(exit.else)visit(from,exit.else);}else if(exit.type==='choices'||exit.type==='signal')for(const item of exit.items||exit.outcomes)visit(from,item.then);};
    Object.values(nodes).forEach(node=>visit(node.sceneId,node.exit));start=nodes[story.program.entry].sceneId;
    for(const scene of story.scenes)if(scene.mapGroup!==undefined&&(!sceneById.has(scene.mapGroup)||sceneById.get(scene.mapGroup).mapGroup!==undefined&&sceneById.get(scene.mapGroup).mapGroup!==scene.mapGroup))add('error','INVALID_MAP_GROUP','地图分组没有有效的可见代表场景。',scene.id);
    for(const scene of graphStory(story).scenes)if(!own(story.program.mapEntries||{},scene.id))add('warning','MAP_ENTRY_UNDECLARED','此地图节点未声明独立入口变量和返回上下文，请人工确认直接进入后的流程。',scene.id);
    if(conditional)add('info','CONDITIONS_NOT_EXECUTED','可达性按所有声明的分支计算，不代表各分支的运行条件均可满足。');
    if(hasReturn)add('info','RETURN_FLOW_APPROXIMATED','返回连线按声明的所有调用位置估算，未证明每条路径的调用栈正确。');
    add('info','RUNTIME_PATHS_NOT_EXECUTED','静态检查不执行完整流程；无等待循环、表达式运行结果和演出时序仍需实际检查。');
  }else for(const scene of story.scenes){
    if(scene.next)edges.get(scene.id).add(scene.next);for(const choice of scene.choices||[])edges.get(scene.id).add(choice.target);
    if(!edges.get(scene.id).size&&!expectedEndings.includes(scene.id))add('warning','ENDING_UNCONFIRMED','此节点没有后续场景，请确认它是有意的结尾。',scene.id);
    if(scene.next&&scene.choices?.length)add('warning','AMBIGUOUS_CONTINUATION','此节点同时声明自动后续和可选分支，请确认预期交互。',scene.id);
  }
  const reachable=new Set(),pending=[start];while(pending.length){const id=pending.pop();if(reachable.has(id))continue;reachable.add(id);for(const target of edges.get(id)||[])pending.push(target);}
  for(const scene of story.scenes){
    scenes.find(item=>item.id===scene.id).reachable=reachable.has(scene.id);if(!reachable.has(scene.id))add('warning','UNREACHABLE_SCENE','从起始节点没有声明的可达路径；地图预览入口不计入主流程可达性。',scene.id);
    const ids=new Set(scene.events.filter(event=>event.type==='dialogue').map(event=>event.textId));if(scene.entry.dialogue?.visible&&scene.entry.dialogue.textId)ids.add(scene.entry.dialogue.textId);
    for(const textId of ids){const length=Array.from(visibleText(texts.get(textId)?.source||'')).length;if(length>longDialogueLimit)add('warning','LONG_DIALOGUE',`对白 ${textId} 有 ${length} 个字符，超过 ${longDialogueLimit}；请在实际画面确认换行与溢出。`,scene.id);}
  }
  return finish(true);
}

function checkedCheckpoint(story,document){
  fields(document,['type','schemaVersion','scope','id','storyId','sourceFingerprint','storyRevision','sceneId','label','savedAt','paused','snapshot'],'检查点');canonical(document);
  if(document.type!=='neutral-story-review-checkpoint'||document.schemaVersion!==1||document.scope!==SCOPE)fail('不支持的检查点类型或版本');
  validatePlaybackStory(story);const sourceRevision=revision(story);
  if(document.storyId!==story.id||document.sourceFingerprint!==story.gameFingerprint||document.storyRevision!==sourceRevision)fail('检查点与当前作品或完整源码版本不匹配');
  validatePresentation(story);
  string(document.label,'标签',200);string(document.sceneId,'场景编号');
  if(document.paused!==true||typeof document.savedAt!=='string'||timestamp(document.savedAt)!==document.savedAt)fail('检查点必须暂停保存且使用标准时间');
  const snapshot=validatePlaybackSnapshot(story,document.snapshot),sceneId=snapshot.type==='story-player-program'?snapshot.reader.sceneId:snapshot.sceneId;
  if(sceneId!==document.sceneId)fail('检查点场景与逐句进度不一致');
  const id=`review-1:${digest({storyId:story.id,sourceFingerprint:story.gameFingerprint,storyRevision:sourceRevision,snapshot})}`;
  if(document.id!==id)fail('检查点编号与内容不匹配');
  return {type:document.type,schemaVersion:1,scope:SCOPE,id,storyId:story.id,sourceFingerprint:story.gameFingerprint,storyRevision:sourceRevision,sceneId,label:document.label,savedAt:document.savedAt,paused:true,snapshot};
}

/** Captures a validated snapshot without pausing, advancing or otherwise changing the live player. */
export function createReviewCheckpoint(story,player,{label='未命名检查点',now}={}){
  validatePlaybackStory(story);validatePresentation(story);if(!player||typeof player.snapshot!=='function')fail('播放器不支持保存检查点');
  const snapshot=validatePlaybackSnapshot(story,player.snapshot()),sourceRevision=revision(story),sceneId=snapshot.type==='story-player-program'?snapshot.reader.sceneId:snapshot.sceneId;
  const core={storyId:story.id,sourceFingerprint:story.gameFingerprint,storyRevision:sourceRevision,snapshot};
  return checkedCheckpoint(story,{type:'neutral-story-review-checkpoint',schemaVersion:1,scope:SCOPE,id:`review-1:${digest(core)}`,...core,sceneId,label,savedAt:timestamp(now),paused:true});
}

/** No player is touched here. Only pass the returned .snapshot to restore after this succeeds. */
export function parseReviewCheckpoint(story,document){return checkedCheckpoint(story,document);}

function cleanedIssue(raw){
  fields(raw,['severity','code','message','sceneId','assetId','selector'],'问题记录');if(!['error','warning','info'].includes(raw.severity))fail('问题严重级别无效');
  const result={severity:raw.severity,code:string(raw.code,'问题编号',100),message:string(raw.message,'问题说明',4000)};
  for(const key of ['sceneId','assetId','selector'])if(raw[key]!==undefined)result[key]=string(raw[key],key,512);return result;
}
function resourceSection(story,resources){
  if(resources===undefined||resources===null)return {status:'unchecked',total:story.assets.length,available:0,results:[],issues:[issue('warning','RESOURCES_UNCHECKED','资源尚未检查。')]};
  const issues=[],results=[];
  if(!plain(resources)||resources.storyId!==story.id||resources.gameFingerprint!==story.gameFingerprint||!Array.isArray(resources.results)||resources.results.length!==story.assets.length)return {status:'failed',total:story.assets.length,available:0,results,issues:[issue('error','INVALID_RESOURCE_AUDIT','资源审计与当前作品不匹配，或未覆盖全部资源。')]};
  const known=new Map(story.assets.map(asset=>[asset.id,asset.type])),seen=new Set();
  for(const raw of resources.results){
    if(!plain(raw)||!known.has(raw.id)||seen.has(raw.id)||known.get(raw.id)!==raw.type||!['available','missing','size-mismatch','hash-mismatch','type-mismatch','error'].includes(raw.status)){issues.push(issue('error','INVALID_RESOURCE_RESULT','资源审计含未知、重复或无效的资源记录。'));continue;}
    seen.add(raw.id);const result={id:raw.id,type:raw.type,status:raw.status};if(typeof raw.path==='string')result.path=string(raw.path,'资源路径',4096);if(typeof raw.message==='string')result.message=string(raw.message,'资源说明',4000,{empty:true});
    for(const key of ['expectedSize','actualSize'])if(Number.isSafeInteger(raw[key])&&raw[key]>=0)result[key]=raw[key];results.push(result);
    if(raw.status!=='available')issues.push(issue('error',`RESOURCE_${raw.status.toUpperCase().replaceAll('-','_')}`,result.message||`资源检查失败：${raw.id}（${raw.status}）`,{assetId:raw.id}));
  }
  return {status:statusOf(issues),total:story.assets.length,available:results.filter(result=>result.status==='available').length,results,issues};
}
function renderSection(rendered){
  if(rendered===undefined||rendered===null)return {status:'unchecked',checked:{texts:0,images:0,videos:0},issues:[issue('warning','RENDER_UNCHECKED','当前画面尚未检查。')]};
  if(!plain(rendered)||!plain(rendered.checked)||!Array.isArray(rendered.issues))fail('画面检查结果格式无效');
  const checked={};for(const key of ['texts','images','videos']){if(!Number.isInteger(rendered.checked[key])||rendered.checked[key]<0||rendered.checked[key]>100000)fail('画面检查数量无效');checked[key]=rendered.checked[key];}
  const issues=rendered.issues.map(cleanedIssue);if(!Object.values(checked).some(Boolean))issues.push(issue('warning','RENDER_NOT_VISIBLE','没有可检查的可见文字或媒体。'));
  return {status:Object.values(checked).some(Boolean)?statusOf(issues):'unchecked',checked,issues,limitations:['仅检查一次当前可见 DOM；不代表所有场景、CSS 背景、音轨或全部媒体帧已经检查。']};
}

/** A report is complete only after static, asset, visible-frame and manual checkpoint checks all pass. */
export function createReviewReport(story,{resources,rendered,checkpoints=[],expectedEndings=[],longDialogueLimit=160,now}={}){
  validatePlaybackStory(story);const staticReport=auditStory(story,{expectedEndings,longDialogueLimit}),assetReport=resourceSection(story,resources),frameReport=renderSection(rendered);
  if(!Array.isArray(checkpoints)||checkpoints.length>10000)fail('人工检查点列表无效');const records=[],manualIssues=[],seen=new Set(),sceneIds=new Set(story.scenes.map(scene=>scene.id));
  for(const raw of checkpoints){fields(raw,['id','label','status','sceneId','notes'],'人工检查点');const record={id:string(raw.id,'检查点编号'),label:string(raw.label,'检查点标签',200),status:raw.status};if(seen.has(record.id)||!['pending','passed','failed'].includes(record.status))fail('人工检查点重复或状态无效');seen.add(record.id);
    if(raw.sceneId!==undefined){if(!sceneIds.has(raw.sceneId))fail('人工检查点场景不存在');record.sceneId=raw.sceneId;}if(raw.notes!==undefined)record.notes=string(raw.notes,'检查备注',4000,{empty:true});records.push(record);
    if(record.status!=='passed')manualIssues.push(issue(record.status==='failed'?'error':'warning',record.status==='failed'?'MANUAL_CHECK_FAILED':'MANUAL_CHECK_PENDING',`人工检查点「${record.label}」${record.status==='failed'?'未通过':'尚未确认'}。`,record.sceneId?{sceneId:record.sceneId}:{}));
  }
  if(!records.length)manualIssues.push(issue('warning','MANUAL_UNCHECKED','尚无人工检查点记录；不能认定剧情演出已经验收。'));
  const manualStatus=!records.length?'unchecked':statusOf(manualIssues),staticStatus=statusOf(staticReport.issues),issues=[...staticReport.issues,...assetReport.issues,...frameReport.issues,...manualIssues],statuses=[staticStatus,assetReport.status,frameReport.status,manualStatus],ok=statuses.every(status=>status==='passed');
  return {type:'neutral-story-review-report',schemaVersion:1,scope:SCOPE,scopeNotice:'仅用于独立通用剧情项目的自检；不是任何其他作品的还原、全路径覆盖或逐帧一致性证明。',storyId:story.id,sourceFingerprint:story.gameFingerprint,storyRevision:revision(story),createdAt:timestamp(now),ok,summary:{status:ok?'passed':statuses.includes('failed')?'failed':'incomplete',staticStatus,resourcesStatus:assetReport.status,renderedStatus:frameReport.status,manualStatus,...counts(issues)},static:staticReport,resources:assetReport,rendered:frameReport,checkpoints:records,issues};
}

/** Reads visible DOM layout and native decode status; never advances media or mutates nodes. */
export function inspectRenderedStage(stage){
  if(!stage||typeof stage.querySelectorAll!=='function'||typeof stage.getBoundingClientRect!=='function')fail('画面容器不是可读取的 DOM 元素');
  const issues=[],checked={texts:0,images:0,videos:0},view=stage.ownerDocument?.defaultView,style=element=>view?.getComputedStyle?.(element);
  const visible=element=>{for(let node=element;node;node=node.parentElement){if(node.hidden)return false;const css=style(node);if(css&&(css.display==='none'||['hidden','collapse'].includes(css.visibility)||Number(css.opacity)===0))return false;if(node===stage)break;}const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0;};
  const selector=element=>element.id?`#${element.id}`:String(element.tagName||'element').toLowerCase();
  const add=(severity,code,message,element)=>issues.push(issue(severity,code,message,{selector:selector(element)}));
  const stageRect=stage.getBoundingClientRect();
  for(const element of stage.querySelectorAll('[data-review-text], [data-review-overflow], .dialogue-text, #dialogueText')){
    if(!visible(element))continue;checked.texts++;const rect=element.getBoundingClientRect();
    if(element.clientWidth>0&&element.scrollWidth>element.clientWidth+1||element.clientHeight>0&&element.scrollHeight>element.clientHeight+1)add('warning','TEXT_OVERFLOW','当前文字超出文字框，请检查换行、字号和显示范围。',element);
    if(rect.left<stageRect.left-1||rect.right>stageRect.right+1||rect.top<stageRect.top-1||rect.bottom>stageRect.bottom+1)add('warning','TEXT_OUTSIDE_STAGE','当前文字框部分超出演出画面。',element);
  }
  for(const element of stage.querySelectorAll('img')){
    if(!visible(element))continue;checked.images++;const source=element.currentSrc||element.getAttribute('src');
    if(!source)add('error','IMAGE_SOURCE_MISSING','可见图片没有资源地址。',element);
    else if(!element.complete)add('warning','IMAGE_PENDING','当前图片尚未完成载入，不能确认解码成功。',element);
    else if(!(element.naturalWidth>0&&element.naturalHeight>0))add('error','IMAGE_DECODE_FAILED','当前图片已结束载入，但未成功解码。',element);
  }
  for(const element of stage.querySelectorAll('video')){
    if(!visible(element))continue;checked.videos++;
    if(element.error)add('error','VIDEO_DECODE_FAILED','当前视频报告媒体错误。',element);
    else if(!(element.readyState>=2&&element.videoWidth>0&&element.videoHeight>0))add('warning','VIDEO_PENDING','当前视频尚无可解码画面。',element);
  }
  return {ok:!issues.some(entry=>entry.severity==='error'),checked,issues,limitations:['仅检查当前可见 DOM 中标记的文字框、img 与 video。','CSS 背景图、音轨、未进入的场景和所有媒体帧未由此函数验证。']};
}
