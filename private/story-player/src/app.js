import {bindUnityFolder} from './unity-local.js';
import {createPlayer} from './playback.js';
import {AtomicStageImages,visualAssetIds} from './stage-images.js';
import {validateAssetManifest,auditBundledAssets,importVerifiedAssetFolder} from './asset-pack.js';
import {validatePresentation,PresentationRenderer} from './effects.js';
import {auditStory,createReviewCheckpoint,parseReviewCheckpoint,createReviewReport,inspectRenderedStage} from './review-tools.js';
import {ResourceLibrary} from './resources.js';
import {mergeTranslationDocument,translateText} from './translations.js';
import {createProgress,parseProgress} from './progress.js';
import {MediaController} from './media.js';
import {MenuSounds} from './menu-sounds.js';
import {renderRichText,countRichText} from './rich-text.js';
import {readStored,writeStored} from './store.js';
import {AutoReader} from './auto-reader.js';
import {readReadingSettings,saveReadingSettings,normalizeReadingSettings} from './reading-settings.js';
import {createGameShell} from './game-shell.js';
import {validateImageManifest,createImageTemplate,readLocalImagePack} from './localization-pack.js';
import {createGraphView} from './graph-view.js';
import {restoreProject} from './restore.js';

const $=id=>document.getElementById(id),ROOT=new URL('../',import.meta.url),VERSION='1.5.0';
const app={unityIndex:null,localReady:false,resourceLoading:false,story:null,player:null,library:null,media:null,translations:null,visited:new Set(),history:[],historyIndex:-1,actors:new Map(),graphButtons:new Map(),lastText:'',lastBackground:null,lastSave:0,saveChain:Promise.resolve(),loading:false,transitioning:false,support:[],lastState:null,config:null,savingBlocked:false,recovery:null,mode:'player',epoch:0,bundledStory:null,bundledTranslations:null,assetManifest:null,assetAudit:null,reviewAudit:null,presentation:null,checkpoints:[],stageAudit:null,graphView:null,mapManifest:null,sceneMap:new Map(),scenePositions:new Map(),storySceneIds:new Set(),storySceneCount:0,lengths:{},navigating:false,referenceURL:null,stageAuditSignature:null,resourceRevision:0,hudError:'',dialogueHidden:false,historyOpen:false,historyEntries:new Map()};
const WINDOW_SKIN='texture:sharedassets0.assets:789';
const autoReader=new AutoReader();
app.settings=readReadingSettings();app.scrubbing=false;app.previewState=null;app.scrubWanted=null;app.scrubRunning=false;
const status=text=>{$('statusMessage').textContent=text;$('publicStatus').textContent=text;};
const clearError=()=>{$('errorBox').hidden=true;app.hudError='';if($('hudStatus'))$('hudStatus').hidden=true;};
const showError=error=>{stopAuto();app.hudError=error?.message||String(error);$('errorMessage').textContent=app.hudError;$('errorBox').hidden=false;const node=$('hudStatus');if(node){node.dataset.kind='error';node.textContent=app.hudError;node.hidden=false;}};
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const legacyKeyFor=story=>`${story.id}|${story.gameFingerprint}`;
const keyFor=story=>`${legacyKeyFor(story)}|reader-${app.mode}|player-1.1`;
const emptyTranslations=story=>({type:'story-translations',schemaVersion:2,gameName:story.title,gameFingerprint:story.gameFingerprint,translations:[]});
const formatTime=time=>{const ticks=Math.round(Math.max(0,time)*10);return `${Math.floor(ticks/600).toString().padStart(2,'0')}:${(Math.floor(ticks/10)%60).toString().padStart(2,'0')}.${ticks%10}`;};
const sceneById=id=>app.sceneMap.get(id);
const activeScene=()=>sceneById(app.lastState?.sceneId||app.player?.state.sceneId);
const mapId=id=>id;
const sceneName=scene=>/^\d+(?:_\d+)*_txt$/i.test(scene.title)?`剧情 ${scene.title.replace(/_txt$/i,'').replaceAll('_','·')}`:scene.title;
const inputIds=['readerNext','readerPrevious','hudNext','hudPrevious','hudAuto','hudHistory','hudHide','autoReadButton','historyButton','hideDialogueButton','modeSelect','loadStoryPack','resetDemo','loadTranslation','importProgress','exportProgress','loadGameFolder','assetFolderButton','auditAssets','runReview','saveCheckpoint','exportReview','importCheckpoint','clearAssets','compareReference','clearReference','playPause','restartScene','previousScene','nextScene','readerPosition','timeSlider','speedSelect','languageSelect','fullscreenButton'];
const busy=()=>app.loading||app.transitioning;
function updateInputLocks(state=app.lastState||app.player?.state){
  const locked=busy()||!app.player;for(const id of inputIds)$(id).disabled=locked;
  if(locked){$('stageViewport').dataset.readerDisabled='true';syncReadingChrome(state);return;}
  $('auditAssets').disabled=app.config?.localGame||!app.assetManifest;$('loadGameFolder').disabled=app.config?.localGame?!app.unityIndex:!app.assetManifest;$('assetFolderButton').disabled=$('loadGameFolder').disabled;$('clearAssets').disabled=!(app.library?.provider||app.library?.overrides.size);$('clearReference').disabled=!app.referenceURL;for(const id of ['referenceOpacity','referenceMode'])$(id).disabled=!app.referenceURL;
  const choiceWait=['choice','signal'].includes(state.waiting);
  $('previousScene').disabled=app.historyIndex<=0;$('nextScene').disabled=!sceneById(state.sceneId)?.next;
  $('readerNext').disabled=app.scrubbing||app.historyOpen||!!state.ended||choiceWait||stagePending()||state.playing&&!['dialogue','text','node'].includes(state.waiting);
  $('readerPrevious').disabled=app.scrubbing||app.historyOpen||!app.player.canPreviousDialogue?.()||stagePending(state);
  $('readerPosition').disabled=!!app.story.program&&(choiceWait||state.ended);
  $('stageViewport').dataset.readerDisabled=String(!!state.ended||choiceWait||stagePending());
  if(app.config?.localGame&&!app.localReady){for(const id of ['readerPrevious','readerNext','playPause','restartScene','nextScene','readerPosition'])$(id).disabled=true;}
  if($('selectLocalGame'))$('selectLocalGame').disabled=busy()||!app.unityIndex;
  syncReadingChrome(state);
}
function beginTransition(){if(busy()||!app.player)return false;cancelScrub();stopAuto();app.menuSounds?.stop();app.transitioning=true;app.epoch++;app.player.pause();app.media?.sync({...app.player.state,rate:app.player.rate});updateInputLocks();return true;}
function endTransition(){app.transitioning=false;if(app.player&&!app.loading)render(app.player.state);else updateInputLocks();}
function guardedFile(handler){return async event=>{if(!event.target.files.length||!beginTransition()){event.target.value='';return;}try{await handler(event);}finally{event.target.value='';endTransition();}};}
// Native file pickers can finish after another action. Lock every entry point,
// including already-open pickers and keyboard controls, during a transition.
for(const type of ['click','change','input'])document.addEventListener(type,event=>{if(app.historyOpen&&event.target.closest('button,input,select,#stageViewport')&&!event.target.closest('#historyPanel,#hudHistory,#historyButton,#hudExitFullscreen,#fullscreenButton')){event.preventDefault();event.stopImmediatePropagation();return;}if(busy()&&event.target.closest('button,input,select,#stageViewport')&&!event.target.closest('#dismissError,#recoveryExport,#hudExitFullscreen,#hudRestore,#historyClose')){event.preventDefault();event.stopImmediatePropagation();}},true);
const safeData=doc=>{
  const queue=[{value:doc,depth:0}];let count=0;
  while(queue.length){const {value,depth}=queue.pop();if(++count>200000||depth>40)throw new Error('文件结构过于复杂，未应用。');if(value&&typeof value==='object')for(const [name,child]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(name))throw new Error('文件包含不支持的字段，未应用。');if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});}}
  return doc;
};
async function readJSON(file,maxMB=10){if(!file)return null;if(file.size>maxMB*1024*1024)throw new Error(`文件超过 ${maxMB} MB，未应用。`);try{return safeData(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));}catch(error){if(error instanceof SyntaxError)throw new Error('文件不是有效的 JSON 文档，未应用。');throw error;}}
async function fetchJSON(path,{withHash=false}={}){const response=await fetch(new URL(path,ROOT));if(!response.ok)throw new Error(`无法读取网页资源：${path}`);if(!withHash)return safeData(await response.json());const bytes=await response.arrayBuffer(),document=safeData(JSON.parse(new TextDecoder().decode(bytes)));const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');return {document,sha256};}
function downloadJSON(name,doc){const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)+'\n'],{type:'application/json;charset=utf-8'})),a=element('a');try{a.href=url;a.download=name;document.body.append(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}}

const setText=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
function syncReadingChrome(state=app.lastState){
  const unavailable=busy()||!app.player||app.config?.localGame&&!app.localReady;
  const gate=!!state&&(['choice','signal','node'].includes(state.waiting)||state.ended);
  if(gate)autoReader.setEnabled(false);
  const progress=app.scrubbing?{current:Math.max(0,(state?.dialogue?.index??-1)+1),total:state?.dialogue?.count||0,complete:false}:app.player?.getDialogueProgress?.()||{current:0,total:0,ratio:0,complete:false};
  const total=progress.total||0,current=Math.min(total,progress.current||0),bar=$('segmentProgress');
  const max=total||1,value=total?current:progress.complete?1:0;if(bar.max!==max)bar.max=max;if(bar.value!==value)bar.value=value;
  const seek=$('segmentSeek');if(seek){seek.max=String(Math.max(0,total-1));seek.disabled=unavailable||app.historyOpen||total<1;if(!app.scrubbing)seek.value=String(Math.max(0,current-1));seek.setAttribute('aria-valuetext',`第 ${current} 句，共 ${total} 句`);}
  setText($('segmentProgressLabel'),total?`本段 ${current} / ${total} 句 · 还剩 ${Math.max(0,total-current)} 句`:state?.waiting==='choice'||state?.waiting==='signal'?'本段过场 · 等待选择':progress.complete?'本段过场已结束':'本段过场');
  $('hudPrevious').disabled=$('readerPrevious').disabled||app.historyOpen||app.scrubbing;$('hudNext').disabled=$('readerNext').disabled||app.historyOpen||app.scrubbing;
  setText($('hudNext'),$('readerNext').textContent||'下一句');
  for(const id of ['hudAuto','autoReadButton']){const button=$(id);button.disabled=unavailable||app.historyOpen||app.scrubbing||gate;button.setAttribute('aria-pressed',String(autoReader.enabled));setText(button,autoReader.enabled?'自动：开':'自动播放');}
  for(const id of ['hudHistory','historyButton']){const button=$(id);button.disabled=unavailable||app.scrubbing;button.setAttribute('aria-expanded',String(app.historyOpen));}
  for(const id of ['hudHide','hideDialogueButton'])$(id).disabled=unavailable||app.historyOpen||app.scrubbing;
  setText($('hideDialogueButton'),app.dialogueHidden?'显示对话框':'隐藏对话框');
  $('stageViewport').dataset.dialogueHidden=String(app.dialogueHidden);$('hudRestore').hidden=!app.dialogueHidden;
  $('hudExitFullscreen').hidden=document.fullscreenElement!==$('stageViewport');
  const hudStatus=$('hudStatus');if(hudStatus){const pending=!!state&&(busy()||stagePending(state));hudStatus.hidden=!app.hudError&&!pending;hudStatus.dataset.kind=app.hudError?'error':'loading';if(!hudStatus.hidden)setText(hudStatus,app.hudError||'正在读取本段画面与声音…');}
  syncShell(state);
}

function applyReadingSettings(patch={},save=true){
  const before=app.settings.autoSpeed;app.settings=normalizeReadingSettings({...app.settings,...patch});if(save)saveReadingSettings(app.settings);if(before!==app.settings.autoSpeed)autoReader.reset();
  for(const id of ['hudAutoSpeed','autoReadSpeed'])if($(id))$(id).value=String(app.settings.autoSpeed);
  for(const id of ['hudAutoSpeedValue','autoReadSpeedValue'])if($(id))$(id).textContent=`${Number(app.settings.autoSpeed.toFixed(2))}×`;
  const dock=document.querySelector('.dialogue-dock');if(dock)dock.style.background=`linear-gradient(100deg,rgba(23,18,31,${app.settings.dialogueOpacity}),rgba(16,30,45,${app.settings.dialogueOpacity}))`;
  app.player?.setTextSpeed?.(app.settings.textSpeed);
  if(app.media){app.media.masterVolume=app.settings.masterVolume;app.media.channelVolumes={bgm:app.settings.bgmVolume,se:app.settings.seVolume,voice:app.settings.voiceVolume,ambient:app.settings.ambientVolume};if(!app.scrubbing&&app.lastState)app.media.sync({...app.lastState,rate:app.player.rate});}
  app.menuSounds?.setVolume(app.settings.masterVolume*app.settings.seVolume);
  syncShell(app.lastState);
}
function syncShell(state=app.lastState){
  if(!app.shell)return;const localizationStatus=app.localizationStatus||'正在使用内置汉化';
  const key=JSON.stringify([app.localReady,state?.sceneId,app.settings,localizationStatus,app.resourceRevision]);if(app.shellKey===key)return;app.shellKey=key;
  app.shell.update({localReady:app.localReady,sceneId:state?.sceneId,settings:app.settings,localizationStatus,resourceRevision:app.resourceRevision});
}
const localizationKey=story=>`${story.id}|${story.gameFingerprint}|localization-1`;
function applyImageOverrides(){
  const entries=new Map((app.baseImageEntries||[]).map(entry=>[entry.assetId,entry]));for(const entry of app.localImageEntries||[])entries.set(entry.assetId,entry);
  app.library.replaceImageOverrides([...entries.values()]);invalidateImages();
  app.localizationStatus=`${app.customTranslation?'已载入本机更新译文':'正在使用内置译文'} · ${app.localImageEntries?.length||0} 张本机替换图片 · ${app.baseImageEntries?.length||0} 张内置替换图片`;
  app.shellKey=null;syncShell();
}
async function saveLocalization(){
  await writeStored(localizationKey(app.story),{type:'xp2-localization-cache',gameFingerprint:app.story.gameFingerprint,translations:app.customTranslation?app.translations:null,imageManifest:app.localImageManifest||null,imageEntries:app.localImageEntries||[]});
}
async function restoreLocalization(){
  app.baseImageEntries=[];app.localImageEntries=[];app.localImageManifest=null;app.customTranslation=false;
  if(!app.unityIndex)return;
  const deployed=validateImageManifest(await fetchJSON(app.config.imageOverrides||'data/image-overrides.json'),app.unityIndex);
  app.baseImageEntries=deployed.images.map(image=>({assetId:image.assetId,url:new URL(image.path,ROOT).href}));
  try{
    let nextTranslations=app.translations,nextCustom=false,nextManifest=null,nextEntries=[];
    const saved=await readStored(localizationKey(app.story));
    if(saved){
      if(saved.type!=='xp2-localization-cache'||saved.gameFingerprint!==app.story.gameFingerprint)throw new Error('本机汉化更新与游戏版本不一致。');
      if(saved.translations){nextTranslations=mergeTranslationDocument(app.story,app.translations,saved.translations).document;nextCustom=true;}
      if(saved.imageManifest){
        const manifest=validateImageManifest(saved.imageManifest,app.unityIndex),entries=saved.imageEntries||[];
        if(entries.length!==manifest.images.length)throw new Error('本机图片更新记录不完整。');
        const files=[new File([JSON.stringify(manifest)],'overrides.json',{type:'application/json'})];
        for(const image of manifest.images){const entry=entries.find(item=>item.assetId===image.assetId);if(!(entry?.file instanceof Blob))throw new Error('本机替换图片记录无效。');const file=new File([entry.file],image.path.split('/').at(-1),{type:entry.file.type});Object.defineProperty(file,'relativePath',{value:image.path});files.push(file);}
        const restored=await readLocalImagePack(files,app.unityIndex);nextManifest=restored.manifest;nextEntries=restored.entries;
      }
    }
    app.translations=nextTranslations;app.customTranslation=nextCustom;app.localImageManifest=nextManifest;app.localImageEntries=nextEntries;
  }catch(error){showError(new Error(`本机汉化更新未能完整恢复：${error.message}。可在游戏设置重新导入。`));}
  applyImageOverrides();
}
function exportImageTemplate(){if(app.unityIndex)downloadJSON('overrides.json',createImageTemplate(app.unityIndex));}
async function resetLocalization(){
  if(!beginTransition())return;
  try{app.translations=mergeTranslationDocument(app.story,emptyTranslations(app.story),app.bundledTranslations||emptyTranslations(app.story)).document;app.customTranslation=false;app.localImageEntries=[];app.localImageManifest=null;applyImageOverrides();syncTextLengths();await saveLocalization();status('已恢复网站内置汉化，浏览进度保持。');}
  catch(error){showError(error);}finally{endTransition();}
}
function mountGameShell(){
  if(!$('gameShell')||!app.story)return;
  app.shell=createGameShell($('gameShell'),{
    story:app.story,index:app.unityIndex,translateText:id=>translateText(app.story,app.translations,id).text,
    onSelectFolder:()=>$('gameFiles').click(),
    onStart:async()=>{if(app.localReady){await requestJump(app.story.startScene);app.shell?.showPage('reader');}},
    onContinue:()=>app.shell?.showPage('reader'),
    onJump:async(id,{dialogueIndex}={})=>{await requestJump(id);if(Number.isInteger(dialogueIndex)&&app.player.state.sceneId===id&&beginTransition())try{app.player.commitDialogue(dialogueIndex);await readyStageResources();scheduleSave(true);}catch(error){showError(error);}finally{endTransition();}app.shell?.showPage('reader');},
    onPageChange:page=>{app.menuSounds?.stop();if(page!=='reader'){cancelScrub();stopAuto();app.player.pause();app.media.stop();scheduleSave(true);}},
    onSettingsChange:patch=>applyReadingSettings(patch),
    onImportTranslation:()=>$('translationFile').click(),
    onImportImages:()=>$('localizedImageFiles')?.click(),
    onExportImageTemplate:()=>exportImageTemplate(),
    onResetLocalization:()=>resetLocalization(),
    onVisibleAssets:ids=>{app.shellAssets=new Set(ids);},
    onMenuSound:cue=>{app.menuSounds?.play(cue).catch(()=>{});},
    onPreviewAsset:id=>{app.galleryPin=id;},
    resolveAsset:async id=>{if(!app.localReady)throw new Error('请先选择游戏目录。');const library=app.library;await library.preload([id]);if(library!==app.library)throw new Error('游戏资源已切换，请重试。');return library.resolve(id);},
  });
  app.shellKey=null;syncShell();
}
function cancelScrub(){
  if(!app.scrubbing)return;app.scrubRun=(app.scrubRun||0)+1;app.scrubbing=false;app.previewState=null;app.scrubWanted=null;app.scrubCommit=false;app.scrubRunning=false;
  if(app.player&&!busy())render(app.player.state);
}
function requestScrub(index,commit=false){
  if(busy()||!app.player||!app.localReady||!Number.isInteger(index))return;
  if(!app.scrubbing){stopAuto();closeHistory(false);app.scrubbing=true;app.scrubScene=app.player.state.sceneId;app.scrubEpoch=app.epoch;app.player.pause();app.media.stop();}
  app.scrubWanted=index;app.scrubCommit=app.scrubCommit||commit;drainScrub();
}
async function drainScrub(){
  if(app.scrubRunning)return;app.scrubRunning=true;const run=app.scrubRun=(app.scrubRun||0)+1;
  try{
    while(app.scrubbing&&app.scrubRun===run&&app.scrubWanted!==null){
      const index=app.scrubWanted;app.scrubWanted=null;
      if(app.epoch!==app.scrubEpoch||app.player.state.sceneId!==app.scrubScene){cancelScrub();return;}
      const preview=app.player.previewDialogue(index);app.previewState=preview;render(preview);
      const ready=await app.stageImages.waitFor(preview);
      if(app.scrubRun!==run||!app.scrubbing)return;
      if(!ready)throw new Error('速览图片尚未准备好，已保留原画面。');
      render(preview);
      if(app.scrubCommit&&app.scrubWanted===null){
        app.previewState=null;app.player.commitDialogue(index);app.scrubbing=false;app.scrubCommit=false;
        if(beginTransition())try{render(app.player.state);await readyStageResources();scheduleSave(true);status(`已定位本段第 ${index+1} 句，点击继续阅读。`);}finally{endTransition();}return;
      }
      // Let the browser paint each decoded composition before taking the latest thumb position.
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
  }catch(error){cancelScrub();showError(error);}finally{if(app.scrubRun===run)app.scrubRunning=false;}
}
for(const id of ['hudAutoSpeed','autoReadSpeed'])$(id)?.addEventListener('input',event=>applyReadingSettings({autoSpeed:Number(event.target.value)}));
$('segmentSeek')?.addEventListener('input',event=>requestScrub(Number(event.target.value)));
$('segmentSeek')?.addEventListener('change',event=>requestScrub(Number(event.target.value),true));
$('segmentSeek')?.addEventListener('pointercancel',cancelScrub);
$('segmentSeek')?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelScrub();}});
function stopAuto(){autoReader.setEnabled(false);for(const id of ['hudAuto','autoReadButton']){const button=$(id);if(button){button.setAttribute('aria-pressed','false');setText(button,'自动播放');}}}
function toggleAuto(){
  if(busy()||!app.player||app.historyOpen||app.config?.localGame&&!app.localReady)return;
  const state=app.player.state;if(state.ended||['choice','signal','node'].includes(state.waiting))return;
  if(autoReader.enabled){stopAuto();app.player.pause();status('自动播放已关闭，点击继续阅读。');}
  else{autoReader.setEnabled(true);previousFrame=performance.now();app.media.unlock();app.player.play();status('自动播放已开启，遇到分支会暂停。');}
  syncReadingChrome(app.lastState);
}
function setDialogueHidden(hidden){app.dialogueHidden=!!hidden;if(hidden)closeHistory(false);syncReadingChrome(app.lastState);(hidden?$('hudRestore'):$('stageViewport')).focus({preventScroll:true});}
function closeHistory(restoreFocus=true){
  if(!app.historyOpen)return;app.historyOpen=false;app.historyEntries.clear();$('historyPanel').hidden=true;$('historyList').replaceChildren();
  if(app.player)updateInputLocks(app.lastState||app.player.state);
  if(restoreFocus){const target=[$('hudHistory'),$('historyButton'),$('stageViewport')].find(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');target?.focus({preventScroll:true});}
}
function openHistory(){
  if(busy()||!app.player||app.config?.localGame&&!app.localReady)return;
  if(app.historyOpen){closeHistory();return;}
  stopAuto();app.dialogueHidden=false;app.historyOpen=true;app.player.pause();
  const entries=app.player.getDialogueHistory(30),list=$('historyList');list.replaceChildren();app.historyEntries=new Map(entries.map(entry=>[entry.token,entry]));
  for(const [index,entry]of entries.entries()){
    const item=translateText(app.story,app.translations,entry.textId,app.mode==='player'?'translation':$('languageSelect').value);
    const button=element('button','history-entry');button.type='button';button.dataset.historyToken=entry.token;
    button.append(element('span','history-speaker',`${index+1}. ${entry.speaker||item.speaker||'旁白'}`));
    const text=element('span','history-text');renderRichText(text,item.text,{visibleCharacters:countRichText(item.text)});button.append(text);list.append(button);
  }
  if(!entries.length)list.append(element('p','history-empty','还没有更早的已读对白。'));
  const current=app.player.state.dialogue;
  if(current?.textId){const item=translateText(app.story,app.translations,current.textId,app.mode==='player'?'translation':$('languageSelect').value);const line=element('p','history-current');line.append(element('strong','','当前句 · '));const text=element('span','history-text');renderRichText(text,item.text,{visibleCharacters:countRichText(item.text)});line.append(text);list.append(line);}
  $('historyPanel').hidden=false;list.scrollTop=list.scrollHeight;$('historyClose').focus({preventScroll:true});updateInputLocks(app.lastState);
}
async function jumpHistory(token){
  if(!app.historyEntries.has(token)||!beginTransition())return;
  try{app.media.stop();app.player.rewindToDialogue(token);closeHistory(false);app.dialogueHidden=false;app.lastState=app.player.state;
    buildDialoguePositions();app.visited.add(app.lastState.sceneId);updateProgressSummary();await readyStageResources();scheduleSave(true);status('已返回所选对白，点击继续阅读。');
  }catch(error){showError(error);}finally{endTransition();$('stageViewport').focus({preventScroll:true});}
}
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stageViewport').requestFullscreen();}catch{showError(new Error('当前浏览器或嵌入页面未允许全屏，可继续在页面中浏览。'));}}
for(const id of ['hudPrevious'])$(id).addEventListener('click',previousReading);
$('hudNext').addEventListener('click',()=>continueReading());
for(const id of ['hudAuto','autoReadButton'])$(id).addEventListener('click',toggleAuto);
for(const id of ['hudHistory','historyButton'])$(id).addEventListener('click',openHistory);
for(const id of ['hudHide','hideDialogueButton'])$(id).addEventListener('click',()=>setDialogueHidden(!app.dialogueHidden));
$('hudRestore').addEventListener('click',()=>setDialogueHidden(false));$('hudExitFullscreen').addEventListener('click',toggleFullscreen);
$('historyClose').addEventListener('click',()=>closeHistory());
$('historyList').addEventListener('click',event=>{const button=event.target.closest('[data-history-token]');if(button)jumpHistory(button.dataset.historyToken);});

function renderNativeWindow(state){
  const windowEffect=state?.nativeEffects?.messageWindow,window=$('messageWindow'),scale=app.viewportScale||1;
  const x=windowEffect?.offsetX||0,y=windowEffect?.offsetY||0;
  window.style.transform=`translate(${x*scale}px, ${y*scale}px)`;window.style.opacity=String(windowEffect?.opacity??1);
  if(windowEffect?.visible===false)window.hidden=true;
}
async function refreshNativeWindowSkin(){
  const dock=document.querySelector('.dialogue-dock'),library=app.library,revision=app.resourceRevision;
  if(!app.localReady||!library?.asset(WINDOW_SKIN)){dock.style.removeProperty('--native-window-image');return;}
  await library.preload([WINDOW_SKIN]);
  if(app.library!==library||app.resourceRevision!==revision||!app.localReady)return;
  const url=library.resolve(WINDOW_SKIN);if(url)dock.style.setProperty('--native-window-image',`url("${url}")`);
}
function fitStage(){if(app.stageAudit)invalidateStageReview();const width=app.story?.stage?.width||1280,height=app.story?.stage?.height||720,viewport=$('stageViewport'),full=document.fullscreenElement===viewport,scale=full?Math.min(viewport.clientWidth/width,viewport.clientHeight/height):viewport.clientWidth/width;app.viewportScale=scale;viewport.style.aspectRatio=full?'auto':`${width} / ${height}`;Object.assign($('logicalStage').style,{width:`${width}px`,height:`${height}px`,left:full?`${(viewport.clientWidth-width*scale)/2}px`:'0px',top:full?`${(viewport.clientHeight-height*scale)/2}px`:'0px',transformOrigin:'top left',transform:`scale(${scale})`});renderNativeWindow(app.lastState);}
function setRate(rate){app.player.setRate(rate);if(!Array.from($('speedSelect').options).some(option=>Number(option.value)===rate))$('speedSelect').append(new Option(`${rate}×`,String(rate)));$('speedSelect').value=String(rate);scheduleSave(true);}
function syncTextLengths(){
  const lengths=Object.fromEntries(app.story.texts.map(item=>[item.id,countRichText(translateText(app.story,app.translations,item.id,app.mode==='player'?'translation':$('languageSelect').value).text)]));
  app.lengths=lengths;app.lastChoicesKey=null;app.player.setTextLengths(lengths);app.lastText='';
}
function buildDialoguePositions(){
  const select=$('readerPosition');select.replaceChildren(new Option('选择对白位置',''));if(app.mode!=='review')return;
  const scene=activeScene(),commands=scene.commands;
  const lines=commands?commands.filter(command=>command.type==='dialogue').map(command=>scene.events[command.eventIndex]):scene.events.filter(event=>event.type==='dialogue'&&event.textId).sort((a,b)=>a.at-b.at);
  lines.forEach((event,index)=>{if(!event?.textId)return;const item=translateText(app.story,app.translations,event.textId,app.mode==='player'?'translation':$('languageSelect').value);select.append(new Option(`${index+1}. ${item.speaker?item.speaker+'：':''}${item.text.replace(/<[^>]+>/g,'').slice(0,40)}`,String(index)));});
}
function updateProgressSummary(){
  if(!app.story)return;
  const visited=[...app.visited].filter(id=>app.storySceneIds.has(id));
  $('progressSummary').textContent=`已浏览 ${visited.length} / ${app.storySceneCount} 个剧情片段 · ${app.savingBlocked?'请导出当前进度':'本机自动保存'}`;
  app.graphView?.setCurrent(app.lastState?.sceneId||app.player?.state.sceneId,app.visited);
}
function buildGraph(){
  app.graphView?.dispose();
  app.graphView=createGraphView($('graphCanvas'),app.mapManifest,{
    loadChapter:async key=>{const chapter=app.mapManifest.chapters.find(item=>item.id===key||item.key===key);if(!chapter)throw new Error('没有找到该章节。');return fetchJSON(new URL(chapter.file,new URL(app.config.chapterMap||'data/chapter-map/manifest.json',ROOT)).href);},
    onNavigate:id=>requestJump(id),
  });
  updateProgressSummary();
}
async function readyStageResources(){
  if(!app.localReady||!app.library?.provider)return;
  const ids=currentResourceIds(app.player.state);
  await app.library.preload(ids);
  if(app.stageImages&&!await app.stageImages.waitFor(app.player.state))throw new Error('当前画面尚未完成解码，已保留上一帧。');
  const failed=ids.filter(id=>!app.library.resolve(id));
  if(failed.length)throw new Error('当前分支的画面或声音未能完整读取，请检查游戏文件后重新选择目录。');
}
async function requestJump(sceneId){
  if(!beginTransition())return;
  try{
    clearError();status('正在准备所选分支的画面与声音…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    navigate(sceneId,{internal:true,save:false});
    await readyStageResources();
    scheduleSave(true);const route=app.player.state.program?.mapRoute;status(`已定位到「${sceneName(activeScene())}」${route?route.preference==='visited'?'，沿已选路径还原':route.preference==='isolated'?'，从独立入口浏览':'，按默认可达路径还原':''}，点击继续阅读。`);
  }catch(error){showError(error);}finally{endTransition();}
}
function renderChoices(state){
  const scene=sceneById(state.sceneId),panel=$('choicePanel');panel.replaceChildren();
  const invoke=action=>{if(busy()||app.historyOpen)return;try{stopAuto();app.media.unlock();app.player.play();action();scheduleSave(true);}catch(error){showError(error);}};
  if(app.story.program){
    const items=state.signal?.outcomes||state.choices||[];panel.hidden=!items.length;if(!items.length)return;
    panel.append(element('span','choice-heading',state.signal?'选择演出结果':'选择分支'));
    for(const choice of items){const label=app.story.texts.some(item=>item.id===choice.id)?translateText(app.story,app.translations,choice.id,app.mode==='player'?'translation':$('languageSelect').value).text:choice.label;const button=element('button','choice-button',label);const nodeId=state.program.nodeId;
      button.addEventListener('click',()=>{if(app.player.state.program?.nodeId!==nodeId)return;invoke(()=>state.signal?app.player.completeSignal(state.signal.token,choice.id):app.player.choose(choice.id));});panel.append(button);}
    return;
  }
  if(!state.ended){panel.hidden=true;return;}
  const choices=scene.choices?.length?scene.choices:scene.next?[{label:'进入下一段',target:scene.next}]:[];
  panel.hidden=!choices.length;if(!choices.length)return;
  panel.append(element('span','choice-heading','继续浏览'));
  for(const choice of choices){const button=element('button','choice-button');button.append(element('strong','',choice.label||sceneById(choice.target)?.title||'下一段'));if(choice.conditionLabel)button.append(element('span','',choice.conditionLabel));button.addEventListener('click',()=>navigate(choice.target));panel.append(button);}
}
function render(state){
  if(!app.story||!app.player)return;app.lastState=state;
  app.library?.retain([...currentResourceIds(state),...(app.stageImages?.retained||[]),...(app.shellAssets||[]),...(app.menuSounds?.retained||[]),...(app.localReady?[WINDOW_SKIN]:[]),...(app.galleryPin?[app.galleryPin]:[])]);
  if(app.lastRenderedScene&&app.lastRenderedScene!==state.sceneId&&!app.navigating){app.visited.add(state.sceneId);app.history=app.history.slice(0,app.historyIndex+1);app.history.push(state.sceneId);app.historyIndex=app.history.length-1;buildDialoguePositions();updateProgressSummary();}
  const scene=sceneById(state.sceneId),width=app.story.stage.width,height=app.story.stage.height,camera=state.camera||{};
  $('sceneTitle').textContent=sceneName(scene);$('sceneDescription').textContent=scene.subtitle==='顺序指令段'&&app.mode==='player'?'逐句阅读 · 可从地图选择场景':scene.description||scene.subtitle||'';const position=app.scenePositions.get(state.sceneId);$('sceneCounter').textContent=position?.label||'';
  $('playPause').textContent=state.playing?'暂停':'播放';$('playPause').setAttribute('aria-label',state.playing?'暂停演出':'播放演出');$('playPause').setAttribute('aria-pressed',String(state.playing));
  $('timeSlider').max=String(state.duration);$('timeSlider').value=String(state.time);$('timeSlider').setAttribute('aria-valuetext',`${formatTime(state.time)}，共 ${formatTime(state.duration)}`);$('timeLabel').textContent=`${formatTime(state.time)} / ${formatTime(state.duration)}`;
  $('previousScene').disabled=app.historyIndex<=0;$('nextScene').disabled=!scene.next;
  const visualState=((!app.config?.localGame||app.localReady)?app.stageImages?.sync(state,{revision:app.resourceRevision}):null)||state,visualCamera=visualState.camera||camera;
  const transform=`translate(${(visualCamera.x||0)+(visualCamera.shakeX||0)}px, ${(visualCamera.y||0)+(visualCamera.shakeY||0)}px) rotate(${visualCamera.rotation||0}deg) scale(${visualCamera.scale??1})`;
  for(const layer of [$('backgroundLayer'),$('actorLayer')]){layer.style.transform=transform;layer.style.transformOrigin=`${width/2}px ${height/2}px`;}
  const overlay=visualState.overlay||{};$('overlayLayer').style.backgroundColor=overlay.color||'#000000';$('overlayLayer').style.opacity=String(overlay.opacity||0);
  const dialogue=state.dialogue||{};$('messageWindow').hidden=dialogue.visible===false||!dialogue.textId;
  renderNativeWindow(state);
  if(dialogue.textId){
    const language=app.mode==='player'?'translation':$('languageSelect').value||'translation';
    const page=dialogue.pageSegments?.length?dialogue.pageSegments:[{textId:dialogue.textId,current:true,breakBefore:false}];
    let combined='',visible=0;
    for(const segment of page){const text=translateText(app.story,app.translations,segment.textId,language);combined+=(segment.breakBefore?'\n':'')+text.text;visible+=segment.current?(dialogue.visibleCharacters??0):(app.lengths[segment.textId]??countRichText(text.text));}
    const translated=translateText(app.story,app.translations,dialogue.textId,language),signature=JSON.stringify([combined,visible,translated.speaker,dialogue.speaker]);
    if(signature!==app.lastText){app.lastText=signature;$('speakerName').textContent=dialogue.speaker||translated.speaker||'';renderRichText($('dialogueText'),combined,{visibleCharacters:visible});}
  }
  const choiceWait=state.waiting==='choice'||state.waiting==='signal';
  const nativeInputWait=!!state.nativeEffects?.inputWaiting&&dialogue.textComplete;
  $('readerNext').textContent=state.ended?'本段结束':choiceWait?(state.signal?'等待演出结果':'请选择分支'):state.waiting==='node'?'继续剧情':!state.playing?'继续阅读':nativeInputWait?'演出完成后下一句':state.waiting==='dialogue'?(dialogue.textComplete?'下一句':'显示完整对白'):state.waiting==='text'?'显示完整对白':'演出进行中';
  $('readerNext').disabled=app.historyOpen||!!state.ended||choiceWait||stagePending()||state.playing&&!['dialogue','text','node'].includes(state.waiting);
  $('readerHint').textContent=state.ended?'本段已结束，可选择地图中的其他场景。':choiceWait?(state.signal?'本段正在等待演出结果，请选择下方结果继续。':'请选择下方分支继续。'):state.waiting==='node'?'已定位到此分支节点，点击继续剧情。':!state.playing?'点击画面或按空格继续阅读。':state.waiting==='dialogue'?(dialogue.textComplete?'点击画面进入下一句。':'点击画面显示完整对白，再次点击继续。'):state.waiting==='text'?'文字显示后会自动继续，点击可补全文字。':'正在演出，请稍候。';
  $('stageViewport').dataset.readerDisabled=String(state.ended||choiceWait);
  $('stageViewport').setAttribute('aria-label',state.ended?'本段结束，请选择地图节点':choiceWait?'请使用下方选项继续':!state.playing?'继续剧情阅读':state.waiting==='dialogue'?'点击继续对白':'剧情演出画面');
  $('readerPosition').value=dialogue.index>=0?String(dialogue.index):'';
  $('readerPrevious').disabled=app.historyOpen||!app.player.canPreviousDialogue?.()||stagePending(state);
  $('readerPosition').disabled=!!app.story.program&&(choiceWait||state.ended);
  $('stageLabel').textContent=app.config?.localGame?'XP2 · 本地资源':'二维演出';
  const video=state.video;if(video){$('videoLayer').style.transform=transform;$('videoLayer').style.transformOrigin=`${width/2-(video.x||0)}px ${height/2-(video.y||0)}px`;}
  if(!app.scrubbing)app.media.sync({...visualState,rate:app.player.rate});
  $('visualLayer').style.filter=app.presentation.sync(app.story,visualState);
  $('reviewCurrent').textContent=`${scene.title} · 舞台 ${Number(state.stageTime??state.time).toFixed(2)} 秒`;
  syncReference();
  const choicesKey=JSON.stringify([state.sceneId,state.waiting,state.ended,state.choices,state.signal]);if(app.lastChoicesKey!==choicesKey){renderChoices(state);app.lastChoicesKey=choicesKey;}app.lastRenderedEnded=state.ended;app.lastRenderedScene=state.sceneId;
  if(app.stageAudit&&app.stageAuditSignature!==currentStageSignature(state))invalidateStageReview();
  scheduleSave();
  updateInputLocks(state);
}
function saveEnvelope(){if(!app.player)return null;return {progress:createProgress(app.story,app.player.state,app.visited,{rate:app.player.rate,reader:app.player.snapshot()}),...(app.mode==='review'?{translations:app.translations}:{}),language:app.mode==='player'?'translation':$('languageSelect').value};}
function scheduleSave(force=false){
  if(app.loading||app.scrubbing||app.savingBlocked||!app.player)return;const now=performance.now();if(!force&&now-app.lastSave<1000)return;app.lastSave=now;
  const envelope=saveEnvelope(),key=keyFor(app.story);app.saveChain=app.saveChain.catch(()=>{}).then(()=>writeStored(key,envelope)).catch(()=>{$('progressSummary').textContent='本机保存不可用，请导出浏览记录。';});
}
function navigate(sceneId,{history=true,time=0,save=true,reader=null,internal=false}={}){
  if(busy()&&!internal)return;stopAuto();closeHistory(false);if(!sceneById(sceneId))throw new Error('没有找到该剧情节点。');app.media.stop();app.navigating=true;try{app.player.enter(sceneId);if(reader)app.player.restore(reader);else if(time)app.player.seek(time);}finally{app.navigating=false;}app.lastState=app.player.state;app.visited.add(app.lastState.sceneId);
  if(history){app.history=app.history.slice(0,app.historyIndex+1);app.history.push(sceneId);app.historyIndex=app.history.length-1;}
  buildDialoguePositions();updateProgressSummary();render(app.player.state);if(save)scheduleSave(true);status(`已进入「${activeScene().title}」，点击画面开始阅读。`);
}
function translationSummary(result){$('translationSummary').textContent=`${result.matched} 条已匹配译文${result.pending?` · ${result.pending} 条尚未绑定`:' · 原文逐条核对'}`;}
async function installStory(story,document=null,{restore=true}={}){
  if(app.config?.localGame){app.localReady=false;window.document.body.dataset.localGame='waiting';$('localGameGate').hidden=false;}
  if(app.loading)throw new Error('当前演出包仍在载入，请稍后再切换。');
  validatePresentation(story); // The prospective public player validates the full story before replacing the current project.
  const mapManifest=story.id===app.bundledStory?.id?app.bundledMapManifest:null;
  if(!mapManifest)throw new Error('当前剧情包缺少章节目录。');
  const assetManifest=story.id===app.bundledStory?.id?app.bundledAssetManifest:story.assetManifest||null;
  if(assetManifest)story={...story,assetManifest:validateAssetManifest(story,assetManifest)};
  const assets=new Map(story.assets.map(asset=>[asset.id,asset]));for(const [id,asset]of Object.entries(app.unityIndex?.assets||{}))if(['texture','audio'].includes(asset.kind)&&!assets.has(id))assets.set(id,{id,type:asset.kind==='texture'?'image':'audio',src:`local-assets/${id.replaceAll(':','_').replaceAll('.','_')}.${asset.kind==='texture'?'png':'ogg'}`,label:asset.name});
  const library=new ResourceLibrary({baseURL:ROOT.href,assets:[...assets.values()],localOnly:!!app.config?.localGame,onReady:()=>{if(app.library===library&&app.player&&!busy())render(app.previewState||app.player.state);},onError:error=>{stopAuto();app.player?.pause();showError(error);}});
  let merged,player,activated=false;
  try{
    // A structurally valid program can still fail while resolving its entry.
    // Keep the current project intact until the prospective player is ready.
    player=createPlayer(story,{onUpdate:state=>{if(activated&&!busy()&&!app.scrubbing)render(state);},onEnd:()=>{if(activated&&!busy()&&!app.scrubbing){status('本段演出已结束。可以选择分支或地图节点。');scheduleSave(true);}}});
    if(app.bundledNativePresentation&&story.id===app.bundledStory?.id)player.setNativeEffects(app.bundledNativePresentation);
    merged=mergeTranslationDocument(story,emptyTranslations(story),document||emptyTranslations(story));
    const lengths=Object.fromEntries(story.texts.map(item=>[item.id,countRichText(translateText(story,merged.document,item.id,app.mode==='player'?'translation':$('languageSelect').value).text)]));
    player.setTextLengths(lengths);
  }catch(error){player?.dispose();library.dispose();throw error;}
  app.loading=true;app.epoch++;updateInputLocks();
  try{
  cancelScrub();app.shell?.dispose();app.shell=null;app.shellKey=null;app.shellAssets=new Set();app.galleryPin=null;app.menuSounds?.dispose();app.stageImages?.dispose();app.presentation?.dispose();app.media?.dispose();app.library?.dispose();app.player?.dispose();app.graphView?.dispose();app.graphView=null;app.savingBlocked=false;
  app.story=story;app.mapManifest=mapManifest;app.sceneMap=new Map(story.scenes.map(scene=>[scene.id,scene]));
  app.storySceneIds=new Set(story.scenes.filter(scene=>!scene.id.startsWith('archive-')).map(scene=>scene.id));app.storySceneCount=app.storySceneIds.size;
  app.scenePositions=new Map();for(const reference of [false,true]){const scenes=story.scenes.filter(scene=>scene.id.startsWith('archive-')===reference);scenes.forEach((scene,index)=>app.scenePositions.set(scene.id,{label:`${reference?'资料 ':''}${index+1} / ${scenes.length}`}));}
  app.lastState=null;app.localReady=!app.config?.localGame;window.document.body.dataset.localGame=app.localReady?'ready':'waiting';$('localGameGate').hidden=app.localReady;autoReader.setEnabled(false);app.historyOpen=false;app.dialogueHidden=false;app.historyEntries.clear();$('historyPanel').hidden=true;app.library=library;app.player=player;activated=true;app.translations=merged.document;app.visited=new Set();app.history=[];app.historyIndex=-1;app.actors.clear();$('actorLayer').replaceChildren();app.lastBackground=null;$('backgroundLayer').replaceChildren();app.lastText='';app.lastRenderedScene=null;app.lastRenderedEnded=null;
  app.stageImages=new AtomicStageImages($('backgroundLayer'),$('actorLayer'),library,{lighting:app.bundledNativePresentation?.nativeUiSettings?.AdvCharacterGrayOutController?.data,onReady:()=>{if(app.library===library&&app.player&&!busy())render(app.previewState||app.player.state);},onError:error=>{stopAuto();app.player?.pause();showError(error);}});
  app.presentation=new PresentationRenderer($('effectLayer'),library);
  app.assetManifest=assetManifest;app.assetAudit=null;app.reviewAudit=app.mode==='review'?auditStory(story):null;app.checkpoints=[];app.stageAudit=null;clearReference();
  app.media=new MediaController($('videoLayer'),library,message=>{$('mediaStatus').textContent=message;if(/无法|尚未|检查/.test(message))status(message);});
  app.menuSounds=new MenuSounds(library,{enabled:()=>app.localReady&&!busy()&&!window.document.hidden&&window.document.body.dataset.shellPage!=='reader'});
  let restored=null;
  if(restore)try{let saved=await readStored(keyFor(story));const recovered=restoreProject(story,app.translations,saved,{useSavedTranslations:app.mode==='review'});restored=recovered.progress;app.translations=recovered.translations;$('languageSelect').value=app.mode==='player'?'translation':recovered.language;if(recovered.errors.length){app.savingBlocked=true;app.recovery={key:keyFor(story),saved:recovered.preserved};$('recoveryExport').hidden=false;showError(new Error(recovered.errors.join('；')+'。有效部分已恢复，原始记录未覆盖。可导出保留记录，或导出当前浏览进度。'));}}catch{restored=null;app.savingBlocked=true;showError(new Error('本机记录无法读取，已暂停自动保存。可先导出当前浏览进度。'));}
  else if(app.recovery?.key===keyFor(story))await writeStored(`recovery|${app.recovery.key}|${Date.now()}`,app.recovery.saved).catch(()=>{app.savingBlocked=true;});
  await restoreLocalization();syncTextLengths();app.loading=false;$('storyTitle').textContent=story.title;app.visited=new Set(restored?.visited||[]);navigate(restored?.sceneId||story.startScene,{time:restored?.time||0,reader:restored?.reader||null,save:false,internal:true});buildGraph();setRate(app.mode==='player'?1:restored?.rate||1);translationSummary(mergeTranslationDocument(story,emptyTranslations(story),app.translations));fitStage();renderSupport();
  $('sourceNotice').textContent='游戏文件按版本与资源编号匹配；所选文件只在本机读取，不会上传。';
  $('sampleTitle').textContent=app.config?.localGame?'XP2 本地剧情':'演出包';$('sampleDescription').textContent='内置中文翻译 · 选择场景，逐句阅读。';
  $('gameFolderSummary').textContent=app.config?.localGame?'尚未绑定本地游戏，请选择游戏本体文件夹。':'正在使用随网页提供的素材。';renderReview();
  render(app.player.state);
  applyReadingSettings({},false);mountGameShell();
  }finally{
  app.loading=false;
  updateInputLocks();
  }
}

function auditMessage(progress){if(typeof progress==='string')return status(progress);if(progress?.message)return status(progress.message);status('正在核验素材内容…');}
function currentStageSignature(state=app.lastState||app.player?.state){return JSON.stringify([state?.sceneId,state?.stageTime,state?.dialogue?.visible,state?.waiting,state?.ended,app.lastText,app.resourceRevision,app.mode,$('languageSelect').value,app.referenceURL,$('referenceOpacity').value,$('referenceMode').value]);}
function invalidateStageReview(){app.stageAudit=null;app.stageAuditSignature=null;if(app.story)renderReview();}
function invalidateImages(){app.resourceRevision++;app.menuSounds?.stop();invalidateStageReview();app.stageImages?.invalidate();app.presentation?.dispose();app.presentation=new PresentationRenderer($('effectLayer'),app.library);refreshNativeWindowSkin().catch(showError);}
function renderAssetAudit(){
  const list=$('assetAuditList');list.replaceChildren();const audit=app.assetAudit;
  $('assetAuditSummary').textContent=audit?`${audit.available} / ${audit.total} 项内置素材通过；${audit.missing} 项缺失，${audit.failed} 项异常。`:'尚未检查内置素材。';
  if(audit)for(const item of audit.results){if(item.status==='available')continue;list.append(element('li','is-error',`${item.path}：${item.message||item.status}`));}
}
function renderReview(){
  if(!app.story||app.mode!=='review')return;const audit=app.reviewAudit||auditStory(app.story);app.reviewAudit=audit;
  const errors=audit.issues.filter(i=>i.severity==='error').length,warnings=audit.issues.filter(i=>i.severity==='warning').length;
  $('reviewSummary').textContent=`${audit.scenes.length} 个场景 · ${errors} 项结构错误 · ${warnings} 项提醒${app.stageAudit?` · 当前画面${app.stageAudit.issues.length?'有待检查项':'未发现可见问题'}`:' · 当前画面尚未检查'}`;
  const list=$('reviewIssues');list.replaceChildren();for(const issue of [...audit.issues,...(app.stageAudit?.issues||[])])list.append(element('li',`is-${issue.severity}`,issue.message));
  const scenes=$('sceneReviewList');scenes.replaceChildren();for(const scene of audit.scenes){const row=element('div','scene-review-row'),button=element('button','',scene.title||scene.id);button.type='button';button.addEventListener('click',()=>navigate(scene.id));row.append(button,element('small','',`${scene.dialogues} 句 · ${scene.reachable?'可达':'不可达'}`));scenes.append(row);}
  const points=$('checkpointList');points.replaceChildren();for(const item of app.checkpoints){const li=element('li'),name=element('span','checkpoint-name',item.doc.label),restore=element('button','button quiet','恢复'),exportButton=element('button','button quiet','导出'),select=element('select');select.setAttribute('aria-label',`${item.doc.label} 的人工校对结果`);for(const [value,label]of [['pending','未核对'],['passed','已通过'],['failed','有问题']])select.append(new Option(label,value));select.value=item.status;select.addEventListener('change',()=>{item.status=select.value;});restore.addEventListener('click',()=>{if(busy())return;try{restoreCheckpoint(item.doc);status('检查点已恢复并保持暂停。');}catch(error){showError(error);}});exportButton.addEventListener('click',()=>downloadJSON(`检查点-${item.doc.id}.json`,item.doc));li.append(name,restore,exportButton,select);points.append(li);}
  renderAssetAudit();updateInputLocks();
}
function restoreCheckpoint(doc,{internal=false}={}){const checked=parseReviewCheckpoint(app.story,doc);navigate(checked.sceneId,{reader:checked.snapshot,internal});setRate(app.mode==='player'?1:app.player.rate);return checked;}
function clearReference(){if(app.referenceURL)URL.revokeObjectURL(app.referenceURL);app.referenceURL=null;const img=$('referenceImage');img.removeAttribute('src');img.hidden=true;$('referenceSummary').textContent='选择自己制作的 PNG、JPEG 或 WebP 参考图；对照在当前浏览器内完成。';for(const id of ['referenceOpacity','referenceMode','clearReference'])$(id).disabled=true;}
function syncReference(){const img=$('referenceImage');img.hidden=!app.referenceURL||app.mode!=='review';img.style.opacity=String(Number($('referenceOpacity').value)/100);img.style.mixBlendMode=$('referenceMode').value==='difference'?'difference':'normal';$('referenceOpacityValue').textContent=`${$('referenceOpacity').value}%`;if(app.stageAudit&&app.stageAuditSignature!==currentStageSignature(app.lastState))invalidateStageReview();}

function renderSupport(){const list=$('supportList');list.replaceChildren();for(const item of app.support){const row=element('li',`support-item ${item.status}`);row.append(element('span','support-dot'),element('span','',item.label),element('small','',item.status==='ready'?'已实现':'待接入'));list.append(row);}}

$('dismissError').addEventListener('click',clearError);
function continueReading({automatic=false}={}){
  if(app.scrubbing||app.historyOpen||app.dialogueHidden&&!automatic)return;
  if(app.config?.localGame&&!app.localReady){status("请先选择游戏文件夹。");return;}
  if(busy()||!app.player||app.player.state.ended||['choice','signal'].includes(app.player.state.waiting))return;
  if(stagePending()){status('正在准备当前画面与声音，请稍候…');return;}
  if(!automatic)autoReader.reset();
  clearError();previousFrame=performance.now();app.media.unlock();status(`正在浏览「${activeScene().title}」，可从地图切换场景。`);app.player.next();scheduleSave(true);
}
async function previousReading(){
  if(busy()||!app.player||app.config?.localGame&&!app.localReady||!app.player.canPreviousDialogue?.())return;
  if(!beginTransition())return;closeHistory(false);
  try{clearError();app.media.stop();app.player.previousDialogue();app.lastState=app.player.state;
    buildDialoguePositions();app.visited.add(app.lastState.sceneId);updateProgressSummary();
    await readyStageResources();scheduleSave(true);status('已回到上一句，点击继续阅读。');
  }catch(error){showError(error);}finally{endTransition();}
}
$('readerPrevious').title='上一句（←）';
$('readerPrevious').addEventListener('click',previousReading);
$('readerNext').addEventListener('click',continueReading);
$('stageViewport').addEventListener('click',event=>{if(event.target.closest('button,input,select,textarea,a,summary,#historyPanel,#choicePanel,.hud-toolbar,.segment-progress-row'))return;continueReading();});
$('readerPosition').addEventListener('change',event=>{if(app.mode!=='review'||event.target.value==='')return;try{app.media.stop();app.player.seekDialogue(Number(event.target.value));render(app.player.state);scheduleSave(true);status('已定位对白；保持暂停，点击画面继续。');}catch(error){showError(error);}});
$('modeSelect').addEventListener('change',async event=>{
  if(busy()||app.config?.reviewEnabled===false)return;const nextMode=event.target.value;if(!['player','review'].includes(nextMode)||!beginTransition())return;
  const previousMode=app.mode,previousLanguage=$('languageSelect').value,previousStory=app.story;
  try{scheduleSave(true);app.player?.pause();await app.saveChain;
  app.mode=nextMode;document.body.dataset.mode=nextMode;$('languageSelect').value='translation';
  await installStory(app.bundledStory,app.bundledTranslations);status(app.config?.localGame?'已切换浏览模式，请重新选择本机游戏文件夹。':nextMode==='player'?'已进入阅读模式，译文与素材由网页内置。':'已进入校对模式，可检查对白位置与资源。');}catch(error){if(app.story===previousStory){app.mode=previousMode;document.body.dataset.mode=previousMode;$('languageSelect').value=previousLanguage;}showError(error);}finally{event.target.value=app.mode;endTransition();fitStage();}
});
$('playPause').addEventListener('click',()=>{stopAuto();clearError();if(app.player.playing)app.player.pause();else{previousFrame=performance.now();app.media.unlock();if(app.player.state.ended){if(app.story.program)navigate(mapId(app.player.state.sceneId),{history:false});else app.player.seek(0);}app.player.play();}scheduleSave(true);});
$('restartScene').addEventListener('click',()=>navigate(app.player.state.sceneId,{history:false}));
$('previousScene').addEventListener('click',()=>{if(app.historyIndex>0){app.historyIndex--;navigate(app.history[app.historyIndex],{history:false});}});
$('nextScene').addEventListener('click',()=>{if(activeScene()?.next)navigate(activeScene().next);});
$('timeSlider').addEventListener('input',event=>{const time=Number(event.target.value);app.player.pause();app.player.seek(time);scheduleSave(true);});
$('speedSelect').addEventListener('change',event=>setRate(Number(event.target.value)));
$('languageSelect').addEventListener('change',()=>{syncTextLengths();buildDialoguePositions();render(app.player.state);scheduleSave(true);});
$('fullscreenButton').addEventListener('click',toggleFullscreen);
$('loadTranslation').addEventListener('click',()=>$('translationFile').click());
$('translationFile').addEventListener('change',guardedFile(async event=>{try{
  const epoch=app.epoch,sourceStory=app.story;let document=await readJSON(event.target.files[0],50);if(!document)return;
  if(document.type==='xp2-translation')document={...document,type:'story-translations'};
  if(app.epoch!==epoch||app.story!==sourceStory)throw new Error('页面已切换，本次导入未应用。');
  const merged=mergeTranslationDocument(app.story,app.translations,document);app.translations=merged.document;app.customTranslation=true;translationSummary(merged);syncTextLengths();buildDialoguePositions();applyImageOverrides();await saveLocalization();scheduleSave(true);status('更新译文已按编号与原文匹配并保存在本机，空白项保留原有内容。');
}catch(error){showError(error);}finally{event.target.value='';}}));
$('localizedImageFiles').addEventListener('change',guardedFile(async event=>{try{
  const pack=await readLocalImagePack(event.target.files,app.unityIndex);app.localImageManifest=pack.manifest;app.localImageEntries=pack.entries;applyImageOverrides();await saveLocalization();status(`已验证并载入 ${pack.count} 张汉化图片，原游戏文件保持完整。`);
}catch(error){showError(error);}finally{event.target.value='';}}));
$('loadStoryPack').addEventListener('click',()=>$('storyPackFile').click());
$('storyPackFile').addEventListener('change',guardedFile(async event=>{try{if(app.mode!=='review')throw new Error('请在校对模式中切换演出包。');const epoch=app.epoch;const story=await readJSON(event.target.files[0],10);if(!story)return;if(app.mode!=='review'||app.epoch!==epoch)throw new Error('页面已切换，本次导入未应用。');await installStory(story);status('演出包已打开，可在校对模式检查配套资源与同版译文。');}catch(error){showError(error);}finally{event.target.value='';}}));

async function importAssets(files){
  if(app.config?.localGame){
    const epoch=app.epoch,sourceStory=app.story,sourceLibrary=app.library;
    let provider;
    const stillCurrent=()=>app.epoch===epoch&&app.story===sourceStory&&app.library===sourceLibrary;
    try{
      provider=await bindUnityFolder(files,app.unityIndex,{onProgress:message=>{if(stillCurrent()&&message?.phase==='verify'){status(`正在核对游戏文件（${message.current+1}/${message.total}）…`);$('localGameStatus').textContent=$('publicStatus').textContent;}}});
      if(!stillCurrent())throw new Error('页面已切换，本次游戏目录未应用。');
      status('版本核对通过，正在准备当前片段的画面与声音…');$('localGameStatus').textContent=$('publicStatus').textContent;
      // Decode before replacing the working provider. A malformed first resource
      // must leave the previous directory and the choose-folder gate usable.
      await Promise.all(currentResourceIds(app.player.state).map(async id=>{if(!await provider.resolve(id))throw new Error(`本地游戏缺少当前片段的资源 ${id}，请检查配套版本。`);}));
      if(!stillCurrent())throw new Error('页面已切换，本次游戏目录未应用。');
      app.player.pause();app.media.stop();app.menuSounds?.stop();app.library.setLocalProvider(provider);provider=null;app.localReady=true;invalidateImages();
    }finally{provider?.dispose();}
    $('localGameGate').hidden=true;document.body.dataset.localGame='ready';$('gameFolderSummary').textContent='已绑定本地游戏 · 资源仅在本机按需读取';
    render(app.player.state);status('游戏目录已绑定，点击画面或「继续阅读」开始。');return;
  }
  if(!app.assetManifest)throw new Error('当前演出包没有内置素材校验清单，请先在制作阶段生成清单。');
  app.player.pause();const result=await importVerifiedAssetFolder(app.library,app.story,app.assetManifest,files,{onProgress:auditMessage});app.media.stop();invalidateImages();
  $('gameFolderSummary').textContent=`已绑定 ${result.matched} 项本地素材 · ${result.unmatched} 个文件未使用 · 只读`;
  status(result.matched?`已核验并绑定 ${result.matched} 项素材；其他内置资源保持可用。`:'未找到路径匹配的素材，当前资源保持可用。');
}
$('selectLocalGame').addEventListener('click',()=>{if(!busy()&&app.unityIndex)$('gameFiles').click();});
$('loadGameFolder').addEventListener('click',()=>$('gameFiles').click());
$('assetFolderButton').addEventListener('click',()=>$('assetFolderFiles').click());
for(const id of ['gameFiles','assetFolderFiles'])$(id).addEventListener('change',guardedFile(async event=>{try{await importAssets(Array.from(event.target.files));}catch(error){showError(error);}}));
$('clearAssets').addEventListener('click',()=>{if(busy())return;stopAuto();app.player.pause();app.media.stop();app.menuSounds?.stop();app.library.clearOverrides();if(app.config?.localGame){app.library.setLocalProvider(null);app.localReady=false;document.body.dataset.localGame='waiting';$('localGameGate').hidden=false;}invalidateImages();render(app.player.state);$('gameFolderSummary').textContent='已解除本地目录绑定。';status('请选择游戏文件夹继续。');});
$('auditAssets').addEventListener('click',async()=>{if(!beginTransition())return;try{app.player.pause();app.assetAudit=await auditBundledAssets(app.story,app.assetManifest,{baseURL:ROOT.href,onProgress:auditMessage});renderAssetAudit();status(app.assetAudit.available===app.assetAudit.total?'内置素材大小与哈希全部通过。':'素材检查发现缺失或不一致，请查看校对工具。');}catch(error){showError(error);}finally{endTransition();}});
$('runReview').addEventListener('click',()=>{if(busy())return;app.player.pause();app.reviewAudit=auditStory(app.story);app.stageAudit=inspectRenderedStage($('logicalStage'));app.stageAuditSignature=currentStageSignature();renderReview();status('已检查演出结构和当前画面；其他对白位置仍需分别核对。');});
$('saveCheckpoint').addEventListener('click',()=>{if(busy())return;try{if(app.checkpoints.length>=100)throw new Error('本次会话最多保留 100 个检查点，请先导出记录。');app.player.pause();const label=$('checkpointLabel').value.trim()||`${activeScene().title} · ${app.player.state.stageTime.toFixed(2)} 秒`,doc=createReviewCheckpoint(app.story,app.player,{label});const existing=app.checkpoints.find(item=>item.doc.id===doc.id);if(existing)existing.doc=doc;else app.checkpoints.push({doc,status:'pending'});renderReview();downloadJSON(`检查点-${doc.id}.json`,doc);status('检查点已导出；回导后可恢复同一对白、流程与舞台时刻。');}catch(error){showError(error);}});
$('importCheckpoint').addEventListener('click',()=>$('checkpointFile').click());
$('checkpointFile').addEventListener('change',guardedFile(async event=>{try{const doc=await readJSON(event.target.files[0],10);if(!doc)return;const checked=restoreCheckpoint(doc,{internal:true});if(!app.checkpoints.some(item=>item.doc.id===checked.id))app.checkpoints.push({doc:checked,status:'pending'});renderReview();status('检查点已验证并恢复，演出保持暂停。');}catch(error){showError(error);}}));
$('exportReview').addEventListener('click',()=>{if(busy())return;try{app.player.pause();if(app.stageAudit)app.stageAudit=inspectRenderedStage($('logicalStage'));const report=createReviewReport(app.story,{resources:app.assetAudit,checkpoints:app.checkpoints.map(item=>({id:item.doc.id,label:item.doc.label,sceneId:item.doc.sceneId,status:item.status})),rendered:app.stageAudit});if(app.stageAudit)report.rendered.position={sceneId:app.player.state.sceneId,stageTime:app.player.state.stageTime};downloadJSON(`场景检查报告-${app.story.id}.json`,report);status('检查报告已导出，未检查内容会明确标注。');}catch(error){showError(error);}});
$('compareReference').addEventListener('click',()=>$('referenceFile').click());
$('referenceFile').addEventListener('change',guardedFile(async event=>{let url=null;try{const file=event.target.files[0];if(file.size>20*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('参考图应为不超过 20 MB 的 PNG、JPEG 或 WebP。');app.player.pause();url=URL.createObjectURL(file);const probe=new Image();probe.src=url;await probe.decode();if(probe.naturalWidth*probe.naturalHeight>40000000)throw new Error('参考图尺寸超过支持范围。');clearReference();app.referenceURL=url;url=null;$('referenceImage').src=app.referenceURL;for(const id of ['referenceOpacity','referenceMode','clearReference'])$(id).disabled=false;$('referenceSummary').textContent=`${file.name} · ${probe.naturalWidth} × ${probe.naturalHeight}${probe.naturalWidth===app.story.stage.width&&probe.naturalHeight===app.story.stage.height?' · 尺寸与舞台一致':' · 尺寸不同，按比例完整显示，请留意边缘'}。`;syncReference();status('参考图已叠加；可调透明度或切换差异混合进行人工校对。');}catch(error){showError(error);}finally{if(url)URL.revokeObjectURL(url);}}));
$('referenceOpacity').addEventListener('input',syncReference);$('referenceMode').addEventListener('change',syncReference);$('clearReference').addEventListener('click',()=>{clearReference();updateInputLocks();});

$('exportProgress').addEventListener('click',()=>{downloadJSON(`剧情浏览记录-${app.story.id}.json`,createProgress(app.story,app.player.state,app.visited,{rate:app.player.rate,reader:app.player.snapshot()}));scheduleSave(true);status('浏览记录已导出，包含具体对白、演出状态与已浏览节点。');});
$('importProgress').addEventListener('click',()=>$('progressFile').click());
$('progressFile').addEventListener('change',guardedFile(async event=>{try{const epoch=app.epoch;const document=await readJSON(event.target.files[0],10);if(!document)return;if(app.epoch!==epoch)throw new Error('页面已切换，本次进度导入未应用。');const progress=parseProgress(app.story,document);app.visited=new Set(progress.visited);navigate(progress.sceneId,{time:progress.time,reader:progress.reader||null,internal:true});setRate(app.mode==='player'?1:progress.rate);status(app.player.state.ended?'本段已结束，已恢复分支位置，请选择分支或地图节点。':'浏览记录已恢复，保持暂停，点击画面继续。');}catch(error){showError(error);}finally{event.target.value='';}}));
$('resetDemo').addEventListener('click',async()=>{if(!beginTransition())return;const epoch=app.epoch;try{const [story,translations]=await Promise.all([fetchJSON(app.config.story),fetchJSON(app.config.translations)]);if(epoch!==app.epoch)throw new Error('页面已切换，本次重置未应用。');await installStory(story,translations,{restore:false});app.bundledStory=story;app.bundledTranslations=translations;status('已重新开始，请重新选择本地游戏文件夹。');}catch(error){showError(error);}finally{endTransition();}});
document.addEventListener('keydown',event=>{
  if(app.historyOpen){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeHistory();return;}
    if(event.key==='Tab'){const items=[...$('historyPanel').querySelectorAll('button:not([disabled]),[tabindex="0"]')];const first=items[0],last=items.at(-1);if(items.length&&(!$('historyPanel').contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last)){event.preventDefault();(event.shiftKey?last:first).focus();}}return;
  }
  if(busy()||app.scrubbing||$('main').hidden||!app.player||app.config?.localGame&&!app.localReady||event.ctrlKey||event.metaKey||event.altKey)return;
  const readingKey=event.code==='Space'||event.code==='Enter';
  if(event.target.closest('button,input,textarea,select,a,summary')){if(readingKey&&event.repeat)event.preventDefault();return;}
  if(app.dialogueHidden)return;
  if(readingKey){event.preventDefault();if(!event.repeat)continueReading();}
  else if(app.mode==='player'&&event.code==='ArrowLeft'){event.preventDefault();if(!event.repeat)previousReading();}
  else if(app.mode==='review'&&(event.code==='ArrowLeft'||event.code==='ArrowRight')){const dialogue=app.player.state.dialogue;if(!dialogue.count||app.story.program&&(app.player.state.ended||['choice','signal'].includes(app.player.state.waiting)))return;event.preventDefault();stopAuto();app.media.stop();app.player.seekDialogue(Math.max(0,Math.min(dialogue.count-1,dialogue.index+(event.code==='ArrowLeft'?-1:1))));scheduleSave(true);}
});

document.addEventListener('visibilitychange',()=>{previousFrame=0;if(document.hidden&&app.player){cancelScrub();stopAuto();app.menuSounds?.stop();app.player.pause();scheduleSave(true);}});
window.addEventListener('pagehide',()=>{stopAuto();app.player?.pause();scheduleSave(true);});
new ResizeObserver(fitStage).observe($('stageViewport'));
document.addEventListener('fullscreenchange',()=>{fitStage();$('fullscreenButton').textContent=document.fullscreenElement?'退出全屏':'全屏';syncReadingChrome(app.lastState);});
function stagePending(state=app.lastState||app.player?.state){if(!app.localReady||!app.library?.provider||!state)return false;const ids=app.scrubbing?visualAssetIds(state):currentResourceIds(state);ids.forEach(id=>app.library.resolve(id));return !!app.stageImages?.pending(state)||ids.some(id=>app.library.pending.has(id)&&!app.library.resolved.has(id));}
function currentResourceIds(state){return [...new Set([...visualAssetIds(state),...(state.audio||[]).map(item=>item.asset),state.video?.asset].filter(Boolean))];}
let previousFrame=0;
function frame(now){
  const delta=previousFrame?Math.max(0,(now-previousFrame)/1000):0;previousFrame=now;
  try{
    let ready=!!app.player&&(!app.config?.localGame||app.localReady)&&!stagePending();
    if(!busy()&&app.player?.playing&&ready&&!app.historyOpen)app.player.advance(delta);
    if(app.player&&autoReader.enabled){const state=app.lastState||app.player.state;ready=(!app.config?.localGame||app.localReady)&&!stagePending(state);const enabled=autoReader.enabled;
      if(autoReader.update(state,{delta,ready:ready&&!state.nativeEffects?.inputWaiting,blocked:busy()||app.scrubbing||app.historyOpen||document.hidden,lineLength:app.lengths[state.dialogue?.textId]||0,speed:app.settings.autoSpeed}))continueReading({automatic:true});
      if(enabled!==autoReader.enabled)syncReadingChrome(app.lastState||state);
    }
  }catch(error){stopAuto();app.player?.pause();showError(error);}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const recoveryButton=element('button','button small quiet','导出保留记录');recoveryButton.id='recoveryExport';recoveryButton.hidden=true;recoveryButton.addEventListener('click',()=>{if(app.recovery)downloadJSON('播放器-保留记录.json',{type:'story-player-recovery',schemaVersion:1,...app.recovery});});$('errorBox').append(recoveryButton);

for(const id of ['readerNext','readerPrevious','hudNext','hudPrevious','hudAuto','hudHistory','hudHide','autoReadButton','historyButton','hideDialogueButton','modeSelect','loadStoryPack','resetDemo','loadTranslation','importProgress','exportProgress','loadGameFolder','assetFolderButton','auditAssets','runReview','saveCheckpoint','exportReview','importCheckpoint','clearAssets','compareReference','clearReference','playPause','restartScene','previousScene','nextScene','readerPosition','speedSelect','languageSelect','fullscreenButton'])$(id).disabled=true;

try{
  app.config=await fetchJSON('data/player-config.json');
  if(app.config.localGame){app.unityIndex=await fetchJSON(app.config.unityIndex||'data/unity-index.json');$('localGameStatus').textContent='已准备好，请选择游戏文件夹。';}

  if(app.config.reviewEnabled===false)$('modeSelect').closest('label').hidden=true;
  for(const name of ['story','translations','support','assets'])if(typeof app.config[name]!=='string'||!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/.test(app.config[name]))throw new Error('播放器配置中的文件路径无效。');
  const results=await Promise.allSettled([fetchJSON(app.config.story,{withHash:true}),fetchJSON(app.config.translations),fetchJSON(app.config.support),fetchJSON(app.config.chapterMap||'data/chapter-map/manifest.json'),fetchJSON(app.config.nativePresentation||'data/native-presentation.json')]);
  if(results[0].status==='rejected')throw results[0].reason;
  if(results[2].status==='fulfilled')app.support=results[2].value.items||[];else showError(results[2].reason);
  app.bundledAssetManifest=app.config.localGame?null:await fetchJSON(app.config.assets);
  if(results[3].status==='rejected')throw results[3].reason;app.bundledMapManifest=results[3].value;
  if(results[4].status==='rejected')throw results[4].reason;app.bundledNativePresentation=results[4].value;
  if(app.bundledNativePresentation.sourceStorySha256!==results[0].value.sha256)throw new Error('演出配置与剧情版本不匹配，请完整覆盖本次更新文件并刷新。');
  app.bundledStory=results[0].value.document;app.bundledTranslations=results[1].status==='fulfilled'?results[1].value:null;
  await installStory(app.bundledStory,app.bundledTranslations);
  if(results[1].status==='rejected')showError(results[1].reason);
  status(app.config.localGame?'剧情与中文翻译已准备好。请选择本机游戏文件夹。':'演出包已准备好。');
}catch(error){showError(error);status('框架未能完整载入，请通过网页服务打开，并检查部署包是否完整。');}
