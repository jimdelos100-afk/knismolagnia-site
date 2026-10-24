const MAX_IMAGES=200,MAX_IMAGE_BYTES=20*1024*1024,MAX_PACK_BYTES=200*1024*1024,MAX_MANIFEST_BYTES=2*1024*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(`图片汉化包：${message}`);};
function shape(value,allowed,label){if(!plain(value))fail(`${label}必须是对象。`);for(const key of Object.keys(value))if(!allowed.includes(key))fail(`${label}包含不支持的字段 ${key}。`);}
function safeObject(doc){const queue=[{value:doc,depth:0}];let total=0;while(queue.length){const {value,depth}=queue.pop();if(++total>100000||depth>12)fail('清单结构过于复杂。');if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))fail('清单包含不支持的字段名称。');if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});}}}
function relativePath(value,label='文件路径'){
  if(typeof value!=='string'||!value||value.length>240||/[\\:%?#\x00-\x1f\x7f]/.test(value)||value.startsWith('/'))fail(`${label}必须是安全的相对路径。`);
  const parts=value.split('/');if(parts.length>12||parts.some(part=>!part||part==='.'||part==='..'||part.trim()!==part||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail(`${label}包含无效目录或文件名。`);
  return value;
}
const keyFor=path=>path.normalize('NFC').toLowerCase();
function assetsFor(index){
  if(!plain(index)||typeof index.gameFingerprint!=='string'||!index.gameFingerprint||!index.assets)fail('缺少当前游戏资源目录。');
  return new Map(Array.isArray(index.assets)?index.assets.map(asset=>[asset.id,asset]):Object.entries(index.assets));
}
export function validateImageManifest(doc,index){
  safeObject(doc);shape(doc,['type','schemaVersion','gameFingerprint','images','catalog'],'清单');
  if(doc.type!=='xp2-image-overrides'||doc.schemaVersion!==1||doc.gameFingerprint!==index?.gameFingerprint)fail('清单类型、版本或游戏指纹不匹配。');
  if(!Array.isArray(doc.images)||doc.images.length>MAX_IMAGES||doc.catalog!==undefined&&!Array.isArray(doc.catalog))fail('图片清单无效，最多允许 200 张。');
  const assets=assetsFor(index),ids=new Set(),paths=new Set(),names=new Set(),images=[];
  for(const image of doc.images){
    shape(image,['assetId','path','sha256'],'图片映射');const asset=assets.get(image.assetId);
    if(typeof image.assetId!=='string'||!asset||asset.kind!=='texture'||!Number.isSafeInteger(asset.width)||!Number.isSafeInteger(asset.height)||asset.width<=0||asset.height<=0)fail(`图片目标不是有效纹理：${String(image.assetId)}。`);
    const path=relativePath(image.path),key=keyFor(path),name=key.split('/').at(-1);
    if(!/\.(png|jpe?g|webp)$/i.test(path))fail('只允许 PNG、JPEG 或 WebP 图片。');
    if(ids.has(image.assetId)||paths.has(key)||names.has(name))fail('图片编号、路径或同名文件存在重复映射。');
    if(image.sha256!==undefined&&(typeof image.sha256!=='string'||!(/^[a-f\d]{64}$/i.test(image.sha256))))fail('SHA-256 必须为 64 位十六进制字符串。');
    ids.add(image.assetId);paths.add(key);names.add(name);images.push({assetId:image.assetId,path,...(image.sha256?{sha256:image.sha256.toLowerCase()}:{})});
  }
  return {type:'xp2-image-overrides',schemaVersion:1,gameFingerprint:doc.gameFingerprint,images};
}
export function createImageTemplate(index){
  const assets=assetsFor(index),paths=new Map();
  for(const [path,ids] of Object.entries(index.resourcePaths||{}))for(const id of Array.isArray(ids)?ids:[ids]){if(!paths.has(id))paths.set(id,[]);paths.get(id).push(path);}
  return {type:'xp2-image-overrides',schemaVersion:1,gameFingerprint:index.gameFingerprint,images:[],catalog:[...assets].filter(([,asset])=>asset.kind==='texture').map(([assetId,asset])=>({assetId,name:asset.name||'',nativePaths:paths.get(assetId)||[],width:asset.width,height:asset.height}))};
}
function imageHeader(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(offset,size)=>String.fromCharCode(...bytes.subarray(offset,offset+size));
  if(bytes.length>=24&&bytes[0]===137&&ascii(1,3)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10&&ascii(12,4)==='IHDR')return {mime:'image/png',width:view.getUint32(16),height:view.getUint32(20)};
  if(bytes.length>=12&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
    for(let p=12;p+8<=bytes.length;){const kind=ascii(p,4),size=view.getUint32(p+4,true),start=p+8;if(start+size>bytes.length)fail('WebP 文件不完整。');
      if(kind==='VP8X'&&size>=10)return {mime:'image/webp',width:1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16),height:1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16)};
      if(kind==='VP8L'&&size>=5&&bytes[start]===47){const bits=view.getUint32(start+1,true);return {mime:'image/webp',width:1+(bits&16383),height:1+((bits>>>14)&16383)};}
      if(kind==='VP8 '&&size>=10&&bytes[start+3]===157&&bytes[start+4]===1&&bytes[start+5]===42)return {mime:'image/webp',width:view.getUint16(start+6,true)&16383,height:view.getUint16(start+8,true)&16383};p=start+size+(size%2);
    }
  }
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
    for(let p=2;p+3<bytes.length;){if(bytes[p++]!==255)fail('JPEG 标记无效。');while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217||marker===218)break;if(marker===216||marker===1||marker>=208&&marker<=215)continue;
      const size=view.getUint16(p);if(size<2||p+size>bytes.length)fail('JPEG 文件不完整。');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8)return {mime:'image/jpeg',width:view.getUint16(p+5),height:view.getUint16(p+3)};p+=size;
    }
  }
  fail('文件不是受支持的 PNG、JPEG 或 WebP 图片。');
}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}
async function defaultDecode(file,{bytes,mime}){if(typeof createImageBitmap!=='function')fail('当前环境缺少图片解码器，请在浏览器导入或使用维护脚本。');return createImageBitmap(new Blob([bytes],{type:mime}));}

/** Validate every file first. Nothing is installed or turned into an object URL here. */
export async function readLocalImagePack(input,index,{decode=defaultDecode}={}){
  const files=Array.from(input||[]);if(files.length>2048)fail('所选目录文件过多。');
  const all=new Map(),names=new Set();let selectedBytes=0;
  for(const file of files){const path=relativePath(file.webkitRelativePath||file.relativePath||file.name),key=keyFor(path),name=key.split('/').at(-1);
    if(!Number.isSafeInteger(file.size)||file.size<0||typeof file.arrayBuffer!=='function')fail('所选文件无效。');selectedBytes+=file.size;if(selectedBytes>MAX_PACK_BYTES)fail('所选目录总大小超过 200 MB。');
    if(all.has(key)||names.has(name))fail('所选目录存在重复路径或不同目录中的同名文件。');all.set(key,{path,file});names.add(name);
  }
  const manifests=[...all.values()].filter(item=>item.path.split('/').at(-1)==='overrides.json');if(manifests.length!==1)fail('请选择包含唯一 overrides.json 的图片目录。');
  const source=manifests[0],parts=source.path.split('/');if(parts.length>2)fail('overrides.json 必须在所选目录根部或一个外层文件夹内。');
  if(source.file.size>MAX_MANIFEST_BYTES)fail('清单超过 2 MB。');
  let doc;try{doc=JSON.parse(new TextDecoder().decode(await source.file.arrayBuffer()).replace(/^\uFEFF/,''));}catch{fail('overrides.json 不是有效 JSON。');}
  const manifest=validateImageManifest(doc,index),assets=assetsFor(index),base=parts.length===2?parts[0]+'/':'',entries=[];let totalBytes=0;
  for(const image of manifest.images){
    const selected=all.get(keyFor(base+image.path));if(!selected||selected.path!==base+image.path)fail(`没有找到精确路径 ${image.path}，请检查目录层级和大小写。`);
    const file=selected.file;if(!file.size||file.size>MAX_IMAGE_BYTES)fail(`${image.path} 为空或超过单张 20 MB。`);totalBytes+=file.size;
    const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.byteLength!==file.size)fail(`${image.path} 读取大小不一致。`);
    const header=imageHeader(bytes),expected=/\.png$/i.test(image.path)?'image/png':/\.jpe?g$/i.test(image.path)?'image/jpeg':'image/webp',asset=assets.get(image.assetId);
    if(header.mime!==expected)fail(`${image.path} 的格式与扩展名不一致。`);
    if(header.width!==asset.width||header.height!==asset.height)fail(`${image.path} 尺寸必须为 ${asset.width} × ${asset.height}。`);
    if(image.sha256&&await digest(bytes)!==image.sha256)fail(`${image.path} 的 SHA-256 不匹配。`);
    let decoded;try{decoded=await decode(file,{bytes,mime:header.mime,asset});if(decoded?.width!==asset.width||decoded?.height!==asset.height)fail(`${image.path} 解码尺寸与原纹理不一致。`);}finally{decoded?.close?.();}
    entries.push({assetId:image.assetId,file});
  }
  return {manifest,entries,count:entries.length,totalBytes};
}
