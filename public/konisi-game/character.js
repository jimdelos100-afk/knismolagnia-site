/* Both poses share one renderer. Expressions and blinking are independent states. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = window.KONISI_MODELS[document.body.dataset.pose];
  const W = model.width, H = model.height;
  const outfits = { original:'原装', tights:'白色裤袜', overknee:'过膝白丝' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const state = { expression:'neutral', outfit:'original', full:true, follow:!reduced.matches, motion:!reduced.matches, gaze:[0,0], target:[0,0], time:0, blinkAt:-100, nextBlink:2.5, reaction:null, reactionStart:0, reactionDuration:0 };
  const canvas = $('character'), scene = $('scene');
  let gl, program, texture, uniforms, indexCount, open, closed, frame=0, lastTime=0, visible=true, ready=false, metrics;
  const images = new Map();
  function makeCanvas() { const c=document.createElement('canvas'); c.width=W; c.height=H; return c; }
  function paint(ctx, asset) { ctx.drawImage(images.get(asset.src),asset.x,asset.y,asset.width,asset.height); }
  function feedback() {
    $('costume').value=state.outfit;
    $('view').textContent=state.full?'查看半身':'查看全身'; $('view').setAttribute('aria-pressed',String(!state.full));
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
    if(!['happy','blink'].includes(state.expression)) for(const eye of model.blinkEyes) paint(cg,eye);
    if(gl) for(let i=0;i<2;i++) { gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,texture[i]); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,i?closed:open); }
    else $('fallback').src=open.toDataURL();
    feedback(); requestFrame();
  }
  function initializeRenderer() {
    gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl) throw new Error('WebGL unavailable');
    const vs=`attribute vec2 aPos;attribute vec2 aUV;varying vec2 vUV;uniform vec2 uSize;uniform vec2 uFocus;uniform float uZoom;uniform mediump vec2 uArt;uniform float uTime;uniform float uMotion;uniform float uSeated;uniform float uReact;uniform float uReactT;
      void main(){vec2 p=aPos;float x=p.x,y=p.y;float breath=sin(uTime*1.8)*uMotion;float upper;float head;
      if(uSeated>.5){float torso=smoothstep(410.,480.,y)*(1.-smoothstep(630.,735.,y))*smoothstep(270.,345.,x)*(1.-smoothstep(550.,650.,x));p.y-=breath*1.5*torso;float hair=smoothstep(370.,530.,y)*(1.-smoothstep(690.,770.,y))*max(1.-smoothstep(210.,300.,x),smoothstep(640.,745.,x));p.x+=sin(uTime*1.4+y*.008)*2.8*hair*uMotion;upper=1.-smoothstep(780.,1180.,y);head=(1.-smoothstep(470.,560.,y))*smoothstep(150.,250.,y);}
      else{float torso=smoothstep(315.,400.,y)*(1.-smoothstep(625.,770.,y))*smoothstep(350.,430.,x)*(1.-smoothstep(650.,760.,x));p.y-=breath*1.7*torso;float hair=smoothstep(340.,490.,y)*(1.-smoothstep(850.,970.,y))*max(1.-smoothstep(285.,410.,x),smoothstep(680.,800.,x));p.x+=sin(uTime*1.4+y*.007)*2.8*hair*uMotion;upper=1.-smoothstep(920.,1320.,y);head=1.-smoothstep(300.,390.,y);}
      p.x+=sin(uTime*.72)*3.2*upper*uMotion;p.y+=sin(uTime*.46+1.2)*1.2*upper*uMotion;
      float pulse=pow(max(0.,sin(uTime*.38)),14.)*uMotion;p.x+=pulse*2.2*head;
      float wave=sin(3.1415926*uReactT);if(uReact>.5&&uReact<1.5)p.y+=wave*6.*head;if(uReact>1.5&&uReact<2.5)p.x-=wave*10.*upper;if(uReact>2.5&&uReact<3.5)p.x+=sin(uReactT*12.566)*4.*head*wave;if(uReact>3.5)p.x+=sin(uReactT*18.85)*5.*head*wave;
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
    uniforms={};for(const name of ['uSize','uFocus','uZoom','uArt','uTime','uMotion','uSeated','uReact','uReactT','uGaze','uEyeL','uEyeR','uBlink'])uniforms[name]=gl.getUniformLocation(program,name);
    texture=[];for(let i=0;i<2;i++){const t=gl.createTexture();texture.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.uniform1i(gl.getUniformLocation(program,i?'uClosed':'uOpen'),i);}
    gl.clearColor(0,0,0,0);
  }
  function updateMetrics() {
    const r=scene.getBoundingClientRect(),view=state.full?model.full:model.bust;
    metrics={rect:r,view,fit:Math.min(r.width/W,r.height/H)*.96*view[2]};
    const dpr=Math.min(devicePixelRatio||1,2),width=Math.max(1,Math.round(r.width*dpr)),height=Math.max(1,Math.round(r.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;if(gl)gl.viewport(0,0,width,height);}
    if(!gl){const img=$('fallback');img.style.width=W*metrics.fit+'px';img.style.height=H*metrics.fit+'px';img.style.left=(r.width/2-view[0]*metrics.fit)+'px';img.style.top=(r.height/2-view[1]*metrics.fit)+'px';}
  }
  function requestFrame(){if(ready&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(render);}
  function render(ts) {
    frame=0;const dt=lastTime?Math.min((ts-lastTime)/1000,.05):0;lastTime=ts;if(state.motion)state.time+=dt;
    const smooth=1-Math.exp(-dt/0.095);for(let i=0;i<2;i++)state.gaze[i]+=(state.target[i]-state.gaze[i])*smooth;
    if(state.motion&&state.time>state.nextBlink){state.blinkAt=state.time;state.nextBlink=state.time+3.4+Math.random()*2.2;}
    const age=state.time-state.blinkAt;
    let blink=age<0||age>.2?0:age<.065?age/.065:age<.11?1:(.2-age)/.09;
    if(['happy','blink'].includes(state.expression))blink=0;
    let react=0,reactT=0;
    if(state.reaction){
      if(!state.reactionStart)state.reactionStart=ts;
      reactT=Math.min(1,(ts-state.reactionStart)/state.reactionDuration);
      react={pat:1,poke:2,pinch:3,rub:4}[state.reaction]||0;
      if(reactT>=1){state.reaction=null;state.reactionStart=0;state.expression='neutral';delete document.documentElement.dataset.reaction;document.querySelectorAll('[data-action]').forEach(button=>button.classList.remove('is-active'));compose();react=0;reactT=0;}
    }
    if(gl){const u=uniforms,v=metrics.view,eyes=model.eyes[state.expression]||[],empty=[-100,-100,1,1];
      gl.uniform2f(u.uSize,canvas.width,canvas.height);gl.uniform2f(u.uFocus,v[0],v[1]);gl.uniform1f(u.uZoom,v[2]);gl.uniform2f(u.uArt,W,H);gl.uniform1f(u.uTime,state.time);gl.uniform1f(u.uMotion,state.motion ? .6 : 0);gl.uniform1f(u.uSeated,model.id==='seated'?1:0);
      gl.uniform1f(u.uReact,react);gl.uniform1f(u.uReactT,reactT);
      gl.uniform2f(u.uGaze,state.gaze[0]*2.6,state.gaze[1]*1.8);gl.uniform4fv(u.uEyeL,eyes[0]||empty);gl.uniform4fv(u.uEyeR,eyes[1]||empty);gl.uniform1f(u.uBlink,blink);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,indexCount,gl.UNSIGNED_SHORT,0);
    }
    document.documentElement.dataset.blink=blink>.75?'closed':'open';
    const settling=state.gaze.some((v,i)=>Math.abs(v-state.target[i])>.0001);
    if(state.motion||settling||state.reaction)requestFrame();
  }
  function resetGaze(){state.target=[0,0];requestFrame();}
  function point(e){updateMetrics();const r=metrics.rect,v=metrics.view;return [(e.clientX-r.left-r.width/2)/metrics.fit+v[0],(e.clientY-r.top-r.height/2)/metrics.fit+v[1]];}
  const reactions={
    pat:{mood:'happy',duration:900,line:'唔……这样轻轻摸头的话，我很喜欢哦。'},
    poke:{mood:'surprised',duration:760,line:'呀！突然戳过来，吓了我一跳。'},
    pinch:{mood:'shy',duration:980,line:'脸要被捏红啦……轻一点嘛。'},
    rub:{mood:'angry',duration:1160,line:'头发都要被揉乱了，快住手啦。'}
  };
  function react(kind,button){
    const reaction=reactions[kind];if(!reaction||model.id!=='standing')return;
    state.reaction=kind;state.reactionStart=0;state.reactionDuration=reaction.duration;state.expression=reaction.mood;state.blinkAt=-100;
    delete document.documentElement.dataset.reaction;void document.documentElement.offsetWidth;document.documentElement.dataset.reaction=kind;
    document.querySelectorAll('[data-action]').forEach(item=>item.classList.toggle('is-active',item===button));
    compose();$('speaker').textContent='柯妮丝';$('dialogue').textContent=reaction.line;requestFrame();
  }
  function attachControls() {
    $('costume').addEventListener('change',e=>{if(outfits[e.target.value]){state.outfit=e.target.value;compose();}});
    $('view').addEventListener('click',()=>{state.full=!state.full;resetGaze();updateMetrics();feedback();requestFrame();});
    $('follow').addEventListener('click',()=>{state.follow=!state.follow;resetGaze();feedback();});
    $('motion').addEventListener('click',()=>{state.motion=!state.motion;state.blinkAt=-100;lastTime=0;feedback();requestFrame();});
    document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>react(button.dataset.action,button)));
    scene.addEventListener('pointermove',e=>{if(!state.follow||e.pointerType==='touch'||!gl)return;const p=point(e),h=model.head,dx=(p[0]-(h[0]+h[2]/2))/(W*.3),dy=(p[1]-(h[1]+h[3]/2))/(H*.25);state.target=[Math.tanh(dx),Math.tanh(dy)];requestFrame();});
    scene.addEventListener('pointerleave',resetGaze);scene.addEventListener('pointercancel',resetGaze);
    new ResizeObserver(()=>{updateMetrics();resetGaze();requestFrame();}).observe(scene);
    document.addEventListener('visibilitychange',()=>{lastTime=0;resetGaze();if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else requestFrame();});
    if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;lastTime=0;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else requestFrame();}).observe(scene);
    reduced.addEventListener('change',()=>{if(reduced.matches){state.motion=false;state.follow=false;resetGaze();feedback();requestFrame();}});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(frame)cancelAnimationFrame(frame);frame=0;fallback();compose();updateMetrics();});
  }
  function fallback(){gl=null;state.motion=false;state.follow=false;state.gaze=[0,0];state.target=[0,0];canvas.style.display='none';$('fallback').style.display='block';for(const id of ['follow','motion'])$(id).disabled=true;$('renderNote').textContent=model.id==='standing'?'静态预览 · 穿搭与动作表情仍可使用':'静态预览 · 穿搭仍可使用';}
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
