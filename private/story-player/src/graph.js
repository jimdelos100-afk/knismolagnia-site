const MAX_NODES=10000,MAX_EDGES=50000,MAX_COORD=100000,MAX_DIMENSION=2000000,NODE_MARGIN=85;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=message=>{throw new Error(`剧情地图无效：${message}`);};
function dimension(value,name,fallback){
  if(value===undefined)return fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>MAX_DIMENSION)fail(`${name}超出支持范围`);
  return value;
}
function coordinate(value,name){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>MAX_COORD)fail(`${name}必须是范围内的非负有限数字`);
  return value;
}

/** Pure layout: explicit coordinates are preserved and bounds grow to contain every node. */
export function layoutGraph(story){
  if(Array.isArray(story?.graphEdges))return layoutBranchGraph(story);
  if(!plain(story)||!Array.isArray(story.scenes)||!story.scenes.length||story.scenes.length>MAX_NODES)fail('节点列表缺失或超过支持数量');
  if(story.mapSize!==undefined&&!plain(story.mapSize))fail('地图尺寸格式错误');
  const initialWidth=dimension(story.mapSize?.width,'地图宽度',320),initialHeight=dimension(story.mapSize?.height,'地图高度',520);
  let width=Math.max(320,initialWidth),height=Math.max(520,initialHeight);
  const positions=new Map(),edges=[];
  for(const [index,scene]of story.scenes.entries()){
    if(!plain(scene)||!validId(scene.id))fail('节点编号缺失或无效');
    if(positions.has(scene.id))fail(`节点编号重复 ${scene.id}`);
    let point;
    if(scene.map===undefined)point={x:initialWidth/2,y:65+index*110};
    else{
      if(!plain(scene.map))fail(`节点 ${scene.id} 的位置格式错误`);
      point={x:coordinate(scene.map.x,`${scene.id}横坐标`),y:coordinate(scene.map.y,`${scene.id}纵坐标`)};
    }
    width=Math.max(width,point.x+NODE_MARGIN);height=Math.max(height,point.y+NODE_MARGIN);
    if(width>MAX_DIMENSION||height>MAX_DIMENSION)fail('节点位置需要过大的地图');
    positions.set(scene.id,point);
  }
  const addEdge=(from,target,label)=>{
    if(!validId(target)||!positions.has(target))fail(`节点 ${from} 指向不存在的目标`);
    if(typeof label!=='string')fail(`节点 ${from} 的分支名称无效`);
    if(edges.length>=MAX_EDGES)fail('连线数量超过支持范围');
    edges.push({from,to:target,label});
  };
  for(const scene of story.scenes){
    if(scene.next!==undefined&&scene.next!==null)addEdge(scene.id,scene.next,'');
    if(scene.choices===undefined)continue;
    if(!Array.isArray(scene.choices)||scene.choices.length>MAX_NODES)fail(`节点 ${scene.id} 的分支列表无效`);
    for(const choice of scene.choices){
      if(!plain(choice))fail(`节点 ${scene.id} 的分支格式错误`);
      addEdge(scene.id,choice.target,choice.label);
    }
  }
  return {width,height,positions,edges};
}

/** SCC condensation keeps cycles intact; each chapter gets a layered, non-overlapping layout. */
export function layoutBranchGraph(story){
  if(!plain(story)||!Array.isArray(story.scenes)||!story.scenes.length||story.scenes.length>MAX_NODES)fail('节点列表缺失或超过支持数量');
  const ids=new Set(),groups=new Map(),sceneMap=new Map(),positions=new Map(),edges=[];
  for(const scene of story.scenes){
    if(!validId(scene?.id)||ids.has(scene.id))fail('节点编号缺失或重复');
    ids.add(scene.id);sceneMap.set(scene.id,scene);
    const key=scene.mapGroup||scene.chapter||'剧情';
    if(!groups.has(key))groups.set(key,{id:key,scenes:[],category:scene.category||'story'});
    groups.get(key).scenes.push(scene);
  }
  if((story.graphEdges||[]).length>MAX_EDGES)fail('连线数量超过支持范围');
  for(const edge of story.graphEdges||[]){
    if(!ids.has(edge.from)||!ids.has(edge.to)||typeof edge.label!=='string')fail('连线的目标或名称无效');
    edges.push({...edge});
  }
  const out=new Map([...ids].map(id=>[id,[]])),incoming=new Map([...ids].map(id=>[id,[]]));
  for(const edge of edges){if(edge.terminal)continue;out.get(edge.from).push(edge.to);incoming.get(edge.to).push(edge.from);}
  const tiles=[];let cycleCount=0;
  for(const group of groups.values()){
    const local=new Set(group.scenes.map(scene=>scene.id)),done=new Set(),order=[];
    // Iterative Kosaraju avoids a call-stack limit on long scripts.
    for(const scene of group.scenes){if(done.has(scene.id))continue;
      const stack=[[scene.id,false]];
      while(stack.length){const [id,finish]=stack.pop();if(finish){order.push(id);continue;}if(done.has(id))continue;done.add(id);stack.push([id,true]);
        for(const next of out.get(id))if(local.has(next)&&!done.has(next))stack.push([next,false]);
      }
    }
    const componentOf=new Map(),components=[];
    for(const id of order.reverse()){if(componentOf.has(id))continue;const component=[],stack=[id],index=components.length;
      componentOf.set(id,index);while(stack.length){const item=stack.pop();component.push(item);for(const previous of incoming.get(item))if(local.has(previous)&&!componentOf.has(previous)){componentOf.set(previous,index);stack.push(previous);}}
      components.push(component);
    }
    const nexts=components.map(()=>new Set()),previous=components.map(()=>new Set()),rank=components.map(()=>0);
    for(const id of local)for(const to of out.get(id)){if(!local.has(to))continue;const a=componentOf.get(id),b=componentOf.get(to);if(a!==b){nexts[a].add(b);previous[b].add(a);}}
    const indegree=previous.map(set=>set.size),queue=indegree.flatMap((count,index)=>count?[]:[index]);
    for(let at=0;at<queue.length;at++){const a=queue[at];for(const b of nexts[a]){rank[b]=Math.max(rank[b],rank[a]+1);if(!--indegree[b])queue.push(b);}}
    const sourceOrder=new Map(group.scenes.map((scene,index)=>[scene.id,index]));
    const levels=[];
    components.forEach((component,index)=>{
      component.sort((a,b)=>sourceOrder.get(a)-sourceOrder.get(b));
      if(component.length>1||component.some(id=>out.get(id).includes(id)))cycleCount++;
      (levels[rank[index]]??=[]).push(...component);
    });
    const lanes=new Map();
    for(const level of levels){
      const score=id=>{const peers=incoming.get(id).filter(item=>lanes.has(item)&&local.has(item));return peers.length?peers.reduce((sum,item)=>sum+lanes.get(item),0)/peers.length:sourceOrder.get(id);};
      level.sort((a,b)=>score(a)-score(b)||sourceOrder.get(a)-sourceOrder.get(b));level.forEach((id,index)=>lanes.set(id,index));
    }
    // Long scripts continue in a new column after 12 layers. Every clip and edge remains present.
    const pageLength=12,pageWidths=[];
    levels.forEach((level,index)=>{const page=Math.floor(index/pageLength);pageWidths[page]=Math.max(pageWidths[page]||0,level.length*246+72);});
    const pageX=[];let tileWidth=0;for(const width of pageWidths){pageX.push(tileWidth);tileWidth+=Math.max(312,width)+100;}
    const points=new Map();levels.forEach((level,index)=>level.forEach((id,lane)=>points.set(id,{x:pageX[Math.floor(index/pageLength)]+140+lane*246,y:132+(index%pageLength)*156,rank:index,component:componentOf.get(id)})));
    const titleScene=sceneMap.get(group.id)||group.scenes[0];
    tiles.push({...group,title:titleScene.chapter||titleScene.title||'剧情',subtitle:titleScene.title,width:Math.max(340,tileWidth-52),height:Math.min(pageLength,levels.length)*156+112,points});
  }
  // Shelf packing gives the overview a useful aspect ratio without inventing narrative links.
  const totalArea=tiles.reduce((sum,tile)=>sum+tile.width*tile.height,0),targetWidth=Math.max(1800,Math.sqrt(totalArea)*1.5);
  let x=64,y=64,rowHeight=0,width=320,height=520;
  for(const tile of tiles){
    if(x>64&&x+tile.width>targetWidth){x=64;y+=rowHeight+100;rowHeight=0;}
    tile.x=x;tile.y=y;
    for(const [id,point]of tile.points)positions.set(id,{...point,x:x+point.x,y:y+point.y,group:tile.id});
    x+=tile.width+100;rowHeight=Math.max(rowHeight,tile.height);width=Math.max(width,x);height=Math.max(height,y+tile.height+64);
  }
  const clusters=tiles.map(({points,scenes,...tile})=>({...tile,count:scenes.length,sceneIds:scenes.map(scene=>scene.id)}));
  for(const edge of edges){const a=positions.get(edge.from),b=positions.get(edge.to);edge.crossChapter=a.group!==b.group;edge.cycle=!edge.terminal&&!edge.crossChapter&&(a.component===b.component||b.rank<=a.rank);}
  const branchCounts=new Map();for(const edge of edges)branchCounts.set(edge.from,(branchCounts.get(edge.from)||0)+1);
  return {width,height,positions,edges,clusters,nodeWidth:184,nodeHeight:70,summary:{nodes:ids.size,edges:edges.length,chapters:clusters.length,cycles:cycleCount,forks:[...branchCounts.values()].filter(count=>count>1).length}};
}
