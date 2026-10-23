const DATABASE='independent-story-player',STORE='progress';
let opening;
function open(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{opening=null;reject(request.error||new Error('无法打开浏览记录存储。'));};
  });
  return opening;
}
export async function readStored(key){
  const db=await open();
  return new Promise((resolve,reject)=>{const request=db.transaction(STORE).objectStore(STORE).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function writeStored(key,value){
  const db=await open();
  return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('浏览记录保存中断。'));});
}
