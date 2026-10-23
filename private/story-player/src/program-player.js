import {ReaderPlayer,validateReaderStory,validateReaderSnapshot} from './reader.js';

const copy=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const forbidden=new Set(['__proto__','prototype','constructor']);
const MAX_TRACE=10000,MAX_STACK=64,MAX_HOPS=512;
const fail=message=>{throw new Error(`剧情流程无效：${message}`);};
function fields(value,allowed,name){if(!plain(value))fail(`${name}必须是普通对象`);for(const key of Object.keys(value))if(!allowed.includes(key)||forbidden.has(key))fail(`${name}含未知字段 ${key}`);}
function nameOK(value,name){if(typeof value!=='string'||!value.trim()||value.length>512||/[\u0000-\u001f\u007f]/.test(value)||forbidden.has(value))fail(`${name}不是有效编号`);}
function primitive(value){return value===null||typeof value==='boolean'||finite(value)||typeof value==='string'&&value.length<=10000;}
function scopeOK(scope){if(!plain(scope)||Object.keys(scope).length>128)fail('变量目录无效');for(const [key,value] of Object.entries(scope)){if(!/^[_a-zA-Z][_a-zA-Z0-9]{0,63}$/.test(key)||forbidden.has(key)||['true','false','null'].includes(key)||!primitive(value))fail('变量名或初始值无效');}}
function stable(value,depth=0){if(depth>64)fail('数据嵌套过深');if(value===undefined)return 'null';if(value===null||typeof value!=='object')return JSON.stringify(value);return Array.isArray(value)?`[${value.map(item=>stable(item,depth+1)).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key],depth+1)}`).join(',')}}`;}
function revision(story){const source=stable(story);let first=2166136261,second=5381;for(let index=0;index<source.length;index++){const code=source.charCodeAt(index);first=Math.imul(first^code,16777619);second=Math.imul(second,33)^code;}return `program-1:${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;}

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
  validateReaderStory(story);const program=story.program;fields(program,['version','entry','variables','nodes','mapEntries','entryMode'],'流程程序');if(program.version!==1)fail('流程版本不支持');if(program.entryMode!==undefined&&!['reset','carry'].includes(program.entryMode))fail('流程画面继承模式无效');scopeOK(program.variables);
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

// Internal flow transitions preserve evaluated art and media. Map entries reset.
// This state is derived from canonical commands during save replay, never imported.
function carryEntry(state){
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,copy(value[key])]));
  const media=(track,video=false)=>{
    const result=pick(track,['id','asset','loop','volume',...(video?['visible','x','y','width','height','opacity']:[])]);
    result.offset=track.position||0;
    if(track.duration!==undefined)result.duration=track.loop?track.duration:Math.max(.001,track.duration-Math.max(0,(state.stageTime||0)-(track.startAt||0)));
    return result;
  };
  return {background:pick(state.background,['asset','opacity']),
    characters:(state.characters||[]).map(item=>pick(item,['id','asset','x','y','width','height','scale','scaleX','scaleY','rotation','opacity','layer','pivotX','pivotY','flip','flipY','visible','layerId'])),
    layers:(state.layers||[]).map(item=>pick(item,['id','parentId','x','y','scale','scaleX','scaleY','rotation','opacity','layer','flip','flipY','visible'])),
    camera:pick(state.camera,['x','y','scale','rotation']),overlay:pick(state.overlay,['color','opacity']),
    dialogue:{textId:null,visible:false},audio:(state.audio||[]).map(item=>media(item)),
    video:state.video&&!state.video.ended?media(state.video,true):null};
}

function freshRun(){return globalThis.crypto.randomUUID();}
function checkRun(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail('运行编号无效');}

/** Control flow delegates every visual block and click gate to ReaderPlayer. */
export class ProgramPlayer{
  constructor(story,{onUpdate=()=>{},onEnd=()=>{}}={}){
    validateProgramStory(story);this._story=copy(story);this._program=this._story.program;this._revision=revision(this._story);this._onUpdate=onUpdate;this._onEnd=onEnd;this._reader=new ReaderPlayer(this._story);this._ast=new Map();this._endNotified=false;
    this._reset(null,freshRun());this._notify();
  }
  get story(){return copy(this._story);}get scene(){return this._reader.scene;}get playing(){return this._reader.playing;}get rate(){return this._reader.rate;}
  _expression(source){if(!this._ast.has(source))this._ast.set(source,parseExpression(source,new Set(Object.keys(this._program.variables))));return evaluate(this._ast.get(source),this._variables);}
  _reset(entrySceneId,runId){
    let node=this._program.entry,overrides={},returnStack=[];if(entrySceneId!==null){const explicit=this._program.mapEntries?.[entrySceneId];node=explicit?.node??Object.keys(this._program.nodes).find(id=>this._program.nodes[id].sceneId===entrySceneId);if(!node)fail('场景没有可用的流程入口');overrides=explicit?.variables??{};returnStack=explicit?.returnStack??[];}
    this._nodeId=null;this._origin=entrySceneId;this._runId=runId;this._variables={...this._program.variables,...overrides};this._stack=copy(returnStack);this._trace=[];this._serial=0;this._gate=null;this._phase='reader';this._endNotified=false;this._activate(node);this._settle();
  }
  _activate(nodeId){const playing=this.playing,rate=this.rate,entry=(this._program.nodes[nodeId].entryMode||this._program.entryMode)==='carry'&&this._nodeId?carryEntry(this._reader.state):null;this._nodeId=nodeId;this._phase='reader';this._gate=null;this._reader.enter(this._program.nodes[nodeId].sceneId,entry);this._reader.setRate(rate);if(playing)this._reader.play();}
  _record(action){if(this._trace.length>=MAX_TRACE)fail('流程记录超过上限，请从地图入口重新开始');this._trace.push(copy(action));}
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
  _settle(){const budget={count:0};while(this._phase==='reader'&&this._reader.state.ended){this._record({kind:'finish',reader:this._reader.snapshot()});this._resolve(this._program.nodes[this._nodeId].exit,budget);}}
  get state(){
    const state=this._reader.state;state.ended=this._phase==='end';if(this._phase!=='reader')state.waiting=this._phase==='end'?null:this._phase;
    state.choices=this._phase==='choice'?this._gate.items.map(({id,label})=>({id,label})):[];state.signal=this._phase==='signal'?{id:this._gate.id,token:this._gate.token,outcomes:this._gate.items.map(({id,label})=>({id,label}))}:null;
    state.program={nodeId:this._nodeId,variables:copy(this._variables),stackDepth:this._stack.length,entryMode:this._program.nodes[this._nodeId].entryMode||this._program.entryMode||'reset'};
    Object.defineProperty(state,'readerSnapshot',{configurable:true,enumerable:false,get:()=>this.snapshot()});return state;
  }
  snapshot(){return {type:'story-player-program',schemaVersion:1,storyId:this._story.id,gameFingerprint:this._story.gameFingerprint,programRevision:this._revision,runId:this._runId,entrySceneId:this._origin,trace:copy(this._trace),nodeId:this._nodeId,variables:copy(this._variables),stack:copy(this._stack),phase:this._phase,signalSerial:this._serial,reader:this._reader.snapshot()};}
  _notify(){const state=this.state;this._onUpdate(state);if(state.ended&&!this._endNotified){this._endNotified=true;this._onEnd(state,this.scene);}}
  enter(sceneId){if(typeof sceneId!=='string')fail('地图场景编号无效');this._reset(sceneId,freshRun());this._reader.pause();this._notify();return this.state;}
  play(){this._reader.play();this._notify();return this.state;}pause(){this._reader.pause();this._notify();return this.state;}
  setRate(rate){this._reader.setRate(rate);this._notify();return this.state;}setTextLengths(lengths){this._reader.setTextLengths(lengths);this._notify();return this.state;}
  advance(seconds){this._reader.advance(seconds);this._settle();this._notify();return this.state;}
  next(){if(this._phase!=='reader'){this._notify();return this._phase==='end'?'end':this._phase;}const result=this._reader.next();this._settle();this._notify();return this._phase==='end'?'end':this._phase!=='reader'?this._phase:result==='end'?'advance':result;}
  choose(id){
    if(this._phase!=='choice')fail('当前没有等待分支选择');const item=this._gate.items.find(item=>item.id===id);if(!item)fail('选项不存在或条件不满足');this._record({kind:'choice',id,reader:this._reader.snapshot()});this._gate=null;this._resolve(item.then,{count:0});this._settle();this._notify();return this.state;
  }
  completeSignal(token,outcomeId){
    if(this._phase!=='signal'||token!==this._gate.token)fail('外部完成令牌已失效');const outcome=this._gate.items.find(item=>item.id===outcomeId);if(!outcome)fail('外部完成结果没有列入允许目录');this._record({kind:'signal',token,outcomeId,reader:this._reader.snapshot()});this._gate=null;this._resolve(outcome.then,{count:0});this._settle();this._notify();return this.state;
  }
  // Canonical review is confined to the active block; its completed exit still executes.
  seek(seconds){if(this._phase!=='reader')fail('交互出口处不能校对定位，请重新进入场景');this._reader.seek(seconds);this._settle();this._notify();return this.state;}
  seekDialogue(index){if(this._phase!=='reader')fail('交互出口处不能校对定位，请重新进入场景');this._reader.seekDialogue(index);this._notify();return this.state;}
  restore(snapshot){const runner=replaySnapshot(this._story,snapshot);this._origin=runner._origin;this._runId=runner._runId;this._nodeId=runner._nodeId;this._variables=runner._variables;this._stack=runner._stack;this._trace=runner._trace;this._serial=runner._serial;this._gate=runner._gate;this._phase=runner._phase;this._reader._entryOverride=copy(runner._reader._entryOverride);this._reader.restore(runner._reader.snapshot());this._endNotified=this._phase==='end';runner.dispose();this._notify();return this.state;}
  dispose(){this._reader.dispose();this._onUpdate=()=>{};this._onEnd=()=>{};}
}

function replaySnapshot(story,doc){
  fields(doc,['type','schemaVersion','storyId','gameFingerprint','programRevision','runId','entrySceneId','trace','nodeId','variables','stack','phase','signalSerial','reader'],'流程进度');
  if(doc.type!=='story-player-program'||doc.schemaVersion!==1)fail('不是支持的流程进度');if(doc.storyId!==story.id||doc.gameFingerprint!==story.gameFingerprint||doc.programRevision!==revision(story))fail('流程进度与当前演出包版本不匹配');checkRun(doc.runId);
  if(doc.entrySceneId!==null&&typeof doc.entrySceneId!=='string')fail('流程入口记录无效');if(!Array.isArray(doc.trace)||doc.trace.length>MAX_TRACE)fail('流程轨迹无效');
  const runner=new ProgramPlayer(story);runner._reset(doc.entrySceneId,doc.runId);let cursor=0,totalExecutions=0;
  // A completed block can keep animating and playing media while a choice or
  // external result is pending. Replay that dwell time before carrying state
  // into the next block, while accepting only the same completed commands.
  function restoreGateReader(snapshot,phase){
    if(runner._phase!==phase)fail('交互轨迹越过了对应的等待出口');
    const completed=runner._reader.snapshot(),checked=validateReaderSnapshot(story,snapshot,{validatedStory:true});
    if(checked.sceneId!==completed.sceneId||checked.wait!==null||checked.cursor!==completed.cursor||checked.forcedReveal!==completed.forcedReveal||stable(checked.executions)!==stable(completed.executions)||checked.stageTime<completed.stageTime)fail('交互等待记录与已完成的演出不一致');
    totalExecutions+=checked.executions.length;if(totalExecutions>500000)fail('流程轨迹过大');
    runner._reader.restore(checked);
  }
  // Automatic empty nodes can already have emitted finish records during reset/resolve.
  while(cursor<doc.trace.length){
    if(cursor<runner._trace.length){if(stable(doc.trace[cursor])!==stable(runner._trace[cursor]))fail('流程轨迹不符合已执行的指令');cursor++;continue;}
    const action=doc.trace[cursor];
    if(action?.kind==='finish'){
      fields(action,['kind','reader'],'完成轨迹');if(runner._phase!=='reader')fail('完成轨迹越过了选择或外部等待');const checked=validateReaderSnapshot(story,action.reader,{validatedStory:true});totalExecutions+=checked.executions.length;if(totalExecutions>500000)fail('流程轨迹过大');if(checked.sceneId!==runner.scene.id||checked.wait!==null)fail('完成轨迹中的场景或等待状态无效');runner._reader.restore(checked);if(!runner._reader.state.ended)fail('未结束的演出不能进入流程出口');runner._settle();
    }else if(action?.kind==='choice'){fields(action,['kind','id','reader'],'选择轨迹');restoreGateReader(action.reader,'choice');runner.choose(action.id);}
    else if(action?.kind==='signal'){fields(action,['kind','token','outcomeId','reader'],'完成结果轨迹');restoreGateReader(action.reader,'signal');runner.completeSignal(action.token,action.outcomeId);}
    else fail('未知的流程轨迹');
  }
  if(runner._trace.length!==doc.trace.length||stable(runner._trace)!==stable(doc.trace))fail('流程轨迹遗漏自动执行记录');
  if(doc.nodeId!==runner._nodeId||doc.phase!==runner._phase||doc.signalSerial!==runner._serial||stable(doc.variables)!==stable(runner._variables)||stable(doc.stack)!==stable(runner._stack))fail('流程状态与重放结果不一致');
  const current=validateReaderSnapshot(story,doc.reader,{validatedStory:true});if(current.sceneId!==runner.scene.id)fail('当前演出场景与流程不一致');
  if(runner._phase!=='reader'){
    const completed=runner._reader.snapshot();
    if(stable(current.executions)!==stable(completed.executions)||current.cursor!==completed.cursor||current.forcedReveal!==completed.forcedReveal||current.stageTime<completed.stageTime)fail('交互出口处的演出记录与完成轨迹不一致');
  }
  runner._reader.restore(current);
  if(runner._phase==='reader'&&runner._reader.state.ended)fail('进度遗漏了场景完成后的流程');if(runner._phase!=='reader'&&!runner._reader.state.ended)fail('交互出口前的演出尚未完成');
  return runner;
}
export function validateProgramSnapshot(story,snapshot){validateProgramStory(story);const runner=replaySnapshot(story,snapshot);const result=runner.snapshot();runner.dispose();return result;}
