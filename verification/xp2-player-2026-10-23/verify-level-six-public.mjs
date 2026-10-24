import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root=path.resolve(new URL('../..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const results=[];
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.stack});}}
async function compiled(relative,dependencies={},globals={}){
  const source=await readFile(path.join(root,relative),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports={};
  vm.runInNewContext(output,{exports,require:name=>{if(name in dependencies)return dependencies[name];throw new Error(`Unexpected dependency ${name}`);},Headers,Response,Request,URL,URLSearchParams,Date,Number,Map,Set,process:{cwd:()=>root},...globals},{filename:relative});
  return exports;
}
const policy=await compiled('src/lib/level-six-access.ts');
const deadline=policy.LEVEL_SIX_PUBLIC_END_MS;
let serverClock=deadline-1;
const timedPolicy={...policy,isLevelSixPublic:()=>policy.isLevelSixPublic(serverClock)};
const cases={
  anonymous:{user:null,membership:null},
  basic:{user:{id:'member-2'},membership:{status:'active',access_level:2}},
  level5:{user:{id:'member-5'},membership:{status:'active',access_level:5}},
  level6:{user:{id:'member-6'},membership:{status:'active',access_level:6}},
  inactive:{user:{id:'inactive-6'},membership:{status:'suspended',access_level:6}},
  missing:{user:{id:'missing-membership'},membership:null},
  admin2:{user:{id:'admin-2'},membership:{status:'active',access_level:2,role:'admin'}},
};
let current=cases.anonymous,contentQueries=0,afterSession=null;
const database={
  auth:{getUser:async()=>({data:{user:current.user}})},
  from(table){
    if(table==='content_items')contentQueries++;
    const query={select(){return query;},eq(){return query;},order(){return query;},range(){return query;},ilike(){return query;},single:async()=>({data:table==='memberships'?current.membership:null}),then(resolve,reject){return Promise.resolve({data:[],count:0,error:null}).then(resolve,reject);}};
    return query;
  },storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},
};
const redirects={redirect:destination=>{throw new Error(`redirect:${destination}`);},notFound:()=>{throw new Error('not-found');}};
const auth=await compiled('src/lib/auth.ts',{
  react:{cache:callback=>callback},'next/navigation':redirects,
  '@/lib/supabase/server':{createClient:async()=>database},
});
const authForPage={...auth,getSessionContext:async()=>{const value=await auth.getSessionContext();if(afterSession)afterSession();return value;}};
const jsx=(type,props)=>({type,props});
const component=name=>({__esModule:true,default:name});
const page=await compiled('src/app/level/[level]/page.tsx',{
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'next/link':component('Link'),'next/navigation':redirects,
  '@/lib/auth':authForPage,'@/lib/level-six-access':timedPolicy,
  '@/lib/local-design-mode':{isLocalDesignMode:async()=>false},
  '@/components/DiscussionRoom':component('DiscussionRoom'),'@/components/SiteHeader':component('SiteHeader'),
  '@/components/SubmissionBox':component('SubmissionBox'),'@/components/KonisiCharacterGame':component('KonisiCharacterGame'),'@/components/StoryPlayer':component('StoryPlayer'),
  './ContentFeed':component('ContentFeed'),'./PrivateMessageBox':component('PrivateMessageBox'),
  './WorkTemplateExample':component('WorkTemplateExample'),'./LocalLevelPreview':component('LocalLevelPreview'),'./LevelHeading':component('LevelHeading'),
});
let crossDuringRead=false;
const route=await compiled('src/app/level/[level]/player/[...path]/route.ts',{
  'node:fs/promises':{...fs,readFile:async file=>{const data=await fs.readFile(file);if(crossDuringRead)serverClock=deadline;return data;}},'node:path':path,
  '@/lib/auth':auth,'@/lib/level-six-access':timedPolicy,'@/lib/local-design-mode':{isLocalDesignMode:async()=>false},
});
const props=level=>({params:Promise.resolve({level}),searchParams:Promise.resolve({})});
const request=(level='6',parts=['index.html'],headers={})=>route.GET(new Request(`https://site.example/level/${level}/player/${parts.join('/')}`,{headers}),{params:Promise.resolve({level,path:parts})});
const hasComponent=(node,name)=>!!node&&typeof node==='object'&&(node.type===name||Object.values(node.props||{}).some(value=>Array.isArray(value)?value.some(item=>hasComponent(item,name)):hasComponent(value,name)));

await check('Beijing midnight closes at the exact deadline, including invalid clocks',()=>{
  assert.equal(policy.LEVEL_SIX_PUBLIC_END,'2026-12-30T16:00:00.000Z');assert.equal(new Date(deadline).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}),'2026-12-31 00:00:00');
  assert.equal(policy.isLevelSixPublic(deadline-1),true);assert.equal(policy.isLevelSixPublic(deadline),false);assert.equal(policy.isLevelSixPublic(deadline+1),false);
  for(const invalid of [NaN,Infinity,-Infinity])assert.equal(policy.isLevelSixPublic(invalid),false);
});
await check('member classification matches existing active Level 6 requirement',()=>{
  for(const [name,ctx] of Object.entries(cases))assert.equal(policy.hasActiveLevelSix(ctx),name==='level6',name);
  assert.equal(policy.hasActiveLevelSix({user:null,membership:{status:'active',access_level:6}}),false);
});
await check('anonymous, lower levels and inactive members see only public player before cutoff',async()=>{
  serverClock=deadline-1;
  for(const [name,ctx] of Object.entries(cases)){
    current=ctx;contentQueries=0;const rendered=await page.default(props('6'));assert.equal(hasComponent(rendered,'StoryPlayer'),true,name);
    assert.equal(hasComponent(rendered,'ContentFeed'),name==='level6',name);assert.equal(contentQueries,name==='level6'?1:0,name);
  }
});
await check('exact cutoff and later requests use the original login, inactive and level guards',async()=>{
  for(const time of [deadline,deadline+1]){
    serverClock=time;
    for(const [name,ctx] of Object.entries(cases)){
      current=ctx;contentQueries=0;
      if(name==='level6'){assert.equal(hasComponent(await page.default(props('6')),'ContentFeed'),true);assert.equal(contentQueries,1);}
      else{const target=name==='anonymous'?'/login':name==='inactive'||name==='missing'?'/account?state=inactive':'/account?need=6';await assert.rejects(page.default(props('6')),error=>error.message===`redirect:${target}`,`${name} at ${time}`);assert.equal(contentQueries,0);}
    }
  }
});
await check('session lookup that straddles midnight cannot return an anonymous public page',async()=>{
  current=cases.anonymous;serverClock=deadline-1;afterSession=()=>{serverClock=deadline;};
  try{await assert.rejects(page.default(props('6')),/redirect:\/login/);}finally{afterSession=null;}
});
await check('other levels, alternate level spellings and administrative roles retain original guards',async()=>{
  serverClock=deadline-1;current=cases.anonymous;
  for(const level of ['2','3','4','5','06'])await assert.rejects(page.default(props(level)),/redirect:\/login/);
  current=cases.basic;await assert.rejects(page.default(props('5')),/redirect:\/account\?need=5/);
  current=cases.admin2;await assert.rejects(auth.requireLevel(6),/redirect:\/account\?need=6/);
});
await check('player source, JSON and module workers are public before cutoff and protected thereafter',async()=>{
  for(const parts of [['index.html'],['data','player-config.json'],['src','reader.js'],['src','texture-worker.js']]){
    current=cases.anonymous;serverClock=deadline-1;const response=await request('6',parts);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('cdn-cache-control'),'no-store');
    for(const time of [deadline,deadline+1]){serverClock=time;await assert.rejects(request('6',parts),/redirect:\/login/);}
    current=cases.level6;assert.equal((await request('6',parts)).status,200);
  }
  current=cases.anonymous;serverClock=deadline-1;const csp=(await request()).headers.get('content-security-policy');assert.match(csp,/worker-src 'self'/);assert.doesNotMatch(csp,/worker-src[^;]*\*/);
});
await check('low level, suspended and missing memberships cannot fetch player files after cutoff',async()=>{
  serverClock=deadline;
  for(const name of ['basic','level5','inactive','missing','admin2']){current=cases[name];await assert.rejects(request(),/redirect:\/account\?/);}
});
await check('browser time, query dates and request headers cannot extend the server window',async()=>{
  current=cases.anonymous;serverClock=deadline;
  await assert.rejects(request('6',['index.html'],{'Date':'Fri, 23 Oct 2026 00:00:00 GMT','x-public-until':'2099-01-01','x-local-design-verified':'1','If-Modified-Since':'Fri, 23 Oct 2026 00:00:00 GMT','Range':'bytes=0-15'}),/redirect:\/login/);
});
await check('reading a file across the deadline rechecks access before returning any bytes',async()=>{
  current=cases.anonymous;serverClock=deadline-1;crossDuringRead=true;
  try{await assert.rejects(request(),/redirect:\/login/);}finally{crossDuringRead=false;}
});
await check('private directory boundaries, routes and range replies retain strict protection',async()=>{
  current=cases.anonymous;serverClock=deadline-1;
  assert.equal((await request('5')).status,404);assert.equal((await request('06')).status,404);
  for(const parts of [['..','secret.json'],['%2e%2e','secret.json'],['src/reader.js'],['data','unknown.exe']])assert.equal((await request('6',parts)).status,404);
  const range=await request('6',['index.html'],{Range:'bytes=0-15'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);assert.match(range.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Object.keys(route).filter(key=>/^(GET|POST|PUT|PATCH|DELETE)$/.test(key)),['GET']);
});
await check('only the canonical Level 6 read paths receive no-store middleware headers and auth cookies stay intact',async()=>{
  for(const pathname of ['/level/6','/level/6/','/level/6/player/index.html','/level/6/player/src/texture-worker.js']){
    const response=new Response();policy.preventLevelSixCaching(pathname,response);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0, must-revalidate');assert.equal(response.headers.get('vercel-cdn-cache-control'),'no-store');
  }
  for(const pathname of ['/level/5','/level/06','/level/6x','/admin','/account','/level/6/submission']){
    const response=new Response();policy.preventLevelSixCaching(pathname,response);assert.equal(response.headers.has('cache-control'),false);
  }
  assert.equal(page.dynamic,'force-dynamic');assert.equal(page.revalidate,0);
  const authenticatedResponse=new Response(null,{headers:{'Set-Cookie':'sb-auth-token=refreshed; Path=/; HttpOnly; Secure; SameSite=Lax','X-Session-Result':'preserved'}});
  const middleware=await compiled('middleware.ts',{
    'next/server':{NextResponse:{next:()=>new Response(),redirect:()=>new Response(null,{status:308})}},
    '@/lib/supabase/middleware':{updateSession:async()=>authenticatedResponse},
    '@/lib/level-six-access':policy,
  },{process:{env:{NODE_ENV:'production'}}});
  const response=await middleware.middleware({headers:new Headers({host:'site.example'}),nextUrl:{pathname:'/level/6'}});
  assert.equal(response,authenticatedResponse);assert.equal(response.headers.get('set-cookie'),'sb-auth-token=refreshed; Path=/; HttpOnly; Secure; SameSite=Lax');assert.equal(response.headers.get('x-session-result'),'preserved');assert.match(response.headers.get('cache-control'),/no-store/);
});

console.log(JSON.stringify({passed:results.filter(item=>item.passed).length,total:results.length,deadline:policy.LEVEL_SIX_PUBLIC_END,results},null,2));
if(results.some(item=>!item.passed))process.exitCode=1;
