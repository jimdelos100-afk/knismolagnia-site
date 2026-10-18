/* Exact, hash-bound acceptance. This module does not introduce a pixel tolerance. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validateIdentity(contract,identity){return identity.mocSha256===contract.newMocSha256&&same(identity.textureSha256,contract.textureSha256);}
function loadAcceptedAppearance(policy,identity,root=process.cwd()){
 const entry=policy?.acceptedAppearanceContract;if(!entry)return null;
 const file=path.resolve(root,entry.file),issues=[];
 if(!fs.existsSync(file))return{file,issues:['Accepted appearance contract missing'],valid:false};
 const bytes=fs.readFileSync(file),contract=readJSON(file);if(hash(bytes)!==entry.sha256)issues.push('Accepted contract bytes differ from policy');
 if(contract.version!==1||contract.authorization?.answer!=='接受图中眼部画面，保留真实差异记录')issues.push('Specific user acceptance is absent');
 if(!validateIdentity(contract,identity))issues.push('Actual MOC or one of the two Atlas hashes differs from accepted identity');
 for(const row of contract.frozenFiles||[]){const f=path.resolve(root,row.file);if(!fs.existsSync(f)||hash(fs.readFileSync(f))!==row.sha256)issues.push('Frozen reference/evidence changed: '+row.role);}
 let raw=null;
 try{raw=zlib.gunzipSync(fs.readFileSync(path.resolve(root,contract.referenceRawRGBA.file)));if(raw.length!==1024*1536*4||hash(raw)!==contract.referenceRawRGBA.decompressedSha256)issues.push('Frozen actual WebGL RGBA reference differs');}catch(error){issues.push('Cannot read frozen actual WebGL reference: '+error.message);}
 return{file,sha256:hash(bytes),contract,referenceRaw:raw,issues,valid:issues.length===0};
}
function comparePixels(a,b,rectangle=null){
 if(a.length!==b.length||a.length!==1024*1536*4)throw Error('Expected exact 1024x1536 RGBA buffers');
 let changed=0,maximum=0,total=0,alphaChanged=0;const bounds={left:1024,top:1536,right:-1,bottom:-1};
 for(let at=0;at<a.length;at+=4){const x=(at/4)%1024,y=1535-Math.floor(at/4/1024);if(rectangle&&x>=rectangle[0]&&x<rectangle[2]&&y>=rectangle[1]&&y<rectangle[3])continue;let error=0;for(let k=0;k<4;k++){const delta=Math.abs(a[at+k]-b[at+k]);error=Math.max(error,delta);maximum=Math.max(maximum,delta);total+=delta;}if(a[at+3]!==b[at+3])alphaChanged++;if(error){changed++;bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);bounds.right=Math.max(bounds.right,x);bounds.bottom=Math.max(bounds.bottom,y);}}
 return{exactPixelMatch:changed===0,changedRGBAPixels:changed,maximumChannelError:maximum,totalChannelError:total,alphaChanged,changedBounds:changed?bounds:null};
}
function originalDeltaMatches(contract,comparison){const expected=contract.originalDifference;return['changedRGBAPixels','maximumChannelError','alphaChanged','totalChannelError'].every(k=>comparison[k]===expected[k])&&same(comparison.changedBounds,expected.changedBounds);}
module.exports={hash,readJSON,same,validateIdentity,loadAcceptedAppearance,comparePixels,originalDeltaMatches};
