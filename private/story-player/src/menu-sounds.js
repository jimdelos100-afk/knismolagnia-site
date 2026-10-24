/** Original UguiButtonSe cues, read from the selected local game only. */
export class MenuSounds{
  constructor(library,{enabled=()=>true,createAudio=url=>new Audio(url)}={}){
    this.library=library;this.enabled=enabled;this.createAudio=createAudio;this.masterVolume=1;this.generation=0;this.requests=new Map();this.channels=new Map();this.disposed=false;
  }
  get retained(){return [...new Set([...this.requests.keys(),...this.channels.keys()])];}
  setVolume(value){this.masterVolume=Math.max(0,Math.min(1,value));for(const channel of this.channels.values())channel.element.volume=channel.volume*this.masterVolume;}
  release(id,channel){
    if(this.channels.get(id)!==channel)return;
    this.channels.delete(id);channel.element.onended=null;channel.element._cancelled=true;channel.element.pause();channel.element.removeAttribute('src');channel.element.load();
  }
  async play({assetId,volume=.5}={}){
    if(this.disposed||!this.enabled()||this.library.asset(assetId)?.type!=='audio')return false;
    // The original menu has two cue assets. Keep at most two requests/channels.
    if(!this.requests.has(assetId)&&!this.channels.has(assetId)&&this.retained.length>=2)return false;
    const generation=this.generation,request={};this.requests.set(assetId,request);
    try{
      await this.library.preload([assetId]);
      if(this.disposed||generation!==this.generation||this.requests.get(assetId)!==request||!this.enabled())return false;
      const url=this.library.resolve(assetId);if(!url)return false;
      const old=this.channels.get(assetId);if(old)this.release(assetId,old);
      const element=this.createAudio(url),channel={element,volume:Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):.5};
      this.channels.set(assetId,channel);element.loop=false;element.volume=channel.volume*this.masterVolume;element.preload='auto';element.onended=()=>this.release(assetId,channel);
      try{await element.play();if(this.disposed||generation!==this.generation||element._cancelled){element.pause();return false;}return true;}
      catch{this.release(assetId,channel);return false;}
    }finally{if(this.requests.get(assetId)===request)this.requests.delete(assetId);}
  }
  stop(){this.generation++;this.requests.clear();for(const [id,channel]of this.channels)this.release(id,channel);}
  dispose(){this.stop();this.disposed=true;}
}
