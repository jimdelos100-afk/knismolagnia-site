/* Optional, app-driven gaze for the verified detailed standing artwork.
 * EyeBallX/Y in this export are unbound. This adapter offsets copied Framework
 * vertices only; it never writes Core's drawable buffers or model parameters.
 */
export const STANDING_GAZE_DRAWABLES = Object.freeze([
  'eye_left_iris', 'eye_right_iris',
  'eye_left_pupil_visible_rim',
  'eye_left_highlight_upper', 'eye_left_highlight_center',
  'eye_right_highlight_upper', 'eye_right_highlight_secondary',
  'iris_left_occlusion', 'iris_right_occlusion',
]);

export const STANDING_GAZE_LIMITS = Object.freeze({ xPixels: .9, yPixels: .4, radialPixels: 1 });

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

/** Attach only to the detailed standing model. Inputs are screen directions:
 * positive x is right, positive y is down. The caller owns smoothing, pointer
 * input and disabling gaze for non-neutral expressions or any blink.
 *
 * Original visible iris/highlight masks in both eyes remain inside the union
 * of the full sclera aperture and fixed lids under all eight +/-1px shifts.
 * The stricter 0.9x0.4px clamp is intentional: this is a small translation,
 * not unrestricted eye rotation or a claim of native EyeBall parameter rigging.
 */
export function createStandingGaze({ model, canvasInfo }) {
  const native = model.getModel();
  const ids = new Map(native.drawables.ids.map((id, index) => [id, index]));
  const supported = canvasInfo.CanvasWidth === 1024 && canvasInfo.CanvasHeight === 1536
    && ids.has('body_visible_fixed') && ids.has('face_visible_residual') && ids.has('head_edge_original');
  let enabled = false, strength = 1, input = [0, 0], offsetPixels = [0, 0], disposed = false;
  const targets = new Set(), copies = new Map();
  const originalVertices = model.getDrawableVertices;
  const originalChanged = model.getDrawableDynamicFlagVertexPositionsDidChange;
  const pixelsPerUnit = canvasInfo.PixelsPerUnit;

  if (supported) {
    if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0 || typeof originalChanged !== 'function') {
      throw new Error('Detailed standing gaze requires valid native geometry accessors.');
    }
    for (const id of STANDING_GAZE_DRAWABLES) {
      const index = ids.get(id);
      if (index === undefined || model.getDrawableVertexCount(index) < 3 || model.getDrawableVertexIndexCount(index) < 3) {
        throw new Error('Detailed standing gaze drawable is missing or empty: ' + id);
      }
      targets.add(index);
    }
    model.getDrawableVertices = function(index) {
      const source = originalVertices.call(model, index);
      if (!enabled || !strength || !targets.has(index) || (offsetPixels[0] === 0 && offsetPixels[1] === 0)) return source;
      let result = copies.get(index);
      if (!result || result.length !== source.length) {
        result = new Float32Array(source.length); copies.set(index, result);
      }
      const dx = offsetPixels[0] / pixelsPerUnit, dy = -offsetPixels[1] / pixelsPerUnit;
      for (let i = 0; i < source.length; i += 2) {
        result[i] = source[i] + dx;
        result[i + 1] = source[i + 1] + dy;
      }
      return result;
    };
    // Gaze can change while native geometry is stationary. Refresh these nine
    // small vertex buffers even when Core's original changed flag is false,
    // including the first zero/disabled frame restoring native coordinates.
    model.getDrawableDynamicFlagVertexPositionsDidChange = function(index) {
      return targets.has(index) || originalChanged.call(model, index);
    };
  }

  return {
    set(x, y, options = {}) {
      if (disposed) throw new Error('Standing gaze adapter is disposed.');
      const nextEnabled = options.enabled ?? true, nextStrength = options.strength ?? 1;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(nextStrength)) {
        throw new TypeError('Gaze x, y and strength must be finite numbers.');
      }
      if (typeof nextEnabled !== 'boolean') throw new TypeError('Gaze enabled must be a boolean.');
      enabled = supported && nextEnabled;
      strength = clamp(nextStrength, 0, 1);
      input = enabled ? [clamp(x, -1, 1), clamp(y, -1, 1)] : [0, 0];
      offsetPixels = [input[0] * STANDING_GAZE_LIMITS.xPixels * strength,
        input[1] * STANDING_GAZE_LIMITS.yPixels * strength];
      const radius = Math.hypot(...offsetPixels);
      if (radius > STANDING_GAZE_LIMITS.radialPixels) {
        offsetPixels = offsetPixels.map(value => value * STANDING_GAZE_LIMITS.radialPixels / radius);
      }
      return supported;
    },
    getStatus() {
      return { supported, enabled: enabled && strength > 0, strength,
        input: [...input], offsetPixels: [...offsetPixels], limits: { ...STANDING_GAZE_LIMITS },
        method: supported ? 'Copied Framework vertices; original native EyeBall parameters remain unbound' : 'Unsupported pose; no gaze adapter installed',
        nativeBuffersModified: false, nativeEyeBallParametersUsed: false,
        movedDrawableIds: supported ? [...STANDING_GAZE_DRAWABLES] : [],
        apertureProtection: 'Conservative subpixel clamp verified against original eye/sclera/lid masks; no new texture or native clipping mask',
      };
    },
    dispose() {
      if (disposed) return;
      if (supported) {
        model.getDrawableVertices = originalVertices;
        model.getDrawableDynamicFlagVertexPositionsDidChange = originalChanged;
      }
      enabled = false; input = offsetPixels = [0, 0]; copies.clear(); disposed = true;
    },
  };
}
