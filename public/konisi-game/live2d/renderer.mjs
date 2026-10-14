/* Genuine Cubism model renderer. No automatic gaze, drag, blink or head motion.
 * App-owned state and animation can set only parameters present in the model.
 * Framework/Core retain their own Live2D licenses; see vendor/licenses/.
 */
import { cameraMatrix, assetURL } from './camera-math.mjs';

let corePromise;
let frameworkPromise;
let CubismFramework, CubismMoc, CubismMatrix44, CubismRenderer_WebGL, CubismShaderManager_WebGL;
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
    ({ CubismFramework, CubismMoc, CubismMatrix44, CubismRenderer_WebGL, CubismShaderManager_WebGL } = module);
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
    this.moc = null; this.model = null; this.renderer = null;
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
    Object.assign(this.status, { phase: 'ready', modelLoaded: true, shadersReady: true,
      mocVersion, latestMocVersion, drawableCount: this.model.getDrawableCount(),
      textureCount: this.textures.length, parameterCount: this.parameterIndices.size,
      partCount: this.partIndices.size,
      // Loading these optional assets or choosing their behaviour belongs to the app.
      optionalReferencesNotPlayed: Object.keys(refs).filter(key => !['Moc', 'Textures', 'DisplayInfo', 'UserData'].includes(key)),
    });
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
    this.model.setParameterValueByIndex(index, Math.max(this.model.getParameterMinimumValue(index), Math.min(this.model.getParameterMaximumValue(index), value)));
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
    return { ...this.status, canvasInfo: this.info ? { ...this.info } : null,
      modelUrl: this.modelUrl, camera: { ...this.camera, focus: [...this.camera.focus], offset: [...this.camera.offset] },
      optionalReferencesNotPlayed: [...(this.status.optionalReferencesNotPlayed || [])] };
  }

  assertModel() {
    if (this.disposed || !this.model) throw new Error('Live2D model is unavailable or disposed.');
  }

  update() { this.assertModel(); this.model.update(); return this; }

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
    this.renderer?.release(); this.renderer = null;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures.length = 0;
    this.textureDimensions.length = 0; this.defaultMapping = null;
    if (this.moc) { if (this.model) this.moc.deleteModel(this.model); this.moc.release(); }
    this.model = this.moc = null;
    if (this.retained) { this.retained = false; users--; }
    if (users === 0 && ownsFramework) { CubismFramework.dispose(); ownsFramework = false; }
    activeCanvases.delete(this.canvas);
    Object.assign(this.status, { phase: 'disposed', modelLoaded: false, shadersReady: false });
  }
}
