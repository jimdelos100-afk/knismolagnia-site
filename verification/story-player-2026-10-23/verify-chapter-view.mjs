import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGraphView} from '../../private/story-player/src/graph-view.js';

// This DOM fixture verifies bounded rendering and asynchronous ownership, not pixel layout.
let created=0;
class Element{
  constructor(tag){this.tagName=tag.toLowerCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.style={setProperty(){},removeProperty(){}};this.className='';this.value='';this._text='';this.listeners=new Map();created++;}
  get classList(){return{add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/),...names])].filter(Boolean).join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');},contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,on)=>{const list=this.classList,present=list.contains(name);if(on??!present)list.add(name);else list.remove(name);}};}
  set textContent(value){for(const child of this.children)child.parentElement=null;this.children=[];this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){if(node.tagName==='#fragment'){this.append(...[...node.children]);continue;}node.remove();node.parentElement=this;this.children.push(node);}}
  prepend(node){node.remove();node.parentElement=this;this.children.unshift(node);}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentElement){const siblings=this.parentElement.children,index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);this.parentElement=null;}}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  matches(selector){return selector[0]==='.'?this.classList.contains(selector.slice(1)):this.tagName===selector.toLowerCase();}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false;}
  closest(selector){for(let current=this;current;current=current.parentElement)if(current.matches(selector))return current;return null;}
  addEventListener(type,callback,options={}){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push({callback,options});}
  fire(type,target=this){for(let current=this;current;current=current.parentElement)for(const listener of current.listeners.get(type)||[]){if(!listener.options.signal?.aborted)listener.callback({target,key:undefined});}}
  get open(){return!!this._open;}
  set open(value){if(!!value===this.open)return;this._open=!!value;queueMicrotask(()=>this.fire('toggle'));}
  scrollIntoView(){}
}
globalThis.document={createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('#fragment')};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),folder=path.join(root,'private/story-player/data/chapter-map');
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
const models=new Map(await Promise.all(manifest.chapters.map(async chapter=>[chapter.id,JSON.parse(await fs.readFile(path.join(folder,chapter.file),'utf8'))])));
const tick=async()=>{for(let step=0;step<5;step++)await Promise.resolve();};
const get=(container,className)=>container.querySelector(`.${className}`),click=(container,node)=>container.fire('click',node);
const chapterSelect=container=>container.querySelectorAll('select').find(node=>node.attributes['aria-label']==='选择要浏览的剧情章节');
const choose=(container,key)=>{const select=chapterSelect(container);select.value=key;select.fire('change');};
const ids=Object.keys(manifest.sceneToChapter),largest=manifest.chapters.reduce((a,b)=>a.sceneCount>b.sceneCount?a:b),largestModel=models.get(largest.id);
const calls=[],container=new Element('div');let view;
view=createGraphView(container,manifest,{loadChapter:async key=>{calls.push(key);return models.get(key);},onNavigate:async id=>view.setCurrent(id,new Set([id]))});
view.setCurrent(largest.entrySceneId,new Set([largest.entrySceneId]));assert.equal(await view.ready,true,container.textContent);await tick();
assert.equal(get(container,'chapter-segment-text').querySelector('strong').textContent,largestModel.segments[0].displayLabel||largestModel.segments[0].label);assert.equal(get(container,'chapter-segment-summary').title,largestModel.segments[0].label);if(largestModel.segments[0].displayLabel)assert.equal(get(container,'chapter-inspector-title').textContent,largestModel.segments[0].displayLabel);
assert.ok(get(container,'chapter-route-list').textContent.includes('条件成立'));assert.equal(get(container,'chapter-route-list').textContent.includes('vs3rd_storyCnt'),false);assert.ok(container.querySelectorAll('.chapter-route-button').some(button=>button.title.includes('vs3rd_storyCnt')));
assert.deepEqual(calls,[largest.id],'restoring a chapter must skip the unused opening request');
assert.equal(view.layoutSummary.nodes,129);assert.equal(view.layoutSummary.renderedSegments,12);assert.equal(view.layoutSummary.renderedScenes,0);assert.equal(container.querySelectorAll('svg').length,0);assert.ok(container.querySelectorAll('li').length<=18);
const originalDetails=container.querySelector('details'),initialCreated=created,visited=new Set([largest.entrySceneId]);view.setCurrent(largest.entrySceneId,visited);const afterFirst=created;
for(let frame=0;frame<1000;frame++)view.setCurrent(largest.entrySceneId,visited);
assert.equal(created,afterFirst,'typewriter frames must not rebuild the map');assert.equal(container.querySelector('details'),originalDetails);assert.equal(calls.length,1);assert.ok(afterFirst>=initialCreated);
// Same-sized imported visited sets must replace markers, not be mistaken for unchanged progress.
const visibleRows=container.querySelectorAll('.chapter-segment'),firstId=largestModel.segments[0].sceneIds[0],secondId=largestModel.segments[1].sceneIds[0];
view.setCurrent(largest.entrySceneId,new Set([firstId]));assert.ok(visibleRows[0].classList.contains('is-visited'));
view.setCurrent(largest.entrySceneId,new Set([secondId]));assert.equal(visibleRows[0].classList.contains('is-visited'),false);assert.ok(visibleRows[1].classList.contains('is-visited'));
// Only the requested page and one opened segment retain detailed scene buttons.
const pageButtons=container.querySelectorAll('.chapter-phase-button');click(container,pageButtons.at(-1));assert.ok(view.layoutSummary.renderedSegments<=12);const details=container.querySelectorAll('details');details[0].open=true;await tick();assert.ok(container.querySelectorAll('.chapter-scene-button').length>0);if(details[1]){details[1].open=true;await tick();assert.equal(details[0].open,false);assert.equal(details[0].querySelector('.chapter-scene-list'),null);}
for(const scene of largestModel.scenes){assert.equal(await view.focusScene(scene.id),true);await tick();assert.ok(container.querySelectorAll('.chapter-scene-button').some(button=>button.dataset.sceneId===scene.id));assert.ok(view.layoutSummary.renderedSegments<=12);assert.ok(container.querySelectorAll('.chapter-scene-list').length<=1);}
const target=largestModel.scenes.at(-1).id,sceneButton=container.querySelectorAll('.chapter-scene-button').find(button=>button.dataset.sceneId===target);click(container,sceneButton);await tick();assert.ok(get(container,'chapter-map-location').textContent.includes(largest.title));
// Browsing another chapter pins that view while playback continues; Current resumes following.
const another=manifest.chapters.find(item=>item.id!==largest.id);choose(container,another.id);await view.ready;view.setCurrent(largestModel.scenes[1].id,new Set());assert.equal(view.layoutSummary.chapterId,another.id);
click(container,container.querySelectorAll('button').find(button=>button.dataset.action==='current'));await tick();await view.ready;assert.equal(view.layoutSummary.chapterId,largest.id);
for(const item of manifest.chapters){choose(container,item.id);await view.ready;assert.ok(view.layoutSummary.cachedChapters<=2);assert.ok(view.layoutSummary.renderedSegments<=12);}
let totalFocusChecks=0;for(const item of manifest.chapters){const data=models.get(item.id);for(const scene of data.scenes){assert.equal(await view.focusScene(scene.id),true);await tick();assert.ok(container.querySelectorAll('.chapter-scene-button').some(button=>button.dataset.sceneId===scene.id));assert.ok(view.layoutSummary.renderedSegments<=12);assert.ok(container.querySelectorAll('.chapter-scene-list').length<=1);totalFocusChecks++;}}assert.equal(totalFocusChecks,ids.length);
view.dispose();assert.equal(container.children.length,0);
// A slow old request cannot replace the latest selected chapter. Pending fetches stay serial.
const raceRoot=new Element('div'),pending=[],raceCalls=[];let inFlight=0,maxInFlight=0;
const race=createGraphView(raceRoot,manifest,{loadChapter:key=>{raceCalls.push(key);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);return new Promise((resolve,reject)=>pending.push({key,resolve:value=>{inFlight--;resolve(value);},reject:error=>{inFlight--;reject(error);}}));}});
race.setCurrent(largest.entrySceneId,new Set());const candidates=manifest.chapters.filter(item=>item.id!==largest.id),middle=candidates[0],last=candidates[1];choose(raceRoot,middle.id);choose(raceRoot,last.id);assert.equal(raceCalls.length,1);pending.shift().resolve(models.get(largest.id));await tick();assert.deepEqual(raceCalls,[largest.id,last.id]);pending.shift().resolve(models.get(last.id));assert.equal(await race.ready,true);assert.equal(race.layoutSummary.chapterId,last.id);assert.equal(maxInFlight,1);
// A load failure offers a real retry and disposal prevents a late render.
choose(raceRoot,middle.id);pending.shift().reject(new Error('fixture failure'));assert.equal(await race.ready,false);await tick();const retry=raceRoot.querySelectorAll('button').find(button=>button.dataset.action==='retry');assert.ok(retry);click(raceRoot,retry);pending.shift().resolve(models.get(middle.id));assert.equal(await race.ready,true);
const remaining=candidates.find(item=>item.id!==middle.id&&item.id!==last.id);choose(raceRoot,remaining.id);race.dispose();pending.shift().resolve(models.get(remaining.id));await tick();assert.equal(raceRoot.children.length,0);
console.log(JSON.stringify({passed:true,maxChapterScenes:largest.sceneCount,maxSummaryCards:12,sceneFocusChecks:totalFocusChecks,startupChapterRequests:calls[0]===largest.id?1:0,typewriterFramesWithoutRebuild:1000,maxConcurrentLoads:maxInFlight,cacheLimit:2,staleLoadsIgnored:true,retryAndDisposal:true},null,2));


