const TYPES=new Set(['image','audio','video']);
const BAD_KEYS=new Set(['__proto__','constructor','prototype']);
const extensions={image:new Set(['png','jpg','jpeg','webp','gif','avif','svg']),audio:new Set(['wav','mp3','ogg','m4a','aac','flac']),video:new Set(['mp4','webm','ogv'])};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};

function cleanPath(value,label='资源路径'){
  if(typeof value!=='string'||!value||value.length>4096)fail(`${label}无效。`);
  let path=value;
  for(let attempt=0;attempt<2;attempt++){
    try{const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}catch{fail(`${label}含无效编码。`);}
  }
  if(/^[a-z][a-z\d+.-]*:/i.test(path)||path.startsWith('/')||/[\\%?#\u0000-\u001f]/.test(path))fail(`${label}必须是资源包中的相对路径。`);
  const parts=path.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||BAD_KEYS.has(part)))fail(`${label}包含不支持的目录。`);
  return parts.join('/');
}
function filePath(file){
  const value=String(file.webkitRelativePath||file.name||'').replaceAll('\\','/');
  return cleanPath(value,'所选文件路径');
}
function compatible(file,type){
  const extension=String(file.name||'').split('.').at(-1).toLowerCase();
  const mime=String(file.type||'').toLowerCase();
  return extensions[type].has(extension)&&(!mime||mime.startsWith(type+'/')||mime==='application/octet-stream');
}
function descriptors(assets){
  if(!Array.isArray(assets)||assets.length>50000)fail('资源清单格式无效。');
  const map=new Map();
  for(const raw of assets){
    if(!plain(raw)||typeof raw.id!=='string'||!raw.id.trim()||BAD_KEYS.has(raw.id)||!TYPES.has(raw.type))fail('资源清单包含无效的编号或类型。');
    if(map.has(raw.id))fail(`资源编号 ${raw.id} 重复。`);
    const asset={id:raw.id,type:raw.type,src:cleanPath(raw.src),localPath:cleanPath(raw.localPath||raw.src)};
    if(typeof raw.label==='string')asset.label=raw.label;
    map.set(asset.id,Object.freeze(asset));
  }
  return map;
}

/** The website only reads explicitly selected files; this module never uploads them. */
export class ResourceLibrary{
  constructor({baseURL=globalThis.location?.href||'http://localhost/',assets=[],urlAPI=URL,maxFileBytes=1024*1024*1024,localOnly=false,onReady=()=>{},onError=()=>{}}={}){
    this.baseURL=new URL(baseURL);this.assets=descriptors(assets);this.overrides=new Map();this.urlAPI=urlAPI;
    if(!['https:','http:','file:'].includes(this.baseURL.protocol))fail('资源包地址必须来自当前网站或本地文件。');
    if(!Number.isSafeInteger(maxFileBytes)||maxFileBytes<=0)fail('资源大小限制无效。');
    this.maxFileBytes=maxFileBytes;this.disposed=false;
    this.localOnly=localOnly;this.provider=null;this.pending=new Map();this.resolved=new Map();this.recent=new Map();this.onReady=onReady;this.onError=onError;
  }
  asset(id){return this.assets.get(id)||null;}
  resolve(id){
    if(this.disposed)return null;
    const asset=this.assets.get(id);if(!asset)return null;
    if(this.provider){
      this.recent.delete(id);this.recent.set(id,true);
      if(this.resolved.has(id))return this.resolved.get(id);
      if(!this.pending.has(id)){
        const provider=this.provider;
        const pending=Promise.resolve().then(()=>provider.resolve(id)).then(url=>{
          if(!this.disposed&&this.provider===provider){this.resolved.set(id,url);this.onReady(id);}
          return url;
        }).catch(error=>{if(!this.disposed&&this.provider===provider){this.resolved.set(id,null);this.onError(error,id);}return null;});
        this.pending.set(id,pending);
      }
      return null;
    }
    if(this.localOnly)return null;
    return this.overrides.get(id)?.url||new URL(asset.src,this.baseURL).href;
  }
  setLocalProvider(provider){this.provider?.dispose();this.provider=provider;this.pending.clear();this.resolved.clear();}
  async preload(ids){for(const id of ids)this.resolve(id);await Promise.all(ids.map(id=>this.pending.get(id)));}
  retain(ids){
    if(!this.provider?.release)return;
    const active=new Set(ids);
    for(const id of this.recent.keys()){
      if(this.resolved.size<=24)break;
      if(active.has(id)||!this.resolved.has(id))continue;
      this.provider.release(id);this.resolved.delete(id);this.pending.delete(id);this.recent.delete(id);
    }
  }
  importFolder(fileList){
    if(this.disposed)fail('此资源库已经关闭。');
    const files=Array.from(fileList||[]);if(files.length>100000)fail('所选文件过多，请只选择资源包目录。');
    const paths=new Map();
    for(const file of files){
      const path=filePath(file),variants=[path];if(path.includes('/'))variants.push(path.slice(path.indexOf('/')+1));
      for(const variant of variants){if(!paths.has(variant))paths.set(variant,new Set());paths.get(variant).add(file);}
    }
    const planned=[],used=new Set();
    for(const asset of this.assets.values()){
      const candidates=paths.get(asset.localPath);
      if(!candidates?.size)continue;
      if(candidates.size>1)fail(`资源 ${asset.id} 匹配到多个同路径文件，未替换任何资源。`);
      const file=[...candidates][0];
      if(!Number.isSafeInteger(file.size)||file.size<0||file.size>this.maxFileBytes)fail(`资源 ${asset.id} 的文件大小无效或超过限制。`);
      if(!compatible(file,asset.type))fail(`资源 ${asset.id} 的文件类型与清单不一致。`);
      planned.push({asset,file});used.add(file);
    }
    const staged=[];
    try{for(const {asset,file} of planned)staged.push({id:asset.id,url:this.urlAPI.createObjectURL(file),file});}
    catch(error){for(const entry of staged)this.urlAPI.revokeObjectURL(entry.url);throw new Error(`读取所选资源失败：${error.message}`);}
    for(const entry of staged){const old=this.overrides.get(entry.id);if(old)this.urlAPI.revokeObjectURL(old.url);this.overrides.set(entry.id,entry);}
    return {matched:staged.length,unmatched:files.length-used.size,ambiguous:[],overrides:[...this.overrides.keys()]};
  }
  clearOverrides(){for(const value of this.overrides.values())this.urlAPI.revokeObjectURL(value.url);this.overrides.clear();}
  dispose(){this.clearOverrides();this.provider?.dispose();this.provider=null;this.pending.clear();this.resolved.clear();this.disposed=true;}
}

