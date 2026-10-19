/* Genuine Cubism renderer with optional official motion/expression playback.
 * Native eye rigs require a hash-bound contract and measurable Core changes.
 * Legacy copied-vertex gaze is used only without that explicit native contract.
 * Framework/Core retain their own Live2D licenses; see vendor/licenses/.
 */
import { cameraMatrix, assetURL } from './camera-math.mjs';
import { validatePhysicsSettings } from './physics-validation.mjs';
import { createStandingGaze } from './standing-gaze.mjs';
import { createAnimationPlayback } from './animation-playback.mjs';

let corePromise;
let frameworkPromise;
let CubismFramework, CubismMoc, CubismMatrix44, CubismRenderer_WebGL, CubismShaderManager_WebGL, CubismPhysics;
let animationFramework;
let users = 0;
let ownsFramework = false;
const activeCanvases = new WeakSet();

async function ensureCore(coreURL) {
  if (globalThis.Live2DCubismCore?.Moc) return;
  if (!corePromise) corePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let timeout;
    const done = error => {
      clearTimeout(timeout); script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    script.src = coreURL; script.async = true;
    script.onload = () => done(globalThis.Live2DCubismCore?.Moc ? null : new Error('Cubism Core did not initialize.'));
    script.onerror = () => done(new Error('Unable to load local Cubism Core: ' + coreURL));
    timeout = setTimeout(() => done(new Error('Cubism Core loading timed out.')), 30000);
    document.head.appendChild(script);
  }).catch(error => { corePromise = null; throw error; });
  await corePromise;
}

function retainFramework() {
  if (!CubismFramework.isInitialized()) {
    if (!CubismFramework.startUp()) throw new Error('Cubism Framework failed to start.');
    CubismFramework.initialize(); ownsFramework = true;
  }
  users++;
}

async function readBuffer(url, signal) {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Live2D asset HTTP ' + response.status + ': ' + url);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error('Empty Live2D asset: ' + url);
  return bytes;
}

async function decodeTexture(bytes) {
  // HTMLImageElement preserves the browser's normal image orientation.
  const url = URL.createObjectURL(new Blob([bytes]));
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty texture dimensions.');
    return image;
  } finally { URL.revokeObjectURL(url); }
}

/** Create one independent renderer for a dedicated, previously unused canvas. */
export async function createLive2DRenderer(options) {
  const { canvas, modelUrl, coreUrl = new URL('./vendor/live2dcubismcore.min.js', import.meta.url).href } = options || {};
  if (!canvas?.getContext || !modelUrl) throw new TypeError('canvas and modelUrl are required.');
  if (activeCanvases.has(canvas)) throw new Error('This canvas already has a Live2D renderer.');
  await ensureCore(coreUrl);
  // Framework references Core constants while its module is evaluated.
  // Import it only after the Core script has initialized, including cold loads.
  if (!frameworkPromise) frameworkPromise = import('./vendor/cubism-framework-5-r.5.mjs').then(module => {
    ({ CubismFramework, CubismMoc, CubismMatrix44, CubismRenderer_WebGL, CubismShaderManager_WebGL, CubismPhysics } = module);
    animationFramework = module;
  }).catch(error => { frameworkPromise = null; throw error; });
  await frameworkPromise;
  // Reserve after awaiting Core so concurrent calls cannot claim one canvas.
  if (activeCanvases.has(canvas)) throw new Error('This canvas already has a Live2D renderer.');
  activeCanvases.add(canvas);
  let instance;
  try {
    instance = new Live2DRenderer(canvas, options);
    await instance.load(modelUrl);
    return instance;
  } catch (error) {
    instance?.dispose(); activeCanvases.delete(canvas); throw error;
  }
}

class Live2DRenderer {
  constructor(canvas, options) {
    this.canvas = canvas; this.options = options;
    this.abortController = new AbortController();
    this.textures = []; this.textureDimensions = []; this.defaultMapping = null;
    this.moc = null; this.model = null; this.renderer = null; this.physics = null;
    this.gaze = null; this.nativeRig = null; this.nativeGaze = null; this.blinkAmount = 0;
    this.headFollow = { enabled: false, input: [0, 0], angle: 0, appliedAngle: 0 };
    this.animation = null; this.baseParameterValues = new Map(); this.layerParameterIds = new Set(); this.disabledAnimatedParameters = new Set(); this.physicsEnabled = true;
    this.physicsInfo = { loaded: false, reason: 'No Physics reference in model3.', inputIds: [], outputIds: [], evaluations: 0 };
    this.retained = false; this.disposed = false;
    this.parameterIndices = new Map(); this.partIndices = new Map();
    this.drawableIndices = new Map(); this.drawableOpacities = new Map();
    this.viewport = { width: 1, height: 1 };
    this.camera = { focus: [0, 0], zoom: 1, padding: .96, offset: [0, 0] };
    this.status = { phase: 'loading', coreLoaded: true, modelLoaded: false,
      shadersReady: false, framesDrawn: 0, visualVerified: false, gazeTracking: false,
      automaticAnimation: false, sdkVersion: '5-r.5', coreVersion: globalThis.Live2DCubismCore.Version.csmGetVersion() };
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true,
      premultipliedAlpha: true, preserveDrawingBuffer: !!options.preserveDrawingBuffer });
    if (!this.gl) throw new Error('WebGL is unavailable for the Live2D canvas.');
    this.onContextLost = event => { event.preventDefault(); this.status.phase = 'context-lost'; this.status.shadersReady = false; };
    this.onContextRestored = () => { this.status.phase = 'reload-required'; };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    retainFramework(); this.retained = true;
  }

  async load(modelUrl) {
    const url = new URL(modelUrl, document.baseURI);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Serve model files through HTTP(S), not file URLs.');
    this.modelUrl = url.href;
    const signal = this.abortController.signal;
    const raw = await readBuffer(url.href, signal);
    const settings = JSON.parse(new TextDecoder().decode(raw).replace(/^\uFEFF/, ''));
    const refs = settings?.FileReferences;
    if (settings?.Version !== 3 || !refs || !Array.isArray(refs.Textures) || !refs.Textures.length) throw new Error('Expected model3 Version 3 with Moc and Textures.');
    const mocBytes = await readBuffer(assetURL(refs.Moc, url.href), signal);
    if (this.options.nativeRig) {
      if (!/^[a-f\d]{64}$/i.test(this.options.nativeRig.mocSha256 || '')) throw new Error('Native eye rig requires the exported MOC3 SHA-256.');
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', mocBytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== this.options.nativeRig.mocSha256.toLowerCase()) throw new Error('Native eye rig contract does not match this MOC3.');
    }
    const core = globalThis.Live2DCubismCore;
    const mocVersion = core.Version.csmGetMocVersion(mocBytes);
    const latestMocVersion = core.Version.csmGetLatestMocVersion();
    if (!mocVersion || mocVersion > latestMocVersion) throw new Error('This .moc3 is unsupported by the loaded Cubism Core.');
    this.moc = CubismMoc.create(mocBytes, true);
    if (!this.moc) throw new Error('Cubism Core rejected the .moc3 integrity or model data.');
    this.model = this.moc.createModel();
    if (!this.model || this.model.getDrawableCount() === 0) throw new Error('Cubism Core did not create a drawable model.');
    const nativeModel = this.model.getModel();
    this.info = { ...nativeModel.canvasinfo };
    for (const key of ['CanvasWidth', 'CanvasHeight', 'CanvasOriginX', 'CanvasOriginY', 'PixelsPerUnit']) this.info[key] = nativeModel.canvasinfo[key];
    this.camera.focus = [this.info.CanvasWidth / 2, this.info.CanvasHeight / 2];
    nativeModel.parameters.ids.forEach((id, index) => this.parameterIndices.set(id, index));
    nativeModel.parameters.ids.forEach((id, index) => this.baseParameterValues.set(id, this.model.getParameterValueByIndex(index)));
    nativeModel.parts.ids.forEach((id, index) => this.partIndices.set(id, index));
    nativeModel.drawables.ids.forEach((id, index) => this.drawableIndices.set(id, index));
    // App appearance factors are applied at the Framework accessor. Core's
    // read-only drawable buffers and the exported MOC3 remain unchanged.
    const originalOpacity = this.model.getDrawableOpacity.bind(this.model);
    this.model.getDrawableOpacity = index => originalOpacity(index) * (this.drawableOpacities.get(index) ?? 1);
    this.resize(this.options.width || this.canvas.clientWidth || this.canvas.width || 1,
      this.options.height || this.canvas.clientHeight || this.canvas.height || 1, this.options.dpr);
    this.renderer = new CubismRenderer_WebGL(this.canvas.width, this.canvas.height);
    this.renderer.initialize(this.model); this.renderer.startUp(this.gl);
    this.renderer.setIsPremultipliedAlpha(true);
    const gl = this.gl;
    for (let index = 0; index < refs.Textures.length; index++) {
      const image = await decodeTexture(await readBuffer(assetURL(refs.Textures[index], url.href), signal));
      if (signal.aborted) throw new Error('Live2D loading cancelled.');
      if (Math.max(image.naturalWidth, image.naturalHeight) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Texture exceeds this device’s WebGL limit.');
      const texture = gl.createTexture();
      if (!texture) throw new Error('Unable to allocate Live2D texture.');
      this.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
      this.textureDimensions.push({ width: image.naturalWidth, height: image.naturalHeight });
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL texture upload failed.');
      this.renderer.bindTexture(index, texture);
    }
    const shaderUrl = new URL('./vendor/shaders/', import.meta.url).href;
    this.renderer.loadShaders(shaderUrl);
    // R5 loads its official shader files asynchronously but exposes no Promise.
    // This adapter is pinned to R5 and waits for its documented source fields.
    const shader = CubismShaderManager_WebGL.getInstance().getShader(gl);
    const deadline = performance.now() + 60000;
    while (!shader._isShaderLoaded) {
      if (signal.aborted) throw new Error('Live2D loading cancelled.');
      if (!shader._isShaderLoading || performance.now() > deadline) throw new Error('Official Cubism shaders did not load.');
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    // R5 reserves three unassigned tail slots for Normal + Over, which uses
    // the standard shader instead. Validate assigned programs plus all 11
    // required standard/copy entries, rather than treating reserved slots as errors.
    const programs = shader._shaderSets.filter(set => set?.shaderProgram !== undefined);
    if (shader._shaderSets.slice(0, 11).some(set => !set?.shaderProgram)
      || programs.length < 11
      || programs.some(set => !set.shaderProgram || !gl.getProgramParameter(set.shaderProgram, gl.LINK_STATUS))) throw new Error('Official Cubism shader compilation failed.');
    this.model.update();
    // Keep default geometry separate from the parameter-driven vertices returned later.
    this.defaultMapping = this.getDrawables({ vertices: true }).map(drawable => ({
      ...drawable,
      uvs: Array.from(this.model.getDrawableVertexUvs(drawable.index)),
      indices: Array.from(this.model.getDrawableVertexIndices(drawable.index)),
    }));
    await this.loadPhysics(refs, url.href, signal);
    this.animation = await createAnimationPlayback({ framework: animationFramework, model: this.model,
      parameters: this.getParameters(), references: refs, modelUrl: url.href, readBuffer, signal });
    for (const id of this.animation.parameterIds) this.layerParameterIds.add(id);
    if (this.options.nativeRig) this.configureNativeRig(this.options.nativeRig);
    else this.gaze = createStandingGaze({ model: this.model, canvasInfo: this.info });
    Object.assign(this.status, { phase: 'ready', modelLoaded: true, shadersReady: true,
      mocVersion, latestMocVersion, drawableCount: this.model.getDrawableCount(),
      textureCount: this.textures.length, parameterCount: this.parameterIndices.size,
      partCount: this.partIndices.size,
      optionalReferencesNotPlayed: Object.keys(refs).filter(key => !['Moc', 'Textures', 'DisplayInfo', 'UserData', 'Physics', 'Motions', 'Expressions'].includes(key)),
    });
  }

  async loadPhysics(refs, modelUrl, signal) {
    if (!refs.Physics) return;
    const url = assetURL(refs.Physics, modelUrl);
    const bytes = await readBuffer(url, signal);
    const json = JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''));
    // The SDK synthesizes unknown parameter IDs. Reject them here so an
    // unbound/absent hair parameter can never be mistaken for a completed rig.
    const descriptor = validatePhysicsSettings(json, this.getParameters());
    this.physics = CubismPhysics.create(bytes, bytes.byteLength);
    if (!this.physics) throw new Error('Cubism Physics rejected the physics3 file.');
    this.physicsInfo = { loaded: true, url, ...descriptor, evaluations: 0, reason: null };
    this.physics.stabilization(this.model);
    this.model.update();
  }

  getPhysicsStatus() { return structuredClone({ ...this.physicsInfo, enabled: !!this.physics && this.physicsEnabled }); }

  setPhysicsEnabled(enabled) {
    this.assertModel();
    if (typeof enabled !== 'boolean') throw new TypeError('Physics enabled must be a boolean.');
    if (this.physicsEnabled === enabled) return this;
    this.physicsEnabled = enabled;
    if (this.physics) {
      // Reset once per transition, not on every paused frame. Enabling starts
      // from stable particles; disabling leaves hair outputs at native defaults.
      this.resetPhysics();
      if (!enabled) {
        for (const id of this.physicsInfo.outputIds) {
          const index = this.parameterIndices.get(id);
          this.model.setParameterValueByIndex(index, this.model.getParameterDefaultValue(index));
        }
        this.model.update();
      }
    }
    return this;
  }

  setGaze(x, y, options = {}) {
    this.assertModel();
    if (this.nativeRig) {
      const enabled = options.enabled ?? true, strength = options.strength ?? 1;
      if (![x, y, strength].every(Number.isFinite) || typeof enabled !== 'boolean') throw new TypeError('Native gaze requires finite coordinates/strength and boolean enabled.');
      if (!enabled && (this.nativeGaze.enabled || !this.nativeGaze.commanded)) {
        for (const id of [this.nativeRig.gaze.x, this.nativeRig.gaze.y]) this.setParameterById(id, this.model.getParameterDefaultValue(this.parameterIndices.get(id)));
      }
      this.nativeGaze = { enabled, strength: Math.max(0, Math.min(1, strength)),
        commanded: true, input: enabled ? [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))] : [0, 0] };
      this.status.gazeTracking = enabled && strength > 0; return true;
    }
    const supported = this.gaze?.set(x, y, options) ?? false;
    this.status.gazeTracking = this.gaze?.getStatus().enabled ?? false;
    return supported;
  }

  // A small additive side tilt uses the model's existing real AngleZ rig.
  // Horizontal facing is a display mirror; no unbound AngleX/Y is driven here.
  setHeadFollow(x, y, { enabled = true } = {}) {
    this.assertModel();
    if (![x, y].every(Number.isFinite) || typeof enabled !== 'boolean') throw new TypeError('Head follow requires finite coordinates and boolean enabled.');
    this.headFollow.enabled = enabled && !!this.nativeRig && this.parameterIndices.has('ParamAngleZ');
    this.headFollow.input = this.headFollow.enabled ? [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))] : [0, 0];
    if (!this.headFollow.enabled) this.headFollow.angle = this.headFollow.appliedAngle = 0;
    return this.headFollow.enabled;
  }

  applyHeadFollow(deltaSeconds) {
    const follow = this.headFollow;
    follow.appliedAngle = 0;
    if (!follow.enabled) return;
    const index = this.parameterIndices.get('ParamAngleZ');
    if (index === undefined) return;
    // AngleZ is in exported parameter units. This rig maps +30 to roughly
    // 1.5 degrees clockwise, so a positive input leans toward screen right.
    const target = follow.input[0] * 4;
    follow.angle += (target - follow.angle) * (1 - Math.exp(-deltaSeconds / .18));
    const current = this.model.getParameterValueByIndex(index);
    const minimum = Math.max(-15, this.model.getParameterMinimumValue(index));
    const maximum = Math.min(15, this.model.getParameterMaximumValue(index));
    const next = Math.max(minimum, Math.min(maximum, current + follow.angle));
    this.model.setParameterValueByIndex(index, next);
    follow.appliedAngle = next - current;
  }

  getGazeStatus() {
    if (this.nativeRig) return { supported: true, ...this.nativeGaze, nativeEyeBallParametersUsed: true,
      nativeBuffersModified: false, method: 'Hash-verified native Cubism EyeBall parameters',
      parameterIds: { ...this.nativeRig.gaze }, bindingEvidence: structuredClone(this.nativeRig.bindingEvidence) };
    return this.gaze?.getStatus() ?? { supported: false, enabled: false };
  }

  configureNativeRig(contract) {
    const ids = [contract.gaze?.x, contract.gaze?.y, contract.blink?.left, contract.blink?.right];
    if (ids.some(id => typeof id !== 'string' || !this.parameterIndices.has(id)) || new Set(ids).size !== 4) throw new Error('Native rig requires four distinct existing eye parameters.');
    const saved = this.getParameters(), evidence = {};
    const capture = () => this.getDrawables({ vertices: true });
    const restore = () => { for (const item of saved) this.model.setParameterValueByIndex(this.parameterIndices.get(item.id), item.value); this.model.update(); };
    try {
      for (const id of ids) {
        const index = this.parameterIndices.get(id), min = this.model.getParameterMinimumValue(index), max = this.model.getParameterMaximumValue(index);
        if (min >= max) throw new Error('Native eye parameter has no range: ' + id);
        restore(); const baseline = capture(); let vertexDelta = 0, opacityDelta = 0;
        for (const value of [min, max]) {
          this.model.setParameterValueByIndex(index, value); this.model.update();
          const changed = capture();
          for (let d = 0; d < changed.length; d++) {
            opacityDelta = Math.max(opacityDelta, Math.abs(changed[d].opacity - baseline[d].opacity));
            for (let v = 0; v < changed[d].vertices.length; v++) vertexDelta = Math.max(vertexDelta, Math.abs(changed[d].vertices[v] - baseline[d].vertices[v]));
          }
        }
        const gazeParameter = id === contract.gaze.x || id === contract.gaze.y;
        if (vertexDelta < 1e-7 && (gazeParameter || opacityDelta < 1e-5)) throw new Error('Native eye parameter is present but has no measurable binding: ' + id);
        evidence[id] = { vertexDelta, opacityDelta, min, max };
      }
    } finally { restore(); }
    this.nativeRig = { mocSha256: contract.mocSha256.toLowerCase(), gaze: { ...contract.gaze }, blink: { ...contract.blink }, bindingEvidence: evidence };
    this.nativeGaze = { enabled: false, strength: 1, commanded: false, input: [0, 0] };
    for (const id of ids) this.layerParameterIds.add(id);
  }

  setBlink(amount) {
    this.assertModel();
    if (!Number.isFinite(amount)) throw new TypeError('Blink amount must be finite.');
    if (!this.nativeRig) return false;
    this.blinkAmount = Math.max(0, Math.min(1, amount)); return true;
  }

  applyNativeEyes() {
    if (!this.nativeRig) return;
    const gaze = this.nativeGaze;
    for (const [id, input] of gaze.enabled ? [[this.nativeRig.gaze.x, gaze.input[0]], [this.nativeRig.gaze.y, -gaze.input[1]]] : []) {
      const index = this.parameterIndices.get(id), center = this.model.getParameterDefaultValue(index);
      const direction = gaze.enabled ? input * gaze.strength : 0;
      const span = direction >= 0 ? this.model.getParameterMaximumValue(index) - center : center - this.model.getParameterMinimumValue(index);
      this.model.setParameterValueByIndex(index, center + direction * span);
    }
    for (const id of [this.nativeRig.blink.left, this.nativeRig.blink.right]) {
      const index = this.parameterIndices.get(id), min = this.model.getParameterMinimumValue(index);
      const current = this.model.getParameterValueByIndex(index);
      this.model.setParameterValueByIndex(index, min + (current - min) * (1 - this.blinkAmount));
    }
  }

  playMotion(group, index = 0, options = {}) { this.assertModel(); return this.animation.playMotion(group, index, options); }
  stopMotions() { this.assertModel(); this.animation.stopMotions(); return this; }
  setExpression(name) { this.assertModel(); this.animation.setExpression(name); return this; }
  setAutoIdle(enabled, options = {}) { this.assertModel(); this.animation.setAutoIdle(enabled, options); return this; }
  setAnimationEnabled(enabled) { this.assertModel(); this.animation.setEnabled(enabled); return this; }
  setAnimatedParameterEnabled(id, enabled) {
    this.assertModel();
    if (typeof enabled !== 'boolean') throw new TypeError('Animated parameter enabled must be boolean.');
    if (!this.parameterIndices.has(id)) return false;
    if (enabled) this.disabledAnimatedParameters.delete(id); else this.disabledAnimatedParameters.add(id);
    return true;
  }
  getAnimationStatus() { return { ...(this.animation?.getStatus() ?? { loaded: false }), disabledAnimatedParameters: [...this.disabledAnimatedParameters] }; }

  resetPhysics() {
    this.assertModel();
    if (!this.physics) return false;
    for (const id of this.physicsInfo.outputIds) {
      const index = this.parameterIndices.get(id);
      this.model.setParameterValueByIndex(index, this.model.getParameterDefaultValue(index));
    }
    this.physics.stabilization(this.model); this.model.update(); return true;
  }

  resize(width, height, dpr = globalThis.devicePixelRatio || 1) {
    if (![width, height, dpr].every(value => Number.isFinite(value) && value > 0)) throw new TypeError('resize expects positive dimensions.');
    this.viewport = { width, height };
    const ratio = Math.min(dpr, 2);
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    return this;
  }

  setCamera(camera = {}) {
    const next = { ...this.camera, ...camera,
      focus: [...(camera.focus || this.camera.focus)], offset: [...(camera.offset || this.camera.offset)] };
    if (this.info) cameraMatrix(this.info, this.viewport, next);
    this.camera = next; return this;
  }

  setParameterById(id, value) {
    this.assertModel();
    if (!Number.isFinite(value)) throw new TypeError('Parameter value must be finite.');
    const index = this.parameterIndices.get(id);
    if (index === undefined) return false;
    const bounded = Math.max(this.model.getParameterMinimumValue(index), Math.min(this.model.getParameterMaximumValue(index), value));
    this.baseParameterValues.set(id, bounded); this.model.setParameterValueByIndex(index, bounded);
    return true;
  }

  setPartOpacityById(id, opacity) {
    this.assertModel();
    if (!Number.isFinite(opacity)) throw new TypeError('Part opacity must be finite.');
    const index = this.partIndices.get(id);
    if (index === undefined) return false;
    this.model.setPartOpacityByIndex(index, Math.max(0, Math.min(1, opacity))); return true;
  }

  setDrawableOpacityById(id, opacity) {
    this.assertModel();
    if (!Number.isFinite(opacity)) throw new TypeError('Drawable opacity must be finite.');
    const index = this.drawableIndices.get(id);
    if (index === undefined) return false;
    this.drawableOpacities.set(index, Math.max(0, Math.min(1, opacity)));
    return true;
  }

  getParameters() {
    this.assertModel();
    return [...this.parameterIndices].map(([id, index]) => ({ id,
      value: this.model.getParameterValueByIndex(index), min: this.model.getParameterMinimumValue(index),
      max: this.model.getParameterMaximumValue(index), default: this.model.getParameterDefaultValue(index) }));
  }

  getParts() {
    this.assertModel();
    return [...this.partIndices].map(([id, index]) => ({ id, opacity: this.model.getPartOpacityByIndex(index) }));
  }

  getDrawables({ vertices = false } = {}) {
    this.assertModel();
    const native = this.model.getModel().drawables;
    return Array.from({ length: this.model.getDrawableCount() }, (_, index) => ({
      id: native.ids[index], index, vertexCount: this.model.getDrawableVertexCount(index),
      indexCount: this.model.getDrawableVertexIndexCount(index),
      textureIndex: this.model.getDrawableTextureIndex(index), opacity: this.model.getDrawableOpacity(index),
      ...(vertices ? { vertices: Array.from(this.model.getDrawableVertices(index)) } : {}),
    }));
  }

  getTextureMapping() {
    this.assertModel();
    if (!this.defaultMapping) throw new Error('Default texture mapping is not ready.');
    return { canvasInfo: { ...this.info }, textures: this.textureDimensions.map(size => ({ ...size })),
      drawables: this.defaultMapping.map(drawable => ({ ...drawable,
        vertices: [...drawable.vertices], uvs: [...drawable.uvs], indices: [...drawable.indices] })) };
  }

  replaceTexture(index, source) {
    this.assertModel();
    if (!Number.isInteger(index) || !this.textures[index]) throw new RangeError('Unknown texture index.');
    const width = source?.naturalWidth || source?.videoWidth || source?.width;
    const height = source?.naturalHeight || source?.videoHeight || source?.height;
    const expected = this.textureDimensions[index];
    if (width !== expected.width || height !== expected.height) throw new TypeError('Replacement texture dimensions must match the original atlas.');
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error('Live2D texture replacement failed: ' + error);
    return true;
  }

  replaceTextureRegion(index, source, x, y) {
    this.assertModel();
    if (!Number.isInteger(index) || !this.textures[index]) throw new RangeError('Unknown texture index.');
    const width = source?.naturalWidth || source?.videoWidth || source?.width;
    const height = source?.naturalHeight || source?.videoHeight || source?.height;
    const expected = this.textureDimensions[index];
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > expected.width || y + height > expected.height) throw new RangeError('Replacement region must fit inside its atlas.');
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error('Live2D texture region replacement failed: ' + error);
    return true;
  }

  getStatus() {
    return { ...this.status, gaze: this.getGazeStatus(), headFollow: structuredClone(this.headFollow), animation: this.getAnimationStatus(), nativeRig: this.nativeRig ? structuredClone(this.nativeRig) : null, canvasInfo: this.info ? { ...this.info } : null,
      modelUrl: this.modelUrl, camera: { ...this.camera, focus: [...this.camera.focus], offset: [...this.camera.offset] },
      optionalReferencesNotPlayed: [...(this.status.optionalReferencesNotPlayed || [])] };
  }

  assertModel() {
    if (this.disposed || !this.model) throw new Error('Live2D model is unavailable or disposed.');
  }

  update(deltaSeconds = 1 / 60) {
    this.assertModel();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > 0.25) throw new RangeError('Animation/physics step must be 0..0.25 seconds; subdivide long frames.');
    // Restore only parameters controlled by animation/eyes. Host-provided base
    // values survive, additive expressions cannot accumulate across frames,
    // and existing physics-only parameters preserve their previous behaviour.
    for (const id of this.layerParameterIds) this.model.setParameterValueByIndex(this.parameterIndices.get(id), this.baseParameterValues.get(id));
    this.animation?.update(deltaSeconds);
    for (const id of this.disabledAnimatedParameters) this.model.setParameterValueByIndex(this.parameterIndices.get(id), this.baseParameterValues.get(id));
    this.applyNativeEyes();
    // Blend after exported motions/expressions, before hair physics and Core.
    this.applyHeadFollow(deltaSeconds);
    if (this.physics && this.physicsEnabled && deltaSeconds > 0) {
      this.physics.evaluate(this.model, deltaSeconds);
      this.physicsInfo.evaluations++;
    }
    this.model.update(); return this;
  }

  draw() {
    this.assertModel();
    if (this.status.phase !== 'ready' || this.gl.isContextLost()) return false;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const matrix = new CubismMatrix44(); matrix.setMatrix(cameraMatrix(this.info, this.viewport, this.camera));
    this.renderer.setMvpMatrix(matrix);
    this.renderer.setRenderState(null, [0, 0, this.canvas.width, this.canvas.height]);
    this.renderer.drawModel(new URL('./vendor/shaders/', import.meta.url).href);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) { this.status.phase = 'render-error'; this.status.glError = error; throw new Error('Cubism draw failed with WebGL error ' + error); }
    this.status.framesDrawn++; return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abortController.abort();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.physics?.release(); this.physics = null;
    this.animation?.dispose(); this.animation = null;
    this.gaze?.dispose(); this.gaze = null;
    this.nativeRig = this.nativeGaze = null;
    this.renderer?.release(); this.renderer = null;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures.length = 0;
    this.textureDimensions.length = 0; this.defaultMapping = null;
    if (this.moc) { if (this.model) this.moc.deleteModel(this.model); this.moc.release(); }
    this.model = this.moc = null;
    if (this.retained) { this.retained = false; users--; }
    if (users === 0 && ownsFramework) { CubismFramework.dispose(); ownsFramework = false; }
    activeCanvases.delete(this.canvas);
    Object.assign(this.status, { phase: 'disposed', modelLoaded: false, shadersReady: false, gazeTracking: false });
  }
}
