import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,stat,realpath,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {validateImageManifest,createImageTemplate,readLocalImagePack} from '../../private/story-player/src/localization-pack.js';
import {installLocalization} from '../../scripts/xp2-adapter/install-localization.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url)),workspace='C:/Users/daisy/Documents/Codex/2026-10-23/c-users-daisy-documents-github-knismolagnia-9/work';
await mkdir(workspace,{recursive:true});const scratch=await mkdtemp(path.join(workspace,'localization-tests-'));
const results=[];async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
const copy=value=>structuredClone(value),index={gameFingerprint:'neutral-version',assets:{image:{kind:'texture',name:'Neutral',width:2,height:2},second:{kind:'texture',name:'Second',width:2,height:2},audio:{kind:'audio'}},resourcePaths:{'texture/event/neutral':['image']}};
const manifest=(images=[{assetId:'image',path:'art.png'}])=>({type:'xp2-image-overrides',schemaVersion:1,gameFingerprint:index.gameFingerprint,images});
const png=await sharp({create:{width:2,height:2,channels:4,background:{r:60,g:120,b:180,alpha:1}}}).png().toBuffer();
const decode=async(file,{bytes})=>{const {info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});return {width:info.width,height:info.height};};
function file(name,bytes,relativePath=name){const blob=new Blob([bytes]);return {name,relativePath,size:blob.size,arrayBuffer:()=>blob.arrayBuffer()};}
const jsonFile=(doc,prefix='')=>file('overrides.json',JSON.stringify(doc),prefix+'overrides.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async target=>JSON.parse(await readFile(target,'utf8'));

await check('strict manifest checks fingerprint, texture identity, shape and unique mappings',()=>{
  assert.equal(validateImageManifest(manifest(),index).images.length,1);
  for(const patch of [{type:'other'},{schemaVersion:2},{gameFingerprint:'other'},{extra:true},{images:[{assetId:'audio',path:'a.png'}]},{images:[{assetId:'missing',path:'a.png'}]},{images:[{assetId:'image',path:'a.png',unexpected:true}]},{images:[{assetId:'image',path:'a.png'},{assetId:'image',path:'b.png'}]},{images:[{assetId:'image',path:'one/a.png'},{assetId:'second',path:'two/A.png'}]}])assert.throws(()=>validateImageManifest({...manifest(),...patch},index));
  assert.throws(()=>validateImageManifest(manifest(Array.from({length:201},()=>({assetId:'image',path:'a.png'}))),index));
});
await check('manifest forbids traversal, absolute paths, URLs, SVG and dangerous fields',()=>{
  for(const unsafe of ['../a.png','one/../a.png','/a.png','C:/a.png','https://example/a.png','a.svg','a.png?x','a%2epng','a\\b.png','one//a.png','con.png','a /b.png'])assert.throws(()=>validateImageManifest(manifest([{assetId:'image',path:unsafe}]),index),undefined,unsafe);
  assert.throws(()=>validateImageManifest(JSON.parse('{"type":"xp2-image-overrides","__proto__":{}}'),index));
  assert.throws(()=>validateImageManifest(manifest([{assetId:'image',path:'a.png',sha256:'bad'}]),index));
});
await check('template includes every texture with original paths and dimensions',()=>{
  const template=createImageTemplate(index);assert.equal(template.images.length,0);assert.equal(template.catalog.length,2);assert.deepEqual(template.catalog[0],{assetId:'image',name:'Neutral',nativePaths:['texture/event/neutral'],width:2,height:2});assert.equal(validateImageManifest(template,index).images.length,0);
});
await check('PNG, JPEG and WebP files decode at the native size, including one outer folder',async()=>{
  for(const [format,extension] of [['png','png'],['jpeg','jpg'],['webp','webp']]){
    const bytes=await sharp(png)[format]().toBuffer(),doc=manifest([{assetId:'image',path:'images/local.'+extension,sha256:sha(bytes)}]);
    const pack=await readLocalImagePack([jsonFile(doc,'pack/'),file('local.'+extension,bytes,'pack/images/local.'+extension)],index,{decode});assert.equal(pack.count,1);assert.equal(pack.entries[0].assetId,'image');assert.equal(pack.totalBytes,bytes.length);
  }
});
await check('exact path matching rejects wrong levels, renamed case and duplicate basenames',async()=>{
  for(const files of [[jsonFile(manifest(),'one/two/'),file('art.png',png,'one/two/art.png')],[jsonFile(manifest()),file('art.png',png,'other/art.png')],[jsonFile(manifest()),file('ART.png',png)],[jsonFile(manifest()),file('art.png',png,'one/art.png'),file('art.png',png,'two/art.png')],[jsonFile(manifest()),jsonFile(manifest(),'second/')]])await assert.rejects(readLocalImagePack(files,index,{decode}));
});
await check('size, count, hash, signature and native dimensions are validated before returning a pack',async()=>{
  const tooBig=file('art.png',png);tooBig.size=20*1024*1024+1;await assert.rejects(readLocalImagePack([jsonFile(manifest()),tooBig],index,{decode}),/20 MB/);
  const total=file('unused.bin','x');total.size=200*1024*1024;await assert.rejects(readLocalImagePack([jsonFile(manifest()),total],index,{decode}),/200 MB/);
  await assert.rejects(readLocalImagePack([jsonFile(manifest([{assetId:'image',path:'art.png',sha256:'0'.repeat(64)}])),file('art.png',png)],index,{decode}),/SHA-256/);
  await assert.rejects(readLocalImagePack([jsonFile(manifest()),file('art.png','<svg>not a raster image</svg>')],index,{decode}));
  const wrong=await sharp(png).resize(3,2).png().toBuffer();await assert.rejects(readLocalImagePack([jsonFile(manifest()),file('art.png',wrong)],index,{decode}),/尺寸/);
  await assert.rejects(readLocalImagePack([jsonFile(manifest([{assetId:'image',path:'art.jpg'}])),file('art.jpg',png)],index,{decode}),/扩展名/);
});
await check('decoder output closes on success and mismatch; failures apply no object URLs',async()=>{
  let closed=0,decoded=0;const images=[jsonFile(manifest()),file('art.png',png)];
  await readLocalImagePack(images,index,{decode:async()=>{decoded++;return {width:2,height:2,close(){closed++;}};}});assert.equal(closed,1);
  await assert.rejects(readLocalImagePack(images,index,{decode:async()=>({width:9,height:9,close(){closed++;}})}),/解码尺寸/);assert.equal(closed,2);
  const doc=manifest([{assetId:'image',path:'art.png'},{assetId:'second',path:'missing.png'}]);await assert.rejects(readLocalImagePack([jsonFile(doc),file('art.png',png)],index,{decode}));assert.equal(decoded,1);
});

const site=path.join(scratch,'site'),data=path.join(site,'private/story-player/data'),packDir=path.join(scratch,'pack');await mkdir(data,{recursive:true});await mkdir(packDir);
const story={type:'story-player',schemaVersion:1,id:'neutral',title:'Neutral',gameFingerprint:index.gameFingerprint,texts:[{id:'line',source:'Original unchanged'}]};
const original={type:'story-translations',schemaVersion:2,gameFingerprint:index.gameFingerprint,translations:[{id:'line',source:'Original unchanged',translation:'旧译文',status:'translated',note:''}]};
for(const [name,value] of [['story.json',story],['unity-index.json',index],['translations.json',original],['image-overrides.json',manifest([])]])await writeFile(path.join(data,name),JSON.stringify(value));
await writeFile(path.join(packDir,'overrides.json'),JSON.stringify(manifest()));await writeFile(path.join(packDir,'art.png'),png);
const incoming=path.join(scratch,'new-translations.json');await writeFile(incoming,JSON.stringify({...original,type:'xp2-translation',translations:[{...original.translations[0],translation:'新译文'}]}));
await check('CLI dry run validates translation conversion and images without changing website bytes',async()=>{
  const before=await readFile(path.join(data,'translations.json'));const plan=await installLocalization({root:site,translationPath:incoming,imagesPath:packDir});assert.equal(plan.apply,false);assert.equal(plan.images.count,1);assert.deepEqual(await readFile(path.join(data,'translations.json')),before);await assert.rejects(stat(path.join(site,'private/story-player/localized-images')));
});
await check('CLI requires explicit apply backup and rejects bad translation without half an image update',async()=>{
  await assert.rejects(installLocalization({root:site,translationPath:incoming,apply:true}),/--backup/);
  const invalid=path.join(scratch,'invalid.json');await writeFile(invalid,JSON.stringify({...original,translations:[{...original.translations[0],source:'Changed original'}]}));
  const before=await readFile(path.join(data,'translations.json'));await assert.rejects(installLocalization({root:site,translationPath:invalid,imagesPath:packDir,apply:true,backupPath:path.join(scratch,'bad-backup')}));assert.deepEqual(await readFile(path.join(data,'translations.json')),before);await assert.rejects(stat(path.join(data,'localized-images')));
});
await check('CLI installs only translated text and mapped raster files with exact backups',async()=>{
  const beforeStory=await readFile(path.join(data,'story.json')),beforeTranslation=await readFile(path.join(data,'translations.json')),backup=path.join(scratch,'backup-one');
  const plan=await installLocalization({root:site,translationPath:incoming,imagesPath:packDir,apply:true,backupPath:backup});assert.equal(plan.apply,true);assert.equal(plan.backup,backup);assert.deepEqual(await readFile(path.join(data,'story.json')),beforeStory);assert.deepEqual(await readFile(path.join(backup,'before/data/translations.json')),beforeTranslation);
  assert.equal((await json(path.join(data,'translations.json'))).translations[0].translation,'新译文');const installed=await json(path.join(data,'image-overrides.json'));assert.match(installed.images[0].path,/^localized-images\/001-[a-f0-9]{16}\.png$/);assert.equal(sha(await readFile(path.join(site,'private/story-player',installed.images[0].path))),installed.images[0].sha256);assert.equal((await readdir(backup)).some(name=>name.startsWith('stage-')),false);
});
await check('CLI replacement removes only previously mapped stale images and backs them up',async()=>{
  const previous=await json(path.join(data,'image-overrides.json')),oldPath=previous.images[0].path;await writeFile(path.join(site,'private/story-player/localized-images/user-note.txt'),'User file stays');await writeFile(path.join(packDir,'overrides.json'),JSON.stringify(manifest([])));
  const backup=path.join(scratch,'backup-two');await installLocalization({root:site,imagesPath:packDir,apply:true,backupPath:backup});assert.equal((await json(path.join(data,'image-overrides.json'))).images.length,0);await assert.rejects(stat(path.join(site,'private/story-player',oldPath)));assert.equal((await readFile(path.join(backup,'before',oldPath))).length,png.length);assert.equal(await readFile(path.join(site,'private/story-player/localized-images/user-note.txt'),'utf8'),'User file stays');
});
await check('CLI rejects in-repository backups and symbolic image input directories',async()=>{
  await assert.rejects(installLocalization({root:site,translationPath:incoming,apply:true,backupPath:path.join(site,'backup')}),/仓库之外/);
  const link=path.join(packDir,'linked');await symlink(scratch,link,'junction');await assert.rejects(installLocalization({root:site,imagesPath:packDir}),/符号链接/);
});
await check('actual command help is Chinese and conflicting write flags are rejected',()=>{
  const script=path.join(repo,'scripts/xp2-adapter/install-localization.mjs'),help=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/默认仅预览/);
  const bad=spawnSync(process.execPath,[script,'--apply','--dry-run'],{encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/不能同时使用/);
});
await check('real texture catalog and currently bundled translations validate in dry run',async()=>{
  const actualIndex=await json(path.join(repo,'private/story-player/data/unity-index.json')),template=createImageTemplate(actualIndex);assert.equal(template.catalog.length,2338);validateImageManifest(template,actualIndex);
  const actual=await installLocalization({root:repo,translationPath:path.join(repo,'private/story-player/data/translations.json')});assert.equal(actual.apply,false);assert.equal(actual.translation.matched,10173);
});

console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,scratch:await realpath(scratch),results},null,2));if(results.some(item=>!item.passed))process.exitCode=1;
