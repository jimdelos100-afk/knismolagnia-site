const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const owns=(value,key)=>Object.hasOwn(value||{},key);
const statuses=new Set(['draft','translated','reviewed']);
const catalogCache=new WeakMap(),translationCache=new WeakMap();
const fail=message=>{throw new Error(message);};
function safeObject(value){
  const queue=[{value,depth:0}];let total=0;
  while(queue.length){const item=queue.pop();if(++total>500000||item.depth>60)fail('翻译文档结构过于复杂。');
    if(item.value&&typeof item.value==='object')for(const [key,child] of Object.entries(item.value)){
      if(['__proto__','constructor','prototype'].includes(key))fail('翻译文档含不支持的字段名称。');
      if(child&&typeof child==='object')queue.push({value:child,depth:item.depth+1});
    }
  }
}
function catalogFor(story){
  if(!plain(story)||!Array.isArray(story.texts))fail('当前演出包没有文字目录。');
  if(catalogCache.has(story))return catalogCache.get(story);
  const map=new Map();
  for(const entry of story.texts){if(!plain(entry)||typeof entry.id!=='string'||typeof entry.source!=='string'||map.has(entry.id))fail('演出包的文字编号或原文无效。');map.set(entry.id,entry);}
  catalogCache.set(story,map);return map;
}
function validatedDocument(story,doc){
  if(!plain(doc)||![1,2].includes(doc.schemaVersion)||!Array.isArray(doc.translations)||doc.type!==undefined&&doc.type!=='story-translations')fail('请选择受支持的第 1 或第 2 版翻译 JSON 文档。');
  if(typeof story.gameFingerprint!=='string'||!story.gameFingerprint||doc.gameFingerprint!==story.gameFingerprint)fail('翻译文档与当前演出包的版本不匹配。');
  if(doc.retainedExtensions!==undefined&&!Array.isArray(doc.retainedExtensions))fail('翻译文档的保留信息无效。');
  safeObject(doc);const known=catalogFor(story),seen=new Set();
  for(const entry of doc.translations){
    if(!plain(entry)||typeof entry.id!=='string'||!entry.id.trim()||typeof entry.source!=='string'||typeof entry.translation!=='string'||typeof entry.note!=='string'||!statuses.has(entry.status))fail('翻译文档中有条目字段缺失或类型错误。');
    if(seen.has(entry.id))fail(`翻译文档出现重复编号 ${entry.id}。`);seen.add(entry.id);
    const source=known.get(entry.id);
    if(source&&(entry.source!==source.source||entry.sourceHash&&source.sourceHash&&entry.sourceHash!==source.sourceHash))fail(`编号 ${entry.id} 的原文与当前演出包不一致，未应用任何内容。`);
  }
  return doc;
}

/** Blank imports never erase local text; unbound entries remain in the returned document. */
export function mergeTranslationDocument(story,currentDoc,incomingDoc){
  const empty={type:'story-translations',schemaVersion:2,gameFingerprint:story.gameFingerprint,gameName:story.title||'',translations:[]};
  const current=validatedDocument(story,currentDoc||empty),incoming=validatedDocument(story,incomingDoc),known=catalogFor(story);
  const entries=new Map(current.translations.map(entry=>[entry.id,structuredClone(entry)]));
  for(const raw of incoming.translations){
    const previous=entries.get(raw.id);
    if(previous&&previous.source!==raw.source)fail(`编号 ${raw.id} 的原文与已保存文档不一致，未应用任何内容。`);
    if(previous&&!raw.translation.trim())continue;
    const entry={...(previous||{}),...structuredClone(raw)};
    if(typeof previous?.note==='string')entry.note=previous.note;
    entries.set(entry.id,entry);
  }
  const document=structuredClone(current),retained=[...(document.retainedExtensions||[])];
  if(!Array.isArray(retained))fail('翻译文档的保留信息无效。');
  for(const [key,value] of Object.entries(incoming)){
    if(['translations','retainedExtensions'].includes(key))continue;
    if(owns(document,key)&&JSON.stringify(document[key])!==JSON.stringify(value)&&!['schemaVersion','gameName','exportedAt','toolVersion','exportMode'].includes(key))retained.push({field:key,value:structuredClone(document[key])});
    document[key]=structuredClone(value);
  }
  if(incoming.retainedExtensions!==undefined){if(!Array.isArray(incoming.retainedExtensions))fail('翻译文档的保留信息无效。');retained.push(...structuredClone(incoming.retainedExtensions));}
  document.type='story-translations';document.schemaVersion=2;document.gameFingerprint=story.gameFingerprint;document.translations=[...entries.values()];
  if(retained.length)document.retainedExtensions=retained;
  let matched=0,pending=0;
  for(const entry of entries.values()){if(!known.has(entry.id))pending++;else if(entry.translation.trim())matched++;}
  return {document,matched,pending};
}

/** Return plain text only. Rendering must use textContent or a safe rich-text parser. */
export function translateText(story,document,textId,language='translation'){
  const original=catalogFor(story).get(textId);
  if(!original)return {text:'',source:'',speaker:'',translated:false,missing:true};
  let map=translationCache.get(document);
  if(!map&&document&&typeof document==='object'){map=new Map((document.translations||[]).map(entry=>[entry.id,entry]));translationCache.set(document,map);}
  const entry=map?.get(textId),translated=language!=='original'&&typeof entry?.translation==='string'&&entry.translation.trim().length>0;
  return {text:translated?entry.translation:original.source,source:original.source,speaker:original.speaker||'',translated};
}
