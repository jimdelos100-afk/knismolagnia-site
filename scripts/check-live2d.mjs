#!/usr/bin/env node
// Local structural preflight only. No SDK, network calls, or model generation.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXPECTED_MODELS = Object.freeze({
  standing: 'standing/character.model3.json',
  seated: 'seated/character.model3.json',
  kneeling: 'kneeling/character.model3.json',
});
const DEFAULT_MANIFEST = fileURLToPath(new URL('../public/konisi-game/live2d/manifest.json', import.meta.url));
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

export async function checkLive2D(manifestFile = DEFAULT_MANIFEST) {
  const manifestPath = path.resolve(manifestFile);
  const root = path.dirname(manifestPath);
  const report = {
    status: 'blocked',
    structuralOnly: true,
    runtimeVerified: false,
    manifest: manifestPath,
    poses: {},
    errors: [],
    notes: [
      'Structure and file signatures do not establish a valid or renderable Live2D model.',
      'MOC3 compatibility and model integrity require loading with the intended Cubism Core; PNG files must also decode and render.',
      'This manifest is an integration checklist. It does not install or enable a Live2D runtime.',
      'Posture, head motion, disabled gaze tracking, framing, and website interactions require runtime and visual verification.',
    ],
  };
  const fail = (code, location, message) => report.errors.push({ code, location, message });
  let rootReal;
  try { rootReal = await realpath(root); }
  catch (error) {
    fail(error.code === 'ENOENT' ? 'missing' : 'unreadable', 'manifest', 'Cannot access package directory: ' + error.message);
    return report;
  }

  async function readAsset(base, reference, location) {
    // Only local relative paths. Reject URL/Windows ambiguities and encoded paths.
    if (typeof reference !== 'string' || !reference.trim() || reference !== reference.trim()
      || /[\u0000-\u001f\\:%?#]/.test(reference) || path.posix.isAbsolute(reference)
      || path.win32.isAbsolute(reference)) {
      fail('invalid_path', location, 'Expected a local relative path using forward slashes; URLs, encodings and absolute paths are not supported.');
      return null;
    }
    const absolute = path.resolve(base, reference);
    if (!within(root, absolute)) {
      fail('path_escape', location, 'Reference escapes the Live2D package directory.');
      return null;
    }
    try {
      const real = await realpath(absolute);
      if (!within(rootReal, real)) {
        fail('path_escape', location, 'Reference resolves outside the package directory through a symbolic link.');
        return null;
      }
      const info = await stat(real);
      if (!info.isFile()) {
        fail('not_file', location, reference + ' is not a regular file.');
        return null;
      }
      if (info.size === 0) {
        fail('empty', location, reference + ' is empty.');
        return null;
      }
      return { absolute, real, data: await readFile(real) };
    } catch (error) {
      fail(error.code === 'ENOENT' ? 'missing' : 'unreadable', location, reference + ': ' + error.message);
      return null;
    }
  }
  function parseJson(asset, location) {
    if (!asset) return null;
    try { return JSON.parse(asset.data.toString('utf8').replace(/^\uFEFF/, '')); }
    catch {
      fail('invalid_json', location, 'File is not valid JSON.');
      return null;
    }
  }

  const manifest = parseJson(await readAsset(root, path.basename(manifestPath), 'manifest'), 'manifest');
  if (!isObject(manifest)) {
    fail('invalid_manifest', 'manifest', 'Manifest must be an object.');
    return report;
  }
  if (manifest.schemaVersion !== 1) fail('schema_version', 'manifest.schemaVersion', 'Expected schemaVersion: 1.');
  if (!isObject(manifest.poses)) {
    fail('invalid_poses', 'manifest.poses', 'Expected standing, seated and kneeling pose entries.');
    return report;
  }
  const knownMocs = new Map();
  const knownModels = new Map();

  for (const [pose, expected] of Object.entries(EXPECTED_MODELS)) {
    const startErrors = report.errors.length;
    const result = report.poses[pose] = { model: expected, status: 'blocked' };
    const entry = manifest.poses[pose];
    if (!isObject(entry) || entry.model !== expected) {
      fail('pose_mapping', 'poses.' + pose, 'This pose must retain its own mapping: ' + expected);
      continue;
    }
    const modelAsset = await readAsset(root, entry.model, pose + '.model');
    const model = parseJson(modelAsset, pose + '.model');
    if (!modelAsset || !isObject(model)) {
      if (modelAsset) fail('invalid_model', pose + '.model', 'Model settings must be an object.');
      continue;
    }
    if (knownModels.has(modelAsset.real)) {
      fail('duplicate_model', pose + '.model', 'Model file is shared with pose ' + knownModels.get(modelAsset.real) + '.');
    } else knownModels.set(modelAsset.real, pose);
    if (model.Version !== 3) fail('model_version', pose + '.Version', 'Expected official model3 JSON Version: 3.');
    const refs = model.FileReferences;
    if (!isObject(refs)) {
      fail('file_references', pose + '.FileReferences', 'Expected a FileReferences object.');
      continue;
    }
    const base = path.dirname(modelAsset.absolute);
    const moc = await readAsset(base, refs.Moc, pose + '.Moc');
    if (moc) {
      if (path.extname(moc.absolute).toLowerCase() !== '.moc3'
        || moc.data.length <= 4 || !moc.data.subarray(0, 4).equals(Buffer.from('MOC3'))) {
        fail('moc_signature', pose + '.Moc', 'Expected a nontrivial .moc3 file starting with MOC3; the header alone never proves validity.');
      }
      if (knownMocs.has(moc.real)) {
        fail('duplicate_moc', pose + '.Moc', 'MOC file is shared with pose ' + knownMocs.get(moc.real) + '; provide this pose’s own export.');
      } else knownMocs.set(moc.real, pose);
    }
    if (!Array.isArray(refs.Textures) || refs.Textures.length === 0) {
      fail('textures', pose + '.Textures', 'Expected at least one texture reference.');
    } else {
      for (const [index, reference] of refs.Textures.entries()) {
        const location = pose + '.Textures[' + index + ']';
        const texture = await readAsset(base, reference, location);
        if (!texture) continue;
        if (path.extname(texture.absolute).toLowerCase() !== '.png') {
          fail('texture_format', location, 'This checker supports Cubism PNG texture exports only. Other formats require explicit runtime support.');
        } else if (texture.data.length <= PNG_MAGIC.length || !texture.data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
          fail('texture_signature', location, 'File does not contain a PNG signature and payload.');
        }
      }
    }
    async function checkJsonReference(reference, label) {
      const asset = await readAsset(base, reference, pose + '.' + label);
      const json = parseJson(asset, pose + '.' + label);
      if (asset && !isObject(json)) fail('invalid_asset_json', pose + '.' + label, 'Expected a JSON object.');
    }
    for (const key of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) {
      if (Object.hasOwn(refs, key)) await checkJsonReference(refs[key], key);
    }
    if (Object.hasOwn(refs, 'Expressions')) {
      if (!Array.isArray(refs.Expressions)) fail('expressions', pose + '.Expressions', 'Expected an array.');
      else for (const [index, expression] of refs.Expressions.entries()) {
        await checkJsonReference(expression?.File, 'Expressions[' + index + '].File');
      }
    }
    if (Object.hasOwn(refs, 'Motions')) {
      if (!isObject(refs.Motions)) fail('motions', pose + '.Motions', 'Expected an object of motion groups.');
      else for (const [group, entries] of Object.entries(refs.Motions)) {
        const label = 'Motions.' + group;
        if (!Array.isArray(entries)) {
          fail('motions', pose + '.' + label, 'Expected an array of motion entries.');
          continue;
        }
        for (const [index, motion] of entries.entries()) {
          await checkJsonReference(motion?.File, label + '[' + index + '].File');
          if (isObject(motion) && Object.hasOwn(motion, 'Sound')) {
            await readAsset(base, motion.Sound, pose + '.' + label + '[' + index + '].Sound');
          }
        }
      }
    }
    if (report.errors.length === startErrors) result.status = 'structure-ok';
  }
  report.status = report.errors.length === 0 ? 'structure-ok' : 'blocked';
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  let manifest = DEFAULT_MANIFEST;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--json') json = true;
    else if (args[index] === '--manifest' && args[index + 1] && !args[index + 1].startsWith('--')) manifest = args[++index];
    else if (args[index] === '--help') {
      console.log('Usage: node scripts/check-live2d.mjs [--manifest path/to/manifest.json] [--json]');
      return;
    } else {
      console.error('Unknown or incomplete argument: ' + args[index]);
      process.exitCode = 1;
      return;
    }
  }
  const report = await checkLive2D(manifest);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('Live2D: ' + report.status.toUpperCase() + ' (structural preflight only)');
    for (const [pose, result] of Object.entries(report.poses)) console.log('  ' + pose + ': ' + result.status + ' — ' + result.model);
    for (const error of report.errors) console.log('  [' + error.code + '] ' + error.location + ': ' + error.message);
    for (const note of report.notes) console.log('  Note: ' + note);
  }
  process.exitCode = report.status === 'structure-ok' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('Live2D checker error: ' + error.message);
    process.exitCode = 1;
  });
}
