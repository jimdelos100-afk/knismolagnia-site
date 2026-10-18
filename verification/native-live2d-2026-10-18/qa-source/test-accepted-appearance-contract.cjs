/* Controls for the exact acceptance gate. Inputs and reference images stay immutable. */
const fs=require('node:fs'),path=require('node:path');
const {hash,readJSON,validateIdentity,loadAcceptedAppearance,comparePixels,originalDeltaMatches}=require('./accepted-appearance-contract.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'outputs/native-live2d-2026-10-15-verification');
const policy=readJSON(path.join(ROOT,'work/native-live2d-2026-10-15-qa/final-neutral-policy.json'));
const model=path.join(ROOT,'work/v8-source/knismolagnia-site/public/konisi-game/live2d/standing/character.model3.json'),settings=readJSON(model),base=path.dirname(model);
const identity={mocSha256:hash(fs.readFileSync(path.resolve(base,settings.FileReferences.Moc))),textureSha256:settings.FileReferences.Textures.map(file=>hash(fs.readFileSync(path.resolve(base,file))))};
const accepted=loadAcceptedAppearance(policy,identity,ROOT),checks=[];const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
check('exact approved current identity and immutable references pass',accepted?.valid,accepted?.issues);
if(!accepted?.valid)throw Error('Cannot test controls without exact approved reference');
const contract=accepted.contract,reference=accepted.referenceRaw;
check('an unseen MOC hash is rejected',!validateIdentity(contract,{...identity,mocSha256:'0'.repeat(64)}));
for(let i=0;i<2;i++){const textures=[...identity.textureSha256];textures[i]='0'.repeat(64);check('a changed Atlas '+i+' hash is rejected',!validateIdentity(contract,{...identity,textureSha256:textures}));}
check('exact reference returns strict zero',comparePixels(reference,Buffer.from(reference)).exactPixelMatch);
function probe(inEye,channel){for(let at=0;at<reference.length;at+=4){const x=(at/4)%1024,y=1535-Math.floor(at/4/1024),inside=x>=475&&x<615&&y>=180&&y<270;if(inside!==inEye||reference[at+3]===0)continue;const changed=Buffer.from(reference);changed[at+channel]^=1;return{changed,x,y};}throw Error('No opaque control point');}
for(const [inside,channel,name]of[[true,0,'one additional eye RGB unit'],[false,0,'one outside-eye RGB unit'],[true,3,'one additional eye alpha unit'],[false,3,'one outside-eye alpha unit']]){const p=probe(inside,channel),delta=comparePixels(reference,p.changed);check(name+' is rejected by zero-reference regression',!delta.exactPixelMatch&&delta.changedRGBAPixels===1&&delta.maximumChannelError===1,{x:p.x,y:p.y,...delta});if(!inside)check(name+' is also rejected by strict outside-eye comparison',!comparePixels(reference,p.changed,contract.acceptedEyeRectangleHalfOpen).exactPixelMatch);}
check('one extra original-difference pixel is not covered by approval',!originalDeltaMatches(contract,{...contract.originalDifference,changedRGBAPixels:2405}));
check('one extra original-difference channel unit is not covered by approval',!originalDeltaMatches(contract,{...contract.originalDifference,maximumChannelError:94}));
const snapshot=path.join(OUT,'tested-source-snapshot.json');
const report={date:new Date().toISOString(),scope:'Positive and negative controls for exact hash identity, zero RGBA reference regression and strict outside-eye equality. No candidate image, MOC, Atlas or policy was modified.',newMocSha256:identity.mocSha256,textureSha256:identity.textureSha256,testedSourceSnapshotSha256:hash(fs.readFileSync(snapshot)),acceptedAppearanceContractSha256:accepted.sha256,checks,errors:[]};
fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'native-accepted-appearance-negative-controls.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,failed:checks.filter(x=>!x.pass)},null,2));if(checks.some(x=>!x.pass))process.exitCode=1;
