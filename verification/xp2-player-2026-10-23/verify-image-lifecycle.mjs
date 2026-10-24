import assert from 'node:assert/strict';
import {TextureDecoder} from '../../private/story-player/src/texture-decoder.js';
import {AtomicStageImages} from '../../private/story-player/src/stage-images.js';
import {ResourceLibrary} from '../../private/story-player/src/resources.js';
import {UnityLocalLibrary} from '../../private/story-player/src/unity-local.js';

const results=[],tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
const previous={Worker:globalThis.Worker,OffscreenCanvas:globalThis.OffscreenCanvas};
const workers=[];
class FakeWorker{
  constructor(){this.messages=[];this.terminated=false;workers.push(this);}
  postMessage(message,transfer){if(this.throwPost)throw new Error('postMessage failed');this.messages.push({message,transfer});}
  terminate(){this.terminated=true;}
  ready(id,blob){this.onmessage({data:{id,blob}});}
}
globalThis.Worker=FakeWorker;globalThis.OffscreenCanvas=class{};
const asset={width:1,height:1,format:4,flipY:true};

await check('worker receives an owned transferable slice, routes the matching response and releases its pending entry',async()=>{
  const decoder=new TextureDecoder(()=>{throw new Error('unexpected fallback');}),bytes=new Uint8Array([9,1,2,3,9]),promise=decoder.decode(bytes.subarray(1,4),asset),worker=workers.at(-1),sent=worker.messages[0];
  assert.deepEqual([...new Uint8Array(sent.message.bytes)],[1,2,3]);assert.notEqual(sent.message.bytes,bytes.buffer);assert.equal(sent.transfer[0],sent.message.bytes);assert.deepEqual(sent.message.asset,asset);const blob=new Blob(['png'],{type:'image/png'});worker.ready(sent.message.id,blob);assert.equal(await promise,blob);assert.equal(decoder.pending.size,0);decoder.dispose();assert.equal(worker.terminated,true);
});
await check('worker errors settle all requests, terminate the failed worker and allow the CPU fallback next time',async()=>{
  let calls=0;const decoder=new TextureDecoder(async()=>{calls++;return 'fallback';}),worker=workers.at(-1),a=decoder.decode(new Uint8Array(4),asset),b=decoder.decode(new Uint8Array(4),asset),rejectedA=assert.rejects(a,/图片后台解码/),rejectedB=assert.rejects(b,/图片后台解码/);worker.onerror({message:'worker module failure'});await Promise.all([rejectedA,rejectedB]);assert.equal(worker.terminated,true);assert.equal(decoder.pending.size,0);assert.equal(decoder.worker,null);assert.equal(await decoder.decode(new Uint8Array(4),asset),'fallback');assert.equal(calls,1);decoder.dispose();
});
await check('synchronous postMessage failure leaves no pending worker request',async()=>{
  const decoder=new TextureDecoder(async()=>null),worker=workers.at(-1);worker.throwPost=true;await assert.rejects(decoder.decode(new Uint8Array(4),asset),/postMessage failed/);assert.equal(decoder.pending.size,0);decoder.dispose();
});
await check('worker disposal rejects pending/future work and ignores late completion',async()=>{
  const decoder=new TextureDecoder(async()=>null),worker=workers.at(-1),promise=decoder.decode(new Uint8Array(4),asset),rejected=assert.rejects(promise,/已取消/);decoder.dispose();await rejected;assert.equal(decoder.pending.size,0);await assert.rejects(decoder.decode(new Uint8Array(4),asset),/已关闭/);worker.ready(1,new Blob(['late']));assert.equal(decoder.pending.size,0);decoder.dispose();
});
if(previous.Worker===undefined)delete globalThis.Worker;else globalThis.Worker=previous.Worker;
if(previous.OffscreenCanvas===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous.OffscreenCanvas;

const layer=()=>({nodes:[],style:{},replaceChildren(...nodes){this.nodes=nodes;}});
const state=asset=>({sceneId:'neutral',background:{asset,opacity:1},characters:[],layers:[]});
function rendererFixture(){
  const gates=new Map(),errors=[],background=layer(),actors=layer(),library={preload:async()=>{},resolve:id=>`blob:${id}`};let creations=0;
  const renderer=new AtomicStageImages(background,actors,library,{onError:error=>errors.push(error),createImage:()=>{creations++;return {style:{},naturalWidth:1280,naturalHeight:720,decode(){return gates.get(this.src)?.promise||Promise.resolve();}};}});
  return {renderer,gates,errors,background,actors,get creations(){return creations;}};
}
await check('A to B to A keeps A and cancels a late B image or late B decode error',async()=>{
  for(const reject of [false,true]){
    const fixture=rendererFixture(),{renderer,gates,errors,background}=fixture;await renderer.waitFor(state('A'));gates.set('blob:B',deferred());renderer.sync(state('B'));await tick();renderer.sync(state('A'));assert.equal(renderer.pending(state('A')),false);if(reject)gates.get('blob:B').reject(new Error('obsolete'));else gates.get('blob:B').resolve();await tick();assert.equal(background.nodes[0].src,'blob:A');assert.equal(errors.length,0);renderer.dispose();
  }
});
await check('failed image keys do not retry per frame and invalidation allows one explicit recovery',async()=>{
  const fixture=rendererFixture(),{renderer,gates,errors,background}=fixture;await renderer.waitFor(state('A'));gates.set('blob:bad',deferred());const failed=renderer.waitFor(state('bad'));await tick();gates.get('blob:bad').reject(new Error('damaged'));assert.equal(await failed,false);const count=fixture.creations;
  for(let n=0;n<100;n++)renderer.sync(state('bad'));assert.equal(fixture.creations,count);assert.equal(errors.length,1);assert.equal(background.nodes[0].src,'blob:A');gates.delete('blob:bad');renderer.invalidate();assert.equal(await renderer.waitFor(state('bad')),true);assert.equal(background.nodes[0].src,'blob:bad');renderer.dispose();
});
await check('a disposed image renderer settles waits immediately without depending on an unresolved old decode',async()=>{
  const fixture=rendererFixture(),{renderer,gates}=fixture;await renderer.waitFor(state('A'));gates.set('blob:slow',deferred());renderer.sync(state('slow'));await tick();renderer.dispose();let settled=false,value;const wait=renderer.waitFor(state('slow')).then(result=>{settled=true;value=result;});await tick();const immediate=settled;gates.get('blob:slow').resolve();await wait;assert.equal(immediate,true);assert.equal(value,false);assert.equal(renderer.pending(state('slow')),false);
});
await check('URL retention pins committed and desired images until their atomic replacement has decoded',async()=>{
  const revoked=[],assets=Array.from({length:30},(_,n)=>({id:`a${n}`,type:'image',src:`a${n}.png`}));
  const provider={resolve:async id=>`blob:${id}`,release:id=>revoked.push(id),dispose(){}};
  const library=new ResourceLibrary({assets,localOnly:true});library.setLocalProvider(provider);
  const gates=new Map(),background=layer(),actors=layer(),renderer=new AtomicStageImages(background,actors,library,{createImage:()=>({style:{},naturalWidth:1280,naturalHeight:720,decode(){return gates.get(this.src)?.promise||Promise.resolve();}})});
  await renderer.waitFor(state('a0'));gates.set('blob:a1',deferred());renderer.sync(state('a1'));await tick();await library.preload(assets.map(item=>item.id));library.retain(renderer.retained);assert.ok(!revoked.includes('a0'));assert.ok(!revoked.includes('a1'));assert.equal(background.nodes[0].src,'blob:a0');assert.ok(library.resolved.size<=24);gates.get('blob:a1').resolve();assert.equal(await renderer.waitFor(state('a1')),true);assert.equal(background.nodes[0].src,'blob:a1');assert.deepEqual(renderer.retained,['a1']);renderer.dispose();library.dispose();
});
function unityFixture(){
  const file=new Blob([new Uint8Array([10,20,30,255,40,50,60,255])]),blocks=[{compressedOffset:0,compressedSize:8,uncompressedOffset:0,uncompressedSize:8,compression:0}],created=[],revoked=[];
  const assets=Object.fromEntries(['a','b'].map((id,index)=>[id,{kind:'texture',width:1,height:1,format:4,source:{file:'data.unity3d',offset:index*4,size:4,space:'file'}}]));
  const library=new UnityLocalLibrary(new Map([['data.unity3d',file]]),{bundle:{file:'data.unity3d',blocks},assets},{urlAPI:{createObjectURL(blob){created.push(blob);return `blob:${created.length}`;},revokeObjectURL(url){revoked.push(url);}}});
  library.textureDecoder.dispose();return {library,created,revoked};
}
await check('Unity resource disposal prevents a late decoder result from creating any Blob URL',async()=>{
  const {library,created}=unityFixture(),gate=deferred();library.textureDecoder={decode:()=>gate.promise,dispose(){}};const pending=library.resolve('a'),rejected=assert.rejects(pending,/已关闭/);await tick();library.dispose();gate.resolve(new Blob(['decoded']));await rejected;assert.equal(created.length,0);assert.equal(library.urls.size,0);assert.equal(library.pending.size,0);assert.equal(library.stats.cacheBytes,0);
});
await check('Unity provider deduplicates assets and serializes decoders with explicit URL release',async()=>{
  const {library,created,revoked}=unityFixture(),first=deferred();let calls=0;library.textureDecoder={decode:()=>{calls++;return calls===1?first.promise:Promise.resolve(new Blob(['decoded']));},dispose(){}};const a=library.resolve('a');assert.equal(library.resolve('a'),a);const b=library.resolve('b');await tick();assert.equal(calls,1);first.resolve(new Blob(['decoded']));assert.equal(await a,'blob:1');assert.equal(await b,'blob:2');assert.equal(calls,2);library.release('a');assert.deepEqual(revoked,['blob:1']);assert.equal(await library.resolve('a'),'blob:3');assert.equal(created.length,3);library.dispose();assert.equal(new Set(revoked).size,3);
});
console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,results},null,2));
if(results.some(item=>!item.passed))process.exitCode=1;
