import {NATIVE_RECALLS,NATIVE_CGS,NATIVE_CG_DESTINATIONS,NATIVE_UI,NATIVE_READING_DEFAULTS} from './game-shell-data.js';
import {createNativeUiAssets} from './native-ui-assets.js';

const basename=value=>String(value||'').replace(/\\/g,'/').split('/').at(-1).replace(/\.[^.]+$/,'');
const plain=value=>String(value||'').replace(/<[^>]*>/g,'');
const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};

/** Native settings define the catalogue; story events provide verified destinations. */
export function buildNativeCatalog(story,index){
  const scenes=story?.scenes||[],byTitle=new Map(),appearances=new Map();
  for(const scene of scenes){
    if(scene.archive)continue;
    if(!byTitle.has(scene.title))byTitle.set(scene.title,scene);
    const events=scene.events||[],totalDialogues=events.reduce((count,event)=>count+(event.type==='dialogue'&&event.textId?1:0),0);let dialogueIndex=0;
    for(let i=0;i<events.length;i++){
      const event=events[i];
      if(event.type==='dialogue'&&event.textId)dialogueIndex++;
      if(!event.asset)continue;
      const later=dialogueIndex<totalDialogues;
      if(!appearances.has(event.asset))appearances.set(event.asset,[]);appearances.get(event.asset).push({sceneId:scene.id,mapGroup:scene.mapGroup,...(later?{dialogueIndex}:{}),eventIndex:i});
    }
  }
  const recalls=NATIVE_RECALLS.map((record,position)=>({...record,id:`native-recall-${position+1}`,sceneId:byTitle.get(record.scenario)?.id||null,thumbnailAssetId:index?.resourcePaths?.[`texture/thumbnail/${record.thumbnail.toLowerCase()}`]?.[0]||null}));
  const images=NATIVE_CGS.map((record,position)=>{
    const resourcePath=`texture/event/${String(record.file).replace(/\.[^./]+$/,'').toLowerCase()}`;
    const candidates=index?.resourcePaths?.[resourcePath]||[],thumbnailResourcePath=`texture/thumbnail/${record.thumbnail.toLowerCase()}`,thumbnailCandidates=index?.resourcePaths?.[thumbnailResourcePath]||[];
    const assetId=candidates.length===1?candidates[0]:null;
    const family=basename(record.file).split('_')[0].toLowerCase();
    const recall=recalls.find(item=>basename(item.thumbnail).split('_')[0].toLowerCase()===family);
    const locations=appearances.get(assetId)||[],destination=locations.find(item=>recall&&item.mapGroup===recall.sceneId)||locations[0];
    const id=`native-cg-${position+1}`,override=NATIVE_CG_DESTINATIONS[id]||{},target={...destination,...override};
    if(override.sceneId&&override.sceneId!==destination?.sceneId&&override.eventIndex===undefined)target.eventIndex=scenes.find(scene=>scene.id===override.sceneId)?.events.findIndex(event=>event.asset===assetId);
    const image={...record,id,number:position+1,resourcePath,assetId,thumbnailResourcePath,thumbnailAssetId:thumbnailCandidates.length===1?thumbnailCandidates[0]:null,recallId:recall?.id||null,sourceSceneId:destination?.sceneId,sourceEventIndex:destination?.eventIndex,...target,exactDialogue:override.exactDialogue??(target.dialogueIndex!==undefined)};
    if(!image.exactDialogue)delete image.dialogueIndex;
    return image;
  }).filter(item=>item.assetId&&item.sceneId);
  return {recalls,images};
}

/** The caller owns local resource binding, playback, localization and persisted settings. */
export function createGameShell(container,options){
  const catalog=buildNativeCatalog(options.story,options.index),PAGE_SIZE=12;
  let state={localReady:false,sceneId:options.story?.startScene,settings:{...NATIVE_READING_DEFAULTS},localizationStatus:'',resourceRevision:0};
  let page='home',mounted=false,returnPage='home',archivePage=0,galleryPage=0,category='',search='',previewToken=0,disposed=false;
  let previewAsset=null,selectedImage=null;
  const listeners=[];
  const artwork=createNativeUiAssets({resolveAsset:id=>options.resolveAsset?.(id),onVisibleAssets:ids=>options.onVisibleAssets?.(ids)});
  const listen=(target,type,handler,settings)=>{target.addEventListener(type,handler,settings);listeners.push(()=>target.removeEventListener(type,handler,settings));};
  const text=(id,fallback)=>{const result=options.translateText?.(id);return plain(typeof result==='string'?result:result?.text)||fallback;};
  const recallTitle=record=>text(record.titleId,record.title);
  const categoryTitle=record=>record.recallId?recallTitle(catalog.recalls.find(item=>item.id===record.recallId)):record.category.replaceAll('_',' ')||'其他原画';
  const root=node('div','shell-inner'),navigation=node('nav','shell-navigation'),content=node('div','shell-content'),feedback=node('p','shell-feedback');
  feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.hidden=true;
  navigation.setAttribute('aria-label','游戏页面');
  const tabs=new Map();
  const sound=kind=>{if(state.localReady)options.onMenuSound?.({assetId:kind==='click'?NATIVE_UI.click:NATIVE_UI.hover,volume:.5,loop:false});};
  const labels={home:'游戏主页',reader:'剧情演出',archive:'回想档案',gallery:'CG 库',settings:'游戏设置'};
  for(const [key,label] of Object.entries(labels)){const button=node('button','shell-nav-button',label);button.type='button';button.dataset.shellPage=key;listen(button,'click',()=>showPage(key));tabs.set(key,button);navigation.append(button);}
  root.append(navigation,content,feedback);container.replaceChildren(root);
  listen(root,'pointerover',event=>{const target=event.target.closest('button:not(:disabled)');if(target&&!target.contains(event.relatedTarget))sound('hover');});
  listen(root,'click',event=>{if(event.target.closest('button:not(:disabled)'))sound('click');});
  const announce=message=>{feedback.textContent=message||'';feedback.hidden=!message;};
  async function invoke(callback,...args){try{announce('');const result=options[callback]?.(...args);await result;}catch(error){announce(error?.message||String(error));}}
  const requestFolder=()=>{const result=invoke('onSelectFolder');announce('请选择「性癖討論v1.0.0」或其中的「性癖討論2_Data」目录；载入后再选择开始或回想。');return result;};
  const button=(label,handler,className='button')=>{const el=node('button',className,label);el.type='button';el.addEventListener('click',handler);return el;};
  const title=(heading,description)=>{const top=node('div','shell-page-heading native-page-heading'),copy=node('div');copy.append(node('h2','',heading),node('p','',description));top.append(copy);const back=button('×',()=>{const target=returnPage;returnPage='home';showPage(target,true);},'native-page-close');back.setAttribute('aria-label','返回上一页面');if(state.localReady){const image=node('img');image.alt='';artwork.image(NATIVE_UI.close,image);back.append(image);}top.append(back);return top;};
  function nativeArt(assetId,target,property){if(state.localReady)artwork.background(assetId,target,property);}
  function thumbnail(assetId,alt,{fallback=false}={}){const frame=node('span','native-thumbnail'),image=node('img');image.alt=alt;image.decoding='async';frame.append(image,node('span','native-thumbnail-placeholder','CG'));if(state.localReady&&assetId)artwork.image(assetId,image,{lazy:true,resize:fallback?[640,360]:null});return frame;}
  function galleryTabs(){const controls=node('div','native-gallery-tabs');for(const [key,label,asset]of [['archive','回想档案',NATIVE_UI.galleryTabScene],['gallery','CG 库',NATIVE_UI.galleryTabCg]]){const item=button('',()=>showPage(key),'native-gallery-tab');item.setAttribute('aria-pressed',String(page===key));if(state.localReady){const image=node('img');image.alt='';artwork.image(asset,image);item.append(image);}item.append(node('span','',label));controls.append(item);}return controls;}
  function pagination(current,total,onChange,label){const pages=Math.max(1,total),controls=node('div','shell-gallery-pagination');const previous=button('上一页',()=>onChange(current-1),'button small quiet'),next=button('下一页',()=>onChange(current+1),'button small quiet');previous.disabled=current===0;next.disabled=current===pages-1;controls.append(previous,node('p','',`${label} · 第 ${current+1} / ${pages} 页`),next);return controls;}
  function clearPreview(){previewToken++;previewAsset=null;selectedImage=null;options.onPreviewAsset?.(null);}
  async function jump(sceneId,settings){await invoke('onJump',sceneId,settings);if(!disposed)showPage('reader');}
  async function begin(which){if(!state.localReady){await requestFolder();return;}await invoke(which==='start'?'onStart':'onContinue');if(!disposed)showPage('reader');}
  function home(){
    const screen=node('section','native-title-screen');screen.setAttribute('aria-label','原作标题画面');nativeArt(NATIVE_UI.title,screen,'--native-title-image');
    const heading=node('div','native-title-fallback');heading.append(node('span','eyebrow','XP2 / LOCAL EDITION'),node('h2','','性癖討論'),node('p','','载入游戏目录后显示原作标题画面与菜单。'));screen.append(heading);
    const menus=node('div','native-title-menu');
    for(const [key,label,asset,action]of [['start','开始游戏',NATIVE_UI.start,()=>begin('start')],['continue','继续阅读',NATIVE_UI.resume,()=>begin('continue')],['settings','游戏设置',NATIVE_UI.config,()=>showPage('settings')],['gallery','回想与 CG',NATIVE_UI.gallery,()=>showPage('archive')]]){
      const item=button('',action,'native-title-button');item.dataset.nativeMenu=key;item.setAttribute('aria-label',label);if(!state.localReady&&['start','continue'].includes(key))item.title='请先选择原游戏目录，载入后再点击'+label;
      if(state.localReady){const image=node('img');image.alt='';artwork.image(asset,image);item.append(image);}item.append(node('span','native-title-button-label',label));menus.append(item);
    }
    screen.append(menus);content.append(screen);
    const footer=node('div','native-title-footer'),status=node('p','shell-local-status',state.localReady?'本机游戏已连接 · 原画与声音在本机读取':'尚未连接本机游戏');status.id='shellLocalStatus';
    footer.append(status,button(state.localReady?'重新选择游戏目录':'载入游戏目录',()=>requestFolder(),'button primary'),node('p','native-catalog-count',`${catalog.recalls.length} 个原作回想 · ${catalog.images.length} 张 CG`));content.append(footer);
    content.append(node('p','shell-scope','剧情与资源浏览：条件分支手动选择，讨论小游戏仍以译文资料与继续入口展示。'));
  }
  function archive(){
    nativeArt(NATIVE_UI.galleryBackground,content);content.append(title('回想档案','按原作回想目录进入剧情。'),galleryTabs());
    const grid=node('div','shell-archive-grid');
    catalog.recalls.slice(archivePage*PAGE_SIZE,(archivePage+1)*PAGE_SIZE).forEach((record,offset)=>{const card=node('article','shell-archive-card'),action=button('',()=>state.localReady?jump(record.sceneId):requestFolder(),'native-recall-select');action.disabled=!record.sceneId;
      action.append(thumbnail(record.thumbnailAssetId,recallTitle(record)),node('span','shell-card-number',String(archivePage*PAGE_SIZE+offset+1).padStart(2,'0')),node('h3','',recallTitle(record)),node('span','native-recall-action',state.localReady?'进入回想':'载入目录后进入'));card.append(action);grid.append(card);});
    content.append(grid,pagination(archivePage,Math.ceil(catalog.recalls.length/PAGE_SIZE),value=>{archivePage=value;render();},`${catalog.recalls.length} 个回想`));
  }
  function matchingImages(){return catalog.images.filter(item=>(!category||(category==='__uncategorized'?!item.category:item.category===category))&&(!search||`${item.label} ${item.category} ${categoryTitle(item)}`.toLowerCase().includes(search.toLowerCase())));}
  function gallery(restorePreview=null){
    nativeArt(NATIVE_UI.galleryBackground,content);content.append(title('CG 库','按页读取原作缩略图，点击查看原图或进入对应剧情。'),galleryTabs());
    if(!state.localReady){const gate=node('div','shell-gallery-gate');gate.append(node('p','','连接已购买的游戏目录后即可查看本地 CG。'),button('载入游戏目录',()=>requestFolder(),'button primary'));content.append(gate);return;}
    const tools=node('div','shell-gallery-tools'),group=node('select'),query=node('input');
    group.id='shellGalleryGroup';group.setAttribute('aria-label','CG 分类');group.append(new Option('全部分类',''));
    const groups=new Map();for(const image of catalog.images)if(!groups.has(image.category))groups.set(image.category,categoryTitle(image));
    for(const [value,label]of groups)group.append(new Option(label,value||'__uncategorized'));group.value=category;
    query.id='shellGallerySearch';query.type='search';query.placeholder='检索人物、分类或 CG 编号';query.setAttribute('aria-label','检索 CG');query.value=search;
    group.addEventListener('change',()=>{category=group.value;galleryPage=0;clearPreview();render();});
    query.addEventListener('change',()=>{search=query.value.trim();galleryPage=0;clearPreview();render();});
    tools.append(group,query);content.append(tools);
    const matches=matchingImages(),pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));galleryPage=Math.min(galleryPage,pages-1);
    const preview=node('section','shell-cg-preview');preview.setAttribute('aria-label','当前 CG 预览');
    const imageHost=node('div','shell-cg-image'),imageStatus=node('p','shell-cg-status','选择下方 CG 查看原图。'),imageActions=node('div','shell-cg-actions');
    imageHost.append(imageStatus);preview.append(imageHost,imageActions);content.append(preview);
    const cards=node('div','shell-cg-grid');
    for(const image of matches.slice(galleryPage*PAGE_SIZE,(galleryPage+1)*PAGE_SIZE)){
      const card=node('article','shell-cg-card');const view=button('',()=>previewImage(image,imageHost,imageActions),'shell-cg-select');
      view.dataset.previewCg=image.id;view.setAttribute('aria-pressed','false');view.append(thumbnail(image.thumbnailAssetId||image.assetId,`${categoryTitle(image)} · ${image.label}`,{fallback:!image.thumbnailAssetId}),node('span','shell-card-number',String(image.number).padStart(3,'0')),node('strong','',image.label),node('span','',categoryTitle(image)));card.append(view,button(image.exactDialogue?'对应剧情':'进入所在片段',()=>jump(image.sceneId,image.dialogueIndex===undefined?{}:{dialogueIndex:image.dialogueIndex}),'button small quiet'));cards.append(card);
    }
    const paging=node('div','shell-gallery-pagination');const previous=button('上一页',()=>{galleryPage--;clearPreview();render();},'button small quiet'),next=button('下一页',()=>{galleryPage++;clearPreview();render();},'button small quiet');previous.disabled=galleryPage===0;next.disabled=galleryPage===pages-1;
    paging.append(previous,node('p','',`${matches.length} 张 · 第 ${galleryPage+1} / ${pages} 页`),next);content.append(cards,paging);
    if(!matches.length)imageStatus.textContent='没有找到匹配的 CG。';
    if(restorePreview&&matches.some(image=>image.id===restorePreview.id))previewImage(restorePreview,imageHost,imageActions);
  }
  async function previewImage(image,host,actions){
    const token=++previewToken;for(const button of container.querySelectorAll('[data-preview-cg]'))button.setAttribute('aria-pressed',String(button.dataset.previewCg===image.id));selectedImage=image;previewAsset=image.assetId;options.onPreviewAsset?.(image.assetId);host.replaceChildren(node('p','shell-cg-status','正在读取本地原图……'));actions.replaceChildren();
    try{
      const url=await options.resolveAsset?.(image.assetId);if(!url)throw new Error('这张 CG 未能读取，请重新连接游戏目录。');
      const img=new Image();img.alt=`${categoryTitle(image)} · ${image.label}`;img.src=url;await img.decode();
      if(disposed||token!==previewToken||page!=='gallery')return;
      host.replaceChildren(img);host.scrollIntoView({block:'nearest'});actions.append(node('span','',`${image.label} · ${img.naturalWidth} × ${img.naturalHeight}${image.exactDialogue?'':' · 此图没有可停留的对白位置'}`),button(image.exactDialogue?'进入对应剧情':'进入所在片段',()=>jump(image.sceneId,image.dialogueIndex===undefined?{}:{dialogueIndex:image.dialogueIndex}),'button small'));
    }catch(error){if(!disposed&&token===previewToken){host.replaceChildren(node('p','shell-cg-status',error?.message||String(error)));options.onPreviewAsset?.(null);previewAsset=null;}}
  }
  const settingInputs=new Map();
  function settings(){
    settingInputs.clear();nativeArt(NATIVE_UI.configBackground,content);content.append(title('游戏设置','原作的阅读与声音分栏；设置即时生效。'));
    const fields=node('div','native-settings-columns'),reading=node('section','native-settings-column'),audio=node('section','native-settings-column');reading.append(node('h3','','文字与窗口'));audio.append(node('h3','','声音'));
    const rows=[['textSpeed','文字显示速度',8,96,1,'每秒显示的字数。',reading,false],['autoSpeed','自动翻句速度',.25,4,.25,'只调整自动等待时间，不改变音调。',reading,false],['dialogueOpacity','对话底色不透明度',.05,.65,.01,'数值越低，CG 越清楚。',reading,false],['masterVolume','总音量',0,1,.01,'所有声音的总音量。',audio,false],['bgmVolume','背景音乐',0,1,.01,'原作背景音乐的音量。',audio,false],['seVolume','音效',0,1,.01,'演出音效与原菜单点击、悬停音效。',audio,false],['voiceVolume','语音',0,1,.01,'原作界面保留此项，本作没有独立语音音轨。',audio,true],['ambientVolume','环境音',0,1,.01,'原作界面保留此项，本作没有独立环境音轨。',audio,true]];
    for(const [key,label,min,max,step,note,column,unused]of rows){
      const field=node('div',`shell-setting${unused?' is-unused':''}`),line=node('div','shell-setting-label'),input=node('input'),output=node('output');input.type='range';input.id=`shellSetting-${key}`;input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(state.settings[key]);input.disabled=unused;const labelNode=node('label','',unused?`${label} · 本作未使用`:label);labelNode.htmlFor=input.id;output.setAttribute('for',input.id);line.append(labelNode,output);field.append(line,input,node('p','',note));column.append(field);settingInputs.set(key,{input,output,unused});
      if(!unused)input.addEventListener('input',()=>{const value=Number(input.value);state.settings={...state.settings,[key]:value};syncSettings();invoke('onSettingsChange',{[key]:value});});
    }
    fields.append(reading,audio);content.append(fields);
    const reset=button('恢复阅读默认设置',()=>{state.settings={...NATIVE_READING_DEFAULTS};syncSettings();invoke('onSettingsChange',{...NATIVE_READING_DEFAULTS});},'button native-reset-settings');content.append(reset);
    const localization=node('section','shell-localization');localization.append(node('h3','','汉化内容替换'),node('p','','可导入更新后的翻译文档，或按模板替换本机图片。替换内容只在当前浏览器使用。'));
    const actions=node('div','shell-localization-actions');for(const [label,callback]of [['导入翻译文档','onImportTranslation'],['导入替换图片','onImportImages'],['导出图片替换模板','onExportImageTemplate'],['恢复内置汉化','onResetLocalization']])actions.append(button(label,()=>invoke(callback),'button quiet'));
    const localizationStatus=node('p','shell-localization-status',state.localizationStatus||'正在使用内置译文与本机游戏素材。');localizationStatus.id='shellLocalizationStatus';localization.append(actions,localizationStatus);content.append(localization);syncSettings();
  }
  function syncSettings(){for(const [key,{input,output,unused}]of settingInputs){if(document.activeElement!==input)input.value=String(state.settings[key]);output.value=unused?'—':key==='autoSpeed'?`${state.settings[key]}×`:key==='textSpeed'?`${state.settings[key]} 字/秒`:`${Math.round(state.settings[key]*100)}%`;}}
  function render({restorePreview=null}={}){if(disposed)return;clearPreview();artwork.beginPage();content.style.removeProperty('--native-panel-image');content.classList.remove('is-loaded');content.classList.toggle('native-panel',['archive','gallery','settings'].includes(page));content.classList.toggle('native-title-content',page==='home');content.replaceChildren();settingInputs.clear();announce('');for(const [key,button]of tabs){button.classList.toggle('is-current',key===page);button.setAttribute('aria-current',key===page?'page':'false');}content.hidden=page==='reader';if(page==='home')home();else if(page==='archive')archive();else if(page==='gallery')gallery(restorePreview);else if(page==='settings')settings();}
  function showPage(next,returning=false){if(!Object.hasOwn(labels,next)||disposed||mounted&&next===page)return;if(!returning&&next!==page&&next!=='home'&&page!=='settings'&&!(('archive'===page||'gallery'===page)&&('archive'===next||'gallery'===next)))returnPage=page;page=next;document.body.dataset.shellPage=page;const main=document.getElementById('main');if(main)main.hidden=page!=='reader';render();mounted=true;options.onPageChange?.(page);}
  function update(patch={}){if(disposed)return;const beforeReady=state.localReady,beforeRevision=state.resourceRevision;state={...state,...patch,settings:{...state.settings,...patch.settings}};syncSettings();const status=container.querySelector('#shellLocalizationStatus');if(status&&patch.localizationStatus!==undefined)status.textContent=state.localizationStatus||'正在使用内置译文与本机游戏素材。';const local=container.querySelector('#shellLocalStatus');if(local)local.textContent=state.localReady?'本机游戏已连接 · 图片和声音按需读取':'尚未连接本机游戏 · 请先载入游戏目录';if(beforeReady!==state.localReady||beforeRevision!==state.resourceRevision){const restorePreview=state.localReady&&page==='gallery'?selectedImage:null;render({restorePreview});}}
  function dispose(){if(disposed)return;clearPreview();artwork.dispose();disposed=true;for(const remove of listeners)remove();container.replaceChildren();const main=document.getElementById('main');if(main)main.hidden=false;delete document.body.dataset.shellPage;}
  showPage('home');return {update,showPage,dispose,catalog,get visibleAssets(){return artwork.visibleAssets;}};
}
