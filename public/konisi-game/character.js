/* Genuine Cubism rendering with the original V8 controls and camera.
 * Idle and reaction motion use exported Cubism parameters. The homepage also animates real iris meshes. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = window.KONISI_MODELS[document.body.dataset.pose];
  const companion = document.body.dataset.mode === 'companion';
  const W = model.width, H = model.height;
  const outfits = model.outfits || { original:'原装', tights:'白色裤袜', overknee:'过膝白丝' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const state = { expression:'neutral', outfit:model.defaultOutfit || 'original', focus:model.full.slice(0,2), zoom:companion?1.0:model.full[2], headMotion:companion||!reduced.matches, motion:companion||!reduced.matches, gaze:companion, blink:true, hairPhysics:true, gazeInput:[0,0], gazeTarget:[0,0], preferredExpression:'neutral', headInput:[0,0], target:[0,0], shake:[0,0], shakeTarget:[0,0], nextShake:0, time:0, blinkAt:-100, nextBlink:2.5, reaction:null, reactionStart:0, reactionDuration:0 };
  const canvas = $('character'), scene = $('scene');
  let live2d, compositor, maxHeadInput=30, frame=0, lastTime=0, lastDraw=0, visible=true, intersectionVisible=true, parentVisible=true, ready=false, metrics, controlsAttached=false, loading=false;
  const images = new Map();
  const pointers=new Map();let gesture=null;
  const expressionOptions=['neutral','happy','shy','surprised','angry','sad','blink'];
  function preferences(){return {motion:state.motion,headMotion:state.headMotion,gaze:state.gaze,blink:state.blink,hairPhysics:state.hairPhysics,zoom:state.zoom,outfit:state.outfit,expression:state.preferredExpression};}
  function publishPreferences(){if(companion&&parent!==window)parent.postMessage({type:'konisi-pet-preferences',preferences:preferences()},'*');}
  function applyPreferences(p){
    if(!companion||!p||typeof p!=='object')return;
    for(const key of ['motion','headMotion','gaze','blink','hairPhysics'])if(typeof p[key]==='boolean')state[key]=p[key];
    if(Number.isFinite(p.zoom))state.zoom=Math.max(.75,Math.min(1.25,p.zoom));
    if(['original','tights','overknee'].includes(p.outfit))state.outfit=p.outfit;
    if(expressionOptions.includes(p.expression)){state.preferredExpression=p.expression;if(!state.reaction)state.expression=p.expression;}
    state.blinkAt=-100;lastTime=0;compose();updateMetrics();requestFrame();
  }
  function updateVisibility(){visible=intersectionVisible&&parentVisible;lastTime=0;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else requestFrame();}
  function setPointer(x,y,active){if(!companion)return;state.gazeTarget=active&&Number.isFinite(x)&&Number.isFinite(y)?[Math.max(-1,Math.min(1,x)),Math.max(-1,Math.min(1,y))]:[0,0];requestFrame();}
  if(companion)window.addEventListener('message',event=>{
    if(parent===window||event.source!==parent||!event.data||typeof event.data!=='object')return;
    const data=event.data;
    if(data.type==='konisi-pet-config')applyPreferences(data.preferences);
    else if(data.type==='konisi-pet-pointer'&&typeof data.active==='boolean')setPointer(data.x,data.y,data.active);
    else if(data.type==='konisi-pet-visibility'&&typeof data.visible==='boolean'){parentVisible=data.visible;updateVisibility();}
  });
  function feedback() {
    $('costume').value=state.outfit;
    $('reset').textContent='回到初始位置';
    if($('zoomLevel'))$('zoomLevel').textContent=Math.round(state.zoom/(companion?1:model.full[2])*100)+'%';
    $('headMotion').textContent=state.headMotion?'暂停自然头动':'开启自然头动'; $('headMotion').setAttribute('aria-pressed',String(state.headMotion));
    $('motion').textContent=state.motion?'暂停动作':'继续动作'; $('motion').setAttribute('aria-pressed',String(state.motion));
    for(const [id,key,label] of [['gaze','gaze','目光跟随'],['blink','blink','自动眨眼'],['hairPhysics','hairPhysics','发丝物理']]){
      const button=$(id);if(button){button.textContent=(state[key]?'关闭':'开启')+label;button.setAttribute('aria-pressed',String(state[key]));}
    }
    if($('expression'))$('expression').value=state.preferredExpression;
    $('appearance').textContent=outfits[state.outfit];
    document.documentElement.dataset.expression=state.expression; document.documentElement.dataset.outfit=state.outfit;
  }
  function compose() {
    compositor?.setAppearance({ outfit:state.outfit, expression:state.expression });
    feedback(); requestFrame();
  }
  async function initializeRenderer() {
    const [{ createLive2DRenderer }, { createTextureCompositor }, response] = await Promise.all([
      import(new URL('./live2d/renderer.mjs?v=20261014-pet2',document.baseURI).href), import(new URL('./live2d/texture-compositor.mjs',document.baseURI).href),
      fetch('./live2d/manifest.json', { cache:'no-cache' })
    ]);
    if(!response.ok) throw new Error('Live2D manifest HTTP '+response.status);
    const manifest=await response.json(), pose=manifest.poses?.[model.id];
    if(!pose?.model) throw new Error('This pose has no exported Live2D model.');
    maxHeadInput=Number.isFinite(pose.maxHeadInput)?pose.maxHeadInput:30;
    const modelUrl=new URL(pose.model,new URL('./live2d/manifest.json',document.baseURI)).href;
    const r=scene.getBoundingClientRect();
    live2d=await createLive2DRenderer({canvas,modelUrl,width:Math.max(1,r.width),height:Math.max(1,r.height)});
    if(pose.appearance==='standing-detailed') {
      const {createStandingAppearance}=await import(new URL('./live2d/standing-appearance.mjs',document.baseURI).href);
      compositor=await createStandingAppearance({mapping:live2d.getTextureMapping(),model,images,modelUrl});
    } else {
      compositor=await createTextureCompositor({mapping:live2d.getTextureMapping(),model,images,modelUrl,drawableRoles:pose.drawableRoles});
    }
    if(!live2d.getParameters().some(parameter=>parameter.id==='ParamAngleZ')) throw new Error('The model has no head-motion parameter.');
    document.documentElement.dataset.renderer='cubism';
  }
  function updateMetrics() {
    const r=scene.getBoundingClientRect(),view=[...state.focus,state.zoom];
    // Hidden/minimized frames have no viewport. Keep the last valid one until restored.
    if(r.width<=0||r.height<=0)return;
    metrics={rect:r,view,fit:Math.min(r.width/W,r.height/H)*.96*view[2]};
    if(live2d){
      const dpr=Math.min(devicePixelRatio||1,2),width=Math.max(1,Math.round(r.width*dpr)),height=Math.max(1,Math.round(r.height*dpr));
      if(canvas.width!==width||canvas.height!==height)live2d.resize(r.width,r.height,dpr);
    }
  }

  function requestFrame(){if(ready&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(render);}
  function render(ts) {
    frame=0;
    // Global companion runs at roughly 30 fps while idle to reduce GPU load.
    if(companion&&!state.reaction&&lastDraw&&ts-lastDraw<32){requestFrame();return;}
    lastDraw=ts;
    const dt=lastTime?Math.min((ts-lastTime)/1000,.05):0;lastTime=ts;if(state.motion)state.time+=dt;
    state.target=window.KONISI_IDLE_HEAD.sample(state.time,state.motion&&state.headMotion);
    const smooth=1-Math.exp(-dt/0.105);for(let i=0;i<2;i++)state.headInput[i]+=(state.target[i]-state.headInput[i])*smooth;
    if(state.motion&&state.blink&&state.time>state.nextBlink){state.blinkAt=state.time;state.nextBlink=state.time+3.4+Math.random()*2.2;}
    const age=state.time-state.blinkAt;
    let blink=age<0||age>.2?0:age<.065?age/.065:age<.11?1:(.2-age)/.09;
    if(!state.blink||!state.motion||['happy','laugh','blink'].includes(state.expression))blink=0;
    let reactT=0;
    if(state.reaction){
      if(!state.reactionStart)state.reactionStart=ts;
      reactT=Math.min(1,(ts-state.reactionStart)/state.reactionDuration);
      if(reactT>=1){state.reaction=null;state.reactionStart=0;state.expression=state.preferredExpression;delete document.documentElement.dataset.reaction;document.querySelectorAll('[data-action]').forEach(button=>button.classList.remove('is-active'));compose();reactT=0;}
    }
    const amplitudes=model.amplitudes || {pat:4.5,poke:8,pinch:6.5,rub:10};
    const shaking=state.motion||state.reaction;
    if(shaking&&ts>=state.nextShake){const amplitude=state.reaction?amplitudes[state.reaction]:1.8,angle=Math.random()*Math.PI*2,strength=amplitude*(.35+Math.random()*.65);state.shakeTarget=[Math.cos(angle)*strength,Math.sin(angle)*strength];state.nextShake=ts+(state.reaction?45+Math.random()*65:170+Math.random()*240);}
    if(!shaking)state.shakeTarget=[0,0];
    const shakeSmooth=1-Math.exp(-dt/(state.reaction ? .045 : .11));for(let i=0;i<2;i++)state.shake[i]+=(state.shakeTarget[i]-state.shake[i])*shakeSmooth;
    if(!state.motion&&!state.reaction){state.headInput=[0,0];state.shake=[0,0];state.gazeInput=[0,0];}
    // These values drive the real ParamAngleZ keys bound in Cubism Editor.
    // The source expression and outfit patches follow that model's UV mapping.
    const cycles={pat:1,poke:2,pinch:1.5,rub:3,tickle:5};
    const reactionAngle=state.reaction&&(companion||!reduced.matches)
      ? Math.sin(Math.PI*reactT)*Math.sin(reactT*Math.PI*2*(cycles[state.reaction]||1))*20 : 0;
    try {
      live2d.setParameterById('ParamAngleZ',Math.max(-maxHeadInput,Math.min(maxHeadInput,state.headInput[0]*70+reactionAngle)));
      live2d.setCamera({focus:state.focus,zoom:state.zoom,offset:state.shake});
      compositor.apply(live2d,blink);
      const gazeEnabled=companion&&state.gaze&&state.motion&&state.expression==='neutral';
      for(let i=0;i<2;i++)state.gazeInput[i]+=((gazeEnabled?state.gazeTarget[i]:0)-state.gazeInput[i])*smooth;
      live2d.setGaze?.(state.gazeInput[0],state.gazeInput[1],{enabled:gazeEnabled,strength:1-blink});
      live2d.setPhysicsEnabled?.(state.hairPhysics);

      if(!state.motion&&!state.reaction) {
        // Paused/reduced motion stays still, including native hair inertia.
        live2d.resetPhysics();
        live2d.update(0);
      } else {
        live2d.update(dt);
      }
      if(!live2d.draw()) throw new Error('Live2D rendering context is unavailable.');
    }catch(error){showFailure(error);return;}
    document.documentElement.dataset.blink=blink>.75?'closed':'open';
    const settling=state.headInput.some((v,i)=>Math.abs(v-state.target[i])>.0001);
    const shakeSettling=state.shake.some((value,index)=>Math.abs(value-state.shakeTarget[index])>.01)||state.shake.some(value=>Math.abs(value)>.01);
    const gazeSettling=state.gazeInput.some((v,i)=>Math.abs(v-(state.motion&&state.gaze?state.gazeTarget[i]:0))>.0001);
    if(state.motion||settling||state.reaction||shakeSettling||gazeSettling)requestFrame();
  }
  function settleHead(){state.target=[0,0];requestFrame();}
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
  function refreshCamera(){updateMetrics();feedback();settleHead();requestFrame();}
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
      e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});scene.setPointerCapture?.(e.pointerId);scene.classList.add('is-dragging');settleHead();beginGesture();
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
    $('costume').addEventListener('change',e=>{if(outfits[e.target.value]){state.outfit=e.target.value;compose();publishPreferences();}});
    if(!companion) attachCameraControls();
    else {
      $('reset').addEventListener('click',()=>{state.focus=model.full.slice(0,2);state.zoom=1;refreshCamera();publishPreferences();});
      $('zoomIn').addEventListener('click',()=>{state.zoom=Math.min(1.25,state.zoom+.05);refreshCamera();publishPreferences();});
      $('zoomOut').addEventListener('click',()=>{state.zoom=Math.max(.75,state.zoom-.05);refreshCamera();publishPreferences();});
      $('expression').addEventListener('change',e=>{if(expressionOptions.includes(e.target.value)){state.reaction=null;state.reactionStart=0;delete document.documentElement.dataset.reaction;document.querySelectorAll('[data-action]').forEach(button=>button.classList.remove('is-active'));state.expression=state.preferredExpression=e.target.value;compose();publishPreferences();}});
      for(const key of ['gaze','blink','hairPhysics'])$(key).addEventListener('click',()=>{state[key]=!state[key];state.blinkAt=-100;feedback();requestFrame();publishPreferences();});
      const panel=$('petSettings'),toggle=$('settingsToggle');
      function showSettings(open){panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)$('costume').focus();}
      toggle.addEventListener('click',()=>showSettings(panel.hidden));
      $('settingsClose').addEventListener('click',()=>{showSettings(false);toggle.focus();});
      document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){showSettings(false);toggle.focus();}});
      scene.addEventListener('pointermove',e=>{const r=scene.getBoundingClientRect();setPointer((e.clientX-r.left-r.width/2)/(r.width/2),(e.clientY-r.top-r.height/2)/(r.height/2),true);});
      scene.addEventListener('pointerleave',()=>setPointer(0,0,false));
      scene.addEventListener('click',e=>{if(!e.target.closest('button'))react('pat',scene);});
      scene.addEventListener('keydown',e=>{if(e.target===scene&&['Enter',' '].includes(e.key)){e.preventDefault();react('pat',scene);}});
    }
    $('headMotion').addEventListener('click',()=>{state.headMotion=!state.headMotion;settleHead();feedback();publishPreferences();});
    $('motion').addEventListener('click',()=>{state.motion=!state.motion;state.blinkAt=-100;lastTime=0;feedback();requestFrame();publishPreferences();});
    document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>react(button.dataset.action,button)));
    // Level poses keep their original camera controls. Homepage input only follows eyes.
    new ResizeObserver(()=>{updateMetrics();settleHead();requestFrame();}).observe(scene);
    document.addEventListener('visibilitychange',()=>{lastTime=0;settleHead();if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else requestFrame();});
    if('IntersectionObserver' in window)new IntersectionObserver(entries=>{intersectionVisible=entries[0].isIntersecting;updateVisibility();}).observe(scene);
    reduced.addEventListener('change',()=>{if(!companion&&reduced.matches){state.motion=false;state.headMotion=false;settleHead();feedback();requestFrame();}});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();showFailure(new Error('WebGL context lost.'));});
    window.addEventListener('pagehide',()=>{if(frame)cancelAnimationFrame(frame);frame=0;});
    window.addEventListener('pageshow',()=>{lastTime=0;requestFrame();});
  }
  function setControlsDisabled(disabled){
    document.querySelectorAll('.settings button,.settings select,[data-action],.zoom-tools button').forEach(control=>{control.disabled=disabled;});
  }
  function showFailure(error){
    ready=false;if(frame)cancelAnimationFrame(frame);frame=0;
    document.documentElement.dataset.ready='false';document.documentElement.dataset.renderer='error';
    setControlsDisabled(true);$('loading').hidden=false;$('retry').hidden=false;
    $('loadingText').textContent='角色模型暂时无法显示，请重新加载。';
    $('renderNote').textContent='角色暂时不可用';
    console.error('Live2D character failed:',error.message);
  }
  async function load() {
    if(loading)return;loading=true;ready=false;setControlsDisabled(true);
    $('loading').hidden=false;$('loadingText').textContent='正在准备角色…';$('retry').hidden=true;
    live2d?.dispose();live2d=null;compositor=null;
    const assets=[model.base,...Object.values(model.expressions),...Object.values(model.wardrobe),...model.blinkEyes];
    try {
      await Promise.all(assets.map(asset=>images.has(asset.src)?Promise.resolve():new Promise((resolve,reject)=>{
        const image=new Image();image.crossOrigin='anonymous';
        image.onload=()=>{images.set(asset.src,image);resolve();};image.onerror=()=>reject(new Error(asset.src));image.src=asset.src;
      })));
      await initializeRenderer();compose();ready=true;updateMetrics();
      if(!controlsAttached){attachControls();controlsAttached=true;}
      $('loading').hidden=true;setControlsDisabled(false);document.documentElement.dataset.ready='true';
      $('renderNote').textContent=companion?'自然头动、眨眼与目光跟随':'自然头动与眨眼';feedback();lastTime=0;requestFrame();if(companion&&parent!==window)parent.postMessage({type:'konisi-pet-ready'},'*');
    }catch(error){live2d?.dispose();live2d=null;compositor=null;showFailure(error);}
    finally{loading=false;}
  }
  // Read-only diagnostics for integration verification. No account or pointer data leaves this page.
  Object.defineProperty(window,'KONISI_LIVE2D',{value:Object.freeze({snapshot:({vertices=false}={})=>({
    pose:model.id,ready,time:state.time,zoom:state.zoom,focus:[...state.focus],gazeTracking:companion&&state.gaze,gaze:[...state.gazeInput],pointerTarget:[...state.gazeTarget],blinkEnabled:state.blink,hairPhysics:state.hairPhysics,preferences:preferences(),headMotion:state.headMotion,motion:state.motion,expression:state.expression,outfit:state.outfit,
    status:live2d?.getStatus()||null,parameters:ready?live2d.getParameters():[],
    drawables:ready?live2d.getDrawables({vertices}):[],appearance:compositor?.getStatus()||null,
    physics:ready?live2d.getPhysicsStatus():null
  })})});
  $('retry').addEventListener('click',load);load();
})();
