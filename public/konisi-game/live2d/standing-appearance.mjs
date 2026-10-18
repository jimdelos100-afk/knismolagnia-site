/* V8 appearance assets on the verified detailed standing export.
 * Only the explicit body/face carriers receive texture changes. Hair, its
 * underpaint, and the untouched neutral atlas remain native Cubism artwork. */
import { assetURL } from './camera-math.mjs';
import { fitDrawableAtlasMap } from './texture-compositor.mjs';

const CLOSED_EXPRESSIONS = new Set(['happy', 'laugh', 'blink']);

function canvas(width, height) {
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}

async function loadImage(url) {
  const image = new Image(); image.crossOrigin = 'anonymous'; image.src = url;
  await image.decode(); return image;
}

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot read standing appearance input (${response.status}): ${url}`);
  return response.json();
}

function opaqueBounds(pixels, width, height) {
  let x = width, y = height, right = -1, bottom = -1;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    if (!pixels[(row * width + column) * 4 + 3]) continue;
    x = Math.min(x, column); y = Math.min(y, row);
    right = Math.max(right, column); bottom = Math.max(bottom, row);
  }
  return right < 0 ? null : { x, y, width: right - x + 1, height: bottom - y + 1 };
}

function transformedBounds(transform, rect) {
  const [a, b, c, d, e, f] = transform;
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
    .map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  return { x: Math.min(...points.map(p => p[0])), y: Math.min(...points.map(p => p[1])),
    right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1])) };
}

function unionBounds(boxes) {
  return boxes.length ? { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
    right: Math.max(...boxes.map(b => b.right)), bottom: Math.max(...boxes.map(b => b.bottom)) } : null;
}

function clipPatch(image, spec, mask) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(spec[key])) throw new Error(`Invalid V8 patch ${spec.src}: ${key}`);
  }
  const x = Math.max(spec.x, mask.x), y = Math.max(spec.y, mask.y);
  const right = Math.min(spec.x + spec.width, mask.x + mask.width);
  const bottom = Math.min(spec.y + spec.height, mask.y + mask.height);
  if (right <= x || bottom <= y) return null;
  const imageCanvas = canvas(right - x, bottom - y);
  const ctx = imageCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, spec.x - x, spec.y - y, spec.width, spec.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask.image, mask.x - x, mask.y - y);
  const visible = opaqueBounds(ctx.getImageData(0, 0, imageCanvas.width, imageCanvas.height).data,
    imageCanvas.width, imageCanvas.height);
  if (!visible) return null;
  return { image: imageCanvas, x, y, width: imageCanvas.width, height: imageCanvas.height,
    visible: { x: x + visible.x, y: y + visible.y, width: visible.width, height: visible.height } };
}

/** Same setAppearance/apply/getStatus surface as the legacy compositor.
 * mapping must be captured at the exported neutral pose, before physics runs. */
export async function createStandingAppearance({ mapping, model, images, modelUrl, nativeEyes = false }) {
  if (model.id !== 'standing') throw new Error('Detailed standing appearance cannot be used for another pose.');
  if (mapping.canvasInfo.CanvasWidth !== model.width || mapping.canvasInfo.CanvasHeight !== model.height) {
    throw new Error('Detailed PSD canvas differs from the V8 standing source.');
  }
  const masksURL = new URL('./standing/appearance-masks.json', import.meta.url);
  const url = new URL(modelUrl, document.baseURI).href;
  const [config, settings] = await Promise.all([readJSON(masksURL), readJSON(url)]);
  if (config.version !== 1 || config.canvas[0] !== model.width || config.canvas[1] !== model.height) {
    throw new Error('Standing appearance masks do not match this canvas.');
  }
  const originals = await Promise.all(settings.FileReferences.Textures.map(ref => loadImage(assetURL(ref, url))));
  if (originals.length !== mapping.textures.length || originals.some((image, i) =>
    image.width !== mapping.textures[i].width || image.height !== mapping.textures[i].height)) {
    throw new Error('Detailed standing atlas dimensions differ from the captured mapping.');
  }
  const masks = {};
  for (const name of ['body', 'face', 'eyes']) {
    const spec = config[name], image = await loadImage(new URL(spec.file, masksURL));
    if (image.width !== spec.width || image.height !== spec.height) throw new Error(`Invalid ${name} ownership mask dimensions.`);
    masks[name] = { ...spec, image };
  }
  const ids = new Map(mapping.drawables.map(drawable => [drawable.id, drawable]));
  const roles = config.roles;
  const facialIds = [...roles.facialOriginal, ...roles.facialOcclusion];
  if (roles.facialOriginal.length !== 18 || roles.facialOcclusion.length !== 6 || new Set(facialIds).size !== 24) {
    throw new Error('Detailed standing facial role list changed.');
  }
  for (const id of [roles.bodyHost, roles.faceHost, ...facialIds, ...roles.blinkFade]) {
    const drawable = ids.get(id);
    if (!drawable || !drawable.vertices?.length || !drawable.indices?.length) {
      throw new Error('Required detailed standing drawable is missing or empty: ' + id);
    }
  }
  if (roles.blinkFade.some(id => !facialIds.includes(id) || !/^(eye_|iris_|sclera_)/.test(id))) {
    throw new Error('Blink opacity roles may contain only original eye parts and eye underpaint.');
  }
  const parts = {};
  for (const [role, id] of [['body', roles.bodyHost], ['face', roles.faceHost]]) {
    const drawable = ids.get(id), texture = mapping.textures[drawable.textureIndex];
    if (!texture) throw new Error('Invalid atlas index for ' + id);
    // A bad mapping is a hard failure; never fall back to the coarse compositor.
    parts[role] = { ...drawable, ...fitDrawableAtlasMap(drawable, mapping.canvasInfo, texture, .15), mask: masks[role] };
  }
  const blinkIds = new Set(roles.blinkFade), clippedCache = new Map();
  const emptyDrawablesSkipped = mapping.drawables.filter(d => !d.vertices?.length || !d.indices?.length).map(d => d.id);

  function patchesFor(role, specs) {
    return specs.flatMap(spec => {
      const key = `${role}:${spec.src}:${spec.x}:${spec.y}:${spec.width}:${spec.height}`;
      if (!clippedCache.has(key)) {
        const image = images.get(spec.src);
        if (!image) throw new Error('Missing existing V8 source asset: ' + spec.src);
        clippedCache.set(key, clipPatch(image, spec, parts[role].mask));
      }
      const patch = clippedCache.get(key);
      return patch ? [patch] : [];
    });
  }

  function regionBox(part, patches) {
    const bounds = unionBounds(patches.map(patch => transformedBounds(part.transform, patch.visible)));
    if (!bounds) return null;
    const size = mapping.textures[part.textureIndex];
    const x = Math.max(0, Math.floor(bounds.x) - 2), y = Math.max(0, Math.floor(bounds.y) - 2);
    const right = Math.min(size.width, Math.ceil(bounds.right) + 2), bottom = Math.min(size.height, Math.ceil(bounds.bottom) + 2);
    if (right <= x || bottom <= y) throw new Error('Standing patch maps outside its atlas.');
    return { textureIndex: part.textureIndex, x, y, width: right - x, height: bottom - y };
  }

  function renderRegion(part, box, patches) {
    const image = canvas(box.width, box.height), ctx = image.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(originals[box.textureIndex], box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    const transform = [...part.transform]; transform[4] -= box.x; transform[5] -= box.y;
    ctx.setTransform(...transform);
    for (const patch of patches) ctx.drawImage(patch.image, patch.x, patch.y, patch.width, patch.height);
    ctx.resetTransform();
    return { ...box, image, ctx };
  }

  let current = null, revision = 0, uploaded = -1, lastBlink = -1;
  let staticRegions = [], blinkRegion = null, lastOpacities = {};
  return {
    setAppearance({ outfit = model.defaultOutfit || 'original', expression = 'neutral', nativeFace = false } = {}) {
      nativeFace = nativeEyes && (expression === 'neutral' || nativeFace === true);
      if (current?.outfit === outfit && current?.expression === expression && current?.nativeFace === nativeFace) return this;
      if (outfit !== 'original' && !model.wardrobe[outfit]) throw new Error('Unknown standing outfit: ' + outfit);
      if (expression !== 'neutral' && !model.expressions[expression]) throw new Error('Unknown standing expression: ' + expression);
      const bodyPatches = patchesFor('body', outfit === 'original' ? [] : [model.wardrobe[outfit]]);
      const facePatches = patchesFor('face', expression === 'neutral' || nativeFace ? [] : [model.expressions[expression]]);
      if (outfit !== 'original' && !bodyPatches.length) throw new Error('Outfit has no pixels within the original body ownership.');
      if (expression !== 'neutral' && !nativeFace && !facePatches.length) throw new Error('Expression has no pixels within the original face ownership.');
      const nextRegions = [];
      for (const [role, patches] of [['body', bodyPatches], ['face', facePatches]]) {
        const box = regionBox(parts[role], patches);
        if (box) nextRegions.push(renderRegion(parts[role], box, patches));
      }
      let nextBlinkRegion = null;
      if (!nativeFace && !CLOSED_EXPRESSIONS.has(expression)) {
        const blinkPatches = patchesFor('face', model.blinkEyes);
        if (!blinkPatches.length) throw new Error('Blink assets have no pixels within original face ownership.');
        const box = regionBox(parts.face, blinkPatches);
        const open = renderRegion(parts.face, box, facePatches);
        const closed = renderRegion(parts.face, box, [...facePatches, ...blinkPatches]);
        const mix = canvas(box.width, box.height), ctx = mix.getContext('2d');
        const ownership = canvas(box.width, box.height), ownershipContext = ownership.getContext('2d');
        const transform = [...parts.face.transform]; transform[4] -= box.x; transform[5] -= box.y;
        ownershipContext.setTransform(...transform);
        ownershipContext.drawImage(masks.eyes.image, masks.eyes.x, masks.eyes.y);
        nextBlinkRegion = { ...box, mix, ctx, output: ctx.createImageData(box.width, box.height),
          originalEyeOwnership: ownershipContext.getImageData(0, 0, box.width, box.height).data,
          open: open.ctx.getImageData(0, 0, box.width, box.height),
          closed: closed.ctx.getImageData(0, 0, box.width, box.height) };
        open.image.width = closed.image.width = ownership.width = 1;
      }
      for (const region of staticRegions) region.image.width = region.image.height = 1;
      if (blinkRegion) blinkRegion.mix.width = blinkRegion.mix.height = 1;
      staticRegions = nextRegions; blinkRegion = nextBlinkRegion;
      current = { outfit, expression, nativeFace }; revision++;
      return this;
    },

    apply(renderer, blink = 0) {
      if (!current) this.setAppearance();
      const value = blinkRegion ? Math.max(0, Math.min(1, Number(blink) || 0)) : 0;
      const appearanceChanged = uploaded !== revision;
      const textureReset = appearanceChanged || (lastBlink > 0 && value === 0);
      if (textureReset) {
        // Upload the decoded export directly. No Canvas2D round-trip touches
        // hair textures or changes neutral semitransparent original pixels.
        originals.forEach((image, index) => renderer.replaceTexture(index, image));
        for (const region of staticRegions) renderer.replaceTextureRegion(region.textureIndex, region.image, region.x, region.y);
        uploaded = revision; lastBlink = 0;
      }
      if (!textureReset && value === lastBlink) return false;
      if (blinkRegion && value !== lastBlink) {
        const { open, closed, output, originalEyeOwnership, ctx, mix, textureIndex, x, y } = blinkRegion;
        for (let i = 0; i < output.data.length; i += 4) {
          // Native eye layers already fade by (1-value). Compensate for their
          // remaining source alpha A so the closed backing contributes b*B,
          // not b squared: host alpha = b*B / (1-A*(1-b)). At opaque original
          // eye pixels this is the complete closed backing. Retaining source
          // alpha prevents a sudden tint at the original semitransparent edge.
          const sourceAlpha = originalEyeOwnership[i + 3] / 255;
          if (current.expression === 'neutral' && sourceAlpha > 0) {
            for (let c = 0; c < 3; c++) output.data[i + c] = closed.data[i + c];
            output.data[i + 3] = closed.data[i + 3] * value / (1 - sourceAlpha * (1 - value));
            continue;
          }
          // Expression sprites have no native eye layers above the carrier.
          const a = open.data[i + 3] * (1 - value), b = closed.data[i + 3] * value, alpha = a + b;
          for (let c = 0; c < 3; c++) output.data[i + c] = alpha ? (open.data[i + c] * a + closed.data[i + c] * b) / alpha : 0;
          output.data[i + 3] = alpha;
        }
        ctx.putImageData(output, 0, 0);
        renderer.replaceTextureRegion(textureIndex, mix, x, y);
      }
      // The face host draws above local original skin, so blinking requires no
      // skin fade. Brows, mouth and nose retain their own native layers.
      const opacities = {};
      for (const id of facialIds) {
        const opacity = current.nativeFace ? 1 : current.expression !== 'neutral' ? 0 : blinkIds.has(id) ? 1 - value : 1;
        if (renderer.setDrawableOpacityById(id, opacity) === false) throw new Error('Cannot apply standing facial opacity: ' + id);
        opacities[id] = opacity;
      }
      lastOpacities = opacities; lastBlink = value;
      return true;
    },

    getStatus() {
      return {
        method: 'V8 patches clipped to detailed original body/face ownership; native hair atlas untouched',
        expressionParametersRigged: false,
        nativeEyes, facialMode: current?.nativeFace ? 'native Cubism parameters' : 'V8 appearance compatibility',
        blinkMethod: current?.nativeFace ? 'native EyeOpen parameters; no blink texture or eye opacity override' : 'V8 eye patches and original layer opacity',
        current: current ? { ...current } : null, blink: Math.max(0, lastBlink),
        maxMappingError: Math.max(parts.body.error, parts.face.error),
        roles: { bodyHost: roles.bodyHost, faceHost: roles.faceHost,
          facialOriginal: [...roles.facialOriginal], facialOcclusion: [...roles.facialOcclusion], blinkFade: [...roles.blinkFade] },
        drawableOpacities: { ...lastOpacities }, emptyDrawablesSkipped: [...emptyDrawablesSkipped],
        wardrobeDrawables: {}, originalAtlasPreservedWhenNeutral: true,
        patchRegions: staticRegions.map(({ textureIndex, x, y, width, height }) => ({ textureIndex, x, y, width, height })),
        blinkRegions: blinkRegion ? [{ textureIndex: blinkRegion.textureIndex, x: blinkRegion.x, y: blinkRegion.y,
          width: blinkRegion.width, height: blinkRegion.height }] : [],
      };
    },
  };
}
