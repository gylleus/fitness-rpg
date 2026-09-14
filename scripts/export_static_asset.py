"""Shared static PNG export and palette migration for item icons and maps.

uv run sprite-python scripts/export_static_asset.py SOURCE OUTPUT [--icon] [--fit-content]
uv run sprite-python scripts/export_static_asset.py --reexport-items
uv run sprite-python scripts/export_static_asset.py --reexport-map
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess

from PIL import Image
from asset_palette import ROOT, map_palette, palette_contract, validate_image


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export_static(source, output, *, icon=False, fit_content=False):
    if source.resolve() == output.resolve():
        raise ValueError("Export must not overwrite its source master")
    if icon:
        # Retain the accepted importer geometry exactly. Map only after resizing.
        data = subprocess.check_output(['convert', str(source),
            *(['-trim', '+repage'] if fit_content else []), '-filter', 'Point',
            '-resize', '56x56' if fit_content else '64x64', '-background', 'none',
            '-gravity', 'center', '-extent', '64x64', 'PNG32:-'])
        image = Image.open(io.BytesIO(data)).convert('RGBA')
    else:
        image = Image.open(source).convert('RGBA')
    image = map_palette(image)
    validate_image(image, source)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)
    return {'source': str(source.relative_to(ROOT) if source.is_relative_to(ROOT) else source),
            'source_sha256': sha(source), 'palette': palette_contract(),
            'size': list(image.size), 'sha256': sha(output)}


def reexport_items():
    for record_path in sorted((ROOT / 'image-generation/items/v1/provenance').glob('*.json')):
        record = json.loads(record_path.read_text())
        output = ROOT / record['icon']
        # These older source masters were local-only. Keep the pre-palette export
        # as an explicit immutable input when the generated original is absent.
        previous = record.get('palette_export')
        if previous:
            source = ROOT / previous['source']
            if sha(source) != previous['source_sha256']:
                raise ValueError(f'Palette source changed: {source}')
            icon = previous['resized_from_master']
        else:
            source = ROOT / record['original']
            icon = source.exists()
            if icon:
                if sha(source) != record['source_sha256']:
                    raise ValueError(f'Item source changed: {source}')
            else:
                if sha(output) != record['icon_sha256']:
                    raise ValueError(f'Item export changed: {output}')
                source = ROOT / 'image-generation/items/v1/palette-inputs' / output.name
                if source.exists() and sha(source) != record['icon_sha256']:
                    raise ValueError(f'Archived item export differs: {source}')
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_bytes(output.read_bytes())
        info = export_static(source, output, icon=icon,
                             fit_content=record.get('fit_content', '56x56' in record['export']))
        record['palette_export'] = {**info, 'resized_from_master': icon,
            'input_kind': 'generated source master' if icon else 'archived original 64px export; generation master unavailable'}
        record['icon_sha256'] = info['sha256']
        record_path.write_text(json.dumps(record, indent=2) + '\n')


def reexport_map():
    folder = ROOT / 'image-generation/maps/world-map-v1'
    path = folder / 'source.json'
    record = json.loads(path.read_text())
    source = folder / record['source']
    if sha(source) != record['sha256']:
        raise ValueError('World map source changed')
    info = export_static(source, ROOT / record['runtime'])
    record.update(runtimeExport='Original dimensions and alpha; shared master palette without dithering.',
                  palette_export=info)
    path.write_text(json.dumps(record, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path)
    parser.add_argument('output', nargs='?', type=Path)
    parser.add_argument('--icon', action='store_true')
    parser.add_argument('--fit-content', action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--reexport-items', action='store_true')
    mode.add_argument('--reexport-map', action='store_true')
    args = parser.parse_args()
    if args.reexport_items:
        reexport_items()
    elif args.reexport_map:
        reexport_map()
    elif args.source and args.output:
        print(json.dumps(export_static(args.source.resolve(), args.output.resolve(),
                                       icon=args.icon, fit_content=args.fit_content)))
    else:
        parser.error('Supply SOURCE OUTPUT or a reexport command')


if __name__ == '__main__':
    main()
