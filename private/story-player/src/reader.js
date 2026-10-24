import {evaluateScene,validateStory} from './engine.js';
import {compileNativeEffects,nativeEffectsFor} from './native-effects.js';

const copy=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const MAX_CLOCK=31536000,EPS=1e-7,CPS=32;
const MAX_PREVIEW_STATES=8;
const PAGE_CONTROLS=['InputBrPage','KeepText','Next','Input','Br','InputBr','BrPage'];
export function normalizePageControl(value){
  const name=value===undefined||value===''?'InputBrPage':typeof value==='number'?PAGE_CONTROLS[value]:value;
  if(!PAGE_CONTROLS.includes(name)||name==='KeepText')fail(`尚未核实或不支持的页控制 ${String(value)}`);
  return name;
}
const autoPage=command=>['Next','Br','BrPage'].includes(normalizePageControl(command.pageCtrl));
const fail=message=>{throw new Error(`逐句演出无效：${message}`);};
const same=(left,right)=>Math.abs(left-right)<=EPS;
function keys(value,allowed,name){if(!plain(value))fail(`${name}必须是对象`);for(const key of Object.keys(value))if(!allowed.includes(key))fail(`${name}含不支持的字段 ${key}`);}
function clock(value,name,max=MAX_CLOCK){if(!finite(value)||value<0||value>max)fail(`${name}必须是支持范围内的非负有限数字`);}
function rateOK(rate){if(!finite(rate)||rate<.25||rate>4)fail('播放速度应为0.25至4倍');}
function stable(value){return value===undefined?'null':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;}
function revision(story,scene,commands){
  const referenced=new Set([scene.entry.dialogue?.textId,...scene.events.map(event=>event.textId)].filter(Boolean));
  const source=stable({stage:story.stage,scene:{id:scene.id,duration:scene.duration,entry:scene.entry,events:scene.events,commands},texts:story.texts.filter(text=>referenced.has(text.id)).map(({id,source})=>({id,source}))});
  let first=2166136261,second=5381;for(let index=0;index<source.length;index++){const code=source.charCodeAt(index);first=Math.imul(first^code,16777619);second=Math.imul(second,33)^code;}
  return `reader-1:${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}

/** A migration helper for neutral fixtures, not an inference of any game's click rules. */
export function compileSceneCommands(scene){
  if(!plain(scene)||!Array.isArray(scene.events)||!finite(scene.duration))fail('场景缺少事件列表或时长');
  const sorted=scene.events.map((event,eventIndex)=>({event,eventIndex})).sort((a,b)=>a.event.at-b.event.at||a.eventIndex-b.eventIndex);
  const result=[];let previous=0;
  for(const {event,eventIndex} of sorted){if(!finite(event.at)||event.at<previous||event.at>scene.duration)fail('事件时间无效');if(event.at>previous)result.push({type:'wait',duration:event.at-previous});result.push({type:event.type==='dialogue'?'dialogue':'event',eventIndex});previous=event.at;}
  if(previous<scene.duration)result.push({type:'wait',duration:scene.duration-previous});
  return result;
}
function commandsFor(scene){return scene.commands===undefined?compileSceneCommands(scene):scene.commands;}
function blockDuration(scene,command,native=null,commandIndex=-1,executions=[]){
  if(native&&commandIndex>=0){const duration=native.blockDuration(scene,commandIndex,executions);if(duration!==null)return duration;}
  if(command.type==='wait')return command.duration;
  if(command.type!=='event'||!command.block)return 0;
  return scene.events[command.eventIndex].duration||0;
}

// Two immutable command clocks share one bounded, active-block index. Review
// keeps its historical zero-click dwell; scrub uses source reading time so a
// completed fade cannot be compressed into the same instant as the next CG.
function dialogueSeekPlan(scene,commands,sourceLengths,native=null){
  const fast=[],canonical=[],targets=[];let fastAt=0,at=0,settleUntil=0;
  for(let commandIndex=0;commandIndex<commands.length;commandIndex++){
    const command=commands[commandIndex],quick={commandIndex,at:fastAt},execution={commandIndex,at};
    fast.push(quick);canonical.push(execution);
    if(command.type==='dialogue'){
      targets.push({commandIndex,fastAt,at,settledAt:Math.max(at,settleUntil)});
      quick.releaseAt=fastAt;execution.releaseAt=at+(sourceLengths.get(scene.events[command.eventIndex].textId)||0)/CPS;if(native){quick.releaseAt=Math.max(quick.releaseAt,native.inputWaitUntil(scene,fast,commandIndex,fastAt));execution.releaseAt=Math.max(execution.releaseAt,native.inputWaitUntil(scene,canonical,commandIndex,at));}fastAt=quick.releaseAt;at=execution.releaseAt;
    }else{
      const event=scene.events[command.eventIndex];
      if(event&&['fade','tween'].includes(event.type))settleUntil=Math.max(settleUntil,at+(event.duration||0));
      const quickDuration=blockDuration(scene,command,native,commandIndex,fast),duration=blockDuration(scene,command,native,commandIndex,canonical);fastAt+=quickDuration;at+=duration;
    }
    if(at>MAX_CLOCK||fastAt>MAX_CLOCK)fail('剧情定位时间超过支持范围');
  }
  return {fast,canonical,targets};
}

export function validateReaderStory(story){
  validateStory(story);
  const assetMap=new Map(story.assets.map(item=>[item.id,item])),textMap=new Map(story.texts.map(item=>[item.id,item]));
  for(const scene of story.scenes){
    const commands=commandsFor(scene),seen=new Set();if(!Array.isArray(commands)||commands.length>100000)fail(`${scene.id}指令列表无效`);
    let at=0;const canonical=[];
    for(const command of commands){
      if(command?.type==='wait'){keys(command,['type','duration'],'等待指令');clock(command.duration,'等待时长',86400);at+=command.duration;continue;}
      if(command?.type!=='event'&&command?.type!=='dialogue')fail(`未实现的顺序指令 ${String(command?.type)}`);
      keys(command,command.type==='event'?['type','eventIndex','block']:['type','eventIndex','pageCtrl'],'顺序指令');
      if(command.type==='dialogue')normalizePageControl(command.pageCtrl);
      if(!Number.isInteger(command.eventIndex)||command.eventIndex<0||command.eventIndex>=scene.events.length)fail('指令引用了不存在的事件');
      if(seen.has(command.eventIndex))fail('事件被重复引用');seen.add(command.eventIndex);
      const event=scene.events[command.eventIndex];if((event.type==='dialogue')!==(command.type==='dialogue'))fail('台词事件必须使用台词等待指令');
      if(command.block!==undefined&&typeof command.block!=='boolean')fail('阻塞标记必须为布尔值');
      if(command.block&&(!['tween','fade','video'].includes(event.type)||!finite(event.duration)||event.duration<=0||event.type==='video'&&event.loop))fail('阻塞动画或视频必须声明有效的非循环时长');
      canonical.push({...event,at});at+=blockDuration(scene,command);
    }
    if(seen.size!==scene.events.length)fail(`${scene.id}存在未接入顺序指令的事件`);
    if(at>86399)fail('场景累计等待超过支持范围');
    // Validate actual command ordering as well as the legacy calibration event list.
    const duration=Math.max(1,at,...canonical.map(event=>event.at+(event.duration||event.shake?.duration||0)))+.001;
    if(duration>86400)fail('场景累计演出超过支持范围');
    const assetIds=new Set([scene.entry.background.asset,...scene.entry.characters.map(item=>item.asset),...(scene.entry.audio||[]).map(item=>item.asset),scene.entry.video?.asset,...canonical.map(item=>item.asset)].filter(Boolean));
    const textIds=new Set([scene.entry.dialogue?.textId,...canonical.map(item=>item.textId)].filter(Boolean));
    validateStory({...story,assets:[...assetIds].map(id=>assetMap.get(id)),texts:[...textIds].map(id=>textMap.get(id)),startScene:scene.id,scenes:[{...scene,next:undefined,choices:[],duration,events:canonical}]});
  }
  return story;
}

function checkedSnapshot(story,doc){
  keys(doc,['type','schemaVersion','storyId','gameFingerprint','readerRevision','sceneId','stageTime','cursor','executions','wait','forcedReveal','rate','historyStart','nativeTimingRevision'],'逐句进度');
  if(doc.type!=='story-player-reader'||doc.schemaVersion!==1)fail('不是支持的逐句进度');
  if(doc.storyId!==story.id||doc.gameFingerprint!==story.gameFingerprint)fail('逐句进度与演出包版本不匹配');
  const scene=story.scenes.find(item=>item.id===doc.sceneId);if(!scene)fail('逐句进度中的剧情节点不存在');
  const native=doc.nativeTimingRevision!==undefined?nativeEffectsFor(story,doc.nativeTimingRevision):null;const commands=commandsFor(scene);if(doc.readerRevision!==revision(story,scene,commands))fail('逐句进度与当前演出指令版本不匹配');clock(doc.stageTime,'舞台时间');rateOK(doc.rate);
  if(!Number.isInteger(doc.cursor)||doc.cursor<0||doc.cursor>commands.length||!Array.isArray(doc.executions)||doc.executions.length!==doc.cursor)fail('指令游标或执行记录无效');
  if(typeof doc.forcedReveal!=='boolean')fail('文字显示状态无效');
  let expectedAt=0,gate=null,lastDialogue=null;
  for(let index=0;index<doc.executions.length;index++){
    const execution=doc.executions[index],command=commands[index];keys(execution,['commandIndex','at','releaseAt'],'执行记录');
    if(execution.commandIndex!==index)fail('执行记录必须连续且不可注入事件');clock(execution.at,'执行时间');
    if(!same(execution.at,expectedAt)||execution.at>doc.stageTime+EPS)fail('执行时间不符合顺序指令');
    if(command.type==='dialogue'){
      lastDialogue=execution;
      if(execution.releaseAt!==undefined){clock(execution.releaseAt,'台词继续时间');if(execution.releaseAt<execution.at||execution.releaseAt>doc.stageTime+EPS)fail('台词继续时间无效');expectedAt=execution.releaseAt;}
      else {if(index!==doc.cursor-1)fail('等待中的台词之后不能执行指令');gate={kind:'dialogue',commandIndex:index};expectedAt=Infinity;}
    }else{
      if(execution.releaseAt!==undefined)fail('只有台词允许记录点击继续');
      expectedAt=execution.at+blockDuration(scene,command,native,index,doc.executions);
      if(expectedAt>doc.stageTime){if(index!==doc.cursor-1)fail('等待结束前不能执行后续指令');gate={kind:'wait',commandIndex:index,until:expectedAt};}
    }
  }
  if(doc.cursor<commands.length&&!gate)fail('进度遗漏了应执行的指令');
  if(doc.cursor===0&&commands.length)fail('进度缺少初始指令');
  if(doc.wait!==null){keys(doc.wait,doc.wait?.kind==='wait'?['kind','commandIndex','until']:['kind','commandIndex'],'等待状态');}
  if((doc.wait===null)!==(gate===null)||gate&&(doc.wait.kind!==gate.kind||doc.wait.commandIndex!==gate.commandIndex||gate.kind==='wait'&&!same(doc.wait.until,gate.until)))fail('等待状态与执行记录不符');
  if(doc.forcedReveal&&(!gate||gate.kind!=='dialogue'||!lastDialogue))fail('补全文字标记没有对应的等待台词');
  if(doc.historyStart!==undefined&&(!Number.isInteger(doc.historyStart)||doc.historyStart<0||doc.historyStart>=doc.cursor||commands[doc.historyStart]?.type!=='dialogue'))fail('已读台词起点必须对应已执行的台词');
  return {type:'story-player-reader',schemaVersion:1,storyId:story.id,gameFingerprint:story.gameFingerprint,readerRevision:doc.readerRevision,sceneId:scene.id,stageTime:doc.stageTime,cursor:doc.cursor,executions:copy(doc.executions),wait:gate,forcedReveal:doc.forcedReveal,rate:doc.rate,...(doc.historyStart!==undefined?{historyStart:doc.historyStart}:{}),...(native?{nativeTimingRevision:native.revision}:{})};
}

/** Source event payloads are always reconstructed from the package, never from a save file. */
export function validateReaderSnapshot(story,snapshot,{validatedStory=false}={}){if(!validatedStory)validateReaderStory(story);return checkedSnapshot(story,snapshot);}

function textLength(text){const stripped=text.replace(/<\/?(?:b|i|u|color|size)(?:=[^>]*)?>|<br\s*\/?>/gi,'');return typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(stripped)].length:Array.from(stripped).length;}

/** Command sequencing and a continuous stage clock are separate from click gates. */
export class ReaderPlayer{
  constructor(story,{onUpdate=()=>{},onEnd=()=>{},nativeEffects=null,nativeTiming=true}={}){
    validateReaderStory(story);this._story=copy(story);this._scenes=new Map(this._story.scenes.map(scene=>[scene.id,scene]));
    this._nativeEffects=nativeEffects?compileNativeEffects(this._story,nativeEffects):null;this._nativeTiming=!!this._nativeEffects&&nativeTiming;this._textSpeed=32;this._onUpdate=onUpdate;this._onEnd=onEnd;this._rate=1;this._playing=false;this._sourceLengths=new Map(this._story.texts.map(text=>[text.id,textLength(text.source)]));this._lengths=new Map(this._sourceLengths);
    this._reset(this._story.startScene);this._notify();
  }
  _reset(id,entry=null){this._invalidateDialogueHistory();this._clearDialoguePreview();this._pendingAdvance=false;this._historyStart=0;this._scene=this._scenes.get(id);this._entryOverride=entry?copy(entry):null;this._commands=commandsFor(this._scene);this._dialogueCount=this._commands.filter(command=>command.type==='dialogue').length;this._revision=revision(this._story,this._scene,this._commands);this._stageTime=0;this._cursor=0;this._executions=[];this._dialogueIndices=[];this._gate=null;this._forcedReveal=false;this._endNotified=false;this._playing=false;this._drain();}
  get story(){return copy(this._story);}
  get scene(){return copy(this._scene);}
  get playing(){return this._playing;}
  get rate(){return this._rate;}
  _scriptTime(executions=this._executions,stageTime=this._stageTime,cursor=this._cursor){
    let anchor=0,at=0;for(const execution of executions){const command=this._commands[execution.commandIndex];if(command.eventIndex!==undefined){anchor=this._scene.events[command.eventIndex].at;at=execution.at;}}
    const next=this._commands.slice(cursor).find(command=>command.eventIndex!==undefined),limit=next?this._scene.events[next.eventIndex].at:this._scene.duration;
    return Math.max(0,Math.min(this._scene.duration,Math.max(anchor,Math.min(limit,anchor+stageTime-at))));
  }
  get state(){return this._renderState(this._executions,this._stageTime,this._gate,this._forcedReveal,this._playing,this._dialogueIndices.length,()=>this.snapshot());}
  _renderState(executions,stageTime,gate,forcedReveal,playing,dialogueCount,snapshot=null){
    const events=this._nativeEffects?this._nativeEffects.timeline(this._scene,this._commands,executions,{ended:executions.length===this._commands.length&&!gate}):executions.filter(execution=>this._commands[execution.commandIndex].eventIndex!==undefined).map(execution=>({...this._scene.events[this._commands[execution.commandIndex].eventIndex],at:execution.at}));
    const result=evaluateScene({...this._scene,entry:this._entryOverride||this._scene.entry,events,duration:Math.max(stageTime+1,this._scene.duration)},stageTime,{nativeEffects:this._nativeEffects});
    result.stageTime=stageTime;result.time=this._scriptTime(executions,stageTime,executions.length);result.scriptTime=result.time;result.duration=this._scene.duration;result.playing=playing;result.rate=this._rate;result.waiting=gate?.kind??null;result.ended=executions.length===this._commands.length&&!gate;
    if(gate?.kind==='dialogue'&&autoPage(this._commands[gate.commandIndex]))result.waiting='text';
    const dialogue=executions.findLast(execution=>this._commands[execution.commandIndex].type==='dialogue');
    const length=this._lengths.get(result.dialogue.textId)||0,elapsed=Math.max(0,stageTime-result.dialogue.startedAt);
    const full=!!dialogue&&dialogue.releaseAt!==undefined||forcedReveal;
    result.dialogue.visibleCharacters=full?length:this._textSpeed===Infinity?length:Math.min(length,Math.floor(elapsed*this._textSpeed+EPS));result.dialogue.textComplete=result.dialogue.visibleCharacters>=length;
    result.dialogue.index=dialogueCount-1;
    result.dialogue.count=this._dialogueCount;
    let pageSegments=[],previous=null;
    for(const execution of executions){const command=this._commands[execution.commandIndex];if(command.type!=='dialogue')continue;
      if(previous&&['InputBrPage','BrPage'].includes(previous))pageSegments=[];
      pageSegments.push({textId:this._scene.events[command.eventIndex].textId,breakBefore:!!previous&&['InputBr','Br'].includes(previous),current:execution===dialogue});previous=normalizePageControl(command.pageCtrl);
    }
    result.dialogue.pageSegments=pageSegments;
    if(dialogue?.releaseAt!==undefined){const command=this._commands[dialogue.commandIndex];if(command.pageCtrl!==undefined&&['InputBrPage','BrPage'].includes(normalizePageControl(command.pageCtrl))){result.dialogue.visible=false;result.dialogue.pageSegments=[];}}
    for(const track of result.audio)track.playing=track.playing&&playing;if(result.video)result.video.playing=result.video.playing&&playing;
    if(snapshot)Object.defineProperty(result,'readerSnapshot',{configurable:true,enumerable:false,get:snapshot});return result;
  }
  snapshot(){return {type:'story-player-reader',schemaVersion:1,storyId:this._story.id,gameFingerprint:this._story.gameFingerprint,readerRevision:this._revision,sceneId:this._scene.id,stageTime:this._stageTime,cursor:this._cursor,executions:copy(this._executions),wait:copy(this._gate),forcedReveal:this._forcedReveal,rate:this._rate,...(this._historyStart?{historyStart:this._historyStart}:{}),...(this._nativeTiming&&this._nativeEffects?{nativeTimingRevision:this._nativeEffects.revision}:{})};}
  restore(snapshot){const valid=checkedSnapshot(this._story,snapshot);this._invalidateDialogueHistory();this._clearDialoguePreview();this._historyStart=valid.historyStart??0;this._nativeTiming=!!valid.nativeTimingRevision;this._pendingAdvance=false;this._scene=this._scenes.get(valid.sceneId);this._commands=commandsFor(this._scene);this._dialogueCount=this._commands.filter(command=>command.type==='dialogue').length;this._revision=valid.readerRevision;this._stageTime=valid.stageTime;this._cursor=valid.cursor;this._executions=valid.executions;this._dialogueIndices=this._executions.filter(item=>this._commands[item.commandIndex].type==='dialogue').map(item=>item.commandIndex);this._gate=valid.wait;this._forcedReveal=valid.forcedReveal;this._rate=valid.rate;this._playing=false;this._endNotified=this._cursor===this._commands.length&&!this._gate;this._notify();return this.state;}
  _notify(){const state=this.state;this._onUpdate(state);if(state.ended&&!this._endNotified){this._endNotified=true;this._onEnd(state,this.scene);}}
  _drain(){
    while(!this._gate&&this._cursor<this._commands.length){
      const commandIndex=this._cursor++,command=this._commands[commandIndex];this._executions.push({commandIndex,at:this._stageTime});
      if(command.type==='dialogue'){this._dialogueIndices.push(commandIndex);this._forcedReveal=false;this._gate={kind:'dialogue',commandIndex};}
      else {const duration=blockDuration(this._scene,command,this._nativeTiming?this._nativeEffects:null,commandIndex,this._executions);if(duration>0)this._gate={kind:'wait',commandIndex,until:this._stageTime+duration};}
    }
  }
  enter(id,entry=null){if(!this._scenes.has(id))fail('选择的剧情节点不存在');this._reset(id,entry);this._notify();return this.state;}
  play(){this._playing=true;this._notify();return this.state;}
  pause(){this._pendingAdvance=false;this._playing=false;this._notify();return this.state;}
  setRate(rate){rateOK(rate);this._rate=rate;this._notify();return this.state;}
  setTextLengths(lengths){
    if(!plain(lengths))fail('文字长度目录必须是对象');const next=new Map(this._lengths);
    for(const [id,length] of Object.entries(lengths)){if(!next.has(id)||!Number.isInteger(length)||length<0||length>1000000)fail('文字长度或原文编号无效');next.set(id,length);}
    this._lengths=next;this._previewCache.clear();this._notify();return this.state;
  }
  setNativeEffects(manifest,{notify=true}={}){this._nativeEffects=manifest?compileNativeEffects(this._story,manifest):null;this._clearDialoguePreview();if(notify)this._notify();return this._nativeEffects;}
  setTextSpeed(speed){if(speed!==Infinity&&(!finite(speed)||speed<8||speed>96))fail('文字速度应为8至96字每秒或瞬显');this._textSpeed=speed;this._previewCache.clear();this._notify();return this.state;}
  next(){
    const wasPaused=!this._playing;this._playing=true;
    if(this._gate?.kind==='dialogue'){
      if(!this.state.dialogue.textComplete){this._forcedReveal=true;if(autoPage(this._commands[this._gate.commandIndex]))this._advanceTo(this._stageTime);this._notify();return 'reveal';}
      if(this._nativeEffects&&this.state.nativeEffects?.inputWaiting){this._pendingAdvance=true;this._notify();return 'wait';}
      this._pendingAdvance=false;this._executions[this._gate.commandIndex].releaseAt=this._stageTime;this._gate=null;this._forcedReveal=false;this._drain();this._notify();return this.state.ended?'end':'advance';
    }
    this._notify();return this.state.ended?'end':wasPaused?'start':'wait';
  }
  // Keep only executed command cursors. Rewinding never borrows an unchosen
  // branch or substitutes canonical timing for the reader's actual dwell time.
  _previousDialogueCommand(){const indices=this._dialogueIndices.filter(index=>index>=this._historyStart);return indices.at(this._gate?.kind==='dialogue'?-2:-1);}
  canPreviousDialogue(){return this._previousDialogueCommand()!==undefined;}
  previousDialogue(){
    const commandIndex=this._previousDialogueCommand();return commandIndex===undefined?this.state:this._rewindDialogueCommand(commandIndex);
  }
  _invalidateDialogueHistory(){this._historyTokens=new Map();this._historyKeys=new Map();}
  getDialogueProgress(){
    const total=this._dialogueCount,current=this._dialogueIndices.length,complete=this._cursor===this._commands.length&&!this._gate;
    return {current,total,ratio:total?current/total:complete?1:0,complete};
  }
  getDialogueHistory(limit=30){
    if(!Number.isInteger(limit)||limit<0)fail('历史台词数量无效');limit=Math.min(30,limit);
    const indices=limit?this._dialogueIndices.slice(0,-1).filter(index=>index>=this._historyStart&&this._scene.events[this._commands[index].eventIndex].textId).slice(-limit):[];
    const descriptors=[],keep=new Set();
    for(const index of indices){
      const event=this._scene.events[this._commands[index].eventIndex];let token=this._historyKeys.get(index);
      if(!token){token=globalThis.crypto.randomUUID();this._historyKeys.set(index,token);this._historyTokens.set(token,index);}
      keep.add(index);descriptors.push({token,sceneId:this._scene.id,textId:event.textId,...(event.speaker?{speaker:event.speaker}:{})});
    }
    for(const [index,token] of this._historyKeys)if(!keep.has(index)){this._historyKeys.delete(index);this._historyTokens.delete(token);}
    return descriptors;
  }
  rewindToDialogue(token){
    if(typeof token!=='string'||!this._historyTokens.has(token))fail('历史台词定位已失效');
    return this._rewindDialogueCommand(this._historyTokens.get(token));
  }
  _rewindDialogueCommand(commandIndex,{stageTime=null}={}){
    const execution=this._executions[commandIndex];
    if(!execution||commandIndex<this._historyStart||this._commands[commandIndex]?.type!=='dialogue')fail('历史台词尚未阅读');
    this._pendingAdvance=false;this._invalidateDialogueHistory();this._previewCache.clear();this._stageTime=stageTime??execution.releaseAt??execution.at;
    this._executions=this._executions.slice(0,commandIndex+1);delete this._executions[commandIndex].releaseAt;
    this._cursor=commandIndex+1;this._dialogueIndices=this._dialogueIndices.filter(index=>index<=commandIndex);
    this._gate={kind:'dialogue',commandIndex};this._forcedReveal=true;this._playing=false;this._endNotified=false;
    this._notify();return this.state;
  }
  _advanceTo(target){
    while(this._gate){
      if(this._gate.kind==='wait'&&this._gate.until<=target){this._stageTime=this._gate.until;this._gate=null;this._drain();continue;}
      if(this._gate.kind==='dialogue'&&(autoPage(this._commands[this._gate.commandIndex])||this._pendingAdvance)){
        const execution=this._executions[this._gate.commandIndex],event=this._scene.events[this._commands[this._gate.commandIndex].eventIndex],length=this._lengths.get(event.textId)||0;
        const revealUntil=this._forcedReveal?this._stageTime:Math.max(this._stageTime,execution.at+length/this._textSpeed),nativeUntil=this._nativeEffects?this.state.nativeEffects?.inputWaitUntil||0:0;const until=Math.max(revealUntil,nativeUntil);
        if(until<=target+EPS){this._stageTime=Math.min(until,target);execution.releaseAt=this._stageTime;this._gate=null;this._forcedReveal=false;this._pendingAdvance=false;this._drain();continue;}
      }
      break;
    }
    this._stageTime=target;
  }
  advance(deltaSeconds){
    if(!finite(deltaSeconds)||deltaSeconds<0)fail('时间增量必须是非负有限数字');if(!this._playing||!deltaSeconds)return this.state;
    this._advanceTo(Math.min(MAX_CLOCK,this._stageTime+deltaSeconds*this._rate));this._notify();return this.state;
  }
  /** Canonical review ignores earlier click dwell times; use seekDialogue for reader navigation. */
  seek(seconds){
    if(!finite(seconds))fail('播放位置必须为有限数字');const target=Math.max(0,Math.min(this._scene.duration,seconds));this._reset(this._scene.id,this._entryOverride);
    while(true){
      if(this._gate?.kind==='dialogue'&&this._stageTime<target){this._executions[this._gate.commandIndex].releaseAt=this._stageTime;this._gate=null;this._drain();continue;}
      if(this._gate?.kind==='wait'&&this._gate.until<=target){this._stageTime=this._gate.until;this._gate=null;this._drain();continue;}
      break;
    }
    this._stageTime=target;this._notify();return this.state;
  }
  _clearDialoguePreview(){this._seekPlan=null;this._previewCache=new Map();}
  _dialogueTarget(index){
    if(!this._seekPlan)this._seekPlan=dialogueSeekPlan(this._scene,this._commands,this._sourceLengths,this._nativeTiming?this._nativeEffects:null);
    if(!Number.isInteger(index)||index<0||index>=this._seekPlan.targets.length)fail('台词位置不存在');
    return this._seekPlan.targets[index];
  }
  _dialogueLocation(index,{fast=false}={}){
    const target=this._dialogueTarget(index),execution=this._executions[target.commandIndex],actual=!fast&&!!execution&&target.commandIndex>=this._historyStart;
    const source=actual?this._executions:fast?this._seekPlan.fast:this._seekPlan.canonical;
    let stageTime=actual?(execution.releaseAt??this._stageTime):fast?target.fastAt:target.settledAt;
    let executions=null;
    if(this._nativeEffects&&!actual&&!fast){const prefix=source.slice(0,target.commandIndex+1);stageTime=Math.max(stageTime,this._nativeEffects.settleTime(this._scene,this._commands,prefix));}
    return {commandIndex:target.commandIndex,get executions(){if(!executions){executions=source.slice(0,target.commandIndex+1).map(item=>({...item}));delete executions.at(-1).releaseAt;}return executions;},stageTime,actual,cacheKey:actual?execution.releaseAt===undefined?null:`actual:${index}:${execution.releaseAt}`:`${fast?'fast':'canonical'}:${index}`};
  }
  previewDialogue(index,{signal}={}){
    if(signal?.aborted)throw new DOMException('剧情速览已取消','AbortError');
    const location=this._dialogueLocation(index),key=location.cacheKey;
    let state=key?this._previewCache.get(key):null;
    if(state){this._previewCache.delete(key);this._previewCache.set(key,state);state=copy(state);}
    else{
      state=this._renderState(location.executions,location.stageTime,{kind:'dialogue',commandIndex:location.commandIndex},true,false,index+1);
      if(key){this._previewCache.set(key,copy(state));if(this._previewCache.size>MAX_PREVIEW_STATES)this._previewCache.delete(this._previewCache.keys().next().value);}
    }
    state.rate=this._rate;return state;
  }
  commitDialogue(index){
    const location=this._dialogueLocation(index);
    if(location.actual)return this._rewindDialogueCommand(location.commandIndex,{stageTime:location.stageTime});
    // Executed visual commands are required to reconstruct the selected frame,
    // but skipped dialogue is not reader history, including after save import.
    this._applyDialogueLocation(location,index,{historyStart:location.commandIndex,reveal:true});
    this._notify();return this.state;
  }
  _applyDialogueLocation(location,index,{historyStart=0,reveal=false}={}){
    this._pendingAdvance=false;this._invalidateDialogueHistory();this._previewCache.clear();this._stageTime=location.stageTime;this._executions=location.executions;
    this._cursor=location.commandIndex+1;this._dialogueIndices=this._seekPlan.targets.slice(0,index+1).map(item=>item.commandIndex);this._historyStart=historyStart;
    this._gate={kind:'dialogue',commandIndex:location.commandIndex};this._forcedReveal=reveal;this._playing=false;this._endNotified=false;
  }
  seekDialogue(index){
    // Compatibility review follows the original zero-click command clock.
    // Scrub previews / commits use the separate provenance-preserving APIs.
    this._applyDialogueLocation(this._dialogueLocation(index,{fast:true}),index);this._notify();return this.state;
  }
  /** Deterministic reconstruction for map routes, without synthetic user clicks. */
  completeCanonical(){
    this._stageTime=0;this._cursor=0;this._executions=[];this._dialogueIndices=[];this._gate=null;this._forcedReveal=false;this._playing=false;
    for(const command of this._commands){
      const execution={commandIndex:this._cursor++,at:this._stageTime};this._executions.push(execution);
      if(command.type==='dialogue'){
        this._dialogueIndices.push(execution.commandIndex);
        const event=this._scene.events[command.eventIndex];
        execution.releaseAt=this._stageTime+(this._sourceLengths.get(event.textId)||0)/CPS;if(this._nativeTiming&&this._nativeEffects)execution.releaseAt=Math.max(execution.releaseAt,this._nativeEffects.inputWaitUntil(this._scene,this._executions,execution.commandIndex,this._stageTime));this._stageTime=execution.releaseAt;
      }else this._stageTime+=blockDuration(this._scene,command,this._nativeTiming?this._nativeEffects:null,execution.commandIndex,this._executions);
    }
    this._endNotified=true;return this.state;
  }
  dispose(){this._playing=false;this._onUpdate=()=>{};this._onEnd=()=>{};}
}
