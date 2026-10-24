import {ReaderPlayer,compileSceneCommands,validateReaderStory,validateReaderSnapshot} from './reader.js';
import {carryNativeEffects,nativeEffectsFor} from './native-effects.js';

const copy=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const forbidden=new Set(['__proto__','prototype','constructor']);
const MAX_TRACE=10000,MAX_STACK=64,MAX_HOPS=512,MAX_BACK_BLOCKS=256;
const fail=message=>{throw new Error(`剧情流程无效：${message}`);};
function fields(value,allowed,name){if(!plain(value))fail(`${name}必须是普通对象`);for(const key of Object.keys(value))if(!allowed.includes(key)||forbidden.has(key))fail(`${name}含未知字段 ${key}`);}
function nameOK(value,name){if(typeof value!=='string'||!value.trim()||value.length>512||/[\u0000-\u001f\u007f]/.test(value)||forbidden.has(value))fail(`${name}不是有效编号`);}
function primitive(value){return value===null||typeof value==='boolean'||finite(value)||typeof value==='string'&&value.length<=10000;}
function scopeOK(scope){if(!plain(scope)||Object.keys(scope).length>128)fail('变量目录无效');for(const [key,value] of Object.entries(scope)){if(!/^[_a-zA-Z][_a-zA-Z0-9]{0,63}$/.test(key)||forbidden.has(key)||['true','false','null'].includes(key)||!primitive(value))fail('变量名或初始值无效');}}
function stable(value,depth=0){if(depth>64)fail('数据嵌套过深');if(value===undefined)return 'null';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?`[${value.map(item=>stable(item,depth+1)).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key],depth+1)}`).join(',')}}`;}
function revision(story){const source=stable(story);let first=2166136261,second=5381;for(let index=0;index<source.length;index++){const code=source.charCodeAt(index);first=Math.imul(first^code,16777619);second=Math.imul(second,33)^code;}return `program-2:${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;}

// A deliberately small expression language. No JavaScript, members, calls or coercion.
const precedence={'||':1,'&&':2,'==':3,'!=':3,'===':3,'!==':3,'<':4,'<=':4,'>':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
function parseExpression(source,names){
  if(typeof source!=='string'||!source.trim()||source.length>4096)fail('表达式为空或过长');
  const tokens=[];let offset=0;
  while(offset<source.length){
    const rest=source.slice(offset),space=/^\s+/.exec(rest);if(space){offset+=space[0].length;continue;}
    let match;
    if(rest[0]==='"'){
      match=/^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(rest);if(!match)fail('字符串必须采用 JSON 双引号格式');
      tokens.push({kind:'literal',value:JSON.parse(match[0])});
    }else if((match=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))){const value=Number(match[0]);if(!finite(value))fail('数字必须有限');tokens.push({kind:'literal',value});}
    else if((match=/^[_a-zA-Z][_a-zA-Z0-9]*/.exec(rest))){const word=match[0];if(['true','false','null'].includes(word))tokens.push({kind:'literal',value:word==='null'?null:word==='true'});else {if(!names.has(word)||forbidden.has(word))fail(`未声明的变量 ${word}`);tokens.push({kind:'variable',value:word});}}
    else if((match=/^(?:===|!==|==|!=|<=|>=|&&|\|\||[()+\-*/%!<>])/.exec(rest)))tokens.push({kind:'operator',value:match[0]});
    else fail(`表达式中不支持 ${rest.slice(0,12)}`);
    offset+=match[0].length;if(tokens.length>256)fail('表达式过于复杂');
  }
  let cursor=0;
  function expression(min=0,depth=0){
    if(depth>64)fail('表达式嵌套过深');const token=tokens[cursor++];if(!token)fail('表达式不完整');let left;
    if(token.kind==='literal'||token.kind==='variable')left=token;
    else if(['!','-','+'].includes(token.value))left={kind:'unary',op:token.value,right:expression(7,depth+1)};
    else if(token.value==='('){left=expression(0,depth+1);if(tokens[cursor++]?.value!==')')fail('表达式缺少右括号');}
    else fail('表达式缺少操作数');
    while(cursor<tokens.length&&own(precedence,tokens[cursor].value)&&precedence[tokens[cursor].value]>=min){const op=tokens[cursor++].value;left={kind:'binary',op,left,right:expression(precedence[op]+1,depth+1)};}
    return left;
  }
  const ast=expression();if(cursor!==tokens.length)fail('表达式存在多余内容');return ast;
}
function boolean(value){if(typeof value!=='boolean')fail('条件必须得到布尔值');return value;}
function number(value){if(!finite(value))fail('算术运算需要有限数字');return value;}
function evaluate(ast,scope){
  if(ast.kind==='literal')return ast.value;if(ast.kind==='variable')return scope[ast.value];
  if(ast.kind==='unary'){const right=evaluate(ast.right,scope);return ast.op==='!'?!boolean(right):ast.op==='-'?-number(right):number(right);}
  const left=evaluate(ast.left,scope);if(ast.op==='&&')return boolean(left)&&boolean(evaluate(ast.right,scope));if(ast.op==='||')return boolean(left)||boolean(evaluate(ast.right,scope));const right=evaluate(ast.right,scope);let value;
  switch(ast.op){
    case '==':case '===':return left===right;case '!=':case '!==':return left!==right;
    case '<':case '<=':case '>':case '>=':if(typeof left!==typeof right||!['number','string'].includes(typeof left))fail('比较需要相同类型的数字或字符串');return ast.op==='<'?left<right:ast.op==='<='?left<=right:ast.op==='>'?left>right:left>=right;
    case '+':if(typeof left==='string'&&typeof right==='string')value=left+right;else value=number(left)+number(right);break;
    case '-':value=number(left)-number(right);break;case '*':value=number(left)*number(right);break;
    case '/':case '%':number(left);number(right);if(right===0)fail('不能除以零');value=ast.op==='/'?left/right:left%right;break;
    default:fail('不支持的运算符');
  }
  if(!primitive(value))fail('表达式结果超出支持范围');return value;
}
export function evaluateExpression(source,variables){scopeOK(variables);return evaluate(parseExpression(source,new Set(Object.keys(variables))),variables);}

export function validateProgramStory(story){
  validateReaderStory(story);return validateProgramFields(story);
}
function validateProgramFields(story){
  const program=story.program;fields(program,['version','entry','variables','nodes','mapEntries','entryMode'],'流程程序');if(program.version!==1)fail('流程版本不支持');if(program.entryMode!==undefined&&!['reset','carry'].includes(program.entryMode))fail('流程画面继承模式无效');scopeOK(program.variables);
  if(!plain(program.nodes)||!Object.keys(program.nodes).length||Object.keys(program.nodes).length>10000)fail('流程节点目录无效');
  const names=new Set(Object.keys(program.variables)),scenes=new Set(story.scenes.map(scene=>scene.id)),usedScenes=new Set();let instructions=0;
  function target(id){nameOK(id,'目标节点');if(!own(program.nodes,id))fail(`目标节点不存在 ${id}`);}
  function expr(source){parseExpression(source,names);}
  function descriptor(exit,depth=0){
    if(depth>32||++instructions>50000)fail('流程指令嵌套或数量超过限制');if(!plain(exit))fail('流程出口必须为对象');
    switch(exit.type){
      case 'end':case 'return':fields(exit,['type'],'流程出口');break;
      case 'goto':fields(exit,['type','target'],'跳转');target(exit.target);break;
      case 'call':fields(exit,['type','target','returnTo'],'调用');target(exit.target);target(exit.returnTo);break;
      case 'set':fields(exit,['type','assign','then'],'赋值');if(!plain(exit.assign)||!Object.keys(exit.assign).length)fail('赋值目录为空');for(const [name,source] of Object.entries(exit.assign)){if(!names.has(name)||forbidden.has(name))fail('赋值变量未声明');expr(source);}descriptor(exit.then,depth+1);break;
      case 'if':fields(exit,['type','branches','else'],'条件');if(!Array.isArray(exit.branches)||!exit.branches.length||exit.branches.length>128)fail('条件分支无效');for(const branch of exit.branches){fields(branch,['when','then'],'条件分支');expr(branch.when);descriptor(branch.then,depth+1);}descriptor(exit.else,depth+1);break;
      case 'choices':case 'signal':{
        fields(exit,exit.type==='choices'?['type','items']:['type','id','outcomes'],'交互出口');if(exit.type==='signal')nameOK(exit.id,'外部等待编号');
        const items=exit.type==='choices'?exit.items:exit.outcomes;if(!Array.isArray(items)||!items.length||items.length>128)fail('选项或完成结果目录无效');const ids=new Set();
        for(const item of items){fields(item,exit.type==='choices'?['id','label','when','then']:['id','label','then'],'选项');nameOK(item.id,'选项');if(ids.has(item.id))fail('选项编号重复');ids.add(item.id);if(typeof item.label!=='string'||!item.label.trim()||item.label.length>512)fail('选项文字无效');if(item.when!==undefined)expr(item.when);descriptor(item.then,depth+1);}break;
      }
      default:fail(`未实现的流程指令 ${String(exit.type)}`);
    }
  }
  target(program.entry);
  for(const [id,node] of Object.entries(program.nodes)){
    nameOK(id,'节点');fields(node,['sceneId','entryMode','exit'],'节点');if(!scenes.has(node.sceneId)||usedScenes.has(node.sceneId))fail('流程节点必须绑定唯一的已有场景');usedScenes.add(node.sceneId);
    if(!['reset','carry'].includes(node.entryMode))fail('入口模式应为 reset 或 carry');descriptor(node.exit);
  }
  if(program.nodes[program.entry].sceneId!==story.startScene)fail('流程初始节点与场景入口不一致');
  if(program.mapEntries!==undefined){if(!plain(program.mapEntries))fail('地图入口目录无效');for(const [sceneId,entry] of Object.entries(program.mapEntries)){if(!scenes.has(sceneId))fail('地图入口场景不存在');fields(entry,['node','variables','returnStack'],'地图入口');target(entry.node);if(program.nodes[entry.node].sceneId!==sceneId)fail('地图入口与流程节点不一致');if(entry.variables!==undefined){scopeOK(entry.variables);for(const [key,value] of Object.entries(entry.variables))if(!names.has(key)||typeof value!==typeof program.variables[key]||(value===null)!==(program.variables[key]===null))fail('入口变量没有声明或类型不一致');}if(entry.returnStack!==undefined){if(!Array.isArray(entry.returnStack)||entry.returnStack.length>MAX_STACK)fail('入口返回栈无效或超出限制');entry.returnStack.forEach(target);}}}
  revision(story);return story;
}

// Internal transitions and reconstructed map routes preserve evaluated art/media.
// This state is derived from canonical commands during save replay, never imported.
function carryEntry(state){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,copy(value[key])]));
  const media=(track,video=false)=>{
    const result=pick(track,['id','asset','loop','volume',...(video?['visible','x','y','width','height','opacity']:[])]);
    result.offset=track.position||0;
    if(track.duration!==undefined)result.duration=track.loop?track.duration:Math.max(.001,track.duration-Math.max(0,(state.stageTime||0)-(track.startAt||0)));
    return result;
  };
  return {...(state.nativeEffects?{nativeEffects:carryNativeEffects(state.nativeEffects,state.stageTime||0)}:{}),eventMode:state.eventMode===true,background:pick(state.background,['asset','opacity']),
    characters:(state.characters||[]).map(item=>pick(item,['id','asset','kind','layerName','x','y','width','height','scale','scaleX','scaleY','rotation','opacity','layer','pivotX','pivotY','flip','flipY','visible','layerId'])),
    layers:(state.layers||[]).map(item=>pick(item,['id','parentId','x','y','scale','scaleX','scaleY','rotation','opacity','layer','flip','flipY','visible'])),
    camera:pick(state.camera,['x','y','scale','rotation']),overlay:pick(state.overlay,['color','opacity']),
    dialogue:{textId:null,visible:false},audio:(state.audio||[]).map(item=>media(item)),
    video:state.video&&!state.video.ended?media(state.video,true):null};
}

function freshRun(){return globalThis.crypto.randomUUID();}
function checkRun(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail('运行编号无效');}

// Explore the declared flow language only. A route records decisions, never art,
// script payloads or expressions supplied by a progress document.
function routeStart(program,sourceSceneId,isolated=false){
  const entry=sourceSceneId===null?null:program.mapEntries?.[sourceSceneId];
  const isolatedNode=isolated?Object.keys(program.nodes).find(id=>program.nodes[id].sceneId===sourceSceneId):null;
  if(sourceSceneId!==null&&!entry&&!isolatedNode)fail('重建路径缺少已声明的章节入口');
  return {node:isolatedNode??entry?.node??program.entry,variables:{...program.variables,...entry?.variables},stack:copy(entry?.returnStack||[])};
}
function routeOptions(program,current){
  let budget=0;
  function walk(exit,variables,stack,picks=[]){
    if(++budget>50000)fail('路径出口超过重建限制');
    const expression=source=>evaluateExpression(source,variables);
    switch(exit.type){
      case 'end':return [];
      case 'goto':return [{node:exit.target,variables,stack,picks}];
      case 'call':if(stack.length>=MAX_STACK)return [];return [{node:exit.target,variables,stack:[...stack,exit.returnTo],picks}];
      case 'return':return stack.length?[{node:stack.at(-1),variables,stack:stack.slice(0,-1),picks}]:[];
      case 'set':{
        const assigned={};for(const [key,source] of Object.entries(exit.assign)){const value=expression(source);if(typeof value!==typeof program.variables[key]||(value===null)!==(program.variables[key]===null))fail('路径变量类型不一致');assigned[key]=value;}
        return walk(exit.then,{...variables,...assigned},stack,picks);
      }
      case 'if':{const branch=exit.branches.find(item=>boolean(expression(item.when)));return walk(branch?branch.then:exit.else,variables,stack,picks);}
      case 'choices':case 'signal':return (exit.type==='choices'?exit.items:exit.outcomes).filter(item=>item.when===undefined||boolean(expression(item.when))).flatMap(item=>walk(item.then,variables,stack,[...picks,item.id]));
      default:fail('路径含未知出口');
    }
  }
  return walk(program.nodes[current.node].exit,current.variables,current.stack);
}
const sourceOrderCache=new WeakMap();
function canonicalSources(program){
  if(sourceOrderCache.has(program))return sourceOrderCache.get(program);
  const incoming=new Set();
  const visit=exit=>{if(exit.target)incoming.add(exit.target);if(exit.returnTo)incoming.add(exit.returnTo);if(exit.then)visit(exit.then);if(exit.else)visit(exit.else);for(const item of [...(exit.branches||[]),...(exit.items||[]),...(exit.outcomes||[])])visit(item.then);};
  for(const node of Object.values(program.nodes))visit(node.exit);
  const entries=Object.keys(program.mapEntries||{}),independent=entries.filter(id=>!incoming.has(program.mapEntries[id].node));
  const result={independent,others:entries.filter(id=>!independent.includes(id))};sourceOrderCache.set(program,result);return result;
}
function findRoute(story,target,preferred){
  const program=story.program,targetNode=Object.keys(program.nodes).find(id=>program.nodes[id].sceneId===target);if(!targetNode)fail('场景没有可用的流程入口');
  if(preferred)return {...copy(preferred),preference:'visited'};
  const scene=story.scenes.find(item=>item.id===target),group=scene?.mapGroup;
  const sourceOrder=canonicalSources(program),sources=[null,...sourceOrder.independent,...sourceOrder.others.filter(id=>id!==group),...(group&&program.mapEntries?.[group]&&!sourceOrder.independent.includes(group)?[group]:[])];
  // Start at the actual game entry or a structurally independent flow root.
  // A chapter anchor with incoming edges must inherit its preceding chapters;
  // it is used cold only if no complete incoming route can be reconstructed.
  for(const sourceSceneId of sources){
    const first=routeStart(program,sourceSceneId),queue=[{...first,previous:null,step:null}],seen=new Set();let cursor=0;
    while(cursor<queue.length&&cursor<20000){
      const item=queue[cursor++],key=stable([item.node,item.variables,item.stack]);if(seen.has(key))continue;seen.add(key);
      if(item.node===targetNode){const steps=[];let previous=item;while(previous.previous){steps.push(previous.step);previous=previous.previous;}return {sourceSceneId,steps:steps.reverse(),preference:'canonical'};}
      for(const next of routeOptions(program,item))queue.push({...next,previous:item,step:{node:item.node,picks:next.picks}});
    }
  }
  // Unreachable script annotations / detached labels remain inspectable. Their
  // own explicit neutral entry is used, with no inherited branch actors.
  return {sourceSceneId:target,steps:[],preference:'isolated'};
}
function checkMapRoute(program,route){
  fields(route,['sourceSceneId','steps','preference'],'地图路径');if(route.sourceSceneId!==null&&typeof route.sourceSceneId!=='string')fail('章节路径入口无效');
  if(!['canonical','visited','isolated'].includes(route.preference)||!Array.isArray(route.steps)||route.steps.length>MAX_TRACE)fail('章节路径目录无效');
  if(route.preference==='isolated'&&(route.sourceSceneId===null||route.steps.length))fail('独立节点只能从自身入口开始');
  let current=routeStart(program,route.sourceSceneId,route.preference==='isolated');
  for(const step of route.steps){
    fields(step,['node','picks'],'路径节点');if(step.node!==current.node||!Array.isArray(step.picks)||step.picks.length>32||step.picks.some(id=>typeof id!=='string'))fail('路径节点或选择无效');
    const next=routeOptions(program,current).find(item=>stable(item.picks)===stable(step.picks));if(!next)fail('路径分支不符合当前变量或调用状态');current=next;
  }
  return current;
}

/** Control flow delegates every visual block and click gate to ReaderPlayer. */
export class ProgramPlayer{
  constructor(story,{onUpdate=()=>{},onEnd=()=>{},nativeEffects=null,nativeTiming=true}={}){
    // ReaderPlayer validates its public input and owns a detached private copy.
    // Flow and reader can share that copy without repeating validation or
    // copying the complete game again. Neither controller mutates the script.
    this._reader=new ReaderPlayer(story,{nativeEffects,nativeTiming});this._story=this._reader._story;validateProgramFields(this._story);this._program=this._story.program;this._revision=revision(this._story);this._onUpdate=onUpdate;this._onEnd=onEnd;this._ast=new Map();this._endNotified=false;this._arrivals=new Map();
    this._reset(null,freshRun());this._notify();
  }
  get story(){return copy(this._story);}get scene(){return this._reader.scene;}get playing(){return this._reader.playing;}get rate(){return this._reader.rate;}
  _expression(source){if(!this._ast.has(source))this._ast.set(source,parseExpression(source,new Set(Object.keys(this._program.variables))));return evaluate(this._ast.get(source),this._variables);}
  _reset(entrySceneId,runId,mapRoute=null){
    const route=entrySceneId===null?null:(mapRoute||findRoute(this._story,entrySceneId,this._arrivals.get(entrySceneId)));
    const start=routeStart(this._program,route?.sourceSceneId??null,route?.preference==='isolated');
    if(route){const end=checkMapRoute(this._program,route);if(this._program.nodes[end.node].sceneId!==entrySceneId)fail('地图路径终点与请求场景不一致');}
    this._invalidateDialogueHistory();this._nodeId=null;this._origin=entrySceneId;this._runId=runId;this._variables=start.variables;this._stack=start.stack;this._trace=[];this._backBlocks=[];this._serial=0;this._gate=null;this._phase='reader';this._endNotified=false;
    this._mapRoute=copy(route);this._routeSource=route?.sourceSceneId??null;this._routeWalk=[];this._pendingRouteStep=null;this._rebuilding=!!route;this._activate(start.node);
    if(route){for(const step of route.steps)this._canonicalStep(step);this._trace=[];this._rebuilding=false;if(route.preference!=='isolated')this._arrivals.set(entrySceneId,{sourceSceneId:route.sourceSceneId,steps:copy(route.steps),preference:route.preference});this._parkMapNode();}
    else this._settle();
  }
  _activate(nodeId){
    const playing=this.playing,rate=this.rate,entry=(this._program.nodes[nodeId].entryMode||this._program.entryMode)==='carry'&&this._nodeId?carryEntry(this._reader.state):null;
    if(this._pendingRouteStep){this._routeWalk.push(this._pendingRouteStep);this._pendingRouteStep=null;}
    this._historyBlockId=freshRun();this._nodeId=nodeId;this._phase='reader';this._gate=null;this._reader.enter(this._program.nodes[nodeId].sceneId,entry,{nativeTiming:this._reader._nativeTiming});this._reader.setRate(rate);if(playing)this._reader.play();
    if(!this._rebuilding&&(this._routeSource===null||this._program.mapEntries?.[this._routeSource]))this._arrivals.set(this._program.nodes[nodeId].sceneId,{sourceSceneId:this._routeSource,steps:copy(this._routeWalk),preference:'visited'});
  }
  _canonicalStep(step){
    if(this._nodeId!==step.node)fail('地图路径越过了指定节点');this._reader.completeCanonical();this._pendingRouteStep={node:this._nodeId,picks:[]};this._resolve(this._program.nodes[this._nodeId].exit,{count:0});
    for(const id of step.picks){if(!['choice','signal'].includes(this._phase))fail('地图路径选择缺少交互出口');const item=this._gate.items.find(item=>item.id===id);if(!item)fail('地图路径选择不可用');this._pendingRouteStep.picks.push(id);this._resolve(item.then,{count:0});}
    if(this._phase!=='reader')fail('地图路径未离开指定节点');
  }
  _parkMapNode(){
    if(!this._reader.state.ended)return;
    const exit=this._program.nodes[this._nodeId].exit;
    if(['choices','signal'].includes(exit.type)){this._finishBlock();this._pendingRouteStep={node:this._nodeId,picks:[]};this._resolve(exit,{count:0});}
    else this._phase='node';
  }
  _record(action){if(this._trace.length>=MAX_TRACE)fail('流程记录超过上限，请从地图入口重新开始');this._trace.push(copy(action));}
  _finishBlock(){
    // One small anchor per completed block points into the existing validated
    // trace. No story, per-frame state, or per-line art snapshot is retained.
    const anchor={historyId:this._historyBlockId,traceIndex:this._trace.length,nodeId:this._nodeId,variables:copy(this._variables),stack:copy(this._stack),serial:this._serial,walkLength:this._routeWalk.length,entry:copy(this._reader._entryOverride),hasDialogue:this._reader._dialogueIndices.some(index=>index>=this._reader._historyStart)};
    this._record({kind:'finish',reader:this._reader.snapshot()});
    if(!this._rebuilding){this._backBlocks.push(anchor);if(this._backBlocks.length>MAX_BACK_BLOCKS)this._backBlocks.shift();}
  }
  _resolve(exit,budget){
    if(++budget.count>MAX_HOPS)fail('连续流程超过限制，可能存在无等待循环');
    switch(exit.type){
      case 'end':this._phase='end';this._gate=null;return;
      case 'goto':this._activate(exit.target);return;
      case 'call':if(this._stack.length>=MAX_STACK)fail('子程序调用栈超过限制');this._stack.push(exit.returnTo);this._activate(exit.target);return;
      case 'return':if(!this._stack.length)fail('子程序返回时调用栈为空');this._activate(this._stack.pop());return;
      case 'set':{
        const assignments={};for(const [key,source] of Object.entries(exit.assign)){const value=this._expression(source),initial=this._program.variables[key];if(!primitive(value)||typeof value!==typeof initial||(value===null)!==(initial===null))fail(`变量 ${key} 的赋值类型不一致`);assignments[key]=value;}Object.assign(this._variables,assignments);this._resolve(exit.then,budget);return;
      }
      case 'if':for(const branch of exit.branches)if(boolean(this._expression(branch.when))){this._resolve(branch.then,budget);return;}this._resolve(exit.else,budget);return;
      case 'choices':{const available=exit.items.filter(item=>item.when===undefined||boolean(this._expression(item.when)));if(!available.length)fail('条件筛选后没有可选择的分支');this._phase='choice';this._gate={items:available};return;}
      case 'signal':this._phase='signal';this._gate={id:exit.id,token:`${this._runId}:${++this._serial}:${exit.id}`,items:exit.outcomes};return;
      default:fail('未知流程出口');
    }
  }
  _settle(){const budget={count:0};while(this._phase==='reader'&&this._reader.state.ended){this._finishBlock();this._pendingRouteStep={node:this._nodeId,picks:[]};this._resolve(this._program.nodes[this._nodeId].exit,budget);}}
  get state(){
    const state=this._reader.state;state.ended=this._phase==='end';if(this._phase!=='reader')state.waiting=this._phase==='end'?null:this._phase;
    state.choices=this._phase==='choice'?this._gate.items.map(({id,label})=>({id,label})):[];state.signal=this._phase==='signal'?{id:this._gate.id,token:this._gate.token,outcomes:this._gate.items.map(({id,label})=>({id,label}))}:null;
    state.program={nodeId:this._nodeId,variables:copy(this._variables),stackDepth:this._stack.length,entryMode:this._program.nodes[this._nodeId].entryMode||this._program.entryMode||'reset',mapRoute:this._mapRoute?{sourceSceneId:this._mapRoute.sourceSceneId,steps:this._mapRoute.steps.length,preference:this._mapRoute.preference}:null};
    Object.defineProperty(state,'readerSnapshot',{configurable:true,enumerable:false,get:()=>this.snapshot()});return state;
  }
  snapshot(){return {type:'story-player-program',schemaVersion:1,storyId:this._story.id,gameFingerprint:this._story.gameFingerprint,programRevision:this._revision,runId:this._runId,entrySceneId:this._origin,mapRoute:copy(this._mapRoute),trace:copy(this._trace),nodeId:this._nodeId,variables:copy(this._variables),stack:copy(this._stack),phase:this._phase,signalSerial:this._serial,reader:this._reader.snapshot(),...(this._reader._nativeTiming&&this._reader._nativeEffects?{nativeTimingRevision:this._reader._nativeEffects.revision}:{})};}
  _notify(){const state=this.state;this._onUpdate(state);if(state.ended&&!this._endNotified){this._endNotified=true;this._onEnd(state,this.scene);}}
  enter(sceneId){this._reader._nativeTiming=!!this._reader._nativeEffects;if(typeof sceneId!=='string')fail('地图场景编号无效');this._reset(sceneId,freshRun());this._reader.pause();this._notify();return this.state;}
  play(){this._reader.play();this._notify();return this.state;}pause(){this._reader.pause();this._notify();return this.state;}
  setNativeEffects(manifest){const snapshot=this.snapshot();this._reader.setNativeEffects(manifest,{notify:false});this.restore(snapshot);return this.state;}
  setTextSpeed(speed){this._reader.setTextSpeed(speed);this._notify();return this.state;}
  setRate(rate){this._reader.setRate(rate);this._notify();return this.state;}setTextLengths(lengths){this._reader.setTextLengths(lengths);this._notify();return this.state;}
  advance(seconds){this._reader.advance(seconds);this._settle();this._notify();return this.state;}
  next(){if(this._phase==='node'){this._phase='reader';this._settle();this._notify();return this._phase==='reader'?'advance':this._phase;}if(this._phase!=='reader'){this._notify();return this._phase==='end'?'end':this._phase;}const result=this._reader.next();this._settle();this._notify();return this._phase==='end'?'end':this._phase!=='reader'?this._phase:result==='end'?'advance':result;}
  canPreviousDialogue(){return this._reader.canPreviousDialogue()||this._backBlocks.some(block=>block.hasDialogue);}
  previousDialogue(){
    if(!this.canPreviousDialogue())return this.state;
    if(this._phase==='reader'&&this._reader.canPreviousDialogue())return this._rewindDialogueLocation(this._historyBlockId,this._reader._previousDialogueCommand());
    const anchor=this._backBlocks.findLast(block=>block.hasDialogue);if(!anchor)return this.state;
    const snapshot=this._trace[anchor.traceIndex].reader,scene=this._reader._scenes.get(snapshot.sceneId),commands=scene.commands||compileSceneCommands(scene);
    return this._rewindDialogueLocation(anchor.historyId,snapshot.executions.findLast(execution=>execution.commandIndex>=(snapshot.historyStart??0)&&commands[execution.commandIndex].type==='dialogue').commandIndex);
  }
  _invalidateDialogueHistory(){this._historyTokens=new Map();this._historyKeys=new Map();}
  getDialogueProgress(){return this._reader.getDialogueProgress();}
  getDialogueHistory(limit=30){
    if(!Number.isInteger(limit)||limit<0)fail('历史台词数量无效');limit=Math.min(30,limit);
    const found=[];
    const collect=(blockId,scene,commands,executions,excludeCurrent=false,historyStart=0)=>{
      let exclude=excludeCurrent;
      for(let index=executions.length-1;index>=0&&found.length<limit;index--){
        const execution=executions[index],command=commands[execution.commandIndex];if(command.type!=='dialogue'||execution.commandIndex<historyStart)continue;
        if(exclude){exclude=false;continue;}
        const event=scene.events[command.eventIndex];if(event.textId)found.push({blockId,commandIndex:execution.commandIndex,sceneId:scene.id,textId:event.textId,...(event.speaker?{speaker:event.speaker}:{})});
      }
    };
    collect(this._historyBlockId,this._reader._scene,this._reader._commands,this._reader._executions,true,this._reader._historyStart);
    for(let index=this._backBlocks.length-1;index>=0&&found.length<limit;index--){
      const anchor=this._backBlocks[index];if(!anchor.hasDialogue||anchor.historyId===this._historyBlockId)continue;
      const snapshot=this._trace[anchor.traceIndex].reader,scene=this._reader._scenes.get(snapshot.sceneId);
      collect(anchor.historyId,scene,scene.commands||compileSceneCommands(scene),snapshot.executions,false,snapshot.historyStart??0);
    }
    const keep=new Set(),descriptors=[];
    for(const {blockId,commandIndex,...descriptor} of found.reverse()){
      const key=`${blockId}:${commandIndex}`;let token=this._historyKeys.get(key);
      if(!token){token=freshRun();this._historyKeys.set(key,token);this._historyTokens.set(token,{blockId,commandIndex});}
      keep.add(key);descriptors.push({token,...descriptor});
    }
    for(const [key,token] of this._historyKeys)if(!keep.has(key)){this._historyKeys.delete(key);this._historyTokens.delete(token);}
    return descriptors;
  }
  rewindToDialogue(token){
    if(typeof token!=='string'||!this._historyTokens.has(token))fail('历史台词定位已失效');
    const {blockId,commandIndex}=this._historyTokens.get(token);return this._rewindDialogueLocation(blockId,commandIndex);
  }
  _rewindDialogueLocation(blockId,commandIndex){
    const rate=this.rate;
    // A pending exit has recorded its finish. Undo that exit before reopening
    // a line, so art, media, variables, choices and calls all run from that point.
    if(this._phase==='reader'&&blockId===this._historyBlockId)this._reader._rewindDialogueCommand(commandIndex);
    else{
      const anchorIndex=this._backBlocks.findIndex(block=>block.historyId===blockId),anchor=this._backBlocks[anchorIndex];
      if(!anchor)fail('历史台词定位已失效');
      const completed=this._trace[anchor.traceIndex].reader;
      this._backBlocks.length=anchorIndex;this._trace.length=anchor.traceIndex;this._nodeId=anchor.nodeId;this._variables=copy(anchor.variables);this._stack=copy(anchor.stack);this._serial=anchor.serial;
      this._routeWalk.length=anchor.walkLength;this._pendingRouteStep=null;this._phase='reader';this._gate=null;this._historyBlockId=anchor.historyId;
      this._reader._entryOverride=copy(anchor.entry);this._reader.restore(completed);this._reader._rewindDialogueCommand(commandIndex);
    }
    this._invalidateDialogueHistory();this._reader.setRate(rate);this._reader.pause();this._endNotified=false;this._notify();return this.state;
  }
  choose(id){
    if(this._phase!=='choice')fail('当前没有等待分支选择');const item=this._gate.items.find(item=>item.id===id);if(!item)fail('选项不存在或条件不满足');this._record({kind:'choice',id,reader:this._reader.snapshot()});this._pendingRouteStep.picks.push(id);this._gate=null;this._resolve(item.then,{count:0});this._settle();this._notify();return this.state;
  }
  completeSignal(token,outcomeId){
    if(this._phase!=='signal'||token!==this._gate.token)fail('外部完成令牌已失效');const outcome=this._gate.items.find(item=>item.id===outcomeId);if(!outcome)fail('外部完成结果没有列入允许目录');this._record({kind:'signal',token,outcomeId,reader:this._reader.snapshot()});this._pendingRouteStep.picks.push(outcomeId);this._gate=null;this._resolve(outcome.then,{count:0});this._settle();this._notify();return this.state;
  }
  previewDialogue(index,options){
    const state=this._reader.previewDialogue(index,options);
    const anchor=this._phase==='reader'?null:this._backBlocks.findLast(block=>block.historyId===this._historyBlockId);
    state.ended=false;state.choices=[];state.signal=null;
    state.program={nodeId:this._nodeId,variables:copy(anchor?.variables||this._variables),stackDepth:anchor?.stack.length??this._stack.length,entryMode:this._program.nodes[this._nodeId].entryMode||this._program.entryMode||'reset',mapRoute:this._mapRoute?{sourceSceneId:this._mapRoute.sourceSceneId,steps:this._mapRoute.steps.length,preference:this._mapRoute.preference}:null};
    return state;
  }
  commitDialogue(index){
    // Validate the requested position before undoing any already-recorded exit.
    this._reader._dialogueTarget(index);
    if(this._phase!=='reader'){
      const anchorIndex=this._backBlocks.findIndex(block=>block.historyId===this._historyBlockId),anchor=this._backBlocks[anchorIndex];
      if(!anchor)fail('当前片段没有可恢复的对白位置');
      const completed=this._trace[anchor.traceIndex].reader;
      this._backBlocks.length=anchorIndex;this._trace.length=anchor.traceIndex;this._nodeId=anchor.nodeId;this._variables=copy(anchor.variables);this._stack=copy(anchor.stack);this._serial=anchor.serial;
      this._routeWalk.length=anchor.walkLength;this._pendingRouteStep=null;this._phase='reader';this._gate=null;
      this._reader._entryOverride=copy(anchor.entry);this._reader.restore(completed);
    }
    this._reader.commitDialogue(index);this._invalidateDialogueHistory();this._endNotified=false;this._notify();return this.state;
  }
  // Canonical review is confined to the active block; its completed exit still executes.
  seek(seconds){if(this._phase!=='reader')fail('交互出口处不能校对定位，请重新进入场景');this._reader.seek(seconds);this._invalidateDialogueHistory();this._settle();this._notify();return this.state;}
  seekDialogue(index){if(this._phase!=='reader')fail('交互出口处不能校对定位，请重新进入场景');this._reader.seekDialogue(index);this._invalidateDialogueHistory();this._notify();return this.state;}
  restore(snapshot){const runner=replaySnapshot(this._story,snapshot,this._reader._nativeEffects);for(const key of ['_origin','_runId','_nodeId','_variables','_stack','_trace','_backBlocks','_serial','_gate','_phase','_mapRoute','_routeSource','_routeWalk','_pendingRouteStep','_arrivals','_historyBlockId'])this[key]=copy(runner[key]);this._invalidateDialogueHistory();this._reader._entryOverride=copy(runner._reader._entryOverride);this._reader.restore(runner._reader.snapshot());this._endNotified=this._phase==='end';runner.dispose();this._notify();return this.state;}
  dispose(){this._reader.dispose();this._onUpdate=()=>{};this._onEnd=()=>{};}
}

function replaySnapshot(story,doc,nativeEffects=null){
  fields(doc,['type','schemaVersion','storyId','gameFingerprint','programRevision','runId','entrySceneId','mapRoute','trace','nodeId','variables','stack','phase','signalSerial','reader','nativeTimingRevision'],'流程进度');
  if(doc.type!=='story-player-program'||doc.schemaVersion!==1)fail('不是支持的流程进度');if(doc.storyId!==story.id||doc.gameFingerprint!==story.gameFingerprint||doc.programRevision!==revision(story))fail('流程进度与当前演出包版本不匹配');checkRun(doc.runId);
  if(doc.entrySceneId!==null&&typeof doc.entrySceneId!=='string')fail('流程入口记录无效');if(!Array.isArray(doc.trace)||doc.trace.length>MAX_TRACE)fail('流程轨迹无效');
  if((doc.entrySceneId===null)!==(doc.mapRoute===null)||doc.mapRoute===undefined)fail('流程进度缺少可验证的地图路径');
  if(doc.nativeTimingRevision!==undefined)nativeEffects=nativeEffectsFor(story,doc.nativeTimingRevision);if((doc.reader.nativeTimingRevision??null)!==(doc.nativeTimingRevision??null))fail('流程与逐句时钟版本不一致');const runner=new ProgramPlayer(story,{nativeEffects,nativeTiming:!!doc.nativeTimingRevision});runner._reset(doc.entrySceneId,doc.runId,doc.mapRoute);let cursor=0,totalExecutions=0;
  // A completed block can keep animating and playing media while a choice or
  // external result is pending. Replay that dwell time before carrying state
  // into the next block, while accepting only the same completed commands.
  function restoreGateReader(snapshot,phase){
    if(runner._phase!==phase)fail('交互轨迹越过了对应的等待出口');if((snapshot.nativeTimingRevision??null)!==(doc.nativeTimingRevision??null))fail('交互等待的原作时钟版本不一致');
    const completed=runner._reader.snapshot(),checked=validateReaderSnapshot(story,snapshot,{validatedStory:true});
    if(checked.sceneId!==completed.sceneId||checked.wait!==null||checked.cursor!==completed.cursor||checked.forcedReveal!==completed.forcedReveal||stable(checked.executions)!==stable(completed.executions)||checked.stageTime<completed.stageTime||(checked.historyStart??0)!==(completed.historyStart??0))fail('交互等待记录与已完成的演出不一致');
    totalExecutions+=checked.executions.length;if(totalExecutions>500000)fail('流程轨迹过大');
    runner._reader.restore(checked);
  }
  // Automatic empty nodes can already have emitted finish records during reset/resolve.
  while(cursor<doc.trace.length){
    if(cursor<runner._trace.length){if(stable(doc.trace[cursor])!==stable(runner._trace[cursor]))fail('流程轨迹不符合已执行的指令');cursor++;continue;}
    const action=doc.trace[cursor];
    if(action?.kind==='finish'){
      fields(action,['kind','reader'],'完成轨迹');if(runner._phase==='node')runner._phase='reader';if(runner._phase!=='reader')fail('完成轨迹越过了选择或外部等待');if((action.reader.nativeTimingRevision??null)!==(doc.nativeTimingRevision??null))fail('完成轨迹的原作时钟版本不一致');const checked=validateReaderSnapshot(story,action.reader,{validatedStory:true});totalExecutions+=checked.executions.length;if(totalExecutions>500000)fail('流程轨迹过大');if(checked.sceneId!==runner.scene.id||checked.wait!==null)fail('完成轨迹中的场景或等待状态无效');runner._reader.restore(checked);if(!runner._reader.state.ended)fail('未结束的演出不能进入流程出口');runner._settle();
    }else if(action?.kind==='choice'){fields(action,['kind','id','reader'],'选择轨迹');restoreGateReader(action.reader,'choice');runner.choose(action.id);}
    else if(action?.kind==='signal'){fields(action,['kind','token','outcomeId','reader'],'完成结果轨迹');restoreGateReader(action.reader,'signal');runner.completeSignal(action.token,action.outcomeId);}
    else fail('未知的流程轨迹');
  }
  if(runner._trace.length!==doc.trace.length||stable(runner._trace)!==stable(doc.trace))fail('流程轨迹遗漏自动执行记录');
  if(doc.nodeId!==runner._nodeId||doc.phase!==runner._phase||doc.signalSerial!==runner._serial||stable(doc.variables)!==stable(runner._variables)||stable(doc.stack)!==stable(runner._stack))fail('流程状态与重放结果不一致');
  const current=validateReaderSnapshot(story,doc.reader,{validatedStory:true});if(current.sceneId!==runner.scene.id)fail('当前演出场景与流程不一致');
  if(runner._phase!=='reader'){
    const completed=runner._reader.snapshot();
    if(stable(current.executions)!==stable(completed.executions)||current.cursor!==completed.cursor||current.forcedReveal!==completed.forcedReveal||current.stageTime<completed.stageTime||(current.historyStart??0)!==(completed.historyStart??0))fail('交互出口处的演出记录与完成轨迹不一致');
  }
  runner._reader.restore(current);
  if(runner._phase==='reader'&&runner._reader.state.ended)fail('进度遗漏了场景完成后的流程');if(runner._phase!=='reader'&&!runner._reader.state.ended)fail('交互出口前的演出尚未完成');
  return runner;
}
export function validateProgramSnapshot(story,snapshot){validateProgramStory(story);const runner=replaySnapshot(story,snapshot);const result=runner.snapshot();runner.dispose();return result;}
