import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readReadingSettings,saveReadingSettings} from '../../private/story-player/src/reading-settings.js';
import {mergeTranslationDocument} from '../../private/story-player/src/translations.js';
import {validateImageManifest} from '../../private/story-player/src/localization-pack.js';
import {bindUnityFolder} from '../../private/story-player/src/unity-local.js';
import {MenuSounds} from '../../private/story-player/src/menu-sounds.js';
import {MediaController} from '../../private/story-player/src/media.js';
import {ProgramPlayer,validateProgramSnapshot} from '../../private/story-player/src/program-player.js';
import {installLocalization} from '../../scripts/xp2-adapter/install-localization.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url)),read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const results=[];async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
const appPath=path.join(repo,'private/story-player/src/app.js'),appSource=await fs.readFile(appPath,'utf8');
const ast=ts.createSourceFile(appPath,appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functionText=name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)?.getText(ast);
const listener=ast.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='window.addEventListener'&&node.expression.arguments[0]?.text==='message').expression.arguments[1].getText(ast);
const delay=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

await check('XP2 existing reading settings keep their old key; XP3 settings and map fold state remain independent',async()=>{
 const values=new Map([['xp2-reading-settings-1',JSON.stringify({textSpeed:37,masterVolume:.2})],['xp2-chapter-map-collapsed','true']]);
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 assert.equal(readReadingSettings(storage).textSpeed,37);assert.equal(readReadingSettings(storage,'xp3-reading-settings-1').textSpeed,20);
 saveReadingSettings({textSpeed:61},storage,'xp3-reading-settings-1');assert.equal(readReadingSettings(storage).textSpeed,37);assert.equal(readReadingSettings(storage,'xp3-reading-settings-1').textSpeed,61);
 const source=await fs.readFile(path.join(repo,'private/story-player/site-theme.js'),'utf8');
 function theme(gameId){const handlers={},toggle={setAttribute(){},addEventListener:(name,fn)=>{handlers[name]=fn;}},contents={hidden:false};const document={readyState:'complete',documentElement:{dataset:{gameId}},querySelector:()=>null,getElementById:id=>id==='mapFoldButton'?toggle:id==='mapContents'?contents:null};const window={location:{origin:'https://local.example'},addEventListener(){}};window.parent=window;vm.runInNewContext(source,{document,window,localStorage:storage});return {handlers,contents};}
 const xp2=theme('xp2'),xp3=theme('xp3');assert.equal(xp2.contents.hidden,true);assert.equal(xp3.contents.hidden,false);xp3.handlers.click();assert.equal(values.get('xp3-chapter-map-collapsed'),'true');xp2.handlers.click();assert.equal(values.get('xp2-chapter-map-collapsed'),'false');assert.equal(values.get('xp3-chapter-map-collapsed'),'true');
});

await check('real app fold handler authenticates host messages and keeps an async selected-folder bind paused after completion',async()=>{
 const gate=delay(),parent={},counts={pause:0,mediaStop:0,menuStop:0,frame:0,disposed:0};const player={playing:true,state:{sceneId:'neutral'},pause(){this.playing=false;counts.pause++;}},library={setLocalProvider(provider){this.provider=provider;}};
 const app={embeddedVisible:true,epoch:1,story:{id:'neutral'},library,player,unityIndex:{},config:{localGame:true},media:{stop:()=>counts.mediaStop++},menuSounds:{stop:()=>counts.menuStop++}};
 const window={parent,location:{origin:'https://local.example'}},nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const context=vm.createContext({app,window,document:{body:{dataset:{}}},previousFrame:5,$,status(){},cancelScrub(){},stopAuto(){},scheduleSave(){},currentResourceIds:()=>[],invalidateImages(){},render(){},requestAnimationFrame(){counts.frame++;},bindUnityFolder:async()=>gate.promise});
 const receive=vm.runInContext('('+listener+')',context);vm.runInContext(functionText('importAssets')+'\n'+functionText('frame'),context);
 receive({origin:'https://wrong.example',source:parent,data:{type:'knismolagnia-player-visibility',visible:false}});assert.equal(app.embeddedVisible,true);
 receive({origin:window.location.origin,source:{},data:{type:'knismolagnia-player-visibility',visible:false}});assert.equal(app.embeddedVisible,true);
 const importing=vm.runInContext('importAssets([])',context);receive({origin:window.location.origin,source:parent,data:{type:'knismolagnia-player-visibility',visible:false}});assert.equal(player.playing,false);
 const provider={resolve:async()=>true,dispose:()=>counts.disposed++};gate.resolve(provider);await importing;assert.equal(app.localReady,true);assert.equal(library.provider,provider);assert.equal(player.playing,false);assert.equal(counts.disposed,0);
 const beforeFrames={...counts};vm.runInContext('for(let index=0;index<1000;index++)frame(100+index*16)',context);assert.equal(counts.frame,1000);assert.equal(counts.mediaStop,beforeFrames.mediaStop);assert.equal(counts.menuStop,beforeFrames.menuStop);assert.equal(counts.pause,beforeFrames.pause);assert(counts.mediaStop>=2);receive({origin:window.location.origin,source:parent,data:{type:'knismolagnia-player-visibility',visible:true}});assert.equal(player.playing,false,'Unfolding must not auto-resume.');
});

await check('late menu decoding, pending media play and late metadata cannot restart audio after folding',async()=>{
 const gate=delay();let enabled=true,created=0;const sounds=new MenuSounds({asset:()=>({type:'audio'}),preload:()=>gate.promise,resolve:()=> 'blob:neutral'},{enabled:()=>enabled,createAudio:()=>{created++;return {};}});
 const pending=sounds.play({assetId:'click'});enabled=false;sounds.stop();gate.resolve();assert.equal(await pending,false);assert.equal(created,0);sounds.dispose();
 const play=delay();let pauses=0;const video={style:{},hidden:false,paused:true,readyState:0,pause(){this.paused=true;pauses++;},load(){},removeAttribute(){},play(){this.paused=false;return play.promise;}};
 const controller=new MediaController(video,{resolve:()=> 'blob:neutral'});controller.sync({sceneId:'neutral',video:{id:'video',asset:'neutral',startAt:0,playing:true},audio:[]});controller.stop();play.resolve();await tick();video.onloadedmetadata?.();assert.equal(video._desiredPlaying,false);assert.equal(video.paused,true);assert.equal(video.hidden,true);assert(pauses>0);controller.dispose();
});

const work=path.join(repo,'work');await fs.mkdir(work,{recursive:true});const scratch=await fs.mkdtemp(path.join(work,'game-isolation-audit-'));
try{
 const site=path.join(scratch,'site');const neutral={};
 for(const game of ['xp2','xp3']){
  const dir=game==='xp2'?'story-player':'story-player-xp3',data=path.join(site,'private',dir,'data');await fs.mkdir(data,{recursive:true});
  const fingerprint='neutral-'+game,story={type:'story-player',schemaVersion:1,id:game,gameFingerprint:fingerprint,texts:[{id:'same-id',source:'Neutral original'}]},index={gameFingerprint:fingerprint,assets:{same:{kind:'texture',width:2,height:2}}},translations={type:'story-translations',schemaVersion:2,gameFingerprint:fingerprint,translations:[]};neutral[game]={story,index,translations,data};
  for(const [name,value]of Object.entries({'story.json':story,'unity-index.json':index,'translations.json':translations,'player-config.json':{gameId:game,translationPending:game==='xp3'},'image-overrides.json':{type:'xp2-image-overrides',schemaVersion:1,gameFingerprint:fingerprint,images:[]}}))await fs.writeFile(path.join(data,name),JSON.stringify(value));
  await fs.writeFile(path.join(site,'private',dir,'index.html'),game+' html');await fs.mkdir(path.join(site,'private',dir,'src'),{recursive:true});await fs.writeFile(path.join(site,'private',dir,'src/game-shell-data.js'),game+' catalogue');
 }
 await fs.writeFile(path.join(site,'private/story-player/src/app.js'),'shared runtime');await fs.writeFile(path.join(site,'private/story-player/site-theme.css'),'shared theme');
 await check('XP3 file route shares only runtime/interface, while index/data/catalogue/image paths never fall back to XP2',async()=>{
  const file=path.join(repo,'src/app/level/[level]/player/[...path]/route.ts'),source=await fs.readFile(file,'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
  const context={exports,require:name=>name==='node:fs/promises'?fs:name==='node:path'?{default:path}:name==='@/lib/auth'?{requireLevel:async()=>{}}:name==='@/lib/local-design-mode'?{isLocalDesignMode:async()=>true}:{isLevelSixPublic:()=>true,preventLevelSixCaching(){}},process:{cwd:()=>site},Request,Response,Headers};
  vm.runInNewContext(compiled,context);const get=parts=>exports.GET(new Request('https://local.example/level/6/player/'+parts.join('/')),{params:Promise.resolve({level:'6',path:parts})});
  for(const [parts,text]of [[['index.html'],'xp2 html'],[['xp3','index.html'],'xp3 html'],[['xp3','src','app.js'],'shared runtime'],[['xp3','src','game-shell-data.js'],'xp3 catalogue'],[['xp3','site-theme.css'],'shared theme']]){const response=await get(parts);assert.equal(response.status,200);assert.equal(await response.text(),text);}
  await fs.writeFile(path.join(site,'private/story-player/data/xp2-only.json'),'old data');assert.equal((await get(['xp3','data','xp2-only.json'])).status,404);await fs.unlink(path.join(site,'private/story-player-xp3/src/game-shell-data.js'));assert.equal((await get(['xp3','src','game-shell-data.js'])).status,404);
  for(const parts of [['xp3'],['xp3','..','data','story.json'],['xp3','%2e%2e','data','story.json'],['xp3','data','story.json/other']])assert.equal((await get(parts)).status,404);
 });
 await check('localization installer rejects cross-game fingerprints even when IDs match; --game xp3 changes only XP3 files',async()=>{
  const entry={id:'same-id',source:'Neutral original',translation:'Neutral localized',status:'translated',note:''};const xp2=path.join(scratch,'xp2-translation.json'),xp3=path.join(scratch,'xp3-translation.json');await fs.writeFile(xp2,JSON.stringify({...neutral.xp2.translations,translations:[entry]}));await fs.writeFile(xp3,JSON.stringify({...neutral.xp3.translations,translations:[entry]}));
  const xp2Before=await fs.readFile(path.join(neutral.xp2.data,'translations.json')),xp3Before=await fs.readFile(path.join(neutral.xp3.data,'translations.json'));
  await assert.rejects(installLocalization({root:site,game:'xp3',translationPath:xp2}),/版本不匹配/);assert.deepEqual(await fs.readFile(path.join(neutral.xp3.data,'translations.json')),xp3Before);
  assert.throws(()=>validateImageManifest({type:'xp2-image-overrides',schemaVersion:1,gameFingerprint:neutral.xp2.index.gameFingerprint,images:[{assetId:'same',path:'neutral.png'}]},neutral.xp3.index),/指纹不匹配/);
  const plan=await installLocalization({root:site,game:'xp3',translationPath:xp3});assert.equal(plan.game,'xp3');assert.equal(plan.apply,false);assert.deepEqual(await fs.readFile(path.join(neutral.xp3.data,'translations.json')),xp3Before);
  await installLocalization({root:site,game:'xp3',translationPath:xp3,apply:true,backupPath:path.join(scratch,'backup')});assert.deepEqual(await fs.readFile(path.join(neutral.xp2.data,'translations.json')),xp2Before);assert.equal((await read(path.join(neutral.xp3.data,'player-config.json'))).translationPending,false);
  assert.equal((await read(path.join(neutral.xp3.data,'translations.json'))).translations[0].translation,entry.translation);await assert.rejects(installLocalization({root:site,game:'other',translationPath:xp3}),/xp2.*xp3/);
 });
 await check('selected local folder rejects same-size files with the other fingerprint before creating a provider',async()=>{
  const expected=new Uint8Array([1,2,3,4]),wrong=new File([new Uint8Array([4,3,2,1])],'data.unity3d');const index={type:'xp2-unity-local-index',schemaVersion:1,gameName:'Neutral XP3',gameVersion:'1',files:[{path:'data.unity3d',size:4,samples:[{offset:0,length:4,sha256:createHash('sha256').update(expected).digest('hex')}]}],assets:{},bundle:{file:'data.unity3d',blocks:[{compressedOffset:0,compressedSize:4,uncompressedOffset:0,uncompressedSize:4,compression:0}]}};
  await assert.rejects(bindUnityFolder([wrong],index),/不符/);const provider=await bindUnityFolder([new File([expected],'data.unity3d')],index);assert.equal(provider.files.size,1);provider.dispose();
 });
}finally{const resolved=await fs.realpath(scratch);assert(resolved.startsWith(await fs.realpath(work)+path.sep));await fs.rm(resolved,{recursive:true,force:true});}

await check('real XP2/XP3 identities, native catalogue imports and translation scopes remain distinct',async()=>{
 const paths=game=>path.join(repo,'private',game==='xp2'?'story-player':'story-player-xp3'),xp2=await read(path.join(paths('xp2'),'data/story.json')),xp3=await read(path.join(paths('xp3'),'data/story.json'));assert.notEqual(xp2.id,xp3.id);assert.notEqual(xp2.gameFingerprint,xp3.gameFingerprint);
 const tr2=await read(path.join(paths('xp2'),'data/translations.json')),tr3=await read(path.join(paths('xp3'),'data/translations.json'));assert.throws(()=>mergeTranslationDocument(xp3,tr3,tr2),/版本不匹配/);assert.throws(()=>mergeTranslationDocument(xp2,tr2,tr3),/版本不匹配/);
 const config=await read(path.join(paths('xp3'),'data/player-config.json'));assert.equal(config.gameId,'xp3');assert.equal(config.translationPending,true);assert.match(await fs.readFile(path.join(paths('xp3'),'index.html'),'utf8'),/data-game-id="xp3"/);
 const base=path.join(paths('xp2'),'src'),source=(await fs.readFile(path.join(base,'game-shell.js'),'utf8')).replace("'./game-shell-data.js'",JSON.stringify(pathToFileURL(path.join(paths('xp3'),'src/game-shell-data.js')).href)).replace("'./native-ui-assets.js'",JSON.stringify(pathToFileURL(path.join(base,'native-ui-assets.js')).href));
 const {buildNativeCatalog}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')),index=await read(path.join(paths('xp3'),'data/unity-index.json')),catalog=buildNativeCatalog(xp3,index);assert.equal(catalog.recalls.length,17);assert.equal(catalog.recalls.filter(item=>item.sceneId).length,17,'All native XP3 recalls must resolve to an actual scene.');assert.equal(catalog.images.length,319,'Preview-only native CGs must remain visible without a jump target.');
});

await check('the real XP2 legacy progress restores in the shared runtime and cannot restore into XP3',async()=>{
 const xp2=await read(path.join(repo,'private/story-player/data/story.json')),xp3=await read(path.join(repo,'private/story-player-xp3/data/story.json'));
 const legacy=await read(path.join(repo,'verification/xp2-player-2026-10-23/fixtures/program-1.1-chapter26.json')),native=await read(path.join(repo,'private/story-player/data/native-presentation.json'));
 const player=new ProgramPlayer(xp2,{nativeEffects:native});try{player.restore(legacy);const saved=player.snapshot();assert.equal(saved.storyId,xp2.id);assert.equal(saved.programRevision,legacy.programRevision);assert.equal(saved.reader.sceneId,legacy.reader.sceneId);assert.equal(saved.reader.stageTime,legacy.reader.stageTime);assert.equal(saved.reader.cursor,legacy.reader.cursor);assert.deepEqual(saved.reader.executions,legacy.reader.executions);assert.deepEqual(saved.reader.wait,legacy.reader.wait);assert.equal('nativeTimingRevision' in saved,false);validateProgramSnapshot(xp2,saved);assert.throws(()=>validateProgramSnapshot(xp3,saved),/版本不匹配/);}finally{player.dispose();}
});

console.log(JSON.stringify({passed:results.filter(result=>result.passed).length,total:results.length,results,scope:'Node/VM source execution and temporary neutral fixtures; no browser, narrative text or CG pixels.'},null,2));if(results.some(result=>!result.passed))process.exitCode=1;
