/** A bounded, page-scoped loader. URLs returned by the resource library remain library-owned. */
export function createNativeUiAssets(options){
  let generation=0,active=0,disposed=false,observer=null;
  let visible=new Set(),queue=[],deferred=new Map(),derived=new Set();
  const retained=()=>options.onVisibleAssets?.([...visible]);
  function beginPage(){
    generation++;queue=[];deferred.clear();observer?.disconnect();observer=null;
    for(const url of derived)URL.revokeObjectURL(url);derived.clear();
    visible=new Set();retained();
  }
  async function resizedUrl(image,size,token){
    const canvas=document.createElement('canvas');canvas.width=size[0];canvas.height=size[1];
    const context=canvas.getContext('2d');if(!context)return image.src;
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob||token!==generation||disposed)return null;
    const url=URL.createObjectURL(blob);derived.add(url);return url;
  }
  function pump(){
    while(!disposed&&active<2&&queue.length){
      const task=queue.shift();if(task.token!==generation)continue;active++;
      (async()=>{
        try{
          const url=await options.resolveAsset(task.assetId);if(!url||task.token!==generation||disposed)return;
          const probe=new Image();probe.src=url;await probe.decode();if(task.token!==generation||disposed)return;
          const displayUrl=task.resize?await resizedUrl(probe,task.resize,task.token):url;
          if(!displayUrl||task.token!==generation||disposed)return;
          task.apply(displayUrl,probe);task.target?.classList.add('is-loaded');
        }catch(error){if(task.token===generation&&!disposed){task.target?.classList.add('is-unavailable');options.onError?.(error,task.assetId);}}
        finally{active--;pump();}
      })();
    }
  }
  function enqueue(task){if(task.token!==generation||disposed)return;queue.push(task);pump();}
  function request(assetId,apply,{target=null,lazy=false,resize=null}={}){
    if(disposed||!assetId)return;
    visible.add(assetId);retained();
    const task={assetId,apply,target,resize,token:generation};
    if(lazy&&target&&typeof IntersectionObserver!=='undefined'){
      if(!observer){const watcher=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const job=deferred.get(entry.target);deferred.delete(entry.target);watcher.unobserve(entry.target);if(job)enqueue(job);}},{rootMargin:'120px'});observer=watcher;}
      deferred.set(target,task);observer.observe(target);
    }else enqueue(task);
  }
  function image(assetId,img,{lazy=false,resize=null}={}){img.dataset.assetId=assetId;request(assetId,url=>{img.src=url;},{target:img,lazy,resize});}
  function background(assetId,target,property='--native-panel-image'){request(assetId,url=>{target.style.setProperty(property,`url("${url}")`);},{target});}
  function dispose(){if(disposed)return;beginPage();disposed=true;}
  return {beginPage,request,image,background,dispose,get generation(){return generation;},get visibleAssets(){return [...visible];}};
}
