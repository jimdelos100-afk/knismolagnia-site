// Reconcile media with the evaluated timeline. No resource upload is performed.
export class MediaController{
  constructor(video,library,onStatus=()=>{}){this.video=video;this.library=library;this.onStatus=onStatus;this.channels=new Map();this.videoKey=null;this.desiredVideo=null;this.lastMessage='';this.video.onerror=()=>this.report('有视频资源无法播放，请检查格式和资源清单。');}
  report(message){if(message!==this.lastMessage){this.lastMessage=message;this.onStatus(message);}}
  syncElement(element,cue,rate){
    element.loop=!!cue.loop;element.volume=Math.max(0,Math.min(1,cue.volume??1));element.playbackRate=rate;
    let position=Math.max(0,cue.position??0);
    if(Number.isFinite(element.duration)&&element.duration>0)position=cue.loop?position%element.duration:Math.min(position,Math.max(0,element.duration-.015));
    if(element.readyState>=1&&Math.abs(element.currentTime-position)>(cue.playing?.12:.015)){
      try{element.currentTime=position;}catch{}
    }
    if(!cue.playing){element._playAttempt=(element._playAttempt||0)+1;element._starting=false;element.pause();return;}
    if(element.paused&&!element._starting&&!element._playRejected){
      element._starting=true;const attempt=element._playAttempt=(element._playAttempt||0)+1;
      let promise;try{promise=element.play();}catch(error){promise=Promise.reject(error);}
      Promise.resolve(promise).then(()=>{
        if(element._playAttempt!==attempt){if(!element._desiredPlaying)element.pause();return;}
        element._starting=false;
        if(!element._desiredPlaying)element.pause();
      }).catch(error=>{if(element._playAttempt!==attempt)return;element._starting=false;if(!element._desiredPlaying||error?.name==='AbortError')return;element._playRejected=true;this.report('声音或视频尚未开始，请点击播放；也可检查媒体文件是否可用。');});
    }
  }
  sync(state){
    const wanted=new Set();const rate=state.rate||1;
    for(const cue of state.audio||[]){
      const key=`${state.sceneId}:${cue.id}:${cue.asset}:${cue.startAt}`;wanted.add(key);
      let channel=this.channels.get(key);
      if(!channel){
        const url=this.library.resolve(cue.asset);if(!url){if(this.library.localOnly&&this.library.provider&&!this.library.resolved.has(cue.asset)){this.report('正在读取本地声音…');}else this.report('有声音资源尚未提供。');continue;}
        const element=new Audio(url);element.preload='auto';element.addEventListener('error',()=>this.report('有声音资源无法播放，请检查格式和资源清单。'));
        channel={element,cue};this.channels.set(key,channel);
        if(this.library.localOnly)this.report('声音资源已从本机读取。');
        element.addEventListener('loadedmetadata',()=>{if(this.channels.get(key)===channel)this.syncElement(element,channel.cue,channel.rate||1);});
      }
      channel.cue=cue;channel.rate=rate;channel.element._desiredPlaying=!!cue.playing;this.syncElement(channel.element,cue,rate);
    }
    for(const [key,{element}]of this.channels)if(!wanted.has(key)){element._desiredPlaying=false;element.pause();element.removeAttribute('src');element.load();this.channels.delete(key);}
    const cue=state.video;
    if(!cue||cue.visible===false){this.video._desiredPlaying=false;this.video.pause();this.video.hidden=true;this.desiredVideo=null;return;}
    const key=`${state.sceneId}:${cue.id}:${cue.asset}:${cue.startAt}`,url=this.library.resolve(cue.asset);
    if(!url){this.video.hidden=true;if(this.library.localOnly&&this.library.provider&&!this.library.resolved.has(cue.asset))this.report('正在读取本地视频…');else this.report('有视频资源尚未提供。');return;}
    this.desiredVideo={cue,rate};
    if(key!==this.videoKey||this.video.src!==url){
      this.videoKey=key;this.video._playAttempt=(this.video._playAttempt||0)+1;this.video._starting=false;this.video._playRejected=false;this.video.src=url;this.video.preload='auto';this.video.playsInline=true;
      this.video.onloadedmetadata=()=>{if(this.desiredVideo)this.syncElement(this.video,this.desiredVideo.cue,this.desiredVideo.rate);};
    }
    this.video.hidden=false;this.video._desiredPlaying=!!cue.playing;
    Object.assign(this.video.style,{left:`${cue.x||0}px`,top:`${cue.y||0}px`,width:`${cue.width||1280}px`,height:`${cue.height||720}px`,opacity:String(cue.opacity??1)});
    this.syncElement(this.video,cue,rate);
    if((this.channels.size||cue)&&!this.lastMessage)this.report('音视频随当前片段的时间位置同步。');
  }
  unlock(){for(const {element}of this.channels.values())element._playRejected=false;this.video._playRejected=false;this.lastMessage='';}
  stop(){
    for(const {element}of this.channels.values()){element._desiredPlaying=false;element.pause();element.removeAttribute('src');element.load();}
    this.channels.clear();this.video._desiredPlaying=false;this.video.pause();this.video.hidden=true;this.desiredVideo=null;this.videoKey=null;
  }
  dispose(){this.stop();this.video.onerror=null;this.video.onloadedmetadata=null;this.video.removeAttribute('src');this.video.load();}
}
