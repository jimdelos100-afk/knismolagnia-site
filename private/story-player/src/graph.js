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
