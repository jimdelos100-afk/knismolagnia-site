/* Reads only selected local files. UnityFS LZ4 blocks are decoded on demand;
   game files and decoded media are never sent to a server.
   Format references:
   https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md
   https://learn.microsoft.com/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression
   https://xiph.org/ogg/doc/framing.html */
import {TextureDecoder} from './texture-decoder.js';
const MIB=1024*1024;
const MAX_RANGE=128*MIB;
const MAX_PIXELS=16777216;
const MAX_CACHE=8*MIB;
const BAD_NAMES=new Set(['__proto__','prototype','constructor']);
const fail=message=>{throw new Error(message);};
const integer=(value,label,max=Number.MAX_SAFE_INTEGER)=>{
  if(!Number.isSafeInteger(value)||value<0||value>max)fail(`${label}无效。`);
  return value;
};
const normalized=value=>String(value||'').replaceAll('\\','/').replace(/^\.\//,'');
const baseName=value=>normalized(value).split('/').at(-1);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const ascii=(bytes,at,length)=>String.fromCharCode(...bytes.subarray(at,at+length));

async function readSlice(file,offset,length){
  integer(offset,'资源偏移');integer(length,'资源长度',MAX_RANGE);
  if(offset+length>file.size)fail(`本地文件 ${file.name} 的资源范围不完整。`);
  const buffer=await file.slice(offset,offset+length).arrayBuffer();
  if(buffer.byteLength!==length)fail(`本地文件 ${file.name} 读取不完整，请重新选择文件夹。`);
  return new Uint8Array(buffer);
}

/** Independent LZ4 block, with strict input/output bounds (no frame header). */
export function decodeLZ4Block(input,outputSize){
  integer(outputSize,'解压块大小',16*MIB);
  const output=new Uint8Array(outputSize);let ip=0,op=0;
  function extended(initial){
    let length=initial;
    if(initial===15){let value;do{if(ip>=input.length)fail('LZ4 长度数据不完整。');value=input[ip++];length+=value;}while(value===255);}
    return length;
  }
  while(ip<input.length){
    const token=input[ip++],literals=extended(token>>>4);
    if(ip+literals>input.length||op+literals>output.length)fail('LZ4 字面数据超出范围。');
    output.set(input.subarray(ip,ip+literals),op);ip+=literals;op+=literals;
    if(ip===input.length)break;
    if(ip+2>input.length)fail('LZ4 引用数据不完整。');
    const distance=input[ip]|(input[ip+1]<<8);ip+=2;
    if(distance===0||distance>op)fail('LZ4 引用位置无效。');
    const count=extended(token&15)+4;
    if(op+count>output.length)fail('LZ4 解压数据超出范围。');
    let source=op-distance;const end=op+count;
    while(op<end)output[op++]=output[source++];
  }
  if(op!==outputSize)fail('LZ4 解压后的大小与游戏索引不符。');
  return output;
}

function rgb565(value){
  const r=(value>>>11)&31,g=(value>>>5)&63,b=value&31;
  return [(r<<3)|(r>>>2),(g<<2)|(g>>>4),(b<<3)|(b>>>2),255];
}

/** Unity base mip -> top-to-bottom RGBA8, including Alpha8 masks in the sequel. */
export function decodeTextureRGBA(bytes,{width,height,format,flipY=true}){
  integer(width,'图片宽度',8192);integer(height,'图片高度',8192);
  if(!width||!height||width*height>MAX_PIXELS)fail('图片尺寸超出本机解码限制。');
  const formats={Alpha8:1,RGB24:3,RGBA32:4,ARGB32:5,BGRA32:14,DXT1:10,DXT5:12};
  format=typeof format==='string'?(formats[format]??Number(format)):format;
  const rgba=new Uint8ClampedArray(width*height*4);
  const pixelAt=(x,y)=>((flipY?height-1-y:y)*width+x)*4;
  if(format===1){
    if(bytes.length<width*height)fail('图片像素数据不完整。');
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const target=pixelAt(x,y);rgba[target]=rgba[target+1]=rgba[target+2]=255;rgba[target+3]=bytes[y*width+x];}
    return rgba;
  }
  if([3,4,5,14].includes(format)){
    const stride=format===3?3:4;
    if(bytes.length<width*height*stride)fail('图片像素数据不完整。');
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const source=(y*width+x)*stride,target=pixelAt(x,y);
      if(format===14){rgba[target]=bytes[source+2];rgba[target+1]=bytes[source+1];rgba[target+2]=bytes[source];rgba[target+3]=bytes[source+3];}
      else if(format===5){rgba[target]=bytes[source+1];rgba[target+1]=bytes[source+2];rgba[target+2]=bytes[source+3];rgba[target+3]=bytes[source];}
      else{rgba[target]=bytes[source];rgba[target+1]=bytes[source+1];rgba[target+2]=bytes[source+2];rgba[target+3]=stride===4?bytes[source+3]:255;}
    }
    return rgba;
  }
  if(format!==10&&format!==12)fail(`此图片使用尚未支持的 Unity 纹理格式 ${format}。`);
  const blockBytes=format===10?8:16,blocksX=Math.ceil(width/4),blocksY=Math.ceil(height/4);
  if(bytes.length<blocksX*blocksY*blockBytes)fail('压缩图片的数据不完整。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let by=0;by<blocksY;by++)for(let bx=0;bx<blocksX;bx++){
    const at=(by*blocksX+bx)*blockBytes,colorAt=at+(format===12?8:0);
    const c0=view.getUint16(colorAt,true),c1=view.getUint16(colorAt+2,true);
    const colors=[rgb565(c0),rgb565(c1),[0,0,0,255],[0,0,0,255]];
    if(c0>c1||format===12){
      for(let channel=0;channel<3;channel++){
        colors[2][channel]=Math.floor((2*colors[0][channel]+colors[1][channel])/3);
        colors[3][channel]=Math.floor((colors[0][channel]+2*colors[1][channel])/3);
      }
    }else{
      for(let channel=0;channel<3;channel++)colors[2][channel]=Math.floor((colors[0][channel]+colors[1][channel])/2);
      colors[3][3]=0;
    }
    const indices=view.getUint32(colorAt+4,true),alpha=[];
    if(format===12){
      alpha.push(bytes[at],bytes[at+1]);
      if(alpha[0]>alpha[1])for(let i=1;i<=6;i++)alpha.push(Math.floor(((7-i)*alpha[0]+i*alpha[1])/7));
      else{for(let i=1;i<=4;i++)alpha.push(Math.floor(((5-i)*alpha[0]+i*alpha[1])/5));alpha.push(0,255);}
    }
    for(let py=0;py<4;py++)for(let px=0;px<4;px++){
      const x=bx*4+px,y=by*4+py;if(x>=width||y>=height)continue;
      const p=py*4+px,color=colors[(indices>>>(p*2))&3],target=pixelAt(x,y);
      rgba[target]=color[0];rgba[target+1]=color[1];rgba[target+2]=color[2];
      if(format===12){const bit=p*3,byte=at+2+(bit>>>3),shift=bit&7,code=((bytes[byte]|((bytes[byte+1]||0)<<8))>>>shift)&7;rgba[target+3]=alpha[code];}
      else rgba[target+3]=color[3];
    }
  }
  return rgba;
}

async function textureBlob(bytes,asset){
  const pixels=decodeTextureRGBA(bytes,asset);
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(asset.width,asset.height):Object.assign(document.createElement('canvas'),{width:asset.width,height:asset.height});
  const context=canvas.getContext('2d');
  if(!context)fail('浏览器无法创建本地图片画布。');
  context.putImageData(new ImageData(pixels,asset.width,asset.height),0,0);
  if(canvas.convertToBlob)return canvas.convertToBlob({type:'image/png'});
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('本地图片转换失败。')),'image/png'));
}

const CRC_TABLE=(()=>{
  const values=new Uint32Array(256);
  for(let n=0;n<256;n++){let value=n<<24;for(let bit=0;bit<8;bit++)value=(value<<1)^((value&0x80000000)?0x04c11db7:0);values[n]=value>>>0;}
  return values;
})();
function oggCRC(bytes){let crc=0;for(const byte of bytes)crc=((crc<<8)^CRC_TABLE[((crc>>>24)^byte)&255])>>>0;return crc;}
function fromBase64(value){
  if(typeof value!=='string'||value.length>200000)fail('Vorbis 解码表无效。');
  try{return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{fail('Vorbis 解码表损坏。');}
}

/** Writes standards-compliant Ogg pages including packets spanning page boundaries. */
function oggPages(packet,granule,sequence,{first=false,last=false}={}){
  const lacing=[];let remaining=packet.length;
  while(remaining>=255){lacing.push(255);remaining-=255;}lacing.push(remaining);
  const pages=[];let byteAt=0;
  for(let segmentAt=0;segmentAt<lacing.length;segmentAt+=255){
    const segments=lacing.slice(segmentAt,segmentAt+255),complete=segmentAt+segments.length===lacing.length;
    const size=segments.reduce((sum,value)=>sum+value,0),page=new Uint8Array(27+segments.length+size),view=new DataView(page.buffer);
    page.set([79,103,103,83,0],0);page[5]=(segmentAt?1:0)|(first&&segmentAt===0?2:0)|(last&&complete?4:0);
    if(complete){view.setUint32(6,granule>>>0,true);view.setUint32(10,Math.floor(granule/4294967296)>>>0,true);}
    else{view.setUint32(6,0xffffffff,true);view.setUint32(10,0xffffffff,true);}
    view.setUint32(14,1,true);view.setUint32(18,sequence++,true);page[26]=segments.length;
    page.set(segments,27);page.set(packet.subarray(byteAt,byteAt+size),27+segments.length);byteAt+=size;
    view.setUint32(22,oggCRC(page),true);pages.push(page);
  }
  return {pages,sequence};
}

function vorbisIdentification(channels,frequency,blockSizes){
  integer(channels,'音频声道',8);integer(frequency,'音频采样率',384000);
  if(!channels||!frequency)fail('音频采样信息无效。');
  const bytes=new Uint8Array(30),view=new DataView(bytes.buffer);bytes.set([1,118,111,114,98,105,115]);
  bytes[11]=channels;view.setUint32(12,frequency,true);
  const exponents=blockSizes.map(size=>Math.log2(size));
  if(exponents.some(value=>!Number.isInteger(value)||value<6||value>13))fail('Vorbis 块大小无效。');
  bytes[28]=exponents[0]|(exponents[1]<<4);bytes[29]=1;return bytes;
}
function vorbisComment(){
  const vendor=new TextEncoder().encode('XP2 local reader'),bytes=new Uint8Array(16+vendor.length),view=new DataView(bytes.buffer);
  bytes.set([3,118,111,114,98,105,115]);view.setUint32(7,vendor.length,true);bytes.set(vendor,11);bytes[bytes.length-1]=1;return bytes;
}

/** FSB5's little-endian length-prefixed Vorbis packets -> an Ogg Blob. */
export function rebuildVorbisPackets(bytes,asset,setup){
  if(!setup)fail('此音频缺少 Vorbis 解码表，请使用配套版本的游戏。');
  const blockSizes=setup.blockSizes||[256,2048],flags=setup.modeBlockFlags;
  if(!Array.isArray(flags)||!flags.length||flags.length>64)fail('Vorbis 模式索引无效。');
  const modeBits=Math.ceil(Math.log2(flags.length)),mask=(1<<modeBits)-1;
  const parts=[];let sequence=0;
  function append(packet,granule,options){const next=oggPages(packet,granule,sequence,options);parts.push(...next.pages);sequence=next.sequence;}
  append(vorbisIdentification(asset.channels,asset.frequency||asset.sampleRate,blockSizes),0,{first:true});
  append(vorbisComment(),0);
  const setupPacket=fromBase64(setup.setupBase64||setup.setup);
  if(setupPacket[0]!==5||ascii(setupPacket,1,6)!=='vorbis')fail('Vorbis setup packet 无效。');
  append(setupPacket,0);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=asset.packetOffset||0,previous=0,granule=0,count=0;
  while(at+2<=bytes.length){
    const size=view.getUint16(at,true);at+=2;if(!size)break;
    if(at+size>bytes.length)fail('FSB5 音频包不完整。');
    const packet=bytes.subarray(at,at+size);at+=size;
    if(packet[0]&1)fail('FSB5 Vorbis 音频包无效。');
    const mode=((packet[0]|((packet[1]||0)<<8))>>>1)&mask;
    if(mode>=flags.length)fail('FSB5 Vorbis 模式超出范围。');
    const block=blockSizes[flags[mode]?1:0];
    if(previous)granule+=(previous+block)/4;previous=block;count++;
    const last=at+2>bytes.length||view.getUint16(at,true)===0;
    // FSB sample count trims encoder padding on the final page.
    const endSample=asset.samples??asset.sampleCount;
    append(packet,last&&Number.isSafeInteger(endSample)?Math.min(granule,endSample):granule,{last});
    if(last)break;
  }
  if(!count)fail('FSB5 音频没有可播放的数据包。');
  return new Blob(parts,{type:'audio/ogg'});
}

function wavBlob(bytes,asset){
  const channels=asset.channels,frequency=asset.frequency||asset.sampleRate,bits=asset.bits||16;
  integer(channels,'PCM 声道',8);integer(frequency,'PCM 采样率',384000);
  if(!channels||!frequency||![8,16,24,32].includes(bits))fail('PCM 音频格式无效。');
  const header=new Uint8Array(44),view=new DataView(header.buffer),align=channels*bits/8;
  const samples=asset.samples??asset.sampleCount;
  if(Number.isSafeInteger(samples)&&samples>=0){
    const dataSize=samples*align;
    if(dataSize>bytes.length)fail('PCM 音频的样本数据不完整。');
    bytes=bytes.subarray(0,dataSize); // Exclude FSB bank alignment padding.
  }
  header.set([82,73,70,70]);view.setUint32(4,36+bytes.length,true);header.set([87,65,86,69,102,109,116,32],8);
  view.setUint32(16,16,true);view.setUint16(20,asset.float?3:1,true);view.setUint16(22,channels,true);view.setUint32(24,frequency,true);
  view.setUint32(28,frequency*align,true);view.setUint16(32,align,true);view.setUint16(34,bits,true);header.set([100,97,116,97],36);view.setUint32(40,bytes.length,true);
  return new Blob([header,bytes],{type:'audio/wav'});
}

export class UnityLocalLibrary{
  constructor(files,index,{onProgress=()=>{},urlAPI=URL}={}){
    this.files=files;this.index=index;this.onProgress=onProgress;this.urlAPI=urlAPI;
    this.assets=new Map(Array.isArray(index.assets)?index.assets.map(asset=>[asset.id,asset]):Object.entries(index.assets||{}));
    this.bundle=index.bundle||{file:'data.unity3d',blocks:index.blocks};
    this.blocks=this.bundle.blocks;this.blockCache=new Map();this.cacheBytes=0;this.urls=new Map();this.pending=new Map();this.disposed=false;this.queue=Promise.resolve();
    this.stats={sliceBytes:0,decodedBlocks:0,cacheBytes:0};
    if(!Array.isArray(this.blocks)||!this.blocks.length||this.blocks.length>100000)fail('本地游戏的压缩块索引无效。');
    let expectedOffset=0;
    for(const block of this.blocks){
      integer(block.compressedOffset,'压缩块偏移');integer(block.compressedSize,'压缩块长度',16*MIB);
      integer(block.uncompressedOffset,'逻辑块偏移');integer(block.uncompressedSize,'逻辑块长度',16*MIB);
      if(block.uncompressedOffset!==expectedOffset||!block.uncompressedSize||![0,2,3].includes(block.compression))fail('本地游戏的压缩块索引不连续或格式不支持。');
      const source=this.files.get(this.bundle.file);
      if(!source||block.compressedOffset+block.compressedSize>source.size)fail('本地游戏的压缩块索引超出文件范围。');
      expectedOffset+=block.uncompressedSize;
    }
    this.virtualSize=expectedOffset;this.textureDecoder=new TextureDecoder(textureBlob);
  }
  assertOpen(){if(this.disposed)fail('本地游戏资源已关闭，请重新选择文件夹。');}
  async blockAt(index){
    this.assertOpen();
    if(this.blockCache.has(index)){const cached=this.blockCache.get(index);this.blockCache.delete(index);this.blockCache.set(index,cached);return cached;}
    const block=this.blocks[index];if(!block)fail('游戏资源的压缩块不存在。');
    const compressed=await readSlice(this.files.get(this.bundle.file),block.compressedOffset,block.compressedSize);this.stats.sliceBytes+=compressed.length;
    this.assertOpen();
    const bytes=block.compression===0?compressed:decodeLZ4Block(compressed,block.uncompressedSize);
    if(bytes.length!==block.uncompressedSize)fail('游戏资源的压缩块大小不符。');
    this.stats.decodedBlocks++;
    if(bytes.length<=MAX_CACHE){
      while(this.cacheBytes+bytes.length>MAX_CACHE&&this.blockCache.size){const oldest=this.blockCache.keys().next().value;this.cacheBytes-=this.blockCache.get(oldest).length;this.blockCache.delete(oldest);}
      this.blockCache.set(index,bytes);this.cacheBytes+=bytes.length;this.stats.cacheBytes=this.cacheBytes;
    }
    return bytes;
  }
  async readRange(fileName,offset,size,space='file'){
    this.assertOpen();integer(offset,'资源偏移');integer(size,'资源长度',MAX_RANGE);
    if(space!=='file'&&space!=='bundle')fail('游戏资源的存储空间无效。');
    const file=this.files.get(fileName);if(!file)fail(`游戏文件夹缺少 ${fileName}。`);
    if(space!=='bundle'){
      const bytes=await readSlice(file,offset,size);this.stats.sliceBytes+=size;this.assertOpen();return bytes;
    }
    if(fileName!==this.bundle.file||offset+size>this.virtualSize)fail('游戏资源的逻辑范围超出索引。');
    const result=new Uint8Array(size);let low=0,high=this.blocks.length;
    while(low<high){const middle=(low+high)>>>1;if(this.blocks[middle].uncompressedOffset<=offset)low=middle+1;else high=middle;}
    let blockIndex=Math.max(0,low-1),written=0;
    while(written<size){
      const block=this.blocks[blockIndex],bytes=await this.blockAt(blockIndex++),relative=offset+written-block.uncompressedOffset;
      const length=Math.min(size-written,bytes.length-relative);
      if(length<=0)fail('游戏资源的逻辑块映射无效。');
      result.set(bytes.subarray(relative,relative+length),written);written+=length;
    }
    return result;
  }
  resolve(assetId){
    this.assertOpen();if(this.urls.has(assetId))return Promise.resolve(this.urls.get(assetId));
    if(this.pending.has(assetId))return this.pending.get(assetId);
    const asset=this.assets.get(assetId);if(!asset)return Promise.resolve(null);
    const task=this.queue.then(async()=>{
      this.assertOpen();this.onProgress({phase:'decode',assetId});
      const source=asset.source||asset;
      let blob;
      if((asset.kind==='video'||asset.type==='video')&&(source.space||'file')==='file'){
        // File-backed Blob slices let the browser stream a movie without making
        // an ArrayBuffer the size of the movie.
        const file=this.files.get(source.file);integer(source.offset,'视频偏移');integer(source.size,'视频长度',1024*MIB);
        if(!file||source.offset+source.size>file.size)fail('本地游戏的视频范围不完整。');
        blob=file.slice(source.offset,source.offset+source.size,'video/mp4');
      }else{
        const bytes=await this.readRange(source.file,source.offset,source.size,source.space||'file');
        if(asset.kind==='texture'||asset.type==='image')blob=await this.textureDecoder.decode(bytes,asset);
        else if(asset.codec==='fsb5-vorbis'||asset.codec==='vorbis')blob=rebuildVorbisPackets(bytes,asset,this.index.vorbisSetups?.[asset.vorbisSetup]);
        else if(asset.codec==='pcm')blob=wavBlob(bytes.subarray(asset.packetOffset||0),asset);
        else if(asset.codec==='mp3'||asset.codec==='mpeg')blob=new Blob([bytes.subarray(asset.packetOffset||0)],{type:'audio/mpeg'});
        else if(asset.kind==='video'||asset.type==='video')blob=new Blob([bytes],{type:'video/mp4'});
        else{
          const magic=ascii(bytes,0,4),mime=magic==='OggS'?'audio/ogg':magic==='RIFF'?'audio/wav':null;
          if(!mime)fail(`资源 ${assetId} 使用尚未支持的媒体格式。`);
          blob=new Blob([bytes],{type:mime});
        }
      }
      this.assertOpen();const url=this.urlAPI.createObjectURL(blob);this.urls.set(assetId,url);this.onProgress({phase:'ready',assetId});return url;
    });
    this.queue=task.catch(()=>{});this.pending.set(assetId,task);
    task.then(()=>this.pending.delete(assetId),()=>this.pending.delete(assetId));return task;
  }
  release(assetId){const url=this.urls.get(assetId);if(url)this.urlAPI.revokeObjectURL(url);this.urls.delete(assetId);}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.textureDecoder.dispose();
    for(const url of this.urls.values())this.urlAPI.revokeObjectURL(url);
    this.urls.clear();this.blockCache.clear();this.cacheBytes=0;this.stats.cacheBytes=0;this.files.clear();
  }
}

/** Checks exact game version by size and sampled SHA-256 before using offsets. */
export async function bindUnityFolder(fileList,index,{onProgress=()=>{},urlAPI=URL}={}){
  if(!index||typeof index!=='object'||index.type!=='xp2-unity-local-index'||index.schemaVersion!==1||!Array.isArray(index.files)||!index.files.length||index.files.length>16)fail('游戏版本索引不可用或版本不受支持。');
  if(!globalThis.crypto?.subtle)fail('本地游戏校验需要安全连接，请通过 HTTPS 或本机 localhost 打开网站。');
  const selected=Array.from(fileList||[]),bound=new Map();
  if(!selected.length||selected.length>100000)fail('请选择包含游戏本体的文件夹。');
  for(let i=0;i<index.files.length;i++){
    const expected=index.files[i],path=normalized(expected.path||expected.name);
    if(!path||path.startsWith('/')||path.split('/').some(part=>part==='..'||BAD_NAMES.has(part)))fail('游戏版本索引的文件路径无效。');
    const candidates=selected.filter(file=>{
      const chosen=normalized(file.webkitRelativePath||file.name);
      return chosen===path||chosen.endsWith('/'+path)||(baseName(chosen)===path);
    });
    if(!candidates.length)fail(`游戏文件夹缺少 ${path}，请选择完整游戏目录或对应的 _Data 文件夹。`);
    if(candidates.length>1)fail(`所选目录内有多个 ${path}，请只选择一份游戏。`);
    const file=candidates[0];integer(expected.size,`${path} 的预期大小`);
    const gameVersion=typeof index.gameVersion==='string'?index.gameVersion:'v1.0.0',gameName=typeof index.gameName==='string'?index.gameName:'性癖讨论2';
    if(file.size!==expected.size)fail(`${path} 的大小与「${gameName} ${gameVersion}」不符，请选择对应的原始游戏。`);
    if(!Array.isArray(expected.samples)||!expected.samples.length||expected.samples.length>32)fail(`${path} 缺少版本校验信息。`);
    onProgress({phase:'verify',file:path,current:i,total:index.files.length});
    for(const sample of expected.samples){
      integer(sample.offset,'校验偏移');integer(sample.length,'校验长度',MIB);
      if(!/^[0-9a-f]{64}$/i.test(sample.sha256||''))fail('游戏版本的校验摘要无效。');
      const bytes=await readSlice(file,sample.offset,sample.length),actual=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
      if(actual.toLowerCase()!==sample.sha256.toLowerCase())fail(`${path} 与「${gameName} ${gameVersion}」不符，无法安全匹配剧情资源。`);
    }
    bound.set(path,file);
  }
  onProgress({phase:'verified',current:index.files.length,total:index.files.length});
  return new UnityLocalLibrary(bound,index,{onProgress,urlAPI});
}
