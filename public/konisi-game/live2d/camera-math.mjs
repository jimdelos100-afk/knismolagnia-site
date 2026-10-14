// Coordinates accepted by the adapter use the original PSD canvas in pixels.
export function cameraMatrix(info, viewport, camera) {
  const { width, height } = viewport;
  const { CanvasWidth: artWidth, CanvasHeight: artHeight, PixelsPerUnit: ppu,
    CanvasOriginX: originX, CanvasOriginY: originY } = info;
  const { focus, zoom = 1, padding = .96, offset = [0, 0] } = camera;
  if (![width, height, artWidth, artHeight, ppu, zoom, padding].every(value => Number.isFinite(value) && value > 0)
    || ![originX, originY, ...focus, ...offset].every(Number.isFinite)
    || focus.length !== 2 || offset.length !== 2) throw new TypeError('Invalid Live2D camera dimensions or coordinates.');
  const fit = Math.min(width / artWidth, height / artHeight) * padding * zoom;
  return new Float32Array([
    2 * ppu * fit / width, 0, 0, 0,
    0, 2 * ppu * fit / height, 0, 0,
    0, 0, 1, 0,
    2 * (originX - focus[0] + offset[0]) * fit / width,
    2 * (focus[1] - originY - offset[1]) * fit / height, 0, 1,
  ]);
}

export function assetURL(reference, modelURL) {
  if (typeof reference !== 'string' || !reference || reference !== reference.trim()
    || /[\\\u0000-\u001f:%?#]/.test(reference) || reference.startsWith('/')
    || reference.split('/').includes('..')) throw new TypeError('Model references must be local relative paths within their export folder.');
  const url = new URL(reference, modelURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(modelURL).origin) throw new TypeError('Unsupported model asset origin.');
  return url.href;
}
