import {evaluateScene,validateStory} from './engine.js';

const copy=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const MAX_CLOCK=31536000,EPS=1e-7,CPS=32;
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
function blockDuration(scene,command){
  if(command.type==='wait')return command.duration;
  if(command.type!=='event'||!command.block)return 0;
  return scene.events[command.eventIndex].duration||0;
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
    validateStory({...story,program:undefined,assets:[...assetIds].map(id=>assetMap.get(id)),texts:[...textIds].map(id=>textMap.get(id)),startScene:scene.id,scenes:[{...scene,next:undefined,choices:[],duration,events:canonical}]});
  }
  return story;
}

function checkedSnapshot(story,doc){
  keys(doc,['type','schemaVersion','storyId','gameFingerprint','readerRevision','sceneId','stageTime','cursor','executions','wait','forcedReveal','rate'],'逐句进度');
  if(doc.type!=='story-player-reader'||doc.schemaVersion!==1)fail('不是支持的逐句进度');
  if(doc.storyId!==story.id||doc.gameFingerprint!==story.gameFingerprint)fail('逐句进度与演出包版本不匹配');
  const scene=story.scenes.find(item=>item.id===doc.sceneId);if(!scene)fail('逐句进度中的剧情节点不存在');
  const commands=commandsFor(scene);if(doc.readerRevision!==revision(story,scene,commands))fail('逐句进度与当前演出指令版本不匹配');clock(doc.stageTime,'舞台时间');rateOK(doc.rate);
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
      expectedAt=execution.at+blockDuration(scene,command);
      if(expectedAt>doc.stageTime){if(index!==doc.cursor-1)fail('等待结束前不能执行后续指令');gate={kind:'wait',commandIndex:index,until:expectedAt};}
    }
  }
  if(doc.cursor<commands.length&&!gate)fail('进度遗漏了应执行的指令');
  if(doc.cursor===0&&commands.length)fail('进度缺少初始指令');
  if(doc.wait!==null){keys(doc.wait,doc.wait?.kind==='wait'?['kind','commandIndex','until']:['kind','commandIndex'],'等待状态');}
  if((doc.wait===null)!==(gate===null)||gate&&(doc.wait.kind!==gate.kind||doc.wait.commandIndex!==gate.commandIndex||gate.kind==='wait'&&!same(doc.wait.until,gate.until)))fail('等待状态与执行记录不符');
  if(doc.forcedReveal&&(!gate||gate.kind!=='dialogue'||!lastDialogue))fail('补全文字标记没有对应的等待台词');
  return {type:'story-player-reader',schemaVersion:1,storyId:story.id,gameFingerprint:story.gameFingerprint,readerRevision:doc.readerRevision,sceneId:scene.id,stageTime:doc.stageTime,cursor:doc.cursor,executions:copy(doc.executions),wait:gate,forcedReveal:doc.forcedReveal,rate:doc.rate};
}

/** Source event payloads are always reconstructed from the package, never from a save file. */
export function validateReaderSnapshot(story,snapshot,{validatedStory=false}={}){if(!validatedStory)validateReaderStory(story);return checkedSnapshot(story,snapshot);}

function textLength(text){const stripped=text.replace(/<\/?(?:b|i|u|color|size)(?:=[^>]*)?>|<br\s*\/?>/gi,'');return typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(stripped)].length:Array.from(stripped).length;}

/** Command sequencing and a continuous stage clock are separate from click gates. */
export class ReaderPlayer{
  constructor(story,{onUpdate=()=>{},onEnd=()=>{}}={}){
    validateReaderStory(story);this._story=copy(story);this._scenes=new Map(this._story.scenes.map(scene=>[scene.id,scene]));
    this._onUpdate=onUpdate;this._onEnd=onEnd;this._rate=1;this._playing=false;this._lengths=new Map(this._story.texts.map(text=>[text.id,textLength(text.source)]));
    this._reset(this._story.startScene);this._notify();
  }
  _reset(id,entry=null){this._scene=this._scenes.get(id);this._entryOverride=entry?copy(entry):null;this._commands=commandsFor(this._scene);this._revision=revision(this._story,this._scene,this._commands);this._stageTime=0;this._cursor=0;this._executions=[];this._gate=null;this._forcedReveal=false;this._endNotified=false;this._playing=false;this._drain();}
  get story(){return copy(this._story);}
  get scene(){return copy(this._scene);}
  get playing(){return this._playing;}
  get rate(){return this._rate;}
  _scriptTime(){
    let anchor=0,at=0;for(const execution of this._executions){const command=this._commands[execution.commandIndex];if(command.eventIndex!==undefined){anchor=this._scene.events[command.eventIndex].at;at=execution.at;}}
    const next=this._commands.slice(this._cursor).find(command=>command.eventIndex!==undefined),limit=next?this._scene.events[next.eventIndex].at:this._scene.duration;
    return Math.max(0,Math.min(this._scene.duration,Math.max(anchor,Math.min(limit,anchor+this._stageTime-at))));
  }
  get state(){
    const events=this._executions.filter(execution=>this._commands[execution.commandIndex].eventIndex!==undefined).map(execution=>({...this._scene.events[this._commands[execution.commandIndex].eventIndex],at:execution.at}));
    const result=evaluateScene({...this._scene,entry:this._entryOverride||this._scene.entry,events,duration:Math.max(this._stageTime+1,this._scene.duration)},this._stageTime);
    result.stageTime=this._stageTime;result.time=this._scriptTime();result.scriptTime=result.time;result.duration=this._scene.duration;result.playing=this._playing;result.rate=this._rate;result.waiting=this._gate?.kind??null;result.ended=this._cursor===this._commands.length&&!this._gate;
    if(this._gate?.kind==='dialogue'&&autoPage(this._commands[this._gate.commandIndex]))result.waiting='text';
    const dialogue=this._executions.findLast(execution=>this._commands[execution.commandIndex].type==='dialogue');
    const length=this._lengths.get(result.dialogue.textId)||0,elapsed=Math.max(0,this._stageTime-result.dialogue.startedAt);
    const full=!!dialogue&&dialogue.releaseAt!==undefined||this._forcedReveal;
    result.dialogue.visibleCharacters=full?length:Math.min(length,Math.floor(elapsed*CPS+EPS));result.dialogue.textComplete=result.dialogue.visibleCharacters>=length;
    result.dialogue.index=this._commands.slice(0,this._cursor).filter(command=>command.type==='dialogue').length-1;
    result.dialogue.count=this._commands.filter(command=>command.type==='dialogue').length;
    let pageSegments=[],previous=null;
    for(const execution of this._executions){const command=this._commands[execution.commandIndex];if(command.type!=='dialogue')continue;
      if(previous&&['InputBrPage','BrPage'].includes(previous))pageSegments=[];
      pageSegments.push({textId:this._scene.events[command.eventIndex].textId,breakBefore:!!previous&&['InputBr','Br'].includes(previous),current:execution===dialogue});previous=normalizePageControl(command.pageCtrl);
    }
    result.dialogue.pageSegments=pageSegments;
    if(dialogue?.releaseAt!==undefined){const command=this._commands[dialogue.commandIndex];if(command.pageCtrl!==undefined&&['InputBrPage','BrPage'].includes(normalizePageControl(command.pageCtrl))){result.dialogue.visible=false;result.dialogue.pageSegments=[];}}
    for(const track of result.audio)track.playing=track.playing&&this._playing;if(result.video)result.video.playing=result.video.playing&&this._playing;
    result.readerSnapshot=this.snapshot();return result;
  }
  snapshot(){return {type:'story-player-reader',schemaVersion:1,storyId:this._story.id,gameFingerprint:this._story.gameFingerprint,readerRevision:this._revision,sceneId:this._scene.id,stageTime:this._stageTime,cursor:this._cursor,executions:copy(this._executions),wait:copy(this._gate),forcedReveal:this._forcedReveal,rate:this._rate};}
  restore(snapshot){const valid=checkedSnapshot(this._story,snapshot);this._scene=this._scenes.get(valid.sceneId);this._commands=commandsFor(this._scene);this._revision=valid.readerRevision;this._stageTime=valid.stageTime;this._cursor=valid.cursor;this._executions=valid.executions;this._gate=valid.wait;this._forcedReveal=valid.forcedReveal;this._rate=valid.rate;this._playing=false;this._endNotified=this._cursor===this._commands.length&&!this._gate;this._notify();return this.state;}
  _notify(){const state=this.state;this._onUpdate(state);if(state.ended&&!this._endNotified){this._endNotified=true;this._onEnd(state,this.scene);}}
  _drain(){
    while(!this._gate&&this._cursor<this._commands.length){
      const commandIndex=this._cursor++,command=this._commands[commandIndex];this._executions.push({commandIndex,at:this._stageTime});
      if(command.type==='dialogue'){this._forcedReveal=false;this._gate={kind:'dialogue',commandIndex};}
      else {const duration=blockDuration(this._scene,command);if(duration>0)this._gate={kind:'wait',commandIndex,until:this._stageTime+duration};}
    }
  }
  enter(id,entry=null){if(!this._scenes.has(id))fail('选择的剧情节点不存在');this._reset(id,entry);this._notify();return this.state;}
  play(){this._playing=true;this._notify();return this.state;}
  pause(){this._playing=false;this._notify();return this.state;}
  setRate(rate){rateOK(rate);this._rate=rate;this._notify();return this.state;}
  setTextLengths(lengths){
    if(!plain(lengths))fail('文字长度目录必须是对象');const next=new Map(this._lengths);
    for(const [id,length] of Object.entries(lengths)){if(!next.has(id)||!Number.isInteger(length)||length<0||length>1000000)fail('文字长度或原文编号无效');next.set(id,length);}
    this._lengths=next;this._notify();return this.state;
  }
  next(){
    const wasPaused=!this._playing;this._playing=true;
    if(this._gate?.kind==='dialogue'){
      if(!this.state.dialogue.textComplete){this._forcedReveal=true;if(autoPage(this._commands[this._gate.commandIndex]))this._advanceTo(this._stageTime);this._notify();return 'reveal';}
      this._executions[this._gate.commandIndex].releaseAt=this._stageTime;this._gate=null;this._forcedReveal=false;this._drain();this._notify();return this.state.ended?'end':'advance';
    }
    this._notify();return this.state.ended?'end':wasPaused?'start':'wait';
  }
  _advanceTo(target){
    while(this._gate){
      if(this._gate.kind==='wait'&&this._gate.until<=target){this._stageTime=this._gate.until;this._gate=null;this._drain();continue;}
      if(this._gate.kind==='dialogue'&&autoPage(this._commands[this._gate.commandIndex])){
        const execution=this._executions[this._gate.commandIndex],event=this._scene.events[this._commands[this._gate.commandIndex].eventIndex],length=this._lengths.get(event.textId)||0;
        const until=this._forcedReveal?this._stageTime:Math.max(this._stageTime,execution.at+length/CPS);
        if(until<=target+EPS){this._stageTime=Math.min(until,target);execution.releaseAt=this._stageTime;this._gate=null;this._forcedReveal=false;this._drain();continue;}
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
  seekDialogue(index){
    const total=this._commands.filter(command=>command.type==='dialogue').length;if(!Number.isInteger(index)||index<0||index>=total)fail('台词位置不存在');
    this._reset(this._scene.id,this._entryOverride);let current=0;
    while(this._gate){
      if(this._gate.kind==='dialogue'){if(current++===index)break;this._executions[this._gate.commandIndex].releaseAt=this._stageTime;this._gate=null;this._drain();}
      else {this._stageTime=this._gate.until;this._gate=null;this._drain();}
    }
    this._notify();return this.state;
  }
  dispose(){this._playing=false;this._onUpdate=()=>{};this._onEnd=()=>{};}
}
