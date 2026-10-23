import {layoutGraph} from './graph.js';

const SVG='http://www.w3.org/2000/svg';
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const svg=(tag,attributes={})=>{const node=document.createElementNS(SVG,tag);for(const [name,value]of Object.entries(attributes))node.setAttribute(name,String(value));return node;};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const isReference=scene=>scene.category==='reference'||/^(archive-|reference-)/.test(scene.id);
const short=(text,length=30)=>String(text||'').length>length?`${String(text).slice(0,length)}…`:String(text||'');
const rowName=scene=>{const row=scene.id.match(/-row-(\d+)/);return row?`脚本行 ${row[1]}`:scene.id.startsWith('archive-')?`资料片段 ${scene.id.split('-').slice(1).join(' · ')}`:'剧情片段';};
const friendlyTitle=scene=>{
  const raw=scene.title.replace(/\s*·\s*\d+$/,'');
  if(/_CG/i.test(raw))return `${scene.chapter} · CG 演出`;
  if(/GameOver/i.test(raw))return `${scene.chapter} · 结束分支`;
  if(/vs/i.test(raw))return `${scene.chapter} · 讨论剧情`;
  if(/^Start$/i.test(raw))return `${scene.chapter} · 开始`;
  if(/^omake/i.test(raw))return `${scene.chapter} · 追加剧情`;
  return isReference(scene)?scene.title:scene.chapter||scene.title;
};
function edgeRoute(edge,positions,index){
  const a=positions.get(edge.from),b=positions.get(edge.to),halfH=35,halfW=92;
  if(edge.terminal)return {d:`M ${a.x+45} ${a.y+halfH} L ${a.x+72} ${a.y+83}`,x:a.x+170,y:a.y+76,endX:a.x+72,endY:a.y+83};
  if(edge.from===edge.to){const x=a.x+halfW,y=a.y;return {d:`M ${x} ${y-12} C ${x+100} ${y-120}, ${x+100} ${y+120}, ${x} ${y+12}`,x:x+76,y:y-18};}
  if(edge.cycle&&a.y===b.y){const top=a.y-78-(index%4)*12;return {d:`M ${a.x} ${a.y-halfH} C ${a.x} ${top}, ${b.x} ${top}, ${b.x} ${b.y-halfH}`,x:(a.x+b.x)/2,y:top+15};}
  if(!edge.crossChapter&&!edge.cycle&&b.y>a.y){const start=a.y+halfH,end=b.y-halfH,mid=(start+end)/2;return {d:`M ${a.x} ${start} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${end}`,x:(a.x+b.x)/2,y:mid-7};}
  if(!edge.crossChapter&&b.x>a.x&&b.rank>a.rank){const start=a.x+halfW,end=b.x-halfW,mid=(start+end)/2;return {d:`M ${start} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${end} ${b.y}`,x:mid,y:(a.y+b.y)/2-8};}
  const side=a.x<=b.x?-1:1,ax=a.x+side*halfW,bx=b.x+side*halfW,detour=Math.min(ax,bx)-70-(index%5)*16;
  if(edge.crossChapter){const mid=(a.y+b.y)/2;return {d:`M ${a.x} ${a.y+halfH} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y-halfH}`,x:(a.x+b.x)/2,y:mid-7};}
  return {d:`M ${ax} ${a.y} C ${detour} ${a.y}, ${detour} ${b.y}, ${bx} ${b.y}`,x:detour,y:(a.y+b.y)/2-6};
}

/** A complete, zoomable map. Navigation is delegated to the player's resource-aware jump. */
export function createGraphView(container,story,{onNavigate=()=>{}}={}){
  const abort=new AbortController(),listen=(node,type,handler,options={})=>node.addEventListener(type,handler,{...options,signal:abort.signal});
  const allScenes=story.scenes,sceneMap=new Map(allScenes.map(scene=>[scene.id,scene])),layouts=new Map();
  let category=allScenes.some(scene=>!isReference(scene))?'story':'reference',layout,world,connections,scale=1,offsetX=0,offsetY=0,currentId=null,selectedId=null,visited=new Set(),disposed=false,fitMode=true,renderFrame=0,suppressClickUntil=0;
  let nodeButtons=new Map(),edgeElements=[],clusterButtons=[],pointers=new Map(),gesture=null;
  container.replaceChildren();container.classList.add('branch-map');container.style.removeProperty('height');container.style.removeProperty('aspect-ratio');
  const toolbar=el('div','map-toolbar'),viewLabel=el('label','map-field','浏览内容'),viewSelect=el('select');viewSelect.setAttribute('aria-label','切换剧情地图与译文资料');
  viewSelect.append(new Option('完整剧情地图','story'),new Option('译文资料','reference'));viewLabel.append(viewSelect);
  for(const option of viewSelect.options)option.disabled=!allScenes.some(scene=>isReference(scene)===(option.value==='reference'));viewSelect.value=category;
  const chapterLabel=el('label','map-field','定位章节'),chapterSelect=el('select');chapterSelect.setAttribute('aria-label','定位章节，保留所有分支');chapterLabel.append(chapterSelect);
  const searchLabel=el('label','map-field map-search','查找片段'),search=el('input');search.type='search';search.placeholder='章节、脚本行、场景名称';search.autocomplete='off';search.setAttribute('aria-label','查找任意剧情片段');searchLabel.append(search);
  const tools=el('div','map-zoom-tools');tools.setAttribute('role','group');tools.setAttribute('aria-label','地图缩放与定位');
  const control=(label,title,action)=>{const button=el('button','button small quiet',label);button.type='button';button.title=title;button.setAttribute('aria-label',title);listen(button,'click',action);tools.append(button);return button;};
  const zoomOut=control('−','缩小地图',()=>zoomAt(scale/1.5));
  const zoomText=el('output','map-zoom-value','100%');zoomText.setAttribute('aria-label','地图缩放比例');tools.append(zoomText);
  const zoomIn=control('＋','放大地图',()=>zoomAt(scale*1.5));
  control('全图','显示全部片段与分支',()=>fitAll());
  control('当前','定位正在播放的片段',()=>{if(currentId)focusScene(currentId);});
  toolbar.append(viewLabel,chapterLabel,searchLabel,tools);
  const results=el('div','map-search-results');results.hidden=true;results.setAttribute('role','region');results.setAttribute('aria-label','场景搜索结果');
  const viewport=el('div','map-viewport');viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','完整分支地图，可拖动画布，使用加减键缩放和方向键平移');
  const overviewLabels=el('div','map-overview-labels');overviewLabels.setAttribute('aria-label','章节快捷定位');
  const status=el('p','map-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const help=el('p','map-help','拖动移动 · 双指或滚轮缩放 · 点击任意片段跳转 · 「定位章节」放大查看分叉与汇合');
  const inspector=el('section','map-inspector');inspector.setAttribute('aria-label','所选片段与分支');
  const inspectorTitle=el('strong','map-inspector-title','选择任意片段，从对应分支开始阅读。'),inspectorMeta=el('span','map-inspector-meta'),routes=el('div','map-route-list');
  inspector.append(inspectorTitle,inspectorMeta,routes);container.append(toolbar,results,viewport,status,help,inspector);

  function selectedScenes(){return allScenes.filter(scene=>isReference(scene)===(category==='reference'));}
  function getLayout(){
    if(layouts.has(category))return layouts.get(category);
    const scenes=selectedScenes(),ids=new Set(scenes.map(scene=>scene.id));
    const substory={...story,scenes,graphEdges:(story.graphEdges||scenes.flatMap(scene=>[...(scene.next?[{from:scene.id,to:scene.next,label:''}]:[]),...(scene.choices||[]).map(choice=>({from:scene.id,to:choice.target,label:choice.label}))])).filter(edge=>ids.has(edge.from)&&ids.has(edge.to))};
    const value=layoutGraph(substory);layouts.set(category,value);return value;
  }
  function repaint(){
    if(disposed||!world)return;
    world.style.transform=`translate(${offsetX}px,${offsetY}px) scale(${scale})`;
    viewport.dataset.detail=scale>=.46?'full':scale>=.16?'compact':'overview';
    zoomText.value=`${Math.round(scale*100)}%`;zoomText.textContent=zoomText.value;
    zoomOut.disabled=scale<=minimumScale()*1.01;zoomIn.disabled=scale>=2.5;
    // Unscaled chapter labels stay readable in the overview; detailed nodes are never removed.
    for(const {button,cluster}of clusterButtons){
      button.hidden=scale>=.16;
      button.style.left=`${offsetX+(cluster.x+cluster.width/2)*scale}px`;
      button.style.top=`${offsetY+(cluster.y+22)*scale}px`;
      button.style.maxWidth=`${Math.max(45,Math.min(150,cluster.width*scale-6))}px`;
    }
  }
  function minimumScale(){return Math.min(.25,Math.max(.004,Math.min((viewport.clientWidth-36)/layout.width,(viewport.clientHeight-36)/layout.height)*.45));}
  function zoomAt(value,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
    const next=clamp(value,minimumScale(),2.5),ratio=next/scale;offsetX=x-(x-offsetX)*ratio;offsetY=y-(y-offsetY)*ratio;scale=next;fitMode=false;repaint();
  }
  function fitBounds(bounds,maxScale=1){
    scale=clamp(Math.min((viewport.clientWidth-44)/bounds.width,(viewport.clientHeight-44)/bounds.height,maxScale),minimumScale(),2.5);
    offsetX=(viewport.clientWidth-bounds.width*scale)/2-bounds.x*scale;offsetY=(viewport.clientHeight-bounds.height*scale)/2-bounds.y*scale;repaint();
  }
  function fitAll(){fitMode=true;chapterSelect.value='';fitBounds({x:0,y:0,width:layout.width,height:layout.height},.95);}
  function highlight(){
    viewport.dataset.hasSelection=selectedId&&layout.positions.has(selectedId)?'true':'false';
    for(const [id,button]of nodeButtons){button.classList.toggle('is-current',id===currentId);button.classList.toggle('is-selected',id===selectedId);button.classList.toggle('is-visited',visited.has(id));if(id===currentId)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
    for(const {edge,path,label}of edgeElements){const selected=edge.from===selectedId||edge.to===selectedId;path.classList.toggle('is-selected-route',selected);label?.classList.toggle('is-selected-route',selected);path.classList.toggle('is-current',edge.from===currentId||edge.to===currentId);path.classList.toggle('is-visited',visited.has(edge.from)&&visited.has(edge.to));}
  }
  function showInspector(id){
    const scene=sceneMap.get(id);if(!scene)return;selectedId=id;inspectorTitle.textContent=`${friendlyTitle(scene)} · ${rowName(scene)}`;
    inspectorMeta.textContent=`${scene.title} · ${scene.id}`;routes.replaceChildren();
    const outgoing=layout.edges.filter(edge=>edge.from===id);
    if(!outgoing.length)routes.append(el('span','map-route-end','本片段结束；可继续点击地图中的其他分支。'));
    else for(const [index,edge]of outgoing.entries()){
      if(edge.terminal){const ending=el('span','map-route-end map-route-terminal',`${edge.label} → 本段结束`);ending.title='在播放器中选择此选项后结束本段。';routes.append(ending);continue;}
      const target=sceneMap.get(edge.to),button=el('button','map-route-button',`${edge.label||'继续剧情'} → ${rowName(target)}`);button.type='button';button.title=`${edge.label||'继续剧情'}\n${target.title}\n${edge.condition||''}`;
      const number=el('span','map-route-number',String(index+1));button.prepend(number);listen(button,'click',()=>activate(edge.to));routes.append(button);
    }
    highlight();
  }
  function activate(id){if(performance.now()<suppressClickUntil)return;showInspector(id);onNavigate(id);}
  function renderMap(){
    layout=getLayout();selectedId=null;nodeButtons=new Map();edgeElements=[];clusterButtons=[];viewport.replaceChildren();
    world=el('div','map-world');Object.assign(world.style,{width:`${layout.width}px`,height:`${layout.height}px`});
    connections=svg('svg',{class:'map-connections',width:layout.width,height:layout.height,viewBox:`0 0 ${layout.width} ${layout.height}`,'aria-hidden':'true'});
    const defs=svg('defs'),marker=svg('marker',{id:`branch-arrow-${category}`,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse',markerUnits:'userSpaceOnUse'});
    marker.append(svg('path',{d:'M 0 1 L 9 5 L 0 9 z',class:'map-arrow'}));defs.append(marker);connections.append(defs);
    for(const cluster of layout.clusters||[]){
      const box=el('div','map-cluster');Object.assign(box.style,{left:`${cluster.x}px`,top:`${cluster.y}px`,width:`${cluster.width}px`,height:`${cluster.height}px`});box.dataset.clusterId=cluster.id;
      const heading=el('div','map-cluster-heading');heading.append(el('strong','',`${cluster.title} · ${cluster.count} 片段`),el('span','',cluster.subtitle));box.append(heading);world.append(box);
      const button=el('button','map-overview-label',cluster.title);button.type='button';button.title=`${cluster.title} · ${cluster.subtitle} · ${cluster.count} 片段`;button.setAttribute('aria-label',`放大查看${cluster.title}的全部 ${cluster.count} 个片段`);
      listen(button,'click',()=>{chapterSelect.value=cluster.id;fitMode=false;fitBounds(cluster,1);});overviewLabels.append(button);clusterButtons.push({button,cluster});
    }
    const edgeGroup=svg('g',{class:'map-edge-group'}),labelGroup=svg('g',{class:'map-edge-labels'});
    layout.edges.forEach((edge,index)=>{
      const route=edgeRoute(edge,layout.positions,index),path=svg('path',{d:route.d,class:`map-link${edge.cycle?' is-cycle':''}${edge.crossChapter?' is-cross-chapter':''}`,'marker-end':`url(#branch-arrow-${category})`});
      path.dataset.from=edge.from;path.dataset.to=edge.to;const title=svg('title');title.textContent=`${edge.label||'继续剧情'}${edge.condition?` · ${edge.condition}`:''}`;path.append(title);edgeGroup.append(path);const elements={edge,path};edgeElements.push(elements);
      if(edge.terminal){edgeGroup.append(svg('circle',{cx:route.endX,cy:route.endY,r:7,class:'map-endpoint'}));}
      if(edge.label){const label=svg('text',{x:route.x,y:route.y,class:'map-edge-label','text-anchor':'middle'});label.textContent=short(edge.label.replace(/^条件分支浏览：/,''),25);const title=svg('title');title.textContent=edge.label;label.append(title);labelGroup.append(label);elements.label=label;}
    });
    connections.append(edgeGroup,labelGroup);world.append(connections);
    for(const scene of selectedScenes()){
      const point=layout.positions.get(scene.id),outgoing=layout.edges.filter(edge=>edge.from===scene.id),fork=outgoing.length>1;
      const button=el('button',`map-node${fork?' is-fork':''}`);button.type='button';button.dataset.sceneId=scene.id;button.dataset.category=category;button.setAttribute('aria-label',`跳转到${friendlyTitle(scene)}，${rowName(scene)}${fork?`，${outgoing.length} 条分支`:''}`);
      Object.assign(button.style,{left:`${point.x}px`,top:`${point.y}px`});
      button.append(el('small','map-node-kicker',`${rowName(scene)}${fork?` · ${outgoing.length} 分支`:''}`),el('strong','',friendlyTitle(scene)),el('span','map-node-source',short(scene.title,26)));
      button.title=`${scene.title}\n${rowName(scene)}\n${scene.id}${outgoing.length?`\n${outgoing.map(edge=>edge.label||'继续剧情').join('\n')}`:''}`;
      listen(button,'click',()=>activate(scene.id));listen(button,'focus',()=>{showInspector(scene.id);const x=offsetX+point.x*scale,y=offsetY+point.y*scale;if(button.matches(':focus-visible')&&(scale<.5||x<0||y<0||x>viewport.clientWidth||y>viewport.clientHeight))focusScene(scene.id,{focus:false});});
      world.append(button);nodeButtons.set(scene.id,button);
    }
    viewport.append(world,overviewLabels);chapterSelect.replaceChildren(new Option(category==='story'?'全部章节 · 完整地图':'全部译文资料',''));
    for(const cluster of layout.clusters||[])chapterSelect.append(new Option(`${cluster.title} · ${short(cluster.subtitle,24)} · ${cluster.count} 片段`,cluster.id));
    const summary=layout.summary;
    status.textContent=category==='story'?`${summary.nodes.toLocaleString()} 个剧情片段 · ${summary.forks} 处分叉 · ${summary.edges.toLocaleString()} 条连接 · 全部保留`:`${summary.nodes.toLocaleString()} 个译文资料片段 · 与剧情地图分开浏览`;
    search.value='';results.hidden=true;routes.replaceChildren();inspectorTitle.textContent='选择任意片段，从对应分支开始阅读。';inspectorMeta.textContent='';highlight();fitAll();
  }
  function focusScene(id,{focus=false}={}){
    const scene=sceneMap.get(id);if(!scene)return false;const next=isReference(scene)?'reference':'story';
    if(next!==category){category=next;viewSelect.value=category;overviewLabels.replaceChildren();renderMap();}
    const point=layout.positions.get(id);if(!point)return false;
    fitMode=false;scale=Math.min(1.15,Math.max(.7,viewport.clientWidth/700));offsetX=viewport.clientWidth/2-point.x*scale;offsetY=viewport.clientHeight/2-point.y*scale;chapterSelect.value=point.group||'';showInspector(id);repaint();
    if(focus)nodeButtons.get(id)?.focus({preventScroll:true});return true;
  }
  listen(viewSelect,'change',()=>{category=viewSelect.value;overviewLabels.replaceChildren();renderMap();});
  listen(chapterSelect,'change',()=>{const cluster=layout.clusters?.find(item=>item.id===chapterSelect.value);if(cluster){fitMode=false;fitBounds(cluster,1);}else fitAll();});
  listen(search,'input',()=>{
    const query=search.value.trim().toLocaleLowerCase();results.replaceChildren();results.hidden=!query;for(const button of nodeButtons.values())button.classList.remove('is-match');if(!query)return;
    const matches=selectedScenes().filter(scene=>`${scene.id} ${scene.title} ${scene.chapter} ${scene.sourceIds?.join(' ')||''}`.toLocaleLowerCase().includes(query));
    results.append(el('p','map-result-count',`找到 ${matches.length} 个片段${matches.length>80?'，显示前 80 个；可补充脚本行缩小范围':''}`));
    for(const scene of matches){nodeButtons.get(scene.id)?.classList.add('is-match');}
    for(const scene of matches.slice(0,80)){const button=el('button','map-search-result',`${friendlyTitle(scene)} · ${rowName(scene)} · ${short(scene.title,36)}`);button.type='button';listen(button,'click',()=>{focusScene(scene.id,{focus:true});results.hidden=true;});results.append(button);}
  });
  listen(search,'keydown',event=>{if(event.key==='Escape'){results.hidden=true;search.value='';for(const button of nodeButtons.values())button.classList.remove('is-match');}});
  listen(viewport,'wheel',event=>{event.preventDefault();const box=viewport.getBoundingClientRect();zoomAt(scale*Math.exp(-event.deltaY*.0018),event.clientX-box.left,event.clientY-box.top);},{passive:false});
  listen(viewport,'pointerdown',event=>{
    if(event.button!==0)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const points=[...pointers.values()];gesture={x:offsetX,y:offsetY,scale,startX:event.clientX,startY:event.clientY,moved:false};
    if(points.length===2){gesture.distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);gesture.midX=(points[0].x+points[1].x)/2;gesture.midY=(points[0].y+points[1].y)/2;}
  });
  listen(viewport,'pointermove',event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const points=[...pointers.values()],box=viewport.getBoundingClientRect();
    if(points.length===2&&gesture.distance){
      const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),midX=(points[0].x+points[1].x)/2-box.left,midY=(points[0].y+points[1].y)/2-box.top;
      scale=clamp(gesture.scale*distance/Math.max(1,gesture.distance),minimumScale(),2.5);const ratio=scale/gesture.scale;
      offsetX=midX-(gesture.midX-box.left-gesture.x)*ratio;offsetY=midY-(gesture.midY-box.top-gesture.y)*ratio;gesture.moved=true;
    }else if(points.length===1){const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;if(Math.hypot(dx,dy)<6&&!gesture.moved)return;gesture.moved=true;offsetX=gesture.x+dx;offsetY=gesture.y+dy;}
    if(gesture.moved){event.preventDefault();viewport.classList.add('is-panning');viewport.setPointerCapture(event.pointerId);suppressClickUntil=performance.now()+300;fitMode=false;repaint();}
  });
  const endPointer=event=>{pointers.delete(event.pointerId);if(gesture?.moved)suppressClickUntil=performance.now()+300;gesture=null;viewport.classList.remove('is-panning');};
  listen(viewport,'pointerup',endPointer);listen(viewport,'pointercancel',endPointer);listen(viewport,'lostpointercapture',event=>{pointers.delete(event.pointerId);});
  listen(viewport,'keydown',event=>{
    if(event.target!==viewport)return;
    if(event.code==='Space'||event.code==='Enter'){event.preventDefault();event.stopPropagation();return;}
    if(['+','=','-','_','0','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.preventDefault();else return;
    event.stopPropagation();
    if(['+','='].includes(event.key))zoomAt(scale*1.5);else if(['-','_'].includes(event.key))zoomAt(scale/1.5);else if(['0','Home'].includes(event.key))fitAll();
    else{const step=90;if(event.key==='ArrowLeft')offsetX+=step;if(event.key==='ArrowRight')offsetX-=step;if(event.key==='ArrowUp')offsetY+=step;if(event.key==='ArrowDown')offsetY-=step;fitMode=false;repaint();}
  });
  const resize=new ResizeObserver(()=>{if(fitMode)fitAll();else repaint();});
  renderMap();resize.observe(viewport);renderFrame=requestAnimationFrame(()=>fitAll());
  return {
    setCurrent(sceneId,nextVisited=new Set()){currentId=sceneId;visited=nextVisited instanceof Set?nextVisited:new Set(nextVisited);highlight();},
    focusScene,
    get layoutSummary(){return {...layout.summary,category,width:layout.width,height:layout.height};},
    dispose(){disposed=true;abort.abort();resize.disconnect();cancelAnimationFrame(renderFrame);container.replaceChildren();},
  };
}
