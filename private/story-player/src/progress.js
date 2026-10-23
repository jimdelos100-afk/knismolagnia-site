import {validatePlaybackSnapshot} from './playback.js';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
function sceneMap(story){
  if(!plain(story)||!Array.isArray(story.scenes)||typeof story.id!=='string'||typeof story.gameFingerprint!=='string')fail('当前演出包信息不完整。');
  return new Map(story.scenes.map(scene=>[scene.id,scene]));
}
function checked(story,doc,{trustedReader=false}={}){
  if(!plain(doc)||doc.type!=='story-player-progress'||![1,2].includes(doc.schemaVersion))fail('此文件不是受支持的浏览进度文档。');
  for(const key of Object.keys(doc))if(['__proto__','constructor','prototype'].includes(key))fail('浏览进度含不支持的字段名称。');
  if(doc.storyId!==story.id||doc.gameFingerprint!==story.gameFingerprint)fail('浏览进度与当前演出包的版本不匹配。');
  const scenes=sceneMap(story),scene=scenes.get(doc.sceneId);
  if(!scene)fail('浏览进度中的剧情节点不存在。');
  if(!Number.isFinite(doc.time)||doc.time<0||!Number.isFinite(scene.duration)||doc.time>scene.duration)fail('浏览进度中的播放位置无效。');
  if(!Number.isFinite(doc.rate)||doc.rate<0.25||doc.rate>4)fail('浏览进度中的播放速度无效。');
  if(!Array.isArray(doc.visited)||doc.visited.length>scenes.size||doc.visited.some(id=>typeof id!=='string'||!scenes.has(id))||new Set(doc.visited).size!==doc.visited.length)fail('浏览进度中的已浏览节点列表无效。');
  if(typeof doc.savedAt!=='string'||!Number.isFinite(Date.parse(doc.savedAt)))fail('浏览进度中的保存时间无效。');
  // Imported saves are fully replayed. Snapshots just produced by the live
  // player are already canonical; avoid replaying the entire game every second.
  const reader=doc.schemaVersion===2?(trustedReader?doc.reader:validatePlaybackSnapshot(story,doc.reader)):null;
  const position=reader?.type==='story-player-program'?reader.reader:reader;
  if(position&&(position.sceneId!==doc.sceneId||position.rate!==doc.rate))fail('浏览位置与对白记录不一致。');
  return {type:'story-player-progress',schemaVersion:doc.schemaVersion,storyId:story.id,gameFingerprint:story.gameFingerprint,sceneId:doc.sceneId,time:doc.time,visited:[...doc.visited],rate:doc.rate,savedAt:doc.savedAt,...(reader?{reader}:{})};
}

export function createProgress(story,state,visited=[],{rate=1,reader=null}={}){
  const list=Array.from(visited||[]);if(!list.includes(state?.sceneId))list.push(state?.sceneId);
  return checked(story,{type:'story-player-progress',schemaVersion:reader?2:1,storyId:story.id,gameFingerprint:story.gameFingerprint,sceneId:state?.sceneId,time:state?.time,visited:list,rate,savedAt:new Date().toISOString(),...(reader?{reader}:{})},{trustedReader:true});
}
export function parseProgress(story,document){return checked(story,document);}
