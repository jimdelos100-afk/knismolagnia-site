import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildNativeCatalog} from '../../private/story-player/src/game-shell.js';
import {NATIVE_UI} from '../../private/story-player/src/game-shell-data.js';
import {createNativeUiAssets} from '../../private/story-player/src/native-ui-assets.js';

const story=JSON.parse(readFileSync(new URL('../../private/story-player/data/story.json',import.meta.url)));
const index=JSON.parse(readFileSync(new URL('../../private/story-player/data/unity-index.json',import.meta.url)));
const catalog=buildNativeCatalog(story,index);
assert.equal(catalog.images.length,354);
assert.equal(catalog.images.filter(image=>image.thumbnailAssetId).length,349);
assert.deepEqual(catalog.images.filter(image=>!image.thumbnailAssetId).map(image=>image.label),['scene8_8C','scene8_8D','scene8_8E','scene8_8F','scene8_8G']);
for(const image of catalog.images.filter(image=>image.thumbnailAssetId)){
  const asset=index.assets[image.thumbnailAssetId];
  assert.equal(asset.width,640);assert.equal(asset.height,360);
  assert.ok(asset.resourcePaths.includes(image.thumbnailResourcePath));
  assert.notEqual(image.thumbnailAssetId,image.assetId);
}
for(const recall of catalog.recalls)assert.ok(index.assets[recall.thumbnailAssetId]);
for(const [key,id]of Object.entries(NATIVE_UI))assert.equal(index.assets[id]?.kind,['click','hover'].includes(key)?'audio':'texture');
assert.equal(index.assets[NATIVE_UI.title].name,'タイトル画面@11');
assert.equal(index.assets[NATIVE_UI.messageWindow].name,'MessageBox_10th');
assert.equal(index.assets[NATIVE_UI.click].name,'mouse_click_1');
assert.equal(index.assets[NATIVE_UI.hover].name,'mouse_hover_1');

const originalImage=globalThis.Image,originalObserver=globalThis.IntersectionObserver,originalDocument=globalThis.document;
const originalCreateUrl=URL.createObjectURL,originalRevokeUrl=URL.revokeObjectURL;
globalThis.Image=class{decode(){return Promise.resolve();}};
const observers=[];
globalThis.IntersectionObserver=class{
  constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}
  observe(target){this.targets.add(target);}
  unobserve(target){this.targets.delete(target);}
  disconnect(){this.targets.clear();}
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
try{
  const requests=[],pending=new Map(),retained=[],applied=[];
  const loader=createNativeUiAssets({resolveAsset:id=>{requests.push(id);return new Promise(resolve=>pending.set(id,resolve));},onVisibleAssets:ids=>retained.push(ids)});
  for(const id of ['old-a','old-b','old-c'])loader.request(id,()=>applied.push(id));
  assert.deepEqual(requests,['old-a','old-b'],'Only two resource requests may run concurrently');
  assert.deepEqual(retained.at(-1),['old-a','old-b','old-c']);
  loader.beginPage();loader.request('new-a',()=>applied.push('new-a'));
  assert.deepEqual(retained.at(-1),['new-a'],'A page change releases all old page pins');
  pending.get('old-a')('blob:old-a');await tick();
  assert.deepEqual(requests,['old-a','old-b','new-a']);
  pending.get('old-b')('blob:old-b');pending.get('new-a')('blob:new-a');await tick();
  assert.deepEqual(applied,['new-a'],'Old page responses cannot write to the new page');
  assert.ok(!requests.includes('old-c'),'Queued work from a previous page is discarded');
  const target={classList:{add(){}}};loader.request('lazy',()=>applied.push('lazy'),{target,lazy:true});
  assert.ok(!requests.includes('lazy'),'Off-screen thumbnails are not decoded');
  observers.at(-1).callback([{target,isIntersecting:true}]);assert.ok(requests.includes('lazy'));
  pending.get('lazy')('blob:lazy');await tick();assert.ok(applied.includes('lazy'));
  const staleTarget={classList:{add(){}}};loader.request('stale-lazy',()=>applied.push('stale-lazy'),{target:staleTarget,lazy:true});
  const oldObserver=observers.at(-1);loader.beginPage();oldObserver.callback([{target:staleTarget,isIntersecting:true}]);
  assert.ok(!requests.includes('stale-lazy'),'A delayed observer callback cannot revive old work');
  loader.dispose();assert.deepEqual(retained.at(-1),[]);
  const canvases=[],revoked=[];let derivedIndex=0,deferBlob=false,finishBlob;
  globalThis.document={createElement:tag=>{assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob:callback=>{if(deferBlob)finishBlob=callback;else callback(new Blob(['thumbnail']));}};canvases.push(canvas);return canvas;}};
  URL.createObjectURL=()=>`blob:derived-${++derivedIndex}`;URL.revokeObjectURL=url=>revoked.push(url);
  const resizeResults=[],resizer=createNativeUiAssets({resolveAsset:async()=> 'blob:full-original'});
  resizer.request('fallback',url=>resizeResults.push(url),{resize:[640,360]});await tick();
  assert.deepEqual([canvases[0].width,canvases[0].height],[640,360]);assert.deepEqual(resizeResults,['blob:derived-1']);
  resizer.beginPage();assert.deepEqual(revoked,['blob:derived-1'],'Page changes revoke canvas-derived thumbnail URLs');
  deferBlob=true;resizer.request('old-fallback',url=>resizeResults.push(url),{resize:[640,360]});await tick();
  resizer.beginPage();finishBlob(new Blob(['late-thumbnail']));await tick();
  assert.equal(derivedIndex,1,'Stale canvas callbacks do not allocate a new object URL');
  resizer.dispose();
}finally{if(originalImage===undefined)delete globalThis.Image;else globalThis.Image=originalImage;if(originalObserver===undefined)delete globalThis.IntersectionObserver;else globalThis.IntersectionObserver=originalObserver;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;URL.createObjectURL=originalCreateUrl;URL.revokeObjectURL=originalRevokeUrl;}
console.log(JSON.stringify({passed:true,nativeCGs:354,nativeThumbnails:349,missingNativeThumbnails:5,recallThumbnails:15,boundedConcurrency:2,lazyLoading:true,stalePageResponsesDiscarded:true,derivedThumbnailUrlsReleased:true}));
