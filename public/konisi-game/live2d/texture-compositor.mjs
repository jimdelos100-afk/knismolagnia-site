/* Existing V8 image-based expressions and outfits, mapped onto genuine Cubism
 * texture atlases. This does not invent model parameters or replace mesh motion.
 * Default mesh/UV correspondence is validated before any atlas can be changed.
 */
import { assetURL } from './camera-math.mjs';

function canvas(width, height) {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}

function solve3(matrix, values) {
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    if (Math.abs(rows[pivot][i]) < 1e-10) throw new Error('Degenerate default mesh coordinates.');
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const divisor = rows[i][i]; for (let k = i; k < 4; k++) rows[i][k] /= divisor;
    for (let j = 0; j < 3; j++) if (j !== i) {
      const multiplier = rows[j][i]; for (let k = i; k < 4; k++) rows[j][k] -= multiplier * rows[i][k];
    }
  }
  return rows.map(row => row[3]);
}

/** Affine map from original PSD pixels to PNG-atlas pixels, including rotated
 * atlas parts. Core UVs have an upward Y axis; texture PNGs have a downward one. */
export function fitDrawableAtlasMap(drawable, info, texture, maxError = .15) {
  const { vertices, uvs } = drawable;
  if (!vertices || !uvs || vertices.length !== uvs.length || vertices.length < 6) throw new Error('Missing drawable vertices or UVs.');
  const source = [], target = [];
  for (let i = 0; i < vertices.length; i += 2) {
    source.push([vertices[i] * info.PixelsPerUnit + info.CanvasOriginX,
      info.CanvasOriginY - vertices[i + 1] * info.PixelsPerUnit]);
    target.push([uvs[i] * texture.width, (1 - uvs[i + 1]) * texture.height]);
  }
  const center = source.reduce((sum, point) => [sum[0] + point[0] / source.length, sum[1] + point[1] / source.length], [0, 0]);
  const rows = source.map(point => [point[0] - center[0], point[1] - center[1], 1]);
  const gram = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const coefficients = [0, 1].map(axis => solve3(gram,
    [0, 1, 2].map(column => rows.reduce((sum, row, i) => sum + row[column] * target[i][axis], 0))));
  const [x, y] = coefficients;
  const transform = [x[0], y[0], x[1], y[1], x[2] - x[0] * center[0] - x[1] * center[1], y[2] - y[0] * center[0] - y[1] * center[1]];
  let error = 0;
  for (let i = 0; i < source.length; i++) {
    const [sx, sy] = source[i];
    error = Math.max(error, Math.abs(transform[0] * sx + transform[2] * sy + transform[4] - target[i][0]),
      Math.abs(transform[1] * sx + transform[3] * sy + transform[5] - target[i][1]));
  }
  if (!Number.isFinite(error) || error > maxError) throw new Error('Default UV mapping is not affine for ' + drawable.id + ' (' + error + ' px).');
  return { transform, error };
}

function transformedBounds(transform, rect) {
  const [a, b, c, d, e, f] = transform;
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
    .map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  return { x: Math.min(...points.map(p => p[0])), y: Math.min(...points.map(p => p[1])),
    right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1])) };
}

function opaqueBounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function loadImage(url) {
  const image = new Image(); image.crossOrigin = 'anonymous'; image.src = url; await image.decode(); return image;
}

function ownershipMask(image, width, height) {
  const source = canvas(width, height), ctx = source.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const bounds = opaqueBounds(pixels.data, width, height);
  if (!bounds) throw new Error('Empty source part ownership mask.');
  const mask = canvas(bounds.width, bounds.height), output = mask.getContext('2d').createImageData(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    output.data[(y * bounds.width + x) * 4 + 3] = pixels.data[((y + bounds.y) * width + x + bounds.x) * 4 + 3] ? 255 : 0;
  }
  mask.getContext('2d').putImageData(output, 0, 0); source.width = source.height = 1;
  return { ...bounds, canvas: mask };
}

function clipPatch(image, spec, mask) {
  if (!mask) return { image, spec };
  const left = Math.max(spec.x, mask.x), top = Math.max(spec.y, mask.y);
  const right = Math.min(spec.x + spec.width, mask.x + mask.width), bottom = Math.min(spec.y + spec.height, mask.y + mask.height);
  if (right <= left || bottom <= top) return null;
  const clipped = canvas(right - left, bottom - top), ctx = clipped.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, spec.x - left, spec.y - top, spec.width, spec.height);
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask.canvas, mask.x - left, mask.y - top);
  const visible = opaqueBounds(ctx.getImageData(0, 0, clipped.width, clipped.height).data, clipped.width, clipped.height);
  if (!visible) return null;
  return { image: clipped, spec: { x: left, y: top, width: clipped.width, height: clipped.height },
    visible: { x: left + visible.x, y: top + visible.y, width: visible.width, height: visible.height } };
}

function copyTexture(image, dimensions) {
  const result = canvas(dimensions.width, dimensions.height); result.getContext('2d').drawImage(image, 0, 0); return result;
}

/** images is the existing V8 Map from relative asset paths to decoded images.
 * modelUrl points to the genuine export loaded by createLive2DRenderer. */
export async function createTextureCompositor({ mapping, model, images, modelUrl, assetBaseUrl = document.baseURI, drawableRoles = {} }) {
  if (mapping.canvasInfo.CanvasWidth !== model.width || mapping.canvasInfo.CanvasHeight !== model.height) throw new Error('PSD canvas differs from the V8 source canvas.');
  const url = new URL(modelUrl, document.baseURI).href;
  const response = await fetch(url); if (!response.ok) throw new Error('Cannot read texture export settings.');
  const refs = (await response.json()).FileReferences;
  const original = await Promise.all(refs.Textures.map(ref => loadImage(assetURL(ref, url))));
  if (original.length !== mapping.textures.length || original.some((image, i) => image.width !== mapping.textures[i].width || image.height !== mapping.textures[i].height)) throw new Error('Exported atlas dimensions changed.');
  const parts = [], wardrobe = {}, explicitBases = new Set(drawableRoles.base || []);
  const explicitWardrobe = new Map(Object.entries(drawableRoles.wardrobe || {}).map(([outfit, id]) => [id, outfit]));
  const ids = new Set(mapping.drawables.map(drawable => drawable.id));
  if (explicitWardrobe.size !== Object.keys(drawableRoles.wardrobe || {}).length) throw new Error('Outfits must use distinct exported meshes.');
  for (const id of [...explicitBases, ...explicitWardrobe.keys()]) {
    if (!ids.has(id)) throw new Error('Configured source mesh is missing from this export: ' + id);
    if (explicitBases.has(id) && explicitWardrobe.has(id)) throw new Error('A mesh cannot be both base and outfit: ' + id);
  }
  for (const drawable of mapping.drawables) {
    const outfit = explicitWardrobe.get(drawable.id) || Object.keys(model.wardrobe).find(name => drawable.id.includes('outfit_' + name + '_'));
    if (outfit && !model.wardrobe[outfit]) throw new Error('Configured outfit is missing its V8 source: ' + outfit);
    if (outfit) { wardrobe[outfit] = drawable.id; continue; }
    const roughName = drawable.id.startsWith('REFERENCE_rough_part_') ? drawable.id.slice('REFERENCE_rough_'.length) : null;
    if (!roughName && !explicitBases.has(drawable.id) && !/(?:^|_)base(?:_|$)/.test(drawable.id)) throw new Error('Unexpected visible source layer: ' + drawable.id);
    const fitted = fitDrawableAtlasMap(drawable, mapping.canvasInfo, mapping.textures[drawable.textureIndex]);
    const mask = roughName ? ownershipMask(await loadImage(new URL('assets/parts/' + roughName + '.png', assetBaseUrl).href), model.width, model.height) : null;
    parts.push({ ...drawable, ...fitted, mask });
  }
  if (!parts.length) throw new Error('No source base mesh found.');
  if (model.id === 'kneeling' && Object.keys(model.wardrobe).some(name => !wardrobe[name])) throw new Error('Kneeling export must include all three wardrobe meshes.');
  let textures = [], uploadTextures = [], blinkRegions = [], current = null, revision = 0, uploaded = -1, lastBlink = -1;

  function drawPatches(targets, specs) {
    const bounds = mapping.textures.map(() => null);
    for (const spec of specs) {
      const image = images.get(spec.src); if (!image) throw new Error('Missing V8 source asset: ' + spec.src);
      for (const part of parts) {
        const clipped = clipPatch(image, spec, part.mask); if (!clipped) continue;
        const ctx = targets[part.textureIndex].getContext('2d');
        ctx.save(); ctx.setTransform(...part.transform); ctx.drawImage(clipped.image, clipped.spec.x, clipped.spec.y, clipped.spec.width, clipped.spec.height); ctx.restore();
        const next = transformedBounds(part.transform, clipped.visible || clipped.spec), before = bounds[part.textureIndex];
        bounds[part.textureIndex] = before ? { x: Math.min(before.x, next.x), y: Math.min(before.y, next.y), right: Math.max(before.right, next.right), bottom: Math.max(before.bottom, next.bottom) } : next;
      }
    }
    return bounds;
  }

  return {
    setAppearance({ outfit = model.defaultOutfit || 'original', expression = 'neutral' } = {}) {
      if (current?.outfit === outfit && current?.expression === expression) return this;
      if (outfit !== 'original' && !model.wardrobe[outfit]) throw new Error('Unknown outfit: ' + outfit);
      if (expression !== 'neutral' && !model.expressions[expression]) throw new Error('Unknown expression: ' + expression);
      const patches = [];
      if (!Object.keys(wardrobe).length && outfit !== 'original') patches.push(model.wardrobe[outfit]);
      if (expression !== 'neutral') patches.push(model.expressions[expression]);
      textures = original.map((image, i) => copyTexture(image, mapping.textures[i])); drawPatches(textures, patches);
      // Preserve the exact exported baseline when no source patch is active.
      // Canvas2D can round RGB values at partially transparent edge pixels.
      uploadTextures = patches.length ? textures : original;
      const closed = textures.map((image, i) => copyTexture(image, mapping.textures[i]));
      const bounds = drawPatches(closed, ['happy', 'laugh', 'blink'].includes(expression) ? [] : model.blinkEyes);
      blinkRegions = bounds.flatMap((box, textureIndex) => {
        if (!box) return [];
        const size = mapping.textures[textureIndex], x = Math.max(0, Math.floor(box.x) - 2), y = Math.max(0, Math.floor(box.y) - 2);
        const width = Math.min(size.width, Math.ceil(box.right) + 2) - x, height = Math.min(size.height, Math.ceil(box.bottom) + 2) - y;
        if (width <= 0 || height <= 0) return [];
        const mix = canvas(width, height), ctx = mix.getContext('2d'), output = ctx.createImageData(width, height);
        return [{ textureIndex, x, y, width, height, mix, ctx, output,
          open: textures[textureIndex].getContext('2d').getImageData(x, y, width, height),
          closed: closed[textureIndex].getContext('2d').getImageData(x, y, width, height) }];
      });
      for (const image of closed) image.width = image.height = 1;
      current = { outfit, expression }; revision++; return this;
    },

    apply(renderer, blink = 0) {
      if (!current) this.setAppearance();
      const value = Math.max(0, Math.min(1, Number(blink) || 0));
      if (uploaded !== revision) {
        uploadTextures.forEach((texture, index) => renderer.replaceTexture(index, texture));
        for (const [outfit, id] of Object.entries(wardrobe)) renderer.setDrawableOpacityById(id, outfit === current.outfit ? 1 : 0);
        uploaded = revision; lastBlink = 0;
      }
      if (value === lastBlink) return false;
      for (const region of blinkRegions) {
        const a = region.open.data, b = region.closed.data, out = region.output.data;
        for (let i = 0; i < out.length; i += 4) {
          const aa = a[i + 3] * (1 - value), ab = b[i + 3] * value, alpha = aa + ab;
          for (let c = 0; c < 3; c++) out[i + c] = alpha ? (a[i + c] * aa + b[i + c] * ab) / alpha : 0;
          out[i + 3] = alpha;
        }
        region.ctx.putImageData(region.output, 0, 0);
        renderer.replaceTextureRegion(region.textureIndex, region.mix, region.x, region.y);
      }
      lastBlink = value; return true;
    },

    getStatus() {
      return { method: 'V8 source patches on genuine Cubism atlas', expressionParametersRigged: false,
        maxMappingError: Math.max(...parts.map(part => part.error)), current: current ? { ...current } : null,
        wardrobeDrawables: { ...wardrobe }, blinkRegions: blinkRegions.map(({ textureIndex, x, y, width, height }) => ({ textureIndex, x, y, width, height })) };
    },
  };
}
