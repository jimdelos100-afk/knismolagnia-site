import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
Error.stackTraceLimit = 0;

const root = new URL('../../', import.meta.url);
const story = JSON.parse(await readFile(new URL('private/story-player/data/story.json', root), 'utf8'));
const index = JSON.parse(await readFile(new URL('private/story-player/data/unity-index.json', root), 'utf8'));
const engine = await import('data:text/javascript;base64,' + Buffer.from(await readFile(new URL('private/story-player/src/engine.js', root), 'utf8')).toString('base64'));
assert.deepEqual(story.stage, { width: 1280, height: 720 });
engine.validateStory(story);

const textureName = event => index.assets[event.asset]?.name;
const snapshot = (scene, atIndex) => engine.evaluateScene({ ...scene, events: scene.events.slice(0, atIndex + 1) }, scene.events[atIndex].at);
const cgScene = story.scenes.find(scene => scene.id === 'chapter-26-row-1');
const sequence = cgScene.events.map((event, i) => ({ event, i })).filter(({ event }) => ['scene3_3', 'scene3_3b'].includes(textureName(event)));
assert.deepEqual(sequence.map(({ event }) => textureName(event)), ['scene3_3', 'scene3_3b', 'scene3_3', 'scene3_3b']);
for (const { event, i } of sequence) {
  assert.equal(event.id, 'bg:GameOverBack');
  assert.deepEqual([event.x, event.y, event.width, event.height], [0, 0, 1280, 720]);
  const state = snapshot(cgScene, i);
  const slot = state.characters.filter(actor => actor.id === event.id);
  assert.equal(slot.length, 1, 'CG switches replace one native default slot');
  assert.equal(slot[0].asset, event.asset, 'A → B → A restores A');
  assert.equal(state.eventMode, true);
  assert.equal(state.characters.filter(actor => actor.kind === 'character').length, 0, 'event CG hides ordinary portraits');
}

for (const asset of story.assets) {
  assert.ok(!index.assets[asset.id].resourcePaths?.some(path => path.includes('/thumbnail/')), 'story never binds a gallery thumbnail');
}
for (const name of ['scene3_3', 'scene3_3b', 'scene11_15']) {
  const ids = index.resourcePaths['texture/event/' + name];
  assert.equal(ids.length, 1);
  assert.deepEqual([index.assets[ids[0]].width, index.assets[ids[0]].height], [2560, 1440]);
}

const greenScene = story.scenes.find(scene => scene.id === 'chapter-52-row-1');
const greenIndex = greenScene.events.findIndex(event => textureName(event) === 'scene11_15');
assert.ok(greenIndex >= 0);
const greenCG = greenScene.events[greenIndex];
assert.deepEqual([greenCG.x, greenCG.y, greenCG.width, greenCG.height], [0, 0, 1280, 720], 'flashback CG covers the original green scene');
const greenState = snapshot(greenScene, greenIndex);
assert.equal(greenState.characters.find(actor => actor.id === greenCG.id).asset, greenCG.asset);
assert.ok(greenState.characters.some(actor => actor.id === 'bg:Layer_10'), 'intentional lower background layer is preserved');
assert.ok(greenCG.layer > greenState.characters.find(actor => actor.id === 'bg:Layer_10').layer);
assert.ok(story.scenes.every(scene => !scene.entry.characters.length), 'jump entry never accumulates mutually exclusive spreadsheet alternatives');
console.log('XP2 CG regression checks passed: native resource paths, 1280×720, A → B → A replacement, event mode, flashback coverage, explicit layers and clean graph entries.');

// Optional original *_Data folder: verify that the exact fixed CG assets decode
// from the user's local bundle. No images are displayed, copied or uploaded.
const localFolder = process.argv[2];
if (localFolder) {
  const unity = await import('data:text/javascript;base64,' + Buffer.from(await readFile(new URL('private/story-player/src/unity-local.js', root), 'utf8')).toString('base64'));
  const handles = [];
  try {
    const files = [];
    for (const { path: name } of index.files) {
      const handle = await open(join(localFolder, name), 'r'); handles.push(handle);
      const { size } = await handle.stat();
      files.push({ name, size, webkitRelativePath: name, slice(start, end) { return { async arrayBuffer() {
        const bytes = Buffer.alloc(end - start);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
        assert.equal(bytesRead, bytes.length);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      } }; } });
    }
    const library = await unity.bindUnityFolder(files, index);
    const hashes = [];
    for (const name of ['scene3_3', 'scene3_3b', 'scene11_15']) {
      const asset = index.assets[index.resourcePaths['texture/event/' + name][0]];
      const bytes = await library.readRange(asset.file, asset.offset, asset.size, asset.space);
      const rgba = unity.decodeTextureRGBA(bytes, asset);
      assert.equal(rgba.length, 2560 * 1440 * 4);
      hashes.push(createHash('sha256').update(rgba).digest('hex'));
    }
    assert.equal(new Set(hashes).size, 3, 'three native CG references decode distinct original images');
    assert.ok(library.stats.sliceBytes < 50 * 1024 * 1024, 'CG range reads stay bounded');
    library.dispose();
    console.log('Original local game check passed: fingerprint and all three distinct full-resolution CG images decoded; no image output generated.');
  } finally {
    await Promise.all(handles.map(handle => handle.close()));
  }
}
