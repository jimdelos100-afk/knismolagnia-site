/** One worker per selected directory; caller's queue bounds work and memory. */
export class TextureDecoder{
  constructor(fallback){this.fallback=fallback;this.nextId=0;this.pending=new Map();this.disposed=false;this.worker=null;
    if(typeof Worker==='function'&&typeof OffscreenCanvas==='function')try{
      this.worker=new Worker(new URL('./texture-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{const waiting=this.pending.get(data.id);if(!waiting)return;this.pending.delete(data.id);if(data.error)waiting.reject(new Error(data.error));else waiting.resolve(data.blob);};
      this.worker.onerror=()=>{this.worker?.terminate();this.worker=null;for(const waiting of this.pending.values())waiting.reject(new Error('图片后台解码暂时不可用，请重新选择目录。'));this.pending.clear();};
    }catch{this.worker=null;}
  }
  decode(bytes,asset){
    if(this.disposed)return Promise.reject(new Error('图片解码器已关闭。'));
    if(!this.worker)return this.fallback(bytes,asset);
    const id=++this.nextId,buffer=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.slice().buffer;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage({id,bytes:buffer,asset:{width:asset.width,height:asset.height,format:asset.format,flipY:asset.flipY}},[buffer]);}catch(error){this.pending.delete(id);reject(error);}});
  }
  dispose(){this.disposed=true;this.worker?.terminate();this.worker=null;for(const waiting of this.pending.values())waiting.reject(new Error('图片解码已取消。'));this.pending.clear();}
}
