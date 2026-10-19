const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const OUT=__dirname, base='https://knismolagnia.club';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  const entries=[];
  async function get(url,name){const r=await fetch(url),b=Buffer.from(await r.arrayBuffer());fs.writeFileSync(path.join(OUT,name),b);const e={url,status:r.status,sha256:sha(b),bytes:b.length,headers:Object.fromEntries(r.headers)};entries.push(e);return b.toString('utf8');}
  const html=await get(base+'/','homepage.html');
  const cssLinks=[...html.matchAll(/href="([^"]+\.css[^\"]*)"/g)].map(x=>x[1]);
  for(let i=0;i<cssLinks.length;i++)await get(new URL(cssLinks[i],base).href,`online-${i}.css`);
  for(const file of ['home.html','character.css','character.js','live2d/manifest.json'])await get(base+'/konisi-game/'+file,file.replaceAll('/','-'));
  const report={date:new Date().toISOString(),entries,cssLinks,schemeDeclaration:fs.readdirSync(OUT).filter(x=>x.endsWith('.css')).map(n=>({file:n,frameSchemeRule:fs.readFileSync(path.join(OUT,n),'utf8').match(/[^{}]*site-companion-frame[^{}]*\{[^{}]*\}/g)}))};
  fs.writeFileSync(path.join(OUT,'public-response-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
