#!/usr/bin/env python3
"""Register authored poses and export a rigid, planted one-pixel breathing loop.

Run with uv run sprite-python. No model inference or source repainting occurs
here: imagegen authored the references and poses; this is the CPU atlas stage.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / 'image-generation/sprite-animation'))
from pixels import comparison, convert

TYPES = ('mace', 'axe', 'sword', 'fist')
SIZE, PIVOT_X, GROUND = 128, 62, 112
BODY_HEIGHT = 78
KNEE, BOOT = 91, 104
IDLE_OFFSETS = (0, -1, -1, 0, 0, 1, 1, 0)
DURATIONS = {'idle': [300] * 8, 'walk': [140, 130, 130, 140, 130, 130],
             'attack': [120, 160, 120, 100, 140, 160],
             'death': [100, 120, 130, 140, 160, 250]}
# Reviewed garment bounds at the final grid. Saturated orange/red highlights
# are forbidden for this material; leather browns and metal colors stay intact.
CLOTH_BOUNDS = {'idle': (35, 74, 76, 96), 'walk': (28, 70, 82, 100),
                'attack': (30, 73, 78, 103), 'death': (6, 74, 88, 113)}


def cloth_palette(frame, action):
    rgba = np.array(frame)
    x0, y0, x1, y1 = CLOTH_BOUNDS[action]
    cloth = rgba[y0:y1, x0:x1]
    for color in ((190, 74, 47), (162, 38, 51), (228, 59, 68)):
        mask = (cloth[..., :3] == color).all(axis=2) & (cloth[..., 3] > 0)
        cloth[mask, :3] = (115, 62, 57)
    return Image.fromarray(rgba)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def subjects(path, expected, columns=6):
    rgba = np.array(Image.open(path).convert('RGBA'))
    rgb = rgba[..., :3].astype(int)
    key = (rgb[..., 0] - rgb[..., 1] > 40) & (rgb[..., 2] - rgb[..., 1] > 40)
    labels, _ = ndimage.label((rgba[..., 3] >= 128) & ~key, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    objects = ndimage.find_objects(labels)
    selected = [int(i) for i in np.flatnonzero(areas[1:] > 1000) + 1]
    if len(selected) != expected:
        raise ValueError(f'{path.name}: expected {expected} complete subjects, got {len(selected)}')
    result = []
    for label in selected:
        ys, xs = objects[label - 1]
        pose = rgba[ys, xs].copy()
        pose[..., 3] = (labels[ys, xs] == label).astype(np.uint8) * 255
        pose[pose[..., 3] == 0] = 0
        result.append((Image.fromarray(pose), [xs.start, ys.start, xs.stop, ys.stop]))
    # Baselines distinguish the walking, attacking and falling rows, including
    # the low corpses. Connected subjects may cross a nominal column boundary.
    result.sort(key=lambda value: value[1][3])
    if expected > 1:
        if expected % columns:
            raise ValueError('Subject count must fill complete source rows')
        result = [pose for row in range(expected // columns)
                  for pose in sorted(result[row*columns:row*columns+columns], key=lambda v: v[1][0])]
    return result


def register(pose, box, origin, scale):
    """One reviewed scale per source, never fit an attack/corpse independently."""
    left = round(PIVOT_X + (box[0] - origin[0]) * scale)
    top = round(GROUND + (box[1] - origin[1]) * scale)
    size = (round(pose.width * scale), round(pose.height * scale))
    if min(left, top) < 1 or left + size[0] > SIZE - 1 or top + size[1] > SIZE - 1:
        raise ValueError(f'Clipped pose: {box}, placement {(left, top)}, size {size}')
    canvas = Image.new('RGBA', (SIZE, SIZE))
    canvas.paste(pose.resize(size, Image.Resampling.NEAREST), (left, top))
    return convert(canvas, SIZE, 'nearest', color_metric='ciede2000')


def breathe(base, offset):
    """Rigid head/torso/hand/weapon, one-pixel knee flex, identical boot pixels.

    Motion is applied AFTER palette conversion at the final pixel grid, so
    neither the weapon texture nor its silhouette can be resampled or morphed.
    All horizontal coordinates stay fixed; the leg band absorbs the movement.
    """
    source = np.array(base)
    result = np.zeros_like(source)
    for y in range(SIZE):
        if y < KNEE + offset:
            source_y = y - offset
        elif y < BOOT:
            source_y = round(KNEE + (y - KNEE - offset) * (BOOT - KNEE) / (BOOT - KNEE - offset))
        else:
            source_y = y
        if 0 <= source_y < SIZE:
            result[y] = source[source_y]
    return Image.fromarray(result)


def export(weapon, actions, provenance):
    out = HERE / weapon / 'export'
    out.mkdir(parents=True, exist_ok=True)
    entity = 'barbarian_player' if weapon == 'mace' else f'knight_player_{weapon}'
    manifest = {'asset_id': entity, 'name': f'Knight ({weapon})', 'facing': 'right',
                'frame_size': [SIZE, SIZE], 'pivot': [PIVOT_X / SIZE, GROUND / SIZE],
                'height_scale': 1, 'reference_idle_height_px': BODY_HEIGHT,
                'backend': 'built-in imagegen poses; CPU registration; rigid pixel idle',
                'source': provenance, 'code_sha256': sha(Path(__file__)), 'actions': {}}
    rows = []
    for action, frames in actions.items():
        dest = out / action / 'nearest'
        dest.mkdir(parents=True, exist_ok=True)
        sheet = Image.new('RGBA', (SIZE * len(frames), SIZE))
        records = []
        for i, frame in enumerate(frames):
            filename = f'frame-{i:03d}.png'
            frame.save(dest / filename)
            sheet.paste(frame, (SIZE*i, 0))
            records.append({'filename': filename, 'sha256': sha(dest / filename),
                            'frame': {'x': SIZE*i, 'y': 0, 'w': SIZE, 'h': SIZE},
                            'duration': DURATIONS[action][i], 'source_frame': i})
        sheet.save(dest / 'spritesheet.png')
        loop = action in ('idle', 'walk')
        save(dest / 'spritesheet.json', {'frames': records, 'meta': {
            'image': 'spritesheet.png', 'size': {'w': sheet.width, 'h': SIZE}, 'repeat': loop}})
        manifest['actions'][action] = {'timing': {'repeat': loop}}
        frames[0].save(out / f'{action}-first.png')
        frames[0].save(dest / 'preview.gif', save_all=True, append_images=frames[1:],
                       duration=DURATIONS[action], disposal=2, **({'loop': 0} if loop else {}))
        rows.append((action, [(str(i), frame) for i, frame in enumerate(frames)]))
    comparison(rows, out / 'comparison.png')
    save(out / 'manifest.json', manifest)


def main():
    spec = json.loads((HERE / 'sources.json').read_text())
    audit = {'idle': {'duration_ms': sum(DURATIONS['idle']), 'vertical_offsets_px': IDLE_OFFSETS,
                     'rigid_above_y': KNEE, 'fixed_boots_from_y': BOOT}, 'weapons': {}}
    previews = []
    for weapon in TYPES:
        entry = spec['weapons'][weapon]
        for key in ('reference', 'sheet', *(['attack'] if 'attack' in entry else [])):
            if sha(HERE / entry[key]['path']) != entry[key]['sha256']:
                raise ValueError(f'Changed {weapon} {key} source; review before updating provenance')
        pose, box = subjects(HERE / entry['reference']['path'], 1)[0]
        reference = cloth_palette(register(pose, box, entry['reference']['origin'], spec['reference_scale']), 'idle')
        actions = {'idle': [breathe(reference, offset) for offset in IDLE_OFFSETS]}
        source_poses = subjects(HERE / entry['sheet']['path'], 18)
        for row, action in enumerate(('walk', 'attack', 'death')):
            actions[action] = [register(pose, box,
                [spec['column_origin_x'] + i * spec['column_width'], spec['contacts'][action][i]],
                spec['sheet_scale']) for i, (pose, box) in enumerate(source_poses[row*6:row*6+6])]
        # Every action transitions from/to the exact master ready pose.
        actions['attack'][0] = reference.copy()
        actions['attack'][-1] = reference.copy()
        if 'attack' in entry:
            attack = entry['attack']
            poses = subjects(HERE / attack['path'], 4, columns=2)
            if len(attack['origins']) != len(poses):
                raise ValueError('Each corrected attack pose needs a reviewed origin')
            actions['attack'][1:5] = [register(pose, box, origin, attack['scale'])
                for (pose, box), origin in zip(poses, attack['origins'])]
        for action in ('walk', 'attack', 'death'):
            actions[action] = [cloth_palette(frame, action) for frame in actions[action]]
        export(weapon, actions, entry)
        audit['weapons'][weapon] = {'reference_box': box,
            'source_boxes': [box for _, box in source_poses]}
        if 'attack' in entry:
            audit['weapons'][weapon]['corrected_attack_boxes'] = [box for _, box in poses]
        previews.append((weapon, [('ready', reference)]))
    comparison(previews, HERE / 'weapon-previews.png')
    comparison([(weapon, [(str(i), Image.open(HERE / weapon / 'export/attack/nearest' / f'frame-{i:03d}.png'))
                          for i in range(6)]) for weapon in ('mace', 'axe', 'sword')],
               HERE / 'corrections/attack-review.png')
    save(HERE / 'extraction.json', audit)
    review = {'weapons': TYPES, 'size': SIZE, 'pivot': [PIVOT_X, GROUND],
              'bodyHeight': BODY_HEIGHT, 'durations': DURATIONS}
    (HERE / 'review-data.js').write_text('window.playerReview = ' + json.dumps(review) + ';\n')
    print('Exported four weapon classes, 16 action atlases, 104 frames.')


if __name__ == '__main__':
    main()
