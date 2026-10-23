import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createPlayer,validatePlaybackStory,graphStory} from '../../private/story-player/src/playback.js';
import {mergeTranslationDocument} from '../../private/story-player/src/translations.js';
import {createProgress,parseProgress} from '../../private/story-player/src/progress.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>readFile(path.join(root,'private/story-player/data',name),'utf8').then(JSON.parse);
const [story,translations,index,report]=await Promise.all(['story.json','translations.json','unity-index.json','adapter-report.json'].map(read));
const start=performance.now();validatePlaybackStory(story);
const merged=mergeTranslationDocument(story,null,translations);
assert.equal(merged.matched,10173);assert.equal(merged.pending,0);
assert.equal(report.displayedDialogueCount,5614);assert.equal(report.selectionLabelCount,35);
assert.equal(report.nativeCommandTextFields,1021);assert.equal(Object.keys(report.unresolved).length,0);
for(const asset of story.assets)assert.ok(index.assets[asset.id],`Missing local asset ${asset.id}`);
const source=new Map(story.texts.map(text=>[text.id,text.source]));
for(const scene of story.scenes)for(const event of scene.events){
  if(event.type==='dialogue')assert.ok(!/^(backChange|sceneChange)\s/.test(source.get(event.textId)||''),'Command annotation became dialogue');
}
const player=createPlayer(story),maps=graphStory(story).scenes;
assert.equal(maps.length,351);
for(const entry of maps){player.enter(entry.id);assert.ok(story.scenes.some(scene=>scene.id===player.state.sceneId));}
player.enter(story.startScene);const snapshot=player.snapshot();
const progress=createProgress(story,player.state,new Set(),{reader:snapshot});parseProgress(story,progress);
const wrong=structuredClone(progress);wrong.gameFingerprint='wrong-version';assert.throws(()=>parseProgress(story,wrong));
console.log(JSON.stringify({valid:true,chapters:56,mapEntries:maps.length,clips:story.scenes.length,localMedia:story.assets.length,matchedTranslations:merged.matched,dialogues:report.displayedDialogueCount,selectionLabels:report.selectionLabelCount,mapEntriesChecked:maps.length,saveImport:true,wrongVersionRejected:true,elapsedMs:Math.round(performance.now()-start)},null,2));
player.dispose();
