import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkLive2D, EXPECTED_MODELS } from './check-live2d.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const checkerPath = path.join(scriptsDir, 'check-live2d.mjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8uoAAAAASUVORK5CYII=', 'base64');
const codes = report => report.errors.map(error => error.code);

// These bytes intentionally are NOT a valid Cubism model. They test signatures
// only; a structural pass must never claim that Core loading or rendering passed.
const fakeMoc = pose => Buffer.from('MOC3 TEST FIXTURE, NOT A MODEL: ' + pose);
async function fixture(t) {
  const root = await mkdtemp(path.join(scriptsDir, '.live2d-check-test-'));
  t.after(async () => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), scriptsDir);
    assert.ok(path.basename(absolute).startsWith('.live2d-check-test-'));
    await rm(absolute, { recursive: true, force: true });
  });
  const put = async (name, value) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
  };
  const manifest = path.join(root, 'manifest.json');
  const config = { schemaVersion: 1, poses: Object.fromEntries(Object.entries(EXPECTED_MODELS).map(([pose, model]) => [pose, { model }])) };
  await put('manifest.json', config);
  for (const [pose, model] of Object.entries(EXPECTED_MODELS)) {
    await put(model, { Version: 3, FileReferences: { Moc: 'character.moc3', Textures: ['texture.png'] } });
    await put(pose + '/character.moc3', fakeMoc(pose));
    await put(pose + '/texture.png', png);
  }
  const edit = async (pose, change) => {
    const name = EXPECTED_MODELS[pose];
    const value = JSON.parse(await readFile(path.join(root, name), 'utf8'));
    change(value);
    await put(name, value);
  };
  return { root, manifest, config, put, edit, check: () => checkLive2D(manifest) };
}

test('complete structure returns 0 but never claims runtime validity', async t => {
  const f = await fixture(t);
  const report = await f.check();
  assert.equal(report.status, 'structure-ok');
  assert.equal(report.runtimeVerified, false);
  assert.equal(report.structuralOnly, true);
  assert.ok(report.notes.some(note => note.includes('Cubism Core')));
  const child = spawnSync(process.execPath, [checkerPath, '--manifest', f.manifest, '--json'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).runtimeVerified, false);
});

test('missing all three models is blocked and CLI exits 2 with JSON', async t => {
  const f = await fixture(t);
  for (const model of Object.values(EXPECTED_MODELS)) await rm(path.join(f.root, model));
  const child = spawnSync(process.execPath, [checkerPath, '--manifest', f.manifest, '--json'], { encoding: 'utf8' });
  assert.equal(child.status, 2, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'blocked');
  assert.equal(report.errors.filter(error => error.code === 'missing').length, 3);
  assert.ok(Object.values(report.poses).every(pose => pose.status === 'blocked'));
});

test('pose mappings cannot be swapped', async t => {
  const f = await fixture(t);
  f.config.poses.seated.model = EXPECTED_MODELS.kneeling;
  await f.put('manifest.json', f.config);
  assert.ok(codes(await f.check()).includes('pose_mapping'));
});

test('different pose settings cannot share one MOC file', async t => {
  const f = await fixture(t);
  await f.edit('seated', model => { model.FileReferences.Moc = '../standing/character.moc3'; });
  assert.ok(codes(await f.check()).includes('duplicate_moc'));
});

for (const [name, content, expected] of [
  ['empty MOC', Buffer.alloc(0), 'empty'],
  ['renamed PNG as MOC', png, 'moc_signature'],
  ['header-only MOC', Buffer.from('MOC3'), 'moc_signature'],
]) test(name + ' fails', async t => {
  const f = await fixture(t);
  await f.put('standing/character.moc3', content);
  assert.ok(codes(await f.check()).includes(expected));
});

for (const [name, content, expected] of [
  ['empty texture', Buffer.alloc(0), 'empty'],
  ['HTML error page as PNG', '<html>Not found</html>', 'texture_signature'],
  ['header-only PNG', png.subarray(0, 8), 'texture_signature'],
]) test(name + ' fails', async t => {
  const f = await fixture(t);
  await f.put('standing/texture.png', content);
  assert.ok(codes(await f.check()).includes(expected));
});

test('non-PNG texture format is explicitly unsupported', async t => {
  const f = await fixture(t);
  await f.put('standing/texture.jpg', Buffer.from([255, 216, 255, 217]));
  await f.edit('standing', model => { model.FileReferences.Textures = ['texture.jpg']; });
  assert.ok(codes(await f.check()).includes('texture_format'));
});

test('wrong model JSON version and missing required references fail', async t => {
  const f = await fixture(t);
  await f.edit('standing', model => { model.Version = 2; model.FileReferences.Textures = []; delete model.FileReferences.Moc; });
  const errors = codes(await f.check());
  for (const code of ['model_version', 'textures', 'invalid_path']) assert.ok(errors.includes(code));
});

test('all optional references, including sound, are required when declared', async t => {
  const f = await fixture(t);
  await f.edit('standing', model => Object.assign(model.FileReferences, {
    Physics: 'physics.json', Pose: 'pose.json', UserData: 'user.json', DisplayInfo: 'display.json',
    Expressions: [{ Name: 'smile', File: 'expression.json' }],
    Motions: { Idle: [{ File: 'motion.json', Sound: 'voice.wav' }] },
  }));
  let report = await f.check();
  assert.equal(report.errors.filter(error => error.code === 'missing').length, 7);
  for (const filename of ['physics.json', 'pose.json', 'user.json', 'display.json', 'expression.json', 'motion.json']) await f.put('standing/' + filename, {});
  await f.put('standing/voice.wav', 'fixture sound');
  assert.equal((await f.check()).status, 'structure-ok');
  await f.put('standing/motion.json', '{broken');
  assert.ok(codes(await f.check()).includes('invalid_json'));
});

for (const [reference, expected] of [
  ['../../outside.moc3', 'path_escape'],
  ['https://example.test/model.moc3', 'invalid_path'],
  ['C:/outside.moc3', 'invalid_path'],
  ['%2e%2e/outside.moc3', 'invalid_path'],
  ['/outside.moc3', 'invalid_path'],
]) test('reject unsafe reference ' + reference, async t => {
  const f = await fixture(t);
  await f.edit('standing', model => { model.FileReferences.Moc = reference; });
  assert.ok(codes(await f.check()).includes(expected));
});

test('symlink or junction cannot escape package directory', async t => {
  const f = await fixture(t);
  await symlink(scriptsDir, path.join(f.root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await f.edit('standing', model => { model.FileReferences.Moc = '../outside/check-live2d.mjs'; });
  assert.ok(codes(await f.check()).includes('path_escape'));
});

test('malformed JSON and JSON null cannot pass as model settings', async t => {
  const f = await fixture(t);
  await f.put(EXPECTED_MODELS.standing, 'null');
  await f.put(EXPECTED_MODELS.seated, '{broken');
  const report = await f.check();
  assert.equal(report.status, 'blocked');
  assert.ok(codes(report).includes('invalid_model'));
  assert.ok(codes(report).includes('invalid_json'));
});

test('unsupported manifest version is blocked', async t => {
  const f = await fixture(t);
  f.config.schemaVersion = 99;
  await f.put('manifest.json', f.config);
  assert.equal((await f.check()).status, 'blocked');
  assert.ok(codes(await f.check()).includes('schema_version'));
});

test('file references cannot point to a directory', async t => {
  const f = await fixture(t);
  await f.edit('standing', model => { model.FileReferences.Moc = '.'; });
  assert.ok(codes(await f.check()).includes('not_file'));
});

test('CLI usage errors exit 1', () => {
  const child = spawnSync(process.execPath, [checkerPath, '--manifest'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
});
