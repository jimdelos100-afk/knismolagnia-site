/** Run with Node 22+: node verify-local-reader.mjs --game-data ".../_Data"
 * Add --native to check each reconstructed Ogg with Python + PyOgg/libvorbisfile.
 * Optional: --python python --pyogg-deps "path/to/python/site-packages".
 * Prints numerical results only. No game media is kept in the repository.
 */
import assert from 'node:assert/strict';
import {openAsBlob} from 'node:fs';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const gameData=option('--game-data');
if(!gameData)throw new Error('Pass --game-data with the path to the original game _Data directory.');
const playerRoot=new URL('../../private/story-player/',import.meta.url);
const {bindUnityFolder,decodeTextureRGBA,decodeLZ4Block}=await import(new URL('src/unity-local.js',playerRoot));
const index=JSON.parse(await readFile(new URL('data/unity-index.json',playerRoot),'utf8'));
const reference=JSON.parse(await readFile(new URL('reader-reference.json',import.meta.url),'utf8'));
const files=[];
for(const item of index.files){
  const blob=await openAsBlob(join(gameData,item.path));
  files.push(new File([blob],item.path,{type:'application/octet-stream'}));
}
const blobs=new Map();let serial=0;
const urlAPI={createObjectURL(blob){const key='blob:test-'+(++serial);blobs.set(key,blob);return key;},revokeObjectURL(key){blobs.delete(key);}};
const library=await bindUnityFolder(files,index,{urlAPI});
const temporary=await mkdtemp(join(tmpdir(),'xp2-reader-verify-')),temporaryFiles=[];
try{
  const bundleFile=files.find(file=>file.name===index.bundle.file);
  for(const sample of reference.blocks){
    const block=index.bundle.blocks[sample.index],compressed=new Uint8Array(await bundleFile.slice(block.compressedOffset,block.compressedOffset+block.compressedSize).arrayBuffer());
    assert.equal(createHash('sha256').update(decodeLZ4Block(compressed,block.uncompressedSize)).digest('hex'),sample.sha256);
  }
  for(const sample of reference.textures){
    const asset=index.assets[sample.id];assert.equal(asset.format,sample.format);
    const bytes=await library.readRange(asset.file,asset.offset,asset.size,asset.space);
    assert.equal(createHash('sha256').update(decodeTextureRGBA(bytes,asset)).digest('hex'),sample.sha256);
  }
  const bySetup=new Map();
  for(const [id,asset]of Object.entries(index.assets))if(asset.codec==='fsb5-vorbis'){
    const previous=bySetup.get(asset.vorbisSetup);
    if(!previous||asset.size<previous[1].size)bySetup.set(asset.vorbisSetup,[id,asset]);
  }
  assert.equal(bySetup.size,45);const manifest=[];
  for(const [setup,[id,asset]]of bySetup){
    const first=library.resolve(id),second=library.resolve(id);assert.equal(first,second,'concurrent reads must deduplicate');
    const url=await first,blob=blobs.get(url);assert.equal(blob.type,'audio/ogg');
    const buffer=Buffer.from(await blob.arrayBuffer());assert.equal(buffer.subarray(0,4).toString(),'OggS');
    assert.equal(await library.resolve(id),url,'resolved URLs remain stable until release');
    const filename='sample-'+setup+'.ogg',path=join(temporary,filename);
    if(args.includes('--native')){await writeFile(path,buffer);temporaryFiles.push(path);}
    manifest.push({setup,filename,channels:asset.channels,frequency:asset.frequency,samples:asset.samples});library.release(id);
  }
  let nativeDecoding='not-run';
  if(args.includes('--native')){
    const manifestPath=join(temporary,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest));temporaryFiles.push(manifestPath);
    const result=spawnSync(option('--python','python'),[fileURLToPath(new URL('verify-ogg-native.py',import.meta.url)),manifestPath,option('--pyogg-deps','')],{encoding:'utf8'});
    if(result.status!==0)throw new Error(result.stderr||result.stdout||'Native Vorbis verification failed.');
    nativeDecoding=JSON.parse(result.stdout.trim());assert.equal(nativeDecoding.exactSampleCount,45);
  }
  let pcmSamples=0,videoSlices=0;
  for(const [id,asset]of Object.entries(index.assets))if(asset.codec==='pcm'){
    const url=await library.resolve(id),blob=blobs.get(url),buffer=Buffer.from(await blob.arrayBuffer());
    assert.equal(blob.type,'audio/wav');assert.equal(buffer.subarray(0,4).toString(),'RIFF');
    assert.equal(buffer.readUInt32LE(40),asset.samples*asset.channels*asset.bits/8);
    assert.equal(buffer.length,44+buffer.readUInt32LE(40));pcmSamples++;library.release(id);
  }else if(asset.kind==='video'){
    const url=await library.resolve(id),blob=blobs.get(url);assert.equal(blob.type,'video/mp4');assert.equal(blob.size,asset.size);
    const header=Buffer.from(await blob.slice(0,12).arrayBuffer());assert.equal(header.subarray(4,8).toString(),'ftyp');videoSlices++;library.release(id);
  }
  assert.equal(library.pending.size,0);assert.ok(library.stats.cacheBytes<=8*1024*1024);
  const altered=structuredClone(index);altered.files[0].samples[0].sha256='0'.repeat(64);
  await assert.rejects(()=>bindUnityFolder(files,altered),/不符/);
  const stats={...library.stats};library.dispose();assert.equal(blobs.size,0);assert.throws(()=>library.assertOpen());
  console.log(JSON.stringify({versionFiles:files.map(file=>({name:file.name,size:file.size})),lz4Blocks:reference.blocks.length,textures:reference.textures.length,vorbisSetups:manifest.length,nativeDecoding,pcmSamples,videoSlices,wrongVersionRejected:true,disposeRevokedAll:true,...stats},null,2));
}finally{
  library.dispose();for(const path of temporaryFiles)await unlink(path);await rmdir(temporary);
}
