/* Owned local browser only. Exact neutral pixels; does not mutate model/website inputs. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/daisy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {loadAcceptedAppearance,comparePixels,originalDeltaMatches}=require('./accepted-appearance-contract.cjs');
const modelArg=process.argv.find(a=>a.endsWith('.model3.json'));
if(!modelArg||process.argv.includes('--prepare')){console.log('Prepared: node work/verify-native-neutral-pixels.cjs <final.model3.json> after coverage passes and root marks export ready. --self-test uses work-only output.');process.exit(0);}
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const model=path.resolve(modelArg),selfTest=process.argv.includes('--self-test');
const out=path.resolve(selfTest?'work/native-live2d-2026-10-15-qa/pixel-self-test':'outputs/native-live2d-2026-10-15-verification');
const roots={old:path.resolve('work/native-live2d-2026-10-15-qa/original-detailed-baseline'),candidate:path.dirname(model),public:path.resolve('work/v8-source/knismolagnia-site/public')};
const policy=readJSON('work/native-live2d-2026-10-15-qa/final-neutral-policy.json');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.png':'image/png','.vert':'text/plain','.frag':'text/plain'};
const report={date:new Date().toISOString(),selfTest,scope:'Independent default Core geometry rendered through the same SDK/WebGL settings. No host appearance layers, mouse offsets, automatic blink, motions, or physics. The original strict-zero result remains explicit in strictOriginalResult. When a specific human-accepted eye contract exists, identity and frozen-reference regression require exact hashes and zero additional RGBA changes, with every pixel outside the eye rectangle still exactly original. Source-composite evidence remains separately mandatory.',policy,originalModel:path.join(roots.old,'character.model3.json'),newModel:model,checks:[],errors:[]};
let browser;
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/'){res.setHeader('Content-Type',mime['.html']);res.end('<!doctype html><meta charset="utf-8"><title>Exact neutral comparison</title><style>body{margin:0;font:16px system-ui;background:#ede8f2}#pair{display:flex}figure{margin:0;width:512px}canvas{width:512px;height:768px;display:block;background:repeating-conic-gradient(#fff 0% 25%,#eee 0% 50%) 50%/24px 24px}</style><div id="pair"><figure>Original neutral<canvas id="old"></canvas></figure><figure>Exported native neutral<canvas id="candidate"></canvas></figure></div>');return;}
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const mount=u.pathname.startsWith('/old/')?'old':u.pathname.startsWith('/candidate/')?'candidate':'public';
 const relative=mount==='public'?u.pathname.slice(1):u.pathname.slice(mount.length+2),base=roots[mount],file=path.resolve(base,decodeURIComponent(relative));
 if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);});
});
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 for(const [key,file]of[['original',report.originalModel],['new',model]]){const json=readJSON(file),base=path.dirname(file);report[key+'MocSha256']=hash(fs.readFileSync(path.resolve(base,json.FileReferences.Moc)));report[key+'TextureSha256']=json.FileReferences.Textures.map(ref=>hash(fs.readFileSync(path.resolve(base,ref))));}
 check('original is the frozen detailed model',report.originalMocSha256===policy.originalMocSha256,report.originalMocSha256);
 const snapshot=path.resolve('outputs/native-live2d-2026-10-15-verification/tested-source-snapshot.json');report.testedSourceSnapshotSha256=fs.existsSync(snapshot)?hash(fs.readFileSync(snapshot)):null;
 const accepted=selfTest?null:loadAcceptedAppearance(policy,{mocSha256:report.newMocSha256,textureSha256:report.newTextureSha256});
 if(accepted){report.acceptedAppearance={contractFile:accepted.file,contractSha256:accepted.sha256,bindingsValid:accepted.valid,issues:accepted.issues,authorization:accepted.contract?.authorization};check('accepted model identity and frozen approval references are exact',accepted.valid,report.acceptedAppearance);}
 if(!selfTest){const coverageFile=path.join(out,'native-eye-coverage.json');if(fs.existsSync(coverageFile)){const coverage=readJSON(coverageFile);report.coverageEvidence={file:coverageFile,sha256:hash(fs.readFileSync(coverageFile)),newMocSha256:coverage.newMocSha256,sourceCompositeChangedRGBAPixels:coverage.sourceCompositeChangedRGBAPixels};check('source-pixel coverage evidence passes for this same exported MOC',coverage.newMocSha256===report.newMocSha256&&coverage.checks?.length>0&&coverage.checks.every(c=>c.pass)&&Array.isArray(coverage.errors)&&coverage.errors.length===0,report.coverageEvidence);check('updated source PSD neutral merge is exactly the original',coverage.sourceCompositeChangedRGBAPixels===0&&policy.strictSourceCompositeChangedRGBAPixels===0,coverage.sourceCompositeChangedRGBAPixels);}else check('same-MOC source-pixel coverage evidence exists',false,coverageFile);}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1024,height:795}});page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const result=await page.evaluate(async candidateName=>{
  const {createLive2DRenderer}=await import('/konisi-game/live2d/renderer.mjs');const renderers=[],buffers=[],width=1024,height=1536;
  for(const [id,file]of[['old','character.model3.json'],['candidate',candidateName]]){
   const r=await createLive2DRenderer({canvas:document.getElementById(id),modelUrl:'/'+id+'/'+file,width,height,dpr:1,preserveDrawingBuffer:true});
   r.setCamera({focus:[512,768],zoom:1,padding:1});r.setPhysicsEnabled(false);r.setAnimationEnabled(false);r.setGaze(0,0,{enabled:false});
   for(const p of r.getParameters())r.setParameterById(p.id,p.default);r.update(0);r.draw();
   const bytes=new Uint8Array(width*height*4);r.gl.readPixels(0,0,width,height,r.gl.RGBA,r.gl.UNSIGNED_BYTE,bytes);buffers.push(bytes);renderers.push(r);
  }
  let changed=0,maximum=0,total=0,alphaChanged=0,oldNontransparent=0,newNontransparent=0;const examples=[],bounds={left:width,top:height,right:-1,bottom:-1};
  const diff=document.createElement('canvas');diff.width=width;diff.height=height;const context=diff.getContext('2d'),image=context.createImageData(width,height);
  for(let i=0;i<buffers[0].length;i+=4){let error=0;for(let k=0;k<4;k++){const d=Math.abs(buffers[0][i+k]-buffers[1][i+k]);error=Math.max(error,d);maximum=Math.max(maximum,d);total+=d;}if(buffers[0][i+3])oldNontransparent++;if(buffers[1][i+3])newNontransparent++;if(buffers[0][i+3]!==buffers[1][i+3])alphaChanged++;if(!error)continue;
   changed++;const x=(i/4)%width,y=height-1-Math.floor(i/4/width),j=(y*width+x)*4;bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);bounds.right=Math.max(bounds.right,x);bounds.bottom=Math.max(bounds.bottom,y);image.data[j]=255;image.data[j+1]=Math.max(0,255-error*16);image.data[j+3]=255;if(examples.length<12)examples.push({x,y,original:Array.from(buffers[0].slice(i,i+4)),candidate:Array.from(buffers[1].slice(i,i+4))});
  }
  context.putImageData(image,0,0);
  const base64=bytes=>{let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(binary);};
  return {rawOriginalBase64:base64(buffers[0]),rawCandidateBase64:base64(buffers[1]),comparison:{width,height,exactPixelMatch:changed===0,changedRGBAPixels:changed,maximumChannelError:maximum,totalChannelError:total,alphaChanged,oldNontransparent,newNontransparent,changedBounds:changed?bounds:null,examples},status:renderers.map(r=>r.getStatus()),parameters:renderers.map(r=>r.getParameters()),neutralImages:renderers.map(r=>r.canvas.toDataURL()),differenceImage:diff.toDataURL()};
 },encodeURIComponent(path.basename(model)));
 report.comparison=result.comparison;report.comparison.representation='premultiplied WebGL framebuffer RGBA from actual gl.readPixels unsigned bytes';report.rendererStatus=result.status;report.parameters=result.parameters;
 const sharp=require('./v8-source/knismolagnia-site/node_modules/sharp');
 const decodedPNGs=await Promise.all(result.neutralImages.map(url=>sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer()));
 const bottomUp=bytes=>{const output=Buffer.alloc(bytes.length);for(let y=0;y<1536;y++)bytes.copy(output,(1535-y)*4096,y*4096,(y+1)*4096);return output;};
 report.pngStraightComparison={representation:'straight (unpremultiplied) RGBA decoded from original and candidate neutral PNGs',...comparePixels(bottomUp(decodedPNGs[0]),bottomUp(decodedPNGs[1]))};
 check('both neutral models render nonempty artwork',result.comparison.oldNontransparent>10000&&result.comparison.newNontransparent>10000,result.comparison);
 report.strictOriginalResult={pass:result.comparison.changedRGBAPixels===0&&policy.strictFinalWebGLChangedRGBAPixels===0,opacityPass:result.comparison.alphaChanged===0,comparison:result.comparison};
 if(accepted){
  const rawOriginal=Buffer.from(result.rawOriginalBase64,'base64'),rawCandidate=Buffer.from(result.rawCandidateBase64,'base64');
  report.actualNeutralRawRGBASha256=hash(rawCandidate);
  report.outsideEyeComparison=comparePixels(rawOriginal,rawCandidate,accepted.contract.acceptedEyeRectangleHalfOpen);
  report.acceptedReferenceRegression=accepted.referenceRaw?comparePixels(accepted.referenceRaw,rawCandidate):null;
  report.historicalStrictOriginalResult=accepted.contract.historicalStrictOriginalResult;
  check('measured original difference is exactly the disclosed user-accepted eye difference',accepted.valid&&originalDeltaMatches(accepted.contract,result.comparison)&&report.originalMocSha256===accepted.contract.originalMocSha256,result.comparison);
  check('displayed PNG straight RGBA difference is separately disclosed exactly',accepted.valid&&originalDeltaMatches({originalDifference:accepted.contract.originalPNGStraightDifference},report.pngStraightComparison),report.pngStraightComparison);
  check('every RGBA channel outside the accepted eye rectangle stays exactly original',accepted.valid&&report.outsideEyeComparison.exactPixelMatch&&report.outsideEyeComparison.alphaChanged===0,report.outsideEyeComparison);
  check('actual WebGL RGBA is exactly the frozen accepted reference with zero additional changes',accepted.valid&&report.acceptedReferenceRegression?.exactPixelMatch&&hash(rawCandidate)===accepted.contract.referenceRawRGBA.decompressedSha256,report.acceptedReferenceRegression);
  check('neutral PNG is byte-exact to the frozen user-accepted neutral snapshot',accepted.valid&&hash(Buffer.from(result.neutralImages[1].split(',')[1],'base64'))===accepted.contract.referencePNG.sha256);
 }else{
  check('default WebGL neutral RGBA is exactly original at source resolution',report.strictOriginalResult.pass,result.comparison);
  check('default opacity coverage is exactly original',report.strictOriginalResult.opacityPass,result.comparison.alphaChanged);
 }
 const files=['native-neutral-original.png','native-neutral-final.png'];for(let i=0;i<files.length;i++)fs.writeFileSync(path.join(out,files[i]),Buffer.from(result.neutralImages[i].split(',')[1],'base64'));
 fs.writeFileSync(path.join(out,'native-neutral-difference.png'),Buffer.from(result.differenceImage.split(',')[1],'base64'));
 await page.screenshot({path:path.join(out,'native-neutral-comparison.png')});
 check('no browser JavaScript or resource errors',report.errors.length===0,report.errors);
 if(accepted){
  const names=['accepted model identity and frozen approval references are exact','measured original difference is exactly the disclosed user-accepted eye difference','displayed PNG straight RGBA difference is separately disclosed exactly','every RGBA channel outside the accepted eye rectangle stays exactly original','actual WebGL RGBA is exactly the frozen accepted reference with zero additional changes','neutral PNG is byte-exact to the frozen user-accepted neutral snapshot','no browser JavaScript or resource errors'];
  const regression={date:new Date().toISOString(),scope:'User accepted only this exact displayed eye rendering. This report preserves the failed original strict-zero result, requires strict zero outside the eye rectangle and strict zero regression against a frozen actual GPU RGBA reference. It introduces no global tolerance. Premultiplied framebuffer and straight PNG metrics are named and recorded separately.',newMocSha256:report.newMocSha256,textureSha256:report.newTextureSha256,testedSourceSnapshotSha256:report.testedSourceSnapshotSha256,acceptedAppearance:report.acceptedAppearance,strictOriginalResult:report.strictOriginalResult,pngStraightComparison:report.pngStraightComparison,outsideEyeComparison:report.outsideEyeComparison,acceptedReferenceRegression:report.acceptedReferenceRegression,actualNeutralRawRGBASha256:report.actualNeutralRawRGBASha256,checks:report.checks.filter(c=>names.includes(c.name)),errors:report.errors};
  fs.writeFileSync(path.join(out,'native-accepted-appearance-regression.json'),JSON.stringify(regression,null,2)+'\n');
 }
})().catch(error=>{report.errors.push(error.stack);check('pixel comparison completed',false,error.message);}).finally(async()=>{
 await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-neutral-pixels.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:path.join(out,'native-neutral-pixels.json'),checks:report.checks.length,failed:report.checks.filter(c=>!c.pass).map(c=>c.name),errors:report.errors.length}));process.exitCode=report.errors.length||report.checks.some(c=>!c.pass)?1:0;
});
