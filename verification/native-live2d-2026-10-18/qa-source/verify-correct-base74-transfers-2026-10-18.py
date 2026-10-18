"""Independently rebuild the active transfer proof from the correct two 74-layer PSDs."""
from pathlib import Path
from collections import Counter
import datetime
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'work/psd-deps'))
import numpy as np
from PIL import Image
from psd_tools import PSDImage

BASE = ROOT / 'work/standing-native-gaze-2026-10-15/artwork-repair'
manifest_file = BASE / 'base74-update-verification.json'
manifest = json.loads(manifest_file.read_text(encoding='utf-8-sig'))
old_file, new_file = Path(manifest['baseSource']), Path(manifest['base74Update'])
sha = lambda value: hashlib.sha256(value).hexdigest()
assert sha(old_file.read_bytes()) == '14f898110aba5ca8176804f64fc143e84d43cdd29c78fbca05bbbebd64be25f8'
assert sha(new_file.read_bytes()) == '848f09f3004831eb099d726d10ffc622ced36a5f3eba4d614c06b85318c2fe81'
old_psd, new_psd = PSDImage.open(old_file), PSDImage.open(new_file)
leaves = lambda psd: {layer.name: layer for layer in psd.descendants() if not layer.is_group()}
old, new = leaves(old_psd), leaves(new_psd)
assert len(old) == len(new) == 74 and set(old) == set(new)
changed_ids = set(manifest['modifiedExistingNames'])
donors = ['face_visible_residual', 'face_skin_local_visible']
recipients = sorted(changed_ids-set(donors))
assert len(recipients) == 8


def raster(layer):
    result = np.zeros((1536, 1024, 4), np.uint8)
    result[layer.top:layer.bottom, layer.left:layer.right] = np.array(layer.topil(apply_icc=False).convert('RGBA'))
    return result


def parent_names(layer):
    result = []
    while layer.parent is not None:
        layer = layer.parent
        result.append(layer.name)
    return result


before, after = {name: raster(old[name]) for name in changed_ids}, {name: raster(new[name]) for name in changed_ids}
counts, pixels = Counter(), []
for recipient in recipients:
    b, a = before[recipient], after[recipient]
    moved = (b[:, :, 3] == 0) & (a[:, :, 3] > 0)
    ys, xs = np.nonzero(moved)
    for x, y in zip(xs, ys):
        matches = [donor for donor in donors if before[donor][y, x, 3] > 0 and after[donor][y, x, 3] == 0
                   and np.array_equal(before[donor][y, x], a[y, x])]
        assert len(matches) == 1, (recipient, int(x), int(y), matches)
        donor = matches[0]
        counts[(donor, recipient)] += 1
        pixels.append({'from': donor, 'to': recipient, 'sourceXY': [int(x), int(y)],
                       'originalRGBA': before[donor][y, x].tolist(), 'recipientRGBA': a[y, x].tolist(),
                       'exactRGBASha256': sha(a[y, x].tobytes())})
assert len(pixels) == 457 and len({tuple(p['sourceXY']) for p in pixels}) == 457
donor_removed = sum(int(((before[name][:, :, 3] > 0) & (after[name][:, :, 3] == 0)).sum()) for name in donors)
assert donor_removed == 457
before_sum = sum((before[name].astype(np.int32) for name in changed_ids))
after_sum = sum((after[name].astype(np.int32) for name in changed_ids))
assert np.array_equal(before_sum, after_sum)
other = sorted(set(old)-changed_ids)
assert len(other) == 64
assert all(old[name].bbox == new[name].bbox and parent_names(old[name]) == parent_names(new[name])
           and old[name].topil(apply_icc=False).convert('RGBA').tobytes() == new[name].topil(apply_icc=False).convert('RGBA').tobytes()
           for name in other)


def composite(psd):
    result = Image.new('RGBA', psd.size)
    for layer in leaves(psd).values():
        result.alpha_composite(layer.topil(apply_icc=False).convert('RGBA'), (layer.left, layer.top))
    return np.array(result)


source_difference = int(np.any(composite(old_psd) != composite(new_psd), axis=2).sum())
assert source_difference == 0
record = {'version': 1, 'date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'scope': 'Active exact 74-layer-base transfer proof independently enumerated from the approved original74 and repaired74 PSDs. No 75-layer research PSD or its transfer list is used.',
          'baseSource': str(old_file), 'baseSourceSha256': sha(old_file.read_bytes()),
          'base74Update': str(new_file), 'base74UpdateSha256': sha(new_file.read_bytes()),
          'base74UpdateManifest': str(manifest_file), 'base74UpdateManifestSha256': sha(manifest_file.read_bytes()),
          'originalLayerCount': 74, 'updatedLayerCount': 74, 'existingNamesPreserved': True,
          'modifiedExistingNames': sorted(changed_ids), 'other64LayersRGBABoundsAndParentExact': True,
          'neutralCompositeChangedRGBAPixels': source_difference, 'tenLayerRGBAChannelSumsExactlyConserved': True,
          'totalExactRGBATransfers': len(pixels), 'totalDonorRemovedAlphaPixels': donor_removed,
          'originalPixelTransfers': [{'from': source, 'to': target, 'pixels': count} for (source, target), count in sorted(counts.items())],
          'transferredPixels': pixels,
          'helperSourceChain': 'Six helpers are separate additions to form80; the current 6dd4 two-mask repair is verified by approved-helper-source-2026-10-18.json and its independent 78-layer unchanged proof.'}
out = BASE / 'base74-pixel-transfers-verification.json'
out.write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'manifest': str(out), 'sha256': sha(out.read_bytes()), 'transfers': len(pixels),
                  'pairs': record['originalPixelTransfers'], 'sourceCompositeChangedRGBAPixels': source_difference}, indent=2))
