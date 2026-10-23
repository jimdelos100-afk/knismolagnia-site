const TYPES=new Set(['image','audio','video']);
const BAD_KEYS=new Set(['__proto__','constructor','prototype']);
const EXTENSIONS={image:new Set(['png','jpg','jpeg','webp','gif','avif','svg']),audio:new Set(['wav','mp3','ogg','m4a','aac','flac']),video:new Set(['mp4','webm','ogv'])};
export const DEFAULT_MAX_ASSET_BYTES=256*1024*1024;
const fail=message=>{throw new Error(message);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!BAD_KEYS.has(value);

function pathOf(value,label='素材路径'){
  if(typeof value!=='string'||!value||value.length>4096||/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('/')||/[\\%?#\u0000-\u001f\u007f]/.test(value))fail(`${label}必须是网站内的普通相对路径。`);
  if(value.split('/').some(part=>!part||part==='.'||part==='..'||BAD_KEYS.has(part)))fail(`${label}含有不支持的目录。`);
  return value;
}
function typeMatches(name,mime,type){
  return EXTENSIONS[type]?.has(name.split('.').at(-1).toLowerCase())&&(!mime||mime==='application/octet-stream'||mime.toLowerCase().startsWith(type+'/'));
}
function maxBytes(options){
  const max=options.maxFileBytes??DEFAULT_MAX_ASSET_BYTES;
  if(!Number.isSafeInteger(max)||max<=0||max>1024*1024*1024)fail('单份素材的大小限制无效，允许范围为 1 字节至 1 GiB。');
  return max;
}
function progress(callback,value){if(typeof callback==='function')try{callback(Object.freeze({...value}));}catch{/* Progress observers cannot alter verification or commit. */}}
async function sha256(bytes){
  if(!globalThis.crypto?.subtle)fail('当前环境不支持素材校验，请使用 HTTPS 或本机预览地址。');
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}

/** Only the manifest shipped with the website is trusted. A selected folder never supplies it. */
export function validateAssetManifest(story,manifest){
  if(!plain(story)||!identifier(story.id)||!identifier(story.gameFingerprint)||!Array.isArray(story.assets)||story.assets.length>50000)fail('当前作品的素材目录无效。');
  if(!plain(manifest)||manifest.type!=='story-player-asset-manifest'||manifest.schemaVersion!==1||manifest.storyId!==story.id||manifest.gameFingerprint!==story.gameFingerprint||!Array.isArray(manifest.assets)||manifest.assets.length!==story.assets.length)fail('素材校验清单与当前作品或版本不一致。');
  const source=new Map(),sourcePaths=new Set();
  for(const asset of story.assets){
    if(!plain(asset)||!identifier(asset.id)||!TYPES.has(asset.type)||source.has(asset.id))fail('作品素材的编号或类型无效。');
    const path=pathOf(asset.src);
    if(asset.localPath!==undefined&&asset.localPath!==path)fail(`素材 ${asset.id} 的本地路径必须与网站路径一致。`);
    if(!typeMatches(path,'',asset.type)||sourcePaths.has(path))fail(`素材 ${asset.id} 的路径类型无效或重复。`);
    source.set(asset.id,{type:asset.type,path});sourcePaths.add(path);
  }
  const seen=new Set(),assets=[];
  for(const item of manifest.assets){
    if(!plain(item)||!identifier(item.id)||seen.has(item.id))fail('素材校验清单含有无效或重复编号。');
    const expected=source.get(item.id),path=pathOf(item.path);
    if(!expected||item.type!==expected.type||path!==expected.path)fail(`素材 ${item.id} 的类型或路径与作品不一致。`);
    if(!Number.isSafeInteger(item.size)||item.size<1||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))fail(`素材 ${item.id} 的大小或 SHA-256 无效。`);
    seen.add(item.id);assets.push(Object.freeze({id:item.id,type:item.type,path,size:item.size,sha256:item.sha256}));
  }
  return Object.freeze({type:'story-player-asset-manifest',schemaVersion:1,storyId:story.id,gameFingerprint:story.gameFingerprint,assets:Object.freeze(assets)});
}

async function readResponse(response,limit){
  if(!response.body?.getReader){
    const data=await response.arrayBuffer();
    return data.byteLength>limit?{overflow:true,actualSize:data.byteLength}:{data,actualSize:data.byteLength};
  }
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>limit){await reader.cancel();return {overflow:true,actualSize:total};}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const data=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  return {data,actualSize:total};
}

/** Audit deployed bytes without modifying the resource library or the selected user's files. */
export async function auditBundledAssets(story,manifest,{baseURL=globalThis.location?.href||'http://localhost/',fetcher=globalThis.fetch,onProgress,maxFileBytes}={}){
  const approved=validateAssetManifest(story,manifest),max=maxBytes({maxFileBytes});
  let base;try{base=new URL(baseURL);}catch{fail('网站素材地址无效。');}
  if(!['https:','http:','file:'].includes(base.protocol)||typeof fetcher!=='function')fail('网站素材地址或读取方式无效。');
  const results=[];progress(onProgress,{phase:'audit',completed:0,total:approved.assets.length});
  for(const item of approved.assets){
    const result={id:item.id,type:item.type,path:item.path,expectedSize:item.size,status:'error'};
    try{
      if(item.size>max)fail('素材超过当前单份大小限制。');
      const url=new URL(item.path,base),response=await fetcher(url.href,{cache:'no-store',credentials:'same-origin',redirect:'error'});
      if(response.status===404||response.status===410){result.status='missing';result.message='网站缺少此素材。';}
      else if(!response.ok)fail(`网站读取失败（${response.status}）。`);
      else{
        const mime=String(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
        if(!typeMatches(item.path,mime,item.type)){result.status='type-mismatch';result.message='网站返回的素材类型不一致。';await response.body?.cancel?.();}
        else{
          const sizeHeader=response.headers?.get('content-length'),announced=sizeHeader===null||sizeHeader===undefined?null:Number(sizeHeader);
          if(announced!==null&&Number.isFinite(announced)&&announced>item.size){result.status='size-mismatch';result.actualSize=announced;result.message='网站素材大小与清单不一致。';await response.body?.cancel?.();}
          else{
            const read=await readResponse(response,item.size);result.actualSize=read.actualSize;
            if(read.overflow||read.actualSize!==item.size){result.status='size-mismatch';result.message='网站素材大小与清单不一致。';}
            else if(await sha256(read.data)!==item.sha256){result.status='hash-mismatch';result.message='网站素材的 SHA-256 与清单不一致。';}
            else result.status='available';
          }
        }
      }
    }catch(error){result.status='error';result.message=`素材检查失败：${error.message}`;}
    results.push(result);progress(onProgress,{phase:'audit',completed:results.length,total:approved.assets.length,id:item.id,status:result.status});
  }
  const available=results.filter(item=>item.status==='available').length,missing=results.filter(item=>item.status==='missing').length;
  progress(onProgress,{phase:'complete',completed:results.length,total:results.length});
  return {storyId:approved.storyId,gameFingerprint:approved.gameFingerprint,total:results.length,available,missing,failed:results.length-available-missing,results};
}

function matchingFiles(files,approved){
  const wanted=new Set(approved.assets.map(item=>item.path)),matches=new Map();
  for(const file of files){
    let path;try{path=pathOf(file.webkitRelativePath||file.name,'所选文件路径');}catch{continue;}
    const variants=[path];if(path.includes('/'))variants.push(path.slice(path.indexOf('/')+1));
    for(const candidate of variants){
      if(!wanted.has(candidate))continue;
      if(!matches.has(candidate))matches.set(candidate,new Set());matches.get(candidate).add(file);
    }
  }
  for(const [path,values] of matches)if(values.size>1)fail(`路径 ${path} 匹配到多个文件，未替换任何素材。`);
  return matches;
}
function checkLibrary(library,approved){
  if(!library||typeof library.importFolder!=='function'||typeof library.asset!=='function'||library.disposed)fail('当前素材库不可用。');
  for(const item of approved.assets){
    const asset=library.asset(item.id);
    if(!asset||asset.type!==item.type||asset.src!==item.path||(asset.localPath||asset.src)!==item.path)fail(`素材库与校验清单不一致（${item.id}）。`);
  }
}

/** Partial selections are allowed. Every match is verified before one atomic library commit. */
export async function importVerifiedAssetFolder(library,story,manifest,fileList,{onProgress,maxFileBytes}={}){
  const approved=validateAssetManifest(story,manifest),max=maxBytes({maxFileBytes});checkLibrary(library,approved);
  const files=Array.from(fileList||[]);if(files.length>100000)fail('所选文件过多，请选择素材所在目录。');
  const matches=matchingFiles(files,approved),plan=approved.assets.filter(item=>matches.has(item.path)),verified=[];
  progress(onProgress,{phase:'verify',completed:0,total:plan.length});
  for(const item of plan){
    const file=[...matches.get(item.path)][0];
    if(!Number.isSafeInteger(file.size)||file.size!==item.size||file.size>max)fail(`素材 ${item.id} 的大小与清单不一致或超过限制，未替换任何素材。`);
    if(typeof file.name!=='string'||!typeMatches(file.name,String(file.type||'').toLowerCase(),item.type)||typeof file.arrayBuffer!=='function')fail(`素材 ${item.id} 的文件类型无效，未替换任何素材。`);
    let data;try{data=await file.arrayBuffer();}catch{fail(`素材 ${item.id} 读取失败，未替换任何素材。`);}
    if(data.byteLength!==item.size||await sha256(data)!==item.sha256)fail(`素材 ${item.id} 的 SHA-256 与清单不一致，未替换任何素材。`);
    verified.push(file);progress(onProgress,{phase:'verify',completed:verified.length,total:plan.length,id:item.id,status:'verified'});
  }
  checkLibrary(library,approved);
  const result=library.importFolder(verified);
  if(result.matched!==plan.length)fail('素材库的匹配结果发生变化。');
  progress(onProgress,{phase:'complete',completed:verified.length,total:plan.length});
  return {...result,verified:verified.length,unmatched:files.length-new Set(verified).size};
}
