/* Loads model3 motion/expression references and delegates evaluation, blending,
 * fades and priority to the unmodified official Cubism Framework. No RAF here. */
import { assetURL } from './camera-math.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = (bytes, label) => {
  try { return JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Invalid ' + label + ' JSON.'); }
};

function fade(value, label, allowInherit = false) {
  if (value !== undefined && (!finite(value) || value < (allowInherit ? -1 : 0))) throw new Error('Invalid ' + label + '.');
}

/** The site deliberately supports parameter curves, not audio, events or
 * model/part curves. Unsupported features fail explicitly before SDK parsing. */
export function validateMotion(json, parameters) {
  const meta = json?.Meta;
  if (json?.Version !== 3 || !object(meta) || !finite(meta.Duration) || meta.Duration <= 0
    || !finite(meta.Fps) || meta.Fps <= 0 || typeof meta.Loop !== 'boolean'
    || typeof meta.AreBeziersRestricted !== 'boolean' || !Array.isArray(json.Curves) || !json.Curves.length) throw new Error('Invalid motion3 metadata.');
  if ((meta.UserDataCount || 0) !== 0 || (meta.TotalUserDataSize || 0) !== 0 || (json.UserData?.length || 0) !== 0) throw new Error('Motion events are not supported by this site.');
  // CubismMotionJson reads global motion fades from Meta (exp3 uses top-level).
  fade(meta.FadeInTime, 'motion fade-in'); fade(meta.FadeOutTime, 'motion fade-out');
  if (json.FadeInTime !== undefined || json.FadeOutTime !== undefined) throw new Error('Motion fades belong in Meta; top-level values are ignored by Cubism.');
  const available = new Map(parameters.map(parameter => [parameter.id, parameter]));
  const ids = new Set(); let points = 0, segments = 0;
  for (const curve of json.Curves) {
    if (curve?.Target !== 'Parameter' || typeof curve.Id !== 'string' || !available.has(curve.Id) || ids.has(curve.Id)) throw new Error('Motion must reference distinct native parameters: ' + curve?.Id);
    ids.add(curve.Id); fade(curve.FadeInTime, 'curve fade-in', true); fade(curve.FadeOutTime, 'curve fade-out', true);
    const values = curve.Segments, parameter = available.get(curve.Id);
    if (!Array.isArray(values) || values.length < 5 || !values.every(finite)) throw new Error('Invalid motion segments: ' + curve.Id);
    const validPoint = (time, value) => time >= 0 && time <= meta.Duration + 1e-6 && value >= parameter.min - 1e-6 && value <= parameter.max + 1e-6;
    if (!validPoint(values[0], values[1])) throw new Error('Motion starts outside its native parameter range: ' + curve.Id);
    let at = 2, previous = values[0]; points++;
    while (at < values.length) {
      const kind = values[at++];
      if (![0, 1, 2, 3].includes(kind)) throw new Error('Unsupported motion segment type: ' + kind);
      const count = kind === 1 ? 3 : 1;
      if (at + count * 2 > values.length) throw new Error('Truncated motion segment.');
      let time = previous;
      for (let point = 0; point < count; point++) {
        const next = values[at++], value = values[at++];
        if (!validPoint(next, value) || next < time) throw new Error('Motion control points must be ordered and inside the native range: ' + curve.Id);
        time = next;
      }
      if (time <= previous) throw new Error('Motion segments must advance time.');
      previous = time; points += count; segments++;
    }
  }
  if (meta.CurveCount !== json.Curves.length || meta.TotalSegmentCount !== segments || meta.TotalPointCount !== points) throw new Error('Motion curve/segment/point totals do not match the data.');
  return { parameterIds: [...ids], duration: meta.Duration, loop: meta.Loop };
}

export function validateExpression(json, parameters) {
  if (json?.Type !== 'Live2D Expression' || !Array.isArray(json.Parameters)) throw new Error('Invalid exp3 expression.');
  fade(json.FadeInTime, 'expression fade-in'); fade(json.FadeOutTime, 'expression fade-out');
  const available = new Map(parameters.map(parameter => [parameter.id, parameter])), ids = new Set();
  for (const parameter of json.Parameters) {
    const native = available.get(parameter?.Id);
    if (!native || ids.has(parameter.Id) || !finite(parameter.Value) || !['Add', 'Multiply', 'Overwrite'].includes(parameter.Blend ?? 'Add')) throw new Error('Expression references an invalid native parameter or blend: ' + parameter?.Id);
    if (parameter.Blend === 'Overwrite' && (parameter.Value < native.min || parameter.Value > native.max)) throw new Error('Expression overwrite is outside the native parameter range: ' + parameter.Id);
    ids.add(parameter.Id);
  }
  return { parameterIds: [...ids] };
}

function clearManager(manager) {
  // R5 stopAllMotions removes entries while iterating. Repeat until every
  // cross-fading entry is released, without touching SDK internals.
  while (manager.getCubismMotionQueueEntries().length) manager.stopAllMotions();
}

export async function createAnimationPlayback({ framework, model, parameters, references, modelUrl, readBuffer, signal }) {
  const { CubismMotion, CubismMotionManager, CubismExpressionMotion, CubismExpressionMotionManager } = framework;
  const groups = new Map(), expressions = new Map(), controlled = new Set();
  let motionManager = new CubismMotionManager(), expressionManager = new CubismExpressionMotionManager();
  let enabled = true, autoIdle = false, idleGroup = 'Idle', active = null, expression = null, time = 0, disposed = false;
  const own = record => { for (const id of record.parameterIds) controlled.add(id); return record; };
  const failDisposed = () => { if (disposed) throw new Error('Animation controller is disposed.'); };
  const resetMotionManager = () => { clearManager(motionManager); motionManager.release(); motionManager = new CubismMotionManager(); active = null; };
  const resetExpressionManager = () => { clearManager(expressionManager); expressionManager.release(); expressionManager = new CubismExpressionMotionManager(); expression = null; };
  function dispose() {
    if (disposed) return;
    disposed = true; clearManager(motionManager); motionManager.release(); clearManager(expressionManager); expressionManager.release();
    for (const records of groups.values()) for (const record of records) record.motion.release();
    for (const record of expressions.values()) record.motion.release();
    groups.clear(); expressions.clear(); active = expression = null;
  }
  try {
    if (references.Motions !== undefined && !object(references.Motions)) throw new Error('model3 Motions must be a group map.');
    for (const [group, refs] of Object.entries(references.Motions || {})) {
      if (!group || !Array.isArray(refs) || !refs.length) throw new Error('Invalid model3 motion group.');
      const records = []; groups.set(group, records);
      for (const ref of refs) {
        if (!object(ref) || typeof ref.File !== 'string' || ref.Sound !== undefined) throw new Error('Motion requires a local File; audio playback is not supported.');
        fade(ref.FadeInTime, 'model3 motion fade-in', true); fade(ref.FadeOutTime, 'model3 motion fade-out', true);
        const url = assetURL(ref.File, modelUrl), bytes = await readBuffer(url, signal), json = parse(bytes, 'motion3');
        const descriptor = validateMotion(json, parameters);
        const motion = CubismMotion.create(bytes, bytes.byteLength, undefined, undefined, true);
        if (!motion) throw new Error('Cubism Framework rejected motion: ' + ref.File);
        // This site applies blink after expression blending and has no lip-sync
        // source. R5 expects these lists even for Parameter-only motion files.
        motion.setEffectIds([], []);
        motion.setLoop(descriptor.loop); motion.setLoopFadeIn(false);
        if (ref.FadeInTime >= 0) motion.setFadeInTime(ref.FadeInTime);
        if (ref.FadeOutTime >= 0) motion.setFadeOutTime(ref.FadeOutTime);
        records.push(own({ motion, url, ...descriptor }));
      }
    }
    if (references.Expressions !== undefined && !Array.isArray(references.Expressions)) throw new Error('model3 Expressions must be an array.');
    for (const ref of references.Expressions || []) {
      if (!object(ref) || typeof ref.Name !== 'string' || !ref.Name || expressions.has(ref.Name) || typeof ref.File !== 'string') throw new Error('Expressions require unique names and local File references.');
      const url = assetURL(ref.File, modelUrl), bytes = await readBuffer(url, signal), json = parse(bytes, 'exp3');
      const descriptor = validateExpression(json, parameters), motion = CubismExpressionMotion.create(bytes, bytes.byteLength);
      if (!motion) throw new Error('Cubism Framework rejected expression: ' + ref.File);
      expressions.set(ref.Name, own({ motion, url, fadeIn: motion.getFadeInTime(), ...descriptor }));
    }
  } catch (error) { dispose(); throw error; }

  const controller = {
    parameterIds: [...controlled],
    playMotion(group, index = 0, { priority = 2 } = {}) {
      failDisposed();
      const records = groups.get(group);
      if (!records || !Number.isInteger(index) || !records[index]) throw new RangeError('Unknown motion: ' + group + '/' + index);
      if (!Number.isInteger(priority) || priority < 1 || priority > 3) throw new RangeError('Motion priority must be 1 (idle), 2 (normal), or 3 (force).');
      if (priority !== 3 && !motionManager.reserveMotion(priority)) return false;
      motionManager.startMotionPriority(records[index].motion, false, priority);
      active = { group, index, priority, startedAt: time }; return true;
    },
    stopMotions() { failDisposed(); resetMotionManager(); return this; },
    setExpression(name) {
      failDisposed();
      if (name === null) { resetExpressionManager(); return this; }
      if (!expressions.has(name)) throw new RangeError('Unknown expression: ' + name);
      if (expression?.name === name) return this;
      const record = expressions.get(name);
      record.motion.setFadeInTime(enabled ? record.fadeIn : 0);
      expressionManager.startMotion(record.motion, false); expression = { name, startedAt: time }; return this;
    },
    setEnabled(value) {
      failDisposed(); if (typeof value !== 'boolean') throw new TypeError('Animation enabled must be boolean.');
      enabled = value; return this;
    },
    setAutoIdle(value, { group = 'Idle' } = {}) {
      failDisposed(); if (typeof value !== 'boolean' || typeof group !== 'string') throw new TypeError('Invalid auto-idle options.');
      if (value && !groups.has(group)) throw new RangeError('Auto-idle group is missing: ' + group);
      if (active?.group === idleGroup && (!value || idleGroup !== group)) resetMotionManager();
      autoIdle = value; idleGroup = group; return this;
    },
    update(deltaSeconds) {
      failDisposed();
      if (!finite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > .25) throw new RangeError('Animation step must be 0..0.25 seconds.');
      const dt = enabled ? deltaSeconds : 0;
      if (autoIdle && enabled && motionManager.isFinished()) controller.playMotion(idleGroup, 0, { priority: 1 });
      time += dt;
      motionManager.updateMotion(model, dt); expressionManager.updateMotion(model, dt);
      if (motionManager.isFinished()) active = null;
      return this;
    },
    getStatus() {
      return { loaded: true, framework: 'Official CubismMotionManager + CubismExpressionMotionManager', paused: !enabled, time,
        autoIdle, idleGroup, groups: Object.fromEntries([...groups].map(([name, records]) => [name, records.map(({ url, duration, loop, parameterIds }) => ({ url, duration, loop, parameterIds: [...parameterIds] }))])),
        expressionNames: [...expressions.keys()], activeMotion: active ? { ...active, elapsed: time - active.startedAt } : null,
        activeExpression: expression ? { ...expression, elapsed: time - expression.startedAt } : null,
        parameterIds: [...controlled] };
    },
    dispose,
  };
  return controller;
}
