const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;};
const shorten=(text,length=44)=>String(text||'').length>length?`${String(text).slice(0,length)}…`:String(text||'');
const isReference=chapter=>chapter.category==='reference';
const routeLabel=edge=>/^条件分支浏览：不成立/.test(edge.label||'')?'条件不成立':/^条件分支浏览：成立/.test(edge.label||'')?'条件成立':edge.label||'继续剧情';

/** Static chapter summaries. Only one chapter and opened segment details enter the DOM. */
export function createGraphView(container,manifest,{loadChapter,onNavigate=()=>{}}={}){
  if(typeof loadChapter!=='function')throw new Error('缺少章节地图读取器。');
  const chapters=manifest.chapters||[],chapterById=new Map(chapters.map(chapter=>[chapter.id||chapter.key,chapter]));
  const chapterKey=id=>manifest.sceneToChapter?.[id],storyChapters=chapters.filter(chapter=>!isReference(chapter));
  const sectionLabels={main:'主线剧情',ending:'结束分支',extra:'追加剧情',reference:'译文资料'};
  const sectionOf=item=>item.section||(isReference(item)?'reference':'main'),sectionGroups=new Map();
  for(const section of Object.keys(sectionLabels))sectionGroups.set(section,chapters.filter(item=>sectionOf(item)===section));
  const chapterNumbers=new Map();for(const group of sectionGroups.values())group.forEach((item,index)=>chapterNumbers.set(item.id||item.key,index+1));
  const abort=new AbortController(),cache=new Map(),railButtons=new Map();
  let disposed=false,currentId=null,selectedId=null,visited=new Set(),lastVisitedSize=-1,lastVisitedIdentity=null,requestedKey=null,loadedKey=null,loadingKey=null,chapter=null,following=true,jumping=false;
  let sceneMap=new Map(),segmentMap=new Map(),sceneButtons=new Map(),segmentRows=new Map(),openedDetails=null,selectedSegmentId=null,searchTimer=null;
  let readyPromise=Promise.resolve(false),resolveReady=null,pageIndex=0,depthFilter='all',followPosition=true;
  const pageSize=12;
  container.replaceChildren();container.classList.remove('branch-map');container.classList.add('chapter-map');container.style.removeProperty('height');container.style.removeProperty('aspect-ratio');
  const toolbar=el('div','chapter-map-toolbar');
  const chapterLabel=el('label','chapter-map-field','选择章节'),chapterSelect=el('select');chapterSelect.setAttribute('aria-label','选择要浏览的剧情章节');
  for(const [section,items]of sectionGroups){if(!items.length)continue;const group=el('optgroup');group.label=sectionLabels[section];for(const item of items){const key=item.id||item.key,option=el('option','',`${String(chapterNumbers.get(key)).padStart(2,'0')} · ${item.title} · ${item.sceneCount} 片段`);option.value=key;group.append(option);}chapterSelect.append(group);}chapterLabel.append(chapterSelect);
  const searchLabel=el('label','chapter-map-field chapter-map-search','查找章节 / 本章剧情'),search=el('input');search.type='search';search.autocomplete='off';search.placeholder='章节名、本章对白或脚本行';search.setAttribute('aria-label','查找章节或当前章节的剧情片段');searchLabel.append(search);
  const currentButton=el('button','button small quiet','当前剧情');currentButton.type='button';currentButton.dataset.action='current';toolbar.append(chapterLabel,searchLabel,currentButton);
  const searchResults=el('div','chapter-map-results');searchResults.hidden=true;searchResults.setAttribute('role','region');searchResults.setAttribute('aria-label','剧情查找结果');
  const rail=el('nav','chapter-map-rail');rail.setAttribute('aria-label','剧情章节位置总览');
  for(const [section,items]of sectionGroups){if(section==='reference'||!items.length)continue;const row=el('div','chapter-rail-section');row.append(el('span','chapter-rail-label',sectionLabels[section]));const buttons=el('div','chapter-rail-items');for(const item of items){const key=item.id||item.key,button=el('button','chapter-rail-button',String(chapterNumbers.get(key)).padStart(2,'0'));button.type='button';button.dataset.chapterId=key;button.title=item.title;button.setAttribute('aria-label',`查看${sectionLabels[section]} ${chapterNumbers.get(key)}：${item.title}`);buttons.append(button);railButtons.set(key,button);}row.append(buttons);rail.append(row);}
  const location=el('p','chapter-map-location');location.setAttribute('aria-live','polite');
  const header=el('div','chapter-map-header'),heading=el('div'),chapterTitle=el('h3','chapter-map-title','正在读取章节'),chapterMeta=el('p','chapter-map-meta');heading.append(chapterTitle,chapterMeta);
  const playChapter=el('button','button small quiet','从本章开始');playChapter.type='button';playChapter.dataset.action='chapter-start';playChapter.disabled=true;header.append(heading,playChapter);
  const outlineControls=el('div','chapter-outline-controls'),depthLabel=el('label','chapter-depth-label','分支层级'),depthSelect=el('select');depthSelect.setAttribute('aria-label','筛选本章分支层级');depthLabel.append(depthSelect);
  const pagePrevious=el('button','button small quiet','上一组');pagePrevious.type='button';pagePrevious.dataset.action='page-previous';const pageNext=el('button','button small quiet','下一组');pageNext.type='button';pageNext.dataset.action='page-next';const pageInfo=el('span','chapter-page-info');outlineControls.append(depthLabel,pageInfo,pagePrevious,pageNext);
  const phases=el('nav','chapter-phase-nav');phases.setAttribute('aria-label','本章剧情位置与段落范围');
  const body=el('div','chapter-map-body'),outline=el('ol','chapter-outline');outline.setAttribute('aria-label','本章分支层级与剧情段落');
  const inspector=el('section','chapter-map-inspector');inspector.setAttribute('aria-label','所选段落的相关跳转');const inspectorTitle=el('h4','chapter-inspector-title','选择一个段落'),inspectorMeta=el('p','chapter-inspector-meta'),inspectorActions=el('div','chapter-inspector-actions'),routeList=el('ul','chapter-route-list');inspector.append(inspectorTitle,inspectorMeta,inspectorActions,routeList);body.append(outline,inspector);
  const status=el('p','chapter-map-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const help=el('p','chapter-map-help','按章节读取，连续剧情已合并。展开段落可跳到其中任意片段；相关跳转只显示所选段落的分支。');container.append(toolbar,searchResults,rail,location,header,outlineControls,phases,body,status,help);
  const listen=(node,type,handler)=>node.addEventListener(type,handler,{signal:abort.signal});
  const nameForScene=id=>{const scene=sceneMap.get(id);if(scene)return scene.label||scene.title||id;const item=chapterById.get(chapterKey(id));return item?`${item.title} · ${id.match(/-row-(\d+)/)?.[1]||'入口'}`:id;};
  function locationText(){
    const playing=chapterById.get(chapterKey(currentId)),viewing=chapterById.get(requestedKey);
    const prefix=playing?`正在演出：${chapterNumbers.has(chapterKey(currentId))?`${sectionLabels[sectionOf(playing)]} ${chapterNumbers.get(chapterKey(currentId))} / ${sectionGroups.get(sectionOf(playing)).length} · `:''}${playing.title}`:'选择章节，查看相关分支';
    location.textContent=viewing&&playing&&requestedKey!==chapterKey(currentId)?`${prefix}　｜　浏览：${viewing.title}`:prefix;
    currentButton.disabled=!currentId;for(const [key,button]of railButtons){button.classList.toggle('is-current',key===chapterKey(currentId));button.classList.toggle('is-selected',key===requestedKey);if(key===chapterKey(currentId))button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
  }
  function markCurrent(){
    for(const [id,button]of sceneButtons){button.classList.toggle('is-current',id===currentId);button.classList.toggle('is-selected',id===selectedId);button.classList.toggle('is-visited',visited.has(id));if(id===currentId)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
    const currentSegment=sceneMap.get(currentId)?.segmentId;
    if(chapter){const segments=filteredSegments(),index=segments.findIndex(segment=>segment.id===currentSegment),page=index<0?-1:Math.floor(index/pageSize),start=pageIndex*pageSize;for(const button of phases.children){const isCurrent=Number(button.dataset.page)===page;button.classList.toggle('is-current',isCurrent);if(isCurrent)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}pageInfo.textContent=`第 ${segments.length?start+1:0}–${Math.min(start+pageSize,segments.length)} 段 / 共 ${segments.length} 段${index>=0?` · 演出在第 ${index+1} 段`:''}`;}
    for(const [id,row]of segmentRows){const segment=segmentMap.get(id);row.classList.toggle('is-current',id===currentSegment);row.classList.toggle('is-selected',id===selectedSegmentId);row.classList.toggle('is-visited',segment.sceneIds.some(sceneId=>visited.has(sceneId)));if(id===currentSegment)row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');}
  }
  function actionButton(label,id,className='chapter-jump-button'){const button=el('button',className,label);button.type='button';button.dataset.sceneId=id;return button;}
  function describeSelection(segmentId,sceneId=null){
    const segment=segmentMap.get(segmentId);if(!segment)return;selectedSegmentId=segmentId;selectedId=sceneId;
    inspectorTitle.textContent=segment.displayLabel||(sceneId?shorten(nameForScene(sceneId),70):segment.label||'剧情段落');
    inspectorMeta.textContent=`${segment.label} · ${segment.sceneIds.length} 个片段 · ${segment.depth?`分支层级 ${segment.depth}`:'主线层级'}${segment.cycle?' · 包含回环':''}`;
    inspectorActions.replaceChildren(actionButton(sceneId?'从此片段播放':'从本段开始',sceneId||segment.entrySceneId||segment.sceneIds[0]));routeList.replaceChildren();
    const related=(chapter.edges||[]).filter(edge=>edge.fromSegment===segmentId&&!edge.internal||sceneId&&edge.from===sceneId);
    if(!related.length)routeList.append(el('li','chapter-route-empty',sceneId?'此片段继续本段剧情。':'此段结束；可选择本章其他段落。'));
    for(const edge of related){const row=el('li','chapter-route-item');if(edge.terminal){row.append(el('span','chapter-route-terminal',`${edge.label||'本段结束'} → 结束`));routeList.append(row);continue;}
      const destination=chapterById.get(edge.toChapterId||chapterKey(edge.to)),target=sceneMap.get(edge.to),targetSegment=segmentMap.get(edge.toSegment);
      const destinationText=edge.crossChapter?`${destination?.title||'其他章节'} · ${target?.label||edge.to.match(/-row-(\d+)/)?.[1]||'入口'}`:targetSegment?.displayLabel||targetSegment?.label||target?.label||nameForScene(edge.to);
      const button=actionButton(`${routeLabel(edge)} → ${shorten(destinationText,46)}`,edge.to,'chapter-route-button');button.title=`${edge.label||'继续剧情'} → ${destinationText}${edge.condition?`\n${edge.condition}`:''}`;row.append(button);
      if(edge.crossChapter)row.append(el('small','chapter-route-note','跨章节跳转'));if(edge.condition){const note=el('small','chapter-route-note','条件分支');note.title=edge.condition;row.append(note);}routeList.append(row);
    }
    markCurrent();
  }
  function fillDetails(details,segment){
    const content=el('div','chapter-scene-list');for(const id of segment.sceneIds){const scene=sceneMap.get(id),button=actionButton(scene?.label||scene?.title||id,id,'chapter-scene-button');button.title=`${scene?.title||''}\n${id}`;sceneButtons.set(id,button);content.append(button);}details.append(content);markCurrent();
  }
  function clearDetails(details){const segment=segmentMap.get(details.dataset.segmentId);for(const id of segment?.sceneIds||[])sceneButtons.delete(id);details.querySelector('.chapter-scene-list')?.remove();}
  function renderChapter(value,key){
    chapter=value;loadedKey=key;sceneMap=new Map((value.scenes||[]).map(scene=>[scene.id,scene]));segmentMap=new Map((value.segments||[]).map(segment=>[segment.id,segment]));sceneButtons=new Map();segmentRows=new Map();openedDetails=null;outline.replaceChildren();
    const item=chapterById.get(key);chapterTitle.textContent=value.title||item.title;chapterMeta.textContent=`${value.scenes.length} 个片段 → ${value.segments.length} 个剧情段落 · ${item.branchCount||0} 处分叉`;playChapter.disabled=false;depthSelect.disabled=false;body.removeAttribute('aria-busy');
    depthFilter='all';depthSelect.replaceChildren();const allDepths=el('option','','全部层级');allDepths.value='all';depthSelect.append(allDepths);for(const depth of [...new Set(value.segments.map(segment=>Number(segment.depth)||0))].sort((a,b)=>a-b)){const option=el('option','',depth?`分支 ${depth} 级`:'主线层级');option.value=String(depth);depthSelect.append(option);}depthSelect.value='all';
    pageIndex=0;followPosition=true;const selected=sceneMap.get(selectedId)||sceneMap.get(currentId)||sceneMap.get(value.entrySceneId)||value.scenes[0];const selectedIndex=value.segments.findIndex(segment=>segment.id===selected?.segmentId);if(selectedIndex>=0)pageIndex=Math.floor(selectedIndex/pageSize);
    container.dataset.chapterId=key;container.dataset.loadedChapter=key;container.dataset.chapterScenes=String(value.scenes.length);container.dataset.chapterSegments=String(value.segments.length);renderOutline();
    status.textContent=`已读取 ${value.title||item.title}；仅保留本章地图。`;if(search.value.trim())runSearch();locationText();markCurrent();
  }
  function filteredSegments(){return(chapter?.segments||[]).filter(segment=>depthFilter==='all'||String(Number(segment.depth)||0)===depthFilter);}
  function showSegmentPage(segmentId){const index=filteredSegments().findIndex(segment=>segment.id===segmentId);if(index<0)return false;const nextPage=Math.floor(index/pageSize);if(nextPage!==pageIndex){pageIndex=nextPage;renderOutline();}return true;}
  function renderOutline(){
    if(!chapter)return;const segments=filteredSegments(),pageCount=Math.max(1,Math.ceil(segments.length/pageSize));pageIndex=Math.max(0,Math.min(pageCount-1,pageIndex));const start=pageIndex*pageSize,visible=segments.slice(start,start+pageSize);
    sceneButtons.clear();segmentRows.clear();openedDetails=null;outline.replaceChildren();phases.replaceChildren();
    const currentSegment=sceneMap.get(currentId)?.segmentId,currentIndex=segments.findIndex(segment=>segment.id===currentSegment),currentPage=currentIndex<0?-1:Math.floor(currentIndex/pageSize);
    for(let page=0;page<pageCount;page++){const button=el('button','chapter-phase-button',`${page*pageSize+1}–${Math.min(segments.length,(page+1)*pageSize)}`);button.type='button';button.dataset.page=String(page);button.classList.toggle('is-current',page===currentPage);button.classList.toggle('is-selected',page===pageIndex);if(page===currentPage)button.setAttribute('aria-current','step');button.setAttribute('aria-label',`查看本章第 ${page*pageSize+1} 至 ${Math.min(segments.length,(page+1)*pageSize)} 段`);phases.append(button);}
    pageInfo.textContent=`第 ${segments.length?start+1:0}–${Math.min(start+pageSize,segments.length)} 段 / 共 ${segments.length} 段${currentIndex>=0?` · 演出在第 ${currentIndex+1} 段`:''}`;pagePrevious.disabled=pageIndex===0;pageNext.disabled=pageIndex===pageCount-1;
    const fragment=document.createDocumentFragment();for(const [index,segment]of visible.entries()){
      const row=el('li','chapter-segment');row.dataset.segmentId=segment.id;row.style.setProperty('--branch-indent',Math.min(3,Math.max(0,Number(segment.depth)||0)));const details=el('details','chapter-segment-details');details.dataset.segmentId=segment.id;
      const summary=el('summary','chapter-segment-summary'),number=el('span','chapter-segment-number',String(start+index+1).padStart(2,'0')),text=el('span','chapter-segment-text');summary.title=segment.label; text.append(el('strong','',segment.displayLabel||segment.label||`段落 ${start+index+1}`),el('small','',`${segment.depth?`分支 ${segment.depth} 级`:'主线'} · ${segment.sceneIds.length} 片段${segment.cycle?' · 回环':''}`));summary.append(number,text,el('span','chapter-segment-toggle','展开'));details.append(summary);row.append(details);fragment.append(row);segmentRows.set(segment.id,row);
    }outline.append(fragment);container.dataset.renderedScenes='0';container.dataset.renderedSegments=String(visible.length);
    const selected=visible.find(segment=>segment.id===selectedSegmentId)||visible.find(segment=>segment.id===currentSegment)||visible[0];if(selected)describeSelection(selected.id,selected.sceneIds.includes(selectedId)?selectedId:null);else{inspectorTitle.textContent='该层级暂无段落';inspectorMeta.textContent='请选择其他层级';inspectorActions.replaceChildren();routeList.replaceChildren();}markCurrent();
  }
  function finishReady(result){resolveReady?.(result);resolveReady=null;}
  function makeReady(){finishReady(false);readyPromise=new Promise(resolve=>{resolveReady=resolve;});}
  function remember(key,value){cache.delete(key);cache.set(key,value);while(cache.size>2)cache.delete(cache.keys().next().value);}
  async function pumpLoad(){
    if(disposed||loadingKey||!requestedKey)return;const key=requestedKey;
    if(cache.has(key)){renderChapter(cache.get(key),key);finishReady(true);return;}
    loadingKey=key;
    try{const value=await loadChapter(key);if(!value||!Array.isArray(value.scenes)||!Array.isArray(value.segments))throw new Error('章节地图格式不完整。');if(!disposed&&requestedKey===key){remember(key,value);renderChapter(value,key);finishReady(true);}}
    catch(error){if(!disposed&&requestedKey===key){status.textContent=`章节读取失败：${error.message||error}`;chapterTitle.textContent='章节暂时无法读取';const retry=el('button','button small quiet','重新读取');retry.type='button';retry.dataset.action='retry';outline.replaceChildren(el('li','chapter-route-empty','请重试读取本章地图。'),retry);body.removeAttribute('aria-busy');finishReady(false);}}
    finally{loadingKey=null;if(!disposed&&requestedKey!==key)pumpLoad();}
  }
  function requestChapter(key,{sceneId=null}={}){
    if(disposed||!chapterById.has(key))return Promise.resolve(false);if(sceneId)selectedId=sceneId;
    if(requestedKey===key&&loadedKey===key){if(sceneId)describeSelection(sceneMap.get(sceneId)?.segmentId,sceneId);return Promise.resolve(true);}
    if(requestedKey===key&&loadingKey)return readyPromise;
    requestedKey=key;chapterSelect.value=key;makeReady();locationText();playChapter.disabled=true;
    if(cache.has(key)){renderChapter(cache.get(key),key);finishReady(true);}
    else{loadedKey=null;chapter=null;delete container.dataset.loadedChapter;container.dataset.renderedScenes='0';container.dataset.renderedSegments='0';phases.replaceChildren();pageInfo.textContent='';depthSelect.disabled=true;sceneMap.clear();segmentMap.clear();sceneButtons.clear();segmentRows.clear();openedDetails=null;outline.replaceChildren(el('li','chapter-map-loading','正在读取本章的剧情段落…'));inspectorTitle.textContent='正在准备本章分支';inspectorMeta.textContent='';inspectorActions.replaceChildren();routeList.replaceChildren();chapterTitle.textContent=chapterById.get(key).title;chapterMeta.textContent='按需读取本章地图';status.textContent='正在读取本章地图…';body.setAttribute('aria-busy','true');pumpLoad();}
    return readyPromise;
  }
  async function focusScene(id){const key=chapterKey(id);if(!key)return false;following=true;const okay=await requestChapter(key,{sceneId:id});if(!okay||disposed||requestedKey!==key)return false;const segment=sceneMap.get(id)?.segmentId;followPosition=true;if(depthFilter!=='all'){depthFilter='all';depthSelect.value='all';renderOutline();}showSegmentPage(segment);const details=segmentRows.get(segment)?.querySelector('details');if(details){details.open=true;if(!details.querySelector('.chapter-scene-list'))fillDetails(details,segmentMap.get(segment));sceneButtons.get(id)?.scrollIntoView?.({block:'nearest',inline:'nearest'});}describeSelection(segment,id);return true;}
  async function navigate(id){if(jumping||disposed||!chapterKey(id))return;jumping=true;selectedId=id;following=true;status.textContent='正在准备所选剧情…';try{await onNavigate(id);if(!disposed)await focusScene(id);}catch(error){if(!disposed)status.textContent=`剧情跳转失败：${error.message||error}`;}finally{jumping=false;}}
  function resultButton(text,kind,value){const button=el('button','chapter-search-result',text);button.type='button';button.dataset[kind]=value;return button;}
  function runSearch(){
    if(disposed)return;const query=search.value.trim().toLocaleLowerCase();searchResults.replaceChildren();searchResults.hidden=!query;if(!query)return;let count=0;
    const matchedChapters=chapters.filter(item=>`${item.title} ${item.sourceTitle||''} ${chapterNumbers.get(item.id||item.key)||''}`.toLocaleLowerCase().includes(query));
    for(const item of matchedChapters.slice(0,8)){searchResults.append(resultButton(`章节 · ${item.title}`,'chapterId',item.id||item.key));count++;}
    const selectedScenes=chapter?.scenes||[],matches=selectedScenes.filter(scene=>`${scene.id} ${scene.label||''} ${scene.title||''} ${scene.row??''}`.toLocaleLowerCase().includes(query));
    for(const scene of matches.slice(0,18-count)){searchResults.append(resultButton(`本章片段 · ${scene.label||scene.title||scene.id}`,'sceneId',scene.id));count++;}
    if(query.includes('chapter-')||query.includes('archive-'))for(const id of Object.keys(manifest.sceneToChapter||{})){if(count>=18)break;if(!sceneMap.has(id)&&id.toLocaleLowerCase().includes(query)){searchResults.append(resultButton(`${chapterById.get(chapterKey(id))?.title||'剧情'} · ${id}`,'sceneId',id));count++;}}
    searchResults.prepend(el('p','chapter-search-count',count?`章节与本章片段 · ${count} 项${matchedChapters.length+matches.length>18?'，请补充关键词':''}`:'未找到匹配项；可先选择其他章节，再查找其中剧情。'));
  }
  listen(depthSelect,'change',()=>{depthFilter=depthSelect.value;pageIndex=0;followPosition=false;renderOutline();});
  listen(chapterSelect,'change',()=>{following=false;selectedId=null;search.value='';searchResults.hidden=true;requestChapter(chapterSelect.value);});
  listen(search,'input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,120);});listen(search,'keydown',event=>{if(event.key==='Escape'){clearTimeout(searchTimer);search.value='';searchResults.hidden=true;}});
  listen(container,'click',event=>{const button=event.target.closest?.('button');if(!button||!container.contains(button))return;if(button.dataset.page!==undefined){pageIndex=Number(button.dataset.page);followPosition=false;renderOutline();return;}if(button.dataset.sceneId){navigate(button.dataset.sceneId);return;}if(button.dataset.chapterId){following=false;selectedId=null;search.value='';searchResults.hidden=true;requestChapter(button.dataset.chapterId);return;}if(button.dataset.action==='current'){if(currentId)focusScene(currentId);}else if(button.dataset.action==='page-previous'||button.dataset.action==='page-next'){pageIndex+=button.dataset.action==='page-next'?1:-1;followPosition=false;renderOutline();}else if(button.dataset.action==='chapter-start'){navigate(chapter?.entrySceneId||chapterById.get(requestedKey)?.entrySceneId);}else if(button.dataset.action==='retry'){const key=requestedKey;requestedKey=null;requestChapter(key);}});
  // Closing a segment releases its scene buttons; the overview stays small even in long chapters.
  container.addEventListener('toggle',event=>{const details=event.target;if(disposed||!details.matches?.('.chapter-segment-details')||!container.contains(details))return;const segment=segmentMap.get(details.dataset.segmentId);if(!segment)return;if(details.open){if(openedDetails&&openedDetails!==details){openedDetails.open=false;clearDetails(openedDetails);}openedDetails=details;if(!details.querySelector('.chapter-scene-list'))fillDetails(details,segment);describeSelection(segment.id,segment.sceneIds.includes(currentId)?currentId:null);}else{clearDetails(details);if(openedDetails===details)openedDetails=null;}container.dataset.renderedScenes=String(sceneButtons.size);},{capture:true,signal:abort.signal});
  // The player supplies its restored position synchronously; avoid fetching an unused opening chapter.
  queueMicrotask(()=>{if(!disposed&&!requestedKey)requestChapter(chapterKey(manifest.startSceneId)||chapters[0]?.id||chapters[0]?.key);});
  return{
    setCurrent(sceneId,nextVisited=new Set()){
      if(disposed)return;const changed=sceneId!==currentId,size=nextVisited?.size??nextVisited?.length??0;if(!changed&&size===lastVisitedSize&&nextVisited===lastVisitedIdentity)return;currentId=sceneId;visited=nextVisited instanceof Set?nextVisited:new Set(nextVisited);lastVisitedSize=size;lastVisitedIdentity=nextVisited;locationText();
      if(changed&&following&&chapterKey(sceneId)&&chapterKey(sceneId)!==requestedKey)requestChapter(chapterKey(sceneId));else{if(changed&&sceneMap.has(sceneId)){const segmentId=sceneMap.get(sceneId).segmentId;if(following&&followPosition)showSegmentPage(segmentId);describeSelection(segmentId,sceneId);}else markCurrent();}
    },
    focusScene,
    get ready(){return readyPromise;},
    get layoutSummary(){return{category:chapter?.category||'story',chapterId:loadedKey,chapters:chapters.length,nodes:chapter?.scenes.length||0,segments:chapter?.segments.length||0,renderedScenes:sceneButtons.size,renderedSegments:segmentRows.size,pageSize,pageIndex,cachedChapters:cache.size,pendingLoads:loadingKey?1:0,totalNodes:manifest.totals?.scenes||Object.keys(manifest.sceneToChapter||{}).length};},
    dispose(){disposed=true;abort.abort();clearTimeout(searchTimer);finishReady(false);cache.clear();sceneMap.clear();segmentMap.clear();sceneButtons.clear();segmentRows.clear();container.replaceChildren();},
  };
}
