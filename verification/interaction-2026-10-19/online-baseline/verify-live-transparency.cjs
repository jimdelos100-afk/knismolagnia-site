/* Read-only source/ZIP audit plus temporary browser-only color-scheme experiment. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/daisy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const ROOT='C:/Users/daisy/Documents/Codex/2026-10-10/referenced-chatgpt-conversation-this-is-an',SITE=path.join(ROOT,'work/v8-source/knismolagnia-site');
const sharp=require(path.join(SITE,'node_modules/sharp'));
const remote=process.argv.includes('--remote');
const fixed=process.argv.includes('--verify-fixed');
const remaining=process.argv.includes('--remaining-edge');
const OUT=__dirname;fs.mkdirSync(OUT,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const frozenFiles=['src/app/globals.css','src/components/HomeCharacter.tsx','public/konisi-game/home.html','public/konisi-game/character.css','public/konisi-game/character.js','public/konisi-game/live2d/manifest.json'];
const sourceBefore=Object.fromEntries(frozenFiles.map(n=>[n,sha(fs.readFileSync(path.join(SITE,n)))]));
const base=remote?'https://knismolagnia.club':'http://127.0.0.1:3210',results=[],errors=[];
const browsers=[['chrome155','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge139','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']];
const raw=async bytes=>(await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}));
function compareBackground(a,b,c,info,alpha,geometry){
 const report={sampledTransparentPixels:0,beforeDifferentPixels:0,afterDifferentPixels:0,beforeWhitePixels:0,afterWhitePixels:0,examples:[]};
 const {x,y,width,height,canvas}=geometry,W=alpha.width,H=alpha.height,al=Buffer.from(alpha.alphaBase64,'base64'),scale=info.width/geometry.viewportWidth;
 const pixel=(buffer,px,py)=>Array.from(buffer.subarray((py*info.width+px)*4,(py*info.width+px)*4+4));
 for(let py=Math.ceil((y+10)*scale);py<Math.floor((y+height-55)*scale);py++)for(let px=Math.ceil((x+10)*scale);px<Math.floor((x+width-10)*scale);px++){
  const cssX=(px+.5)/scale,cssY=(py+.5)/scale;
  if(cssX>x+width-50&&cssY<y+50)continue;
  const cx=Math.floor((cssX-x-canvas.x)/canvas.width*W),cy=Math.floor((cssY-y-canvas.y)/canvas.height*H);
  if(cx<3||cx>=W-3||cy<3||cy>=H-3)continue;
  let clear=true;for(let dy=-2;dy<=2&&clear;dy++)for(let dx=-2;dx<=2;dx++)if(al[(H-1-(cy+dy))*W+cx+dx]!==0){clear=false;break}
  if(!clear)continue;
  const old=pixel(a,px,py),background=pixel(b,px,py),fixed=pixel(c,px,py);
  report.sampledTransparentPixels++;
  const diffOld=old.some((v,i)=>v!==background[i]),diffFixed=fixed.some((v,i)=>v!==background[i]);
  if(diffOld)report.beforeDifferentPixels++;
  if(diffFixed)report.afterDifferentPixels++;
  if(old[0]===255&&old[1]===255&&old[2]===255)report.beforeWhitePixels++;
  if(fixed[0]===255&&fixed[1]===255&&fixed[2]===255)report.afterWhitePixels++;
  if(diffOld&&report.examples.length<6)report.examples.push({xy:[px,py],before:old,parentWithoutIframe:background,after:fixed});
 }
 return report;
}
async function one(browser,browserName,theme,os,scenario='initial-theme'){
 const name=browserName+'-page-'+theme+'-os-'+os+'-'+scenario;
 const mobile=scenario==='mobile';
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:mobile?2:1,colorScheme:os,hasTouch:mobile,isMobile:mobile});
 await context.addInitScript(theme=>{try{localStorage.setItem('knismolagnia-theme',theme);localStorage.setItem('konisi-companion-minimized','0');localStorage.setItem('konisi-pet-preferences-v1',JSON.stringify({motion:false,headMotion:false,gaze:false,blink:false,hairPhysics:false,expression:'neutral',outfit:'original',zoom:1}));}catch{}},theme);
 const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(base+'/?white-background-audit='+name,{waitUntil:'domcontentloaded'});
 const outer=page.locator('.site-companion-frame');await outer.waitFor({state:'visible'});
 const frame=await(await outer.elementHandle()).contentFrame();
 await frame.waitForFunction(()=>window.KONISI_LIVE2D?.snapshot().ready,null,{timeout:90000});
 await frame.waitForFunction(()=>KONISI_LIVE2D.snapshot().motion===false);
 const lifecycle={scenario,initialTheme:await page.evaluate(()=>document.documentElement.dataset.theme)};
 if(scenario==='theme-toggle'){await page.locator('.theme-toggle').click();await page.waitForFunction(initial=>document.documentElement.dataset.theme!==initial,theme);lifecycle.themeAfterToggle=await page.evaluate(()=>document.documentElement.dataset.theme)}
 if(scenario==='minimize-restore'){
  await page.locator('.site-companion-minimize').click();await outer.waitFor({state:'hidden'});lifecycle.minimized=await page.locator('.site-companion-restore').isVisible();
  await page.screenshot({path:path.join(OUT,name+'-minimized.png')});
  await page.locator('.site-companion-restore').click();await outer.waitFor({state:'visible'});lifecycle.restored=await outer.isVisible();
 }
 const actualSource={};
 for(const file of ['home.html','character.css','character.js','live2d/manifest.json']){
  const response=await context.request.get(base+'/konisi-game/'+file+'?diagnostic='+name);
  actualSource[file]={status:response.status(),sha256:sha(await response.body()),cacheControl:response.headers()['cache-control']};
 }
 const parent=await page.evaluate(()=>{const f=document.querySelector('.site-companion-frame'),r=f.getBoundingClientRect();return{theme:document.documentElement.dataset.theme,rootScheme:getComputedStyle(document.documentElement).colorScheme,bodyScheme:getComputedStyle(document.body).colorScheme,iframeScheme:getComputedStyle(f).colorScheme,iframeBackground:getComputedStyle(f).backgroundColor,osDark:matchMedia('(prefers-color-scheme: dark)').matches,viewportWidth:innerWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}});
 const alpha=await frame.evaluate(()=>new Promise((resolve,reject)=>{
  const c=document.getElementById('character'),g=c.getContext('webgl'),originalGetError=g.getError;
  const timeout=setTimeout(()=>{g.getError=originalGetError;reject(Error('No fresh actual render within five seconds'))},5000);
  g.getError=function(){const error=originalGetError.call(g);g.getError=originalGetError;clearTimeout(timeout);
   const v=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,v);const a=new Uint8Array(c.width*c.height);let nonzero=0;for(let i=0;i<a.length;i++){a[i]=v[i*4+3];if(a[i])nonzero++}let binary='';for(let i=0;i<a.length;i+=16384)binary+=String.fromCharCode(...a.subarray(i,i+16384));const r=c.getBoundingClientRect();resolve({width:c.width,height:c.height,nonzeroAlphaPixels:nonzero,cornerAlpha:[v[3],v[(c.width-1)*4+3],v[(c.height-1)*c.width*4+3],v[v.length-1]],alphaBase64:btoa(binary),canvas:{x:r.x,y:r.y,width:r.width,height:r.height},childRootScheme:getComputedStyle(document.documentElement).colorScheme,childBodyScheme:getComputedStyle(document.body).colorScheme,childBackgrounds:[document.documentElement,document.body,document.querySelector('.shell'),document.querySelector('.interaction'),c].map(e=>({tag:e.tagName,background:getComputedStyle(e).backgroundColor,image:getComputedStyle(e).backgroundImage})),model:KONISI_LIVE2D.snapshot().status.nativeRig.mocSha256});return error;
  };
  document.getElementById('reset').click();
 }));
 if(alpha.nonzeroAlphaPixels<1000)throw Error(name+' did not read a rendered WebGL buffer');
 const before=await page.screenshot({path:path.join(OUT,name+'-before.png')});
 await outer.evaluate(f=>f.style.visibility='hidden');
 const background=await page.screenshot({path:path.join(OUT,name+'-parent-only.png')});
 await outer.evaluate(f=>f.style.visibility='');
 if(!fixed)await page.addStyleTag({content:'.site-companion-frame{color-scheme:light !important}'});
 const after=await page.screenshot({path:path.join(OUT,name+'-after-parent-iframe-light.png')});
 const afterScheme=await outer.evaluate(f=>getComputedStyle(f).colorScheme);
 const aa=await raw(before),bb=await raw(background),cc=await raw(after);
 const comparison=compareBackground(aa.data,bb.data,cc.data,aa.info,alpha,{...parent.rect,viewportWidth:parent.viewportWidth,canvas:alpha.canvas});
 delete alpha.alphaBase64;
 const passed=parent.iframeScheme==='light'&&alpha.childRootScheme==='light'&&comparison.sampledTransparentPixels>1000&&comparison.beforeDifferentPixels===0&&comparison.afterDifferentPixels===0&&pageErrors.length===0&&alpha.cornerAlpha.every(v=>v===0)&&alpha.model==='cb8f9eda38f1b8dcf036e2f367139741245799fdb161e1617b4f6916029dca8c'&&(scenario!=='minimize-restore'||lifecycle.minimized&&lifecycle.restored);
 const result={name,pass:fixed?passed:null,browserVersion:browser.version(),pageTheme:parent.theme,osPreference:os,lifecycle,parent,childAndFramebuffer:alpha,afterIframeScheme:afterScheme,comparison,actualSource,pageErrors};
 results.push(result);console.log(JSON.stringify({name,scheme:parent.iframeScheme,childScheme:alpha.childRootScheme,...comparison,pageErrors}));
 await context.close();
}
(async()=>{
 if(remaining){for(const [scenario,os]of [['theme-toggle','light'],['minimize-restore','dark'],['mobile','dark']]){const browser=await chromium.launch({executablePath:browsers[1][1],headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{await one(browser,'edge139','dark',os,scenario)}finally{await browser.close()}}return;}
 for(const[browserName,executablePath]of browsers){const browser=await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});try{for(const theme of ['light','dark'])for(const os of ['light','dark'])await one(browser,browserName,theme,os);if(fixed){await one(browser,browserName,'light','dark','theme-toggle');await one(browser,browserName,'dark','light','theme-toggle');await one(browser,browserName,'dark','dark','minimize-restore');await one(browser,browserName,'dark','dark','mobile')}}finally{await browser.close()}}
})().catch(e=>{errors.push(e.stack);console.error(e.stack)}).finally(()=>{
 const sourceAfter=Object.fromEntries(frozenFiles.map(n=>[n,sha(fs.readFileSync(path.join(SITE,n)))]));
 const report={date:new Date().toISOString(),url:base,verificationOfActualSourceFix:fixed,noTemporaryStyleInjected:fixed,scope:fixed?'Actual Next source CSS fix, no page.addStyleTag. Initial theme×OS matrix plus real theme button changes, minimize/restore and mobile DPR2. Screenshot pixels compare rendered transparent support against actual same-parent background with iframe hidden. No model/ZIP/remote edit.':'Actual Next homepage, two installed browsers, explicit page themes and emulated OS preferences. Temporary browser CSS only; composited pixels compared with same parent without iframe. No product/ZIP/server edit.',sourceBefore,sourceAfter,sourceUnchanged:JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter),checks:fixed?results.map(r=>({name:r.name,pass:r.pass,detail:r.comparison})):[],results,errors};
 fs.writeFileSync(path.join(OUT,'actual-next-color-scheme-matrix.json'),JSON.stringify(report,null,2)+'\n');
 if(errors.length||fixed&&results.some(r=>!r.pass))process.exitCode=1;
});

