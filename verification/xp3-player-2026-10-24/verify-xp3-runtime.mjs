/** Node 22+: --game-data original/*_Data [--python python --python-deps DIR]
 * Exercises the real XP3 catalogue and local-file decoder without saving media.
 * --python-deps enables independent UnityPy/LZ4 pixel and bundle comparisons.
 */
import assert from 'node:assert/strict';
import {openAsBlob} from 'node:fs';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ReaderPlayer} from '../../private/story-player/src/reader.js';
import {ProgramPlayer} from '../../private/story-player/src/program-player.js';
import {bindUnityFolder,decodeTextureRGBA,decodeLZ4Block} from '../../private/story-player/src/unity-local.js';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const gameData=option('--game-data');
if(!gameData)throw new Error('Pass --game-data with the original XP3 *_Data directory.');
const started=performance.now(),root=new URL('../../private/story-player-xp3/',import.meta.url);
const json=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const [story,index,native,translations,report,map]=await Promise.all([
  json('data/story.json'),json('data/unity-index.json'),json('data/native-presentation.json'),
  json('data/translations.json'),json('data/adapter-report.json'),json('data/chapter-map/manifest.json'),
]);
const hash=data=>createHash('sha256').update(data).digest('hex');
assert.equal(native.sourceStorySha256,hash(await readFile(new URL('data/story.json',root))));
assert.equal(map.storySha256,native.sourceStorySha256);
assert.equal(story.gameFingerprint,translations.gameFingerprint);
assert.equal(story.gameFingerprint,index.gameFingerprint);
assert.equal(story.gameFingerprint,report.gameFingerprint);
const catalog=new Map(story.texts.map(entry=>[entry.id,entry]));
assert.equal(catalog.size,story.texts.length);
assert.equal(translations.translations.length,catalog.size);
for(const entry of translations.translations){
  const original=catalog.get(entry.id);assert.ok(original);
  assert.equal(entry.source,original.source);assert.equal(entry.sourceHash,hash(entry.source));
  assert.equal(entry.sourceHash,original.sourceHash);
}
const nativeScenes=story.scenes.filter(scene=>/^chapter-/.test(scene.id));
assert.ok(nativeScenes.length>0);
assert.equal(nativeScenes.length,map.totals.storyScenes);
assert.equal(story.scenes.length,report.scenes);
const assets=new Set(story.assets.map(asset=>asset.id));
for(const id of assets)assert.ok(index.assets[id],`Missing local resource ${id}`);
const defaultBg=native.defaults.defaultLayers.Bg;
let frames=0,cgFrames=0,maxActors=0;
const checkFinite=(value,path='state')=>{
  if(typeof value==='number')assert.ok(Number.isFinite(value),`Nonfinite ${path}`);
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))checkFinite(child,`${path}.${key}`);
};
const checkState=state=>{
  checkFinite(state);frames++;
  const actorIds=state.characters.map(actor=>actor.id);
  assert.equal(new Set(actorIds).size,actorIds.length,'Duplicate live actor identities');
  const slot=state.characters.filter(actor=>actor.kind==='background'&&actor.layerName===defaultBg);
  assert.ok(slot.length<=1,'Default background/CG slot stacked multiple actors');
  if(slot.length)cgFrames++;
  maxActors=Math.max(maxActors,actorIds.length);
  const activeAssets=[state.background.asset,...state.characters.map(actor=>actor.asset),...state.audio.map(audio=>audio.asset),state.video?.asset].filter(Boolean);
  for(const id of activeAssets){assert.ok(assets.has(id),`Undeclared active resource ${id}`);assert.ok(index.assets[id]);}
  if(state.dialogue.textId)assert.ok(catalog.has(state.dialogue.textId));
};
const previewTimes=[];
let readerScenes=0,readerDialogueScenes=0,readerPreviews=0;
const reader=new ReaderPlayer(story,{nativeEffects:native});
try{
  for(const scene of nativeScenes){
    reader.enter(scene.id);assert.equal(reader.state.sceneId,scene.id);checkState(reader.state);readerScenes++;
    const dialogueEvents=scene.commands.filter(command=>command.type==='dialogue').map(command=>scene.events[command.eventIndex]);
    if(!dialogueEvents.length){reader.completeCanonical();checkState(reader.state);continue;}
    readerDialogueScenes++;
    const before=reader.snapshot();
    for(const position of new Set([0,Math.floor(dialogueEvents.length/2),dialogueEvents.length-1])){
      const at=performance.now(),frame=reader.previewDialogue(position);previewTimes.push(performance.now()-at);
      assert.equal(frame.sceneId,scene.id);assert.equal(frame.dialogue.index,position);
      assert.equal(frame.dialogue.textId,dialogueEvents[position].textId);assert.equal(frame.dialogue.textComplete,true);
      assert.equal(frame.playing,false);checkState(frame);readerPreviews++;
    }
    assert.deepEqual(reader.snapshot(),before,'Preview changed reader position');
  }
}finally{reader.dispose();}
assert.equal(readerScenes,nativeScenes.length);
console.log(JSON.stringify({phase:'reader',covered:readerScenes,dialogueScenes:readerDialogueScenes,previews:readerPreviews,elapsedMs:Math.round(performance.now()-started)}));

const program=new ProgramPlayer(story,{nativeEffects:native});
let programScenes=0,programPreviews=0;
const routeCounts={},jumpTimes=[];
try{
  for(const scene of nativeScenes){
    const at=performance.now();program.enter(scene.id);jumpTimes.push(performance.now()-at);
    const state=program.state;assert.equal(state.sceneId,scene.id);checkState(state);programScenes++;
    const preference=state.program.mapRoute?.preference||'initial';routeCounts[preference]=(routeCounts[preference]||0)+1;
    const count=state.dialogue.count;
    if(count)for(const position of new Set([0,Math.floor(count/2),count-1])){
      const frame=program.previewDialogue(position);assert.equal(frame.sceneId,scene.id);assert.equal(frame.dialogue.index,position);checkState(frame);programPreviews++;
    }
  }
}finally{program.dispose();}
assert.equal(programScenes,nativeScenes.length);
console.log(JSON.stringify({phase:'program',covered:programScenes,previews:programPreviews,routes:routeCounts,elapsedMs:Math.round(performance.now()-started)}));

const files=[];
for(const item of index.files){const blob=await openAsBlob(join(gameData,item.path));files.push(new File([blob],item.path,{type:'application/octet-stream'}));}
const urls=new Map();let serial=0;
const urlAPI={createObjectURL(blob){const id=`blob:xp3-verify-${++serial}`;urls.set(id,blob);return id;},revokeObjectURL(id){urls.delete(id);}};
const library=await bindUnityFolder(files,index,{urlAPI});
let textureSamples=0,vorbisSamples=0,pcmSamples=0,videoSamples=0;
const textureReferences=[],blockReferences=[];
const temporary=args.includes('--native')?await mkdtemp(join(tmpdir(),'xp3-audio-verify-')):null,temporaryFiles=[],audioManifest=[];
let nativeDecoding='not-requested';
try{
  const bundle=files.find(file=>file.name===index.bundle.file);
  for(const position of new Set([0,Math.floor(index.bundle.blocks.length/2),index.bundle.blocks.length-1])){
    const block=index.bundle.blocks[position];
    const compressed=new Uint8Array(await bundle.slice(block.compressedOffset,block.compressedOffset+block.compressedSize).arrayBuffer());
    const decoded=block.compression===0?compressed:decodeLZ4Block(compressed,block.uncompressedSize);
    assert.equal(decoded.length,block.uncompressedSize);
    blockReferences.push({position,block,sha256:hash(decoded)});
  }
  const formats=[...new Set(Object.values(index.assets).filter(asset=>asset.kind==='texture').map(asset=>asset.format))].sort((a,b)=>a-b);
  for(const format of formats){
    const candidates=Object.entries(index.assets).filter(([,asset])=>asset.kind==='texture'&&asset.format===format).sort((a,b)=>a[1].width*a[1].height-b[1].width*b[1].height);
    // Prefer a nontrivial resource while keeping the check bounded in memory.
    const [id,asset]=candidates.find(([,item])=>item.width*item.height>=65536&&item.width*item.height<=1048576)||candidates[0];
    const bytes=await library.readRange(asset.file,asset.offset,asset.size,asset.space),rgba=decodeTextureRGBA(bytes,asset);
    assert.equal(rgba.byteLength,asset.width*asset.height*4);
    textureReferences.push({id,asset,sha256:hash(rgba)});textureSamples++;
  }
  assert.equal(textureSamples,formats.length);
  const bySetup=new Map();
  for(const [id,asset]of Object.entries(index.assets))if(asset.codec==='fsb5-vorbis'){
    const prior=bySetup.get(asset.vorbisSetup);if(!prior||asset.size<prior[1].size)bySetup.set(asset.vorbisSetup,[id,asset]);
  }
  assert.ok(bySetup.size>0);
  for(const [setup,[id,asset]]of bySetup){
    assert.ok(index.vorbisSetups[setup]);
    const first=library.resolve(id),second=library.resolve(id);assert.equal(first,second);
    let url;try{url=await first;}catch(error){throw new Error(`Audio setup ${setup}, asset ${id}, size ${asset.size}: ${error.message}`,{cause:error});}
    const blob=urls.get(url),bytes=Buffer.from(await blob.arrayBuffer());
    assert.equal(blob.type,'audio/ogg');assert.equal(bytes.subarray(0,4).toString(),'OggS');
    assert.ok(bytes.includes(Buffer.from('vorbis')));assert.equal(await library.resolve(id),url);
    const firstBody=27+bytes[26];assert.equal(bytes[firstBody+11],asset.channels);
    assert.equal(bytes.readUInt32LE(firstBody+12),asset.frequency);
    if(temporary){const filename=`setup-${setup}.ogg`,path=join(temporary,filename);await writeFile(path,bytes);temporaryFiles.push(path);audioManifest.push({filename,channels:asset.channels,frequency:asset.frequency,samples:asset.samples});}
    assert.ok(asset.samples>0);vorbisSamples++;library.release(id);
  }
  assert.equal(vorbisSamples,bySetup.size);
  for(const [id,asset]of Object.entries(index.assets)){
    if(asset.codec==='pcm'){
      const url=await library.resolve(id),blob=urls.get(url),bytes=Buffer.from(await blob.arrayBuffer());
      assert.equal(blob.type,'audio/wav');assert.equal(bytes.subarray(0,4).toString(),'RIFF');
      assert.equal(bytes.readUInt32LE(40),asset.samples*asset.channels*asset.bits/8);
      assert.equal(bytes.length,44+bytes.readUInt32LE(40));pcmSamples++;library.release(id);
    }else if(asset.kind==='video'){
      const url=await library.resolve(id),blob=urls.get(url);assert.equal(blob.type,'video/mp4');assert.equal(blob.size,asset.size);
      const header=Buffer.from(await blob.slice(0,12).arrayBuffer());assert.equal(header.subarray(4,8).toString(),'ftyp');videoSamples++;library.release(id);
    }
  }
  const pythonDeps=option('--python-deps');let independentReference='not-requested';
  if(pythonDeps){
    const code=`import sys,json,hashlib,bisect\nsys.path.insert(0,sys.argv[1])\nimport lz4.block\nfrom pathlib import Path\nfrom UnityPy.export.Texture2DConverter import parse_image_data\ndoc=json.load(sys.stdin);game=Path(doc['game']);blocks=doc['blocks'];starts=[b['uncompressedOffset'] for b in blocks]\ndef read(a):\n if a['space']=='file':\n  with open(game/a['file'],'rb') as f:f.seek(a['offset']);return f.read(a['size'])\n result=bytearray();offset=a['offset'];left=a['size'];i=max(0,bisect.bisect_right(starts,offset)-1)\n with open(game/a['file'],'rb') as f:\n  while left:\n   b=blocks[i];f.seek(b['compressedOffset']);data=f.read(b['compressedSize']);data=lz4.block.decompress(data,uncompressed_size=b['uncompressedSize']) if b['compression'] in (2,3) else data\n   part=data[offset-b['uncompressedOffset']:offset-b['uncompressedOffset']+left];result.extend(part);offset+=len(part);left-=len(part);i+=1\n return bytes(result)\nfor item in doc['textures']:\n a=item['asset'];image=parse_image_data(read(a),a['width'],a['height'],a['format'],(2022,3,19,0),19).convert('RGBA');assert hashlib.sha256(image.tobytes()).hexdigest()==item['sha256'],item['id']\nfor item in doc['samples']:\n b=item['block'];data=read(dict(file='data.unity3d',space='file',offset=b['compressedOffset'],size=b['compressedSize']));data=lz4.block.decompress(data,uncompressed_size=b['uncompressedSize']) if b['compression'] in (2,3) else data;assert hashlib.sha256(data).hexdigest()==item['sha256']\nprint(json.dumps(dict(textures=len(doc['textures']),blocks=len(doc['samples']))))\n`;
    // Pillow represents Alpha8's absent RGB channels as black; the native
    // texture sampler/browser represents this alpha-only mask with white RGB.
    // Normalize only those unused RGB channels, retaining every source alpha.
    const referenceCode=code.replace(".convert('RGBA');assert", ".convert('RGBA');image.putdata([(255,255,255,p[3]) for p in image.getdata()]) if a['format']==1 else None;assert");
    const result=spawnSync(option('--python','python'),['-c',referenceCode,pythonDeps],{input:JSON.stringify({game:gameData,blocks:index.bundle.blocks,textures:textureReferences,samples:blockReferences}),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},maxBuffer:1024*1024,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout||'Independent texture comparison failed');independentReference=JSON.parse(result.stdout.trim());
  }
  if(temporary){
    const manifestPath=join(temporary,'manifest.json');await writeFile(manifestPath,JSON.stringify(audioManifest));temporaryFiles.push(manifestPath);
    const result=spawnSync(option('--python','python'),[fileURLToPath(new URL('../xp2-player-2026-10-23/verify-ogg-native.py',import.meta.url)),manifestPath,option('--python-deps','')],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout||'Native Vorbis decode failed');nativeDecoding=JSON.parse(result.stdout.trim());assert.equal(nativeDecoding.exactSampleCount,bySetup.size);
  }
  const bad=structuredClone(index);bad.files[0].samples[0].sha256='0'.repeat(64);
  await assert.rejects(()=>bindUnityFolder(files,bad),/不符/);
  assert.equal(library.pending.size,0);assert.ok(library.stats.cacheBytes<=8*1024*1024);
  const mediaStats={...library.stats};library.dispose();assert.equal(urls.size,0);assert.throws(()=>library.assertOpen());
  const quantiles=values=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:+sorted[Math.floor(sorted.length*.5)].toFixed(3),p95Ms:+sorted[Math.floor(sorted.length*.95)].toFixed(3),maxMs:+sorted.at(-1).toFixed(3)};};
  console.log(JSON.stringify({passed:true,catalogEntries:catalog.size,sourceHashesMatch:true,nativeHashMatches:true,
    nativeScenes:nativeScenes.length,readerScenes,readerDialogueScenes,readerPreviews,programScenes,programPreviews,frames,cgFrames,maxActors,
    defaultCgSlotUnique:true,finiteStateNumbers:true,routes:routeCounts,previewTiming:quantiles(previewTimes),jumpTiming:quantiles(jumpTimes),
    textureFormats:formats,textureSamples,lz4Blocks:blockReferences.length,vorbisSetups:vorbisSamples,pcmSamples,videoSamples,
    independentReference,nativeDecoding,wrongVersionRejected:true,disposeRevokedAll:true,mediaStats,elapsedMs:Math.round(performance.now()-started)},null,2));
}finally{library.dispose();for(const file of temporaryFiles)await unlink(file);if(temporary)await rmdir(temporary);}
