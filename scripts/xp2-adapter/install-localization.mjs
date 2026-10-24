import { readFile,writeFile,mkdir,readdir,stat,lstat,realpath,rename,copyFile,rm,mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readLocalImagePack,validateImageManifest,createImageTemplate } from '../../private/story-player/src/localization-pack.js';
import { mergeTranslationDocument } from '../../private/story-player/src/translations.js';

const DEFAULT_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const HELP=`XP2 本地化维护工具（默认仅预览，不改文件）
node scripts/xp2-adapter/install-localization.mjs --translation 新译文.json --images 图片目录 --dry-run
node scripts/xp2-adapter/install-localization.mjs --translation 新译文.json --images 图片目录 --apply --backup C:/备份目录
node scripts/xp2-adapter/install-localization.mjs --template C:/工作目录/overrides.json

--translation  同版本 xp2-translation 或 story-translations JSON（可单独更新）
--images       含 overrides.json 和对应 PNG/JPEG/WebP 的目录（可单独更新）
--template     输出含全部纹理编号、原路径及尺寸的空清单；不改网站
--dry-run      校验并预览；与默认行为相同
--apply        完整校验后备份并安装；与 --dry-run 互斥
--backup       --apply 时必填；新建备份目录，必须在仓库之外且不存在
--site         可选网站仓库路径；默认本脚本所在仓库
--help         显示说明

只修改译文、图片清单及 localized-images 内的汉化图片，不修改原文或原游戏文件。
图片更新替换整份图片映射；需要保留的旧图片也应包含在本次清单中。`;
const json=async(file,max=50*1024*1024)=>{const size=(await stat(file)).size;if(size>max)throw new Error(`JSON 文件过大：${file}`);return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));};
const stringify=value=>JSON.stringify(value,null,2)+'\n';
async function absent(file){try{await lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
async function safeDirectory(root,folder){let ancestor=folder;while(await absent(ancestor))ancestor=path.dirname(ancestor);if(!inside(root,await realpath(ancestor)))throw new Error('目标目录不允许指向播放器外部。');await mkdir(folder,{recursive:true});if(!inside(root,await realpath(folder)))throw new Error('目标目录不允许指向播放器外部。');}
async function rootFor(input){const root=await realpath(input);for(const relative of ['private/story-player/data/story.json','private/story-player/data/unity-index.json','private/story-player/data/translations.json']){const target=await realpath(path.join(root,relative));if(!inside(root,target))throw new Error('网站数据路径不允许指向仓库外部。');}return root;}
async function directoryFiles(input){
  const root=await realpath(input),files=[];
  async function walk(folder,relative=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const target=path.join(folder,entry.name),name=relative?relative+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink())throw new Error(`图片目录不接受符号链接：${name}`);
      if(entry.isDirectory())await walk(target,name);
      else if(entry.isFile()){const info=await stat(target);let snapshot;files.push({name:entry.name,relativePath:name,size:info.size,arrayBuffer:async()=>{snapshot??=readFile(target);const bytes=await snapshot;return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});if(files.length>2048)throw new Error('图片目录文件过多。');}
    }
  }
  await walk(root);return files;
}
const decode=async(file,{bytes})=>{const image=sharp(bytes,{failOn:'warning',limitInputPixels:80000000});const {info}=await image.raw().toBuffer({resolveWithObject:true});return {width:info.width,height:info.height};};

export async function installLocalization({root=DEFAULT_ROOT,translationPath,imagesPath,apply=false,backupPath}={}){
  if(!translationPath&&!imagesPath)throw new Error('请指定 --translation 或 --images。');
  root=await rootFor(root);const player=await realpath(path.join(root,'private/story-player')),data=path.join(player,'data');
  const [story,index,current]=await Promise.all(['story.json','unity-index.json','translations.json'].map(name=>json(path.join(data,name))));
  let translation=null,pack=null;
  if(translationPath){const incoming=await json(translationPath);if(incoming.type==='xp2-translation')incoming.type='story-translations';if(incoming.type!=='story-translations')throw new Error('请选择 xp2-translation 或 story-translations 文档。');const merged=mergeTranslationDocument(story,current,incoming);if(merged.pending)throw new Error(`新译文包含 ${merged.pending} 个未匹配编号；请先核对原文目录。`);translation=merged;}
  if(imagesPath)pack=await readLocalImagePack(await directoryFiles(imagesPath),index,{decode});
  const plan={apply:!!apply,translation:translation?{matched:translation.matched,entries:translation.document.translations.length}:null,images:pack?{count:pack.count,totalBytes:pack.totalBytes}:null,backup:null};
  if(!apply)return plan;
  if(!backupPath)throw new Error('--apply 必须同时指定 --backup，先保留可恢复的旧文件。');
  let backup=path.resolve(backupPath);const parent=await realpath(path.dirname(backup));backup=path.join(parent,path.basename(backup));if(inside(root,backup))throw new Error('备份目录必须位于网站仓库之外。');if(!await absent(backup))throw new Error('备份目录已存在，请指定新的目录。');await mkdir(backup);
  const changes=[];
  if(translation)changes.push({relative:'data/translations.json',text:stringify(translation.document)});
  if(pack){
    const images=[];
    for(const [number,entry] of pack.entries.entries()){
      const original=pack.manifest.images[number],bytes=new Uint8Array(await entry.file.arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');
      const extension=path.posix.extname(original.path).toLowerCase(),name=String(number+1).padStart(3,'0')+'-'+hash.slice(0,16)+extension;
      changes.push({relative:'localized-images/'+name,bytes});images.push({assetId:entry.assetId,path:'localized-images/'+name,sha256:hash});
    }
    const next=validateImageManifest({...pack.manifest,images},index),nextPaths=new Set(images.map(image=>image.path));
    const previousPath=path.join(data,'image-overrides.json');
    if(!await absent(previousPath)){
      const previous=validateImageManifest(await json(previousPath),index);
      for(const image of previous.images)if(!nextPaths.has(image.path)){
        if(!image.path.startsWith('localized-images/'))throw new Error('旧图片清单含非本地化目录路径，请先人工核对。');
        if(!await absent(path.join(player,image.path)))changes.push({relative:image.path,remove:true});
      }
    }
    changes.push({relative:'data/image-overrides.json',text:stringify(next)});
  }
  const stage=await mkdtemp(path.join(backup,'stage-')),applied=[],backups=[];
  try{
    // Stage first, then check and back up every target. The backup includes an
    // exact file list and is never placed inside the website or deployment ZIP.
    for(const change of changes){const staged=path.join(stage,change.relative);if(!change.remove){await mkdir(path.dirname(staged),{recursive:true});await writeFile(staged,change.text??change.bytes);}const target=path.join(player,change.relative);await safeDirectory(player,path.dirname(target));const existed=!await absent(target);if(existed){const actual=await realpath(target);if(!inside(player,actual)||(await lstat(target)).isSymbolicLink())throw new Error('目标文件不能是符号链接。');const copy=path.join(backup,'before',change.relative);await mkdir(path.dirname(copy),{recursive:true});await copyFile(target,copy);}backups.push({relative:change.relative,existed});}
    await writeFile(path.join(backup,'files.json'),stringify({root,files:backups}));
    for(const change of changes){const target=path.join(player,change.relative);if(change.remove)await rm(target);else await rename(path.join(stage,change.relative),target);applied.push(change.relative);}
  }catch(error){
    for(const relative of applied.reverse()){const previous=backups.find(item=>item.relative===relative),target=path.join(player,relative);if(previous.existed)await copyFile(path.join(backup,'before',relative),target);else await rm(target,{force:true});}
    throw error;
  }finally{if(!inside(backup,await realpath(stage)))throw new Error('临时目录超出备份路径，未清理。');await rm(stage,{recursive:true,force:true});}
  plan.backup=backup;return plan;
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){console.log(HELP);return;}
  const options={};for(let i=0;i<argv.length;i++){const key=argv[i];if(['--apply','--dry-run'].includes(key)){options[key]=true;continue;}if(!['--translation','--images','--backup','--site','--template'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`未知或缺少参数：${key}`);if(options[key])throw new Error(`重复参数：${key}`);options[key]=argv[++i];}
  if(options['--apply']&&options['--dry-run'])throw new Error('--apply 与 --dry-run 不能同时使用。');
  if(options['--template']){if(options['--translation']||options['--images']||options['--apply'])throw new Error('--template 请单独使用。');const root=await rootFor(options['--site']||DEFAULT_ROOT),index=await json(path.join(root,'private/story-player/data/unity-index.json'));const target=path.resolve(options['--template']);if(inside(root,target))throw new Error('请将模板输出到仓库之外的工作目录。');await writeFile(target,stringify(createImageTemplate(index)),{flag:'wx'});console.log(`图片清单模板已输出：${target}`);return;}
  const result=await installLocalization({root:options['--site']||DEFAULT_ROOT,translationPath:options['--translation'],imagesPath:options['--images'],apply:!!options['--apply'],backupPath:options['--backup']});console.log(JSON.stringify(result,null,2));if(!result.apply)console.log('校验通过。当前为预览；确认后增加 --apply 执行安装。');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
