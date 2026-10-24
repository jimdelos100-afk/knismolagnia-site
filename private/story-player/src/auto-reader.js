const BASE_DELAY=1.2,CHARACTERS_PER_SECOND=18,MAX_DELAY=8,MAX_FRAME_DELTA=.5,EPS=1e-8;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Extra reading time starts only after the typewriter has finished. */
export function autoReadDelay(lineLength){
  const length=finite(lineLength)?Math.max(0,lineLength):0;
  return Math.min(MAX_DELAY,BASE_DELAY+length/CHARACTERS_PER_SECOND);
}

/**
 * Uses the application's animation frame, with no timers or persisted autoplay.
 * The caller starts the player on a user gesture and performs next() only when
 * update() returns true. Resource loading, overlays and focus belong in blocked
 * or ready. Hiding the dialogue window does not itself pause this controller.
 */
export class AutoReader{
  constructor(){this._enabled=false;this.reset();}
  get enabled(){return this._enabled;}
  setEnabled(enabled){
    const next=enabled===true;
    if(next!==this._enabled){this._enabled=next;this.reset();}
    return this._enabled;
  }
  /** Forget the current line's dwell time without changing the selected mode. */
  reset(){
    this._seen=false;this._scene=null;this._node=null;this._text=null;this._index=null;this._startedAt=null;this._clock=null;
    this._elapsed=0;this._complete=false;this._issued=false;
  }
  update(state,{delta=0,ready=true,blocked=false,lineLength=0,speed=1}={}){
    if(!this._enabled)return false;
    if(!state){this.reset();return false;}
    if(state.ended||state.waiting==='choice'||state.waiting==='signal'||state.waiting==='node'){
      this.setEnabled(false);return false;
    }
    const dialogue=state.dialogue||null,node=state.program?.nodeId??null;
    const text=dialogue?.textId??null,index=dialogue?.index??null,startedAt=dialogue?.startedAt??null;
    const clock=finite(state.stageTime)?state.stageTime:finite(state.time)?state.time:null;
    // A one-line program may loop back to the same node and command. Its stage
    // clock restarts, so textId and dialogue index alone cannot identify a visit.
    const changed=!this._seen||this._scene!==state.sceneId||this._node!==node||this._text!==text||this._index!==index||this._startedAt!==startedAt||clock!==null&&this._clock!==null&&clock+EPS<this._clock;
    if(changed){
      this._seen=true;this._scene=state.sceneId;this._node=node;this._text=text;this._index=index;this._startedAt=startedAt;
      this._elapsed=0;this._complete=false;this._issued=false;
    }
    this._clock=clock;
    if(blocked||!ready||state.playing!==true){this._elapsed=0;this._complete=false;return false;}
    if(state.waiting!=='dialogue'||!text||dialogue.textComplete!==true){this._elapsed=0;this._complete=false;return false;}
    if(this._issued)return false;
    if(!this._complete){this._complete=true;this._elapsed=0;return false;}
    // Background throttling or a stalled main thread must never catch up by
    // skipping a line immediately. Normal frame time is measured in real seconds.
    if(!finite(delta)||delta<0||delta>MAX_FRAME_DELTA){this._elapsed=0;return false;}
    this._elapsed+=delta*(finite(speed)?Math.max(.25,Math.min(4,speed)):1);
    if(this._elapsed+EPS<autoReadDelay(lineLength))return false;
    this._issued=true;return true;
  }
}
