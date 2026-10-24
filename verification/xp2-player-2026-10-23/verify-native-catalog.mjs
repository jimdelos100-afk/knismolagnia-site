import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildNativeCatalog} from '../../private/story-player/src/game-shell.js';
import {NATIVE_RECALLS,NATIVE_CGS} from '../../private/story-player/src/game-shell-data.js';
import {ReaderPlayer} from '../../private/story-player/src/reader.js';

const read=name=>readFile(new URL('../../private/story-player/data/'+name,import.meta.url),'utf8').then(JSON.parse);
const [story,index]=await Promise.all([read('story.json'),read('unity-index.json')]);
const catalog=buildNativeCatalog(story,index),scenes=new Map(story.scenes.map(scene=>[scene.id,scene])),texts=new Set(story.texts.map(text=>text.id));
const reader=new ReaderPlayer(story),failures=[],segmentOnly=[];let currentSceneId,recallChecks=0,cgChecks=0,renderedFrames=0;
try{
  assert.equal(NATIVE_RECALLS.length,15);assert.equal(catalog.recalls.length,15);assert.equal(NATIVE_CGS.length,354);assert.equal(catalog.images.length,354);assert.equal(new Set(catalog.images.map(image=>image.id)).size,354);
  for(const recall of catalog.recalls){
    try{const scene=scenes.get(recall.sceneId);assert.ok(scene,`${recall.id}: unknown scene`);assert.equal(scene.archive,undefined);assert.equal(scene.title,recall.scenario);assert.ok(texts.has(recall.titleId),`${recall.id}: unknown translated title`);assert.ok(Object.values(story.program.nodes).some(node=>node.sceneId===scene.id),`${recall.id}: no program node`);recallChecks++;}
    catch(error){failures.push({id:recall.id,error:error.message});}
  }
  for(const image of catalog.images){
    try{
      const original=NATIVE_CGS[image.number-1],scene=scenes.get(image.sceneId),asset=index.assets[image.assetId];assert.equal(image.file,original.file);assert.equal(image.label,original.label);assert.ok(scene,`${image.id}: unknown scene`);assert.equal(scene.archive,undefined);assert.ok(asset,`${image.id}: missing native asset`);assert.equal(asset.kind,'texture');assert.ok(asset.width>0&&asset.height>0);assert.match(image.resourcePath,/^texture\/event\//);assert.deepEqual(index.resourcePaths[image.resourcePath],[image.assetId]);assert.ok(Number.isInteger(image.eventIndex)&&image.eventIndex>=0&&image.eventIndex<scene.events.length,`${image.id}: event index is out of range`);assert.equal(scene.events[image.eventIndex].asset,image.assetId,`${image.id}: event index does not draw the expected native CG`);
      if(image.recallId)assert.ok(catalog.recalls.some(recall=>recall.id===image.recallId));
      if(image.exactDialogue===false){
        assert.equal(image.dialogueIndex,undefined,`${image.id}: transient CG must not claim an exact dialogue position`);segmentOnly.push({id:image.id,file:image.file,sceneId:image.sceneId,assetId:image.assetId});
      }else{
        assert.equal(image.exactDialogue,true,`${image.id}: destination must explicitly declare its accuracy`);const commands=scene.commands.filter(command=>command.type==='dialogue');assert.ok(Number.isInteger(image.dialogueIndex)&&image.dialogueIndex>=0&&image.dialogueIndex<commands.length,`${image.id}: dialogue index is out of range`);
        if(currentSceneId!==scene.id){reader.enter(scene.id);currentSceneId=scene.id;}
        const frame=reader.previewDialogue(image.dialogueIndex),visible=[...(frame.background?.asset&&frame.background.opacity>0?[frame.background.asset]:[]),...frame.characters.filter(actor=>actor.opacity>0).map(actor=>actor.asset)];assert.ok(visible.includes(image.assetId),`${image.id}: target CG is already replaced at dialogue ${image.dialogueIndex}; actual ${visible.join(', ')}`);assert.equal(frame.dialogue.index,image.dialogueIndex);assert.equal(frame.dialogue.textComplete,true);renderedFrames++;
      }
      cgChecks++;
    }catch(error){failures.push({id:image.id,file:image.file,sceneId:image.sceneId,dialogueIndex:image.dialogueIndex,error:error.message});}
  }
}catch(error){failures.push({id:'catalog-counts',error:error.message});}
reader.dispose();
console.log(JSON.stringify({passed:failures.length===0,nativeRecalls:15,recallEntriesChecked:recallChecks,nativeCGs:354,cgEntriesChecked:cgChecks,exactDialogueTargets:renderedFrames,segmentOnlyTargets:segmentOnly.length,segmentOnly,failures},null,2));
if(failures.length)process.exitCode=1;
