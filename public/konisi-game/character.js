/* Three poses share one renderer. Expressions and blinking are independent states. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = window.KONISI_MODELS[document.body.dataset.pose];
  const W = model.width, H = model.height;
  const outfits = model.outfits || { original:'原装', tights:'白色裤袜', overknee:'过膝白丝' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const state = { expression:'neutral', outfit:model.defaultOutfit || 'original', focus:model.full.slice(0,2), zoom:model.full[2], follow:!reduced.matches, motion:!reduced.matches, gaze:[0,0], target:[0,0], shake:[0,0], shakeTarget:[0,0], nextShake:0, time:0, blinkAt:-100, nextBlink:2.5, reaction:null, reactionStart:0, reactionDuration:0 };
  const canvas = $('character'), scene = $('scene');
  let gl, program, texture, uniforms, indexCount, open, closed, frame=0, lastTime=0, visible=true, ready=false, metrics;
  const images = new Map();
  const pointers=new Map();let gesture=null;
  function makeCanvas() { const c=document.createElement('canvas'); c.width=W; c.height=H; return c; }
  function paint(ctx, asset) { ctx.drawImage(images.get(asset.src),asset.x,asset.y,asset.width,asset.height); }
  function feedback() {
    $('costume').value=state.outfit;
    $('reset').textContent='回到初始位置';
    if($('zoomLevel'))$('zoomLevel').textContent=Math.round(state.zoom/model.full[2]*100)+'%';
    $('follow').textContent=state.follow?'关闭目光跟随':'开启目光跟随'; $('follow').setAttribute('aria-pressed',String(state.follow));
    $('motion').textContent=state.motion?'暂停动作':'继续动作'; $('motion').setAttribute('aria-pressed',String(state.motion));
    $('appearance').textContent=outfits[state.outfit];
    document.documentElement.dataset.expression=state.expression; document.documentElement.dataset.outfit=state.outfit;
  }
  function compose() {
    open=makeCanvas(); const g=open.getContext('2d'); paint(g,model.base);
    if(state.outfit!=='original') paint(g,model.wardrobe[state.outfit]);
    if(state.expression!=='neutral') paint(g,model.expressions[state.expression]);
    closed=makeCanvas(); const cg=closed.getContext('2d'); cg.drawImage(open,0,0);
    if(!['happy','laugh','blink'].includes(state.expression)) for(const eye of model.blinkEyes) paint(cg,eye);
    if(gl) for(let i=0;i<2;i++) { gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,texture[i]); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,i?closed:open); }
    else $('fallback').src=open.toDataURL();
    feedback(); requestFrame();
  }
  function initializeRenderer() {
    gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl) throw new Error('WebGL unavailable');
    const vs=`attribute vec2 aPos;attribute vec2 aUV;varying vec2 vUV;uniform vec2 uSize;uniform vec2 uFocus;uniform float uZoom;uniform mediump vec2 uArt;uniform vec2 uShake;
      void main(){vec2 p=aPos+uShake;
      float fit=min(uSize.x/uArt.x,uSize.y/uArt.y)*.96*uZoom;vec2 q=(p-uFocus)*fit/uSize*2.;gl_Position=vec4(q.x,-q.y,0.,1.);vUV=aUV;}`;
    const fs=`precision mediump float;varying vec2 vUV;uniform sampler2D uOpen;uniform sampler2D uClosed;uniform mediump vec2 uArt;uniform vec2 uGaze;uniform vec4 uEyeL;uniform vec4 uEyeR;uniform float uBlink;
      float iris(vec2 p,vec4 eye){return 1.-smoothstep(.2,1.,length((p-eye.xy)/max(eye.zw,vec2(1.))));}
      void main(){vec2 p=vUV*uArt;float m=max(iris(p,uEyeL),iris(p,uEyeR));vec2 uv=vUV-uGaze*m*(1.-uBlink)/uArt;vec4 a=texture2D(uOpen,uv);a.a=texture2D(uOpen,vUV).a;vec4 b=texture2D(uClosed,vUV);gl_FragColor=mix(a,b,uBlink);}`;
    function shader(kind,src){const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
    program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const columns=36,rows=56,vertices=[],indices=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++)vertices.push(i*W/columns,j*H/rows,i/columns,j/rows);
    for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){const a=j*(columns+1)+i,b=a+1,c=a+columns+1,d=c+1;indices.push(a,c,b,b,c,d);}
    const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for(const [name,offset] of [['aPos',0],['aUV',8]]){const p=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,16,offset);}
    const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);indexCount=indices.length;
    uniforms={};for(const name of ['uSize','uFocus','uZoom','uArt','uShake','uGaze','uEyeL','uEyeR','uBlink'])uniforms[name]=gl.getUniformLocation(program,name);
    texture=[];for(let i=0;i<2;i++){const t=gl.createTexture();texture.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.uniform1i(gl.getUniformLocation(program,i?'uClosed':'uOpen'),i);}
    gl.clearColor(0,0,0,0);
  }
  function updateMetrics() {
    const r=scene.getBoundingClientRect(),view=[...state.focus,state.zoom];
    metrics={rect:r,view,fit:Math.min(r.width/W,r.height/H)*.96*view[2]};
    const dpr=Math.min(devicePixelRatio||1,2),width=Math.max(1,Math.round(r.width*dpr)),height=Math.max(1,Math.round(r.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;if(gl)gl.viewport(0,0,width,height);}
    if(!gl){const img=$('fallback');img.style.width=W*metrics.fit+'px';img.style.height=H*metrics.fit+'px';img.style.left=(r.width/2-view[0]*metrics.fit)+'px';img.style.top=(r.height/2-view[1]*metrics.fit)+'px';}
  }
  function requestFrame(){if(ready&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(render);}
  function render(ts) {
    frame=0;const dt=lastTime?Math.min((ts-lastTime)/1000,.05):0;lastTime=ts;if(state.motion)state.time+=dt;
    const smooth=1-Math.exp(-dt/0.072);for(let i=0;i<2;i++)state.gaze[i]+=(state.target[i]-state.gaze[i])*smooth;
    if(state.motion&&state.time>state.nextBlink){state.blinkAt=state.time;state.nextBlink=state.time+3.4+Math.random()*2.2;}
    const age=state.time-state.blinkAt;
    let blink=age<0||age>.2?0:age<.065?age/.065:age<.11?1:(.2-age)/.09;
    if(['happy','laugh','blink'].includes(state.expression))blink=0;
    let reactT=0;
    if(state.reaction){
      if(!state.reactionStart)state.reactionStart=ts;
      reactT=Math.min(1,(ts-state.reactionStart)/state.reactionDuration);
      if(reactT>=1){state.reaction=null;state.reactionStart=0;state.expression='neutral';delete document.documentElement.dataset.reaction;document.querySelectorAll('[data-action]').forEach(button=>button.classList.remove('is-active'));compose();reactT=0;}
    }
    const amplitudes=model.amplitudes || {pat:4.5,poke:8,pinch:6.5,rub:10};
    const shaking=state.motion||state.reaction;
    if(shaking&&ts>=state.nextShake){const amplitude=state.reaction?amplitudes[state.reaction]:1.8,angle=Math.random()*Math.PI*2,strength=amplitude*(.35+Math.random()*.65);state.shakeTarget=[Math.cos(angle)*strength,Math.sin(angle)*strength];state.nextShake=ts+(state.reaction?45+Math.random()*65:170+Math.random()*240);}
    if(!shaking)state.shakeTarget=[0,0];
    const shakeSmooth=1-Math.exp(-dt/(state.reaction ? .045 : .11));for(let i=0;i<2;i++)state.shake[i]+=(state.shakeTarget[i]-state.shake[i])*shakeSmooth;
    if(gl){const u=uniforms,v=metrics.view,eyes=model.eyes[state.expression]||[],empty=[-100,-100,1,1];
      gl.uniform2f(u.uSize,canvas.width,canvas.height);gl.uniform2f(u.uFocus,v[0],v[1]);gl.uniform1f(u.uZoom,v[2]);gl.uniform2f(u.uArt,W,H);gl.uniform2f(u.uShake,state.shake[0],state.shake[1]);
      gl.uniform2f(u.uGaze,state.gaze[0]*4.8,state.gaze[1]*3.4);gl.uniform4fv(u.uEyeL,eyes[0]||empty);gl.uniform4fv(u.uEyeR,eyes[1]||empty);gl.uniform1f(u.uBlink,blink);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,indexCount,gl.UNSIGNED_SHORT,0);
    }else $('fallback').style.transform=`translate(${state.shake[0]}px,${state.shake[1]}px)`;
    document.documentElement.dataset.blink=blink>.75?'closed':'open';
    const settling=state.gaze.some((v,i)=>Math.abs(v-state.target[i])>.0001);
    const shakeSettling=state.shake.some((value,index)=>Math.abs(value-state.shakeTarget[index])>.01)||state.shake.some(value=>Math.abs(value)>.01);
    if(state.motion||settling||state.reaction||shakeSettling)requestFrame();
  }
  function resetGaze(){state.target=[0,0];requestFrame();}
  function point(e){updateMetrics();const r=metrics.rect,v=metrics.view;return [(e.clientX-r.left-r.width/2)/metrics.fit+v[0],(e.clientY-r.top-r.height/2)/metrics.fit+v[1]];}
  const reactions=model.reactions || {
    pat:{mood:'happy',duration:900,line:'唔……这样轻轻摸头的话，我很喜欢哦。'},
    poke:{mood:'surprised',duration:760,line:'呀！突然戳过来，吓了我一跳。'},
    pinch:{mood:'shy',duration:980,line:'脸要被捏红啦……轻一点嘛。'},
    rub:{mood:'angry',duration:1160,line:'头发都要被揉乱了，快住手啦。'}
  };
  function react(kind,button){
    const reaction=reactions[kind];if(!reaction||model.id==='seated')return;
    state.reaction=kind;state.reactionStart=0;state.reactionDuration=reaction.duration;state.expression=reaction.mood;state.blinkAt=-100;
    delete document.documentElement.dataset.reaction;void document.documentElement.offsetWidth;document.documentElement.dataset.reaction=kind;
    document.querySelectorAll('[data-action]').forEach(item=>item.classList.toggle('is-active',item===button));
    compose();$('speaker').textContent='柯妮丝';$('dialogue').textContent=reaction.line;requestFrame();
  }
  function refreshCamera(){updateMetrics();feedback();resetGaze();requestFrame();}
  function zoomAt(next,clientX,clientY){
    updateMetrics();const r=metrics.rect;
    const x=clientX==null?r.left+r.width/2:clientX,y=clientY==null?r.top+r.height/2:clientY;
    const anchor=point({clientX:x,clientY:y});
    state.zoom=Math.max(.5,Math.min(4,next));updateMetrics();
    state.focus=[anchor[0]-(x-r.left-r.width/2)/metrics.fit,anchor[1]-(y-r.top-r.height/2)/metrics.fit];refreshCamera();
  }
  function beginGesture(){
    updateMetrics();const ps=[...pointers.values()],a=ps[0];if(!a){gesture=null;return;}
    if(ps.length>=2){const b=ps[1],mid=[(a.x+b.x)/2,(a.y+b.y)/2];gesture={pinch:true,distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),zoom:state.zoom,anchor:point({clientX:mid[0],clientY:mid[1]})};}
    else gesture={pinch:false,x:a.x,y:a.y,focus:[...state.focus],fit:metrics.fit};
  }
  function attachCameraControls(){
    $('reset').addEventListener('click',()=>{pointers.clear();gesture=null;scene.classList.remove('is-dragging');state.focus=model.full.slice(0,2);state.zoom=model.full[2];refreshCamera();});
    $('zoomIn').addEventListener('click',()=>zoomAt(state.zoom*1.2));$('zoomOut').addEventListener('click',()=>zoomAt(state.zoom/1.2));
    scene.addEventListener('pointerdown',e=>{
      if(e.target.closest('button')||e.button>0)return;
      e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});scene.setPointerCapture?.(e.pointerId);scene.classList.add('is-dragging');resetGaze();beginGesture();
    });
    scene.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const ps=[...pointers.values()];
      if(gesture.pinch&&ps.length>=2){const a=ps[0],b=ps[1],mid=[(a.x+b.x)/2,(a.y+b.y)/2];state.zoom=Math.max(.5,Math.min(4,gesture.zoom*Math.hypot(b.x-a.x,b.y-a.y)/gesture.distance));updateMetrics();const r=metrics.rect;state.focus=[gesture.anchor[0]-(mid[0]-r.left-r.width/2)/metrics.fit,gesture.anchor[1]-(mid[1]-r.top-r.height/2)/metrics.fit];}
      else if(!gesture.pinch){const a=ps[0];state.focus=[gesture.focus[0]-(a.x-gesture.x)/gesture.fit,gesture.focus[1]-(a.y-gesture.y)/gesture.fit];}
      refreshCamera();
    });
    function end(e){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(scene.hasPointerCapture?.(e.pointerId))scene.releasePointerCapture(e.pointerId);beginGesture();if(!pointers.size)scene.classList.remove('is-dragging');}
    for(const event of ['pointerup','pointercancel','lostpointercapture'])scene.addEventListener(event,end);
    scene.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?metrics.rect.height:1);zoomAt(state.zoom*Math.exp(-Math.max(-300,Math.min(300,delta))*.002),e.clientX,e.clientY);},{passive:false});
    scene.addEventListener('keydown',e=>{if(e.target!==scene)return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(moves[e.key]){e.preventDefault();updateMetrics();state.focus=state.focus.map((v,i)=>v-moves[e.key][i]*24/metrics.fit);refreshCamera();}else if(['+','=','-','0','Home'].includes(e.key)){e.preventDefault();if(e.key==='0'||e.key==='Home')$('reset').click();else zoomAt(state.zoom*(e.key==='-'?1/1.2:1.2));}});
  }
  function attachControls() {
    $('costume').addEventListener('change',e=>{if(outfits[e.target.value]){state.outfit=e.target.value;compose();}});
    attachCameraControls();
    $('follow').addEventListener('click',()=>{state.follow=!state.follow;resetGaze();feedback();});
    $('motion').addEventListener('click',()=>{state.motion=!state.motion;state.blinkAt=-100;lastTime=0;feedback();requestFrame();});
    document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>react(button.dataset.action,button)));
    scene.addEventListener('pointermove',e=>{if(pointers.size||!state.follow||e.pointerType==='touch'||!gl)return;const p=point(e),h=model.head,dx=(p[0]-(h[0]+h[2]/2))/(W*.22),dy=(p[1]-(h[1]+h[3]/2))/(H*.18);state.target=[Math.tanh(dx),Math.tanh(dy)];requestFrame();});
    scene.addEventListener('pointerleave',resetGaze);scene.addEventListener('pointercancel',resetGaze);
    new ResizeObserver(()=>{updateMetrics();resetGaze();requestFrame();}).observe(scene);
    document.addEventListener('visibilitychange',()=>{lastTime=0;resetGaze();if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else requestFrame();});
    if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;lastTime=0;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else requestFrame();}).observe(scene);
    reduced.addEventListener('change',()=>{if(reduced.matches){state.motion=false;state.follow=false;resetGaze();feedback();requestFrame();}});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(frame)cancelAnimationFrame(frame);frame=0;fallback();compose();updateMetrics();});
  }
  function fallback(){gl=null;state.motion=false;state.follow=false;state.gaze=[0,0];state.target=[0,0];canvas.style.display='none';$('fallback').style.display='block';for(const id of ['follow','motion'])$(id).disabled=true;$('renderNote').textContent=model.id!=='seated'?'静态预览 · 穿搭与动作表情仍可使用':'静态预览 · 穿搭仍可使用';}
  async function load() {
    $('loading').hidden=false;$('retry').hidden=true;
    const assets=[model.base,...Object.values(model.expressions),...Object.values(model.wardrobe),...model.blinkEyes];
    try {
      await Promise.all(assets.map(asset=>new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{images.set(asset.src,image);resolve();};image.onerror=()=>reject(new Error(asset.src));image.src=asset.src;})));
      try{initializeRenderer();}catch(error){console.warn('Character renderer uses the static fallback:',error.message);fallback();}
      compose();ready=true;updateMetrics();attachControls();$('loading').hidden=true;document.documentElement.dataset.ready='true';feedback();requestFrame();
    }catch(error){$('loadingText').textContent='角色素材没有加载完整，请重试。';$('retry').hidden=false;console.error('Character asset failed:',error.message);}
  }
  $('retry').addEventListener('click',load);load();
})();
