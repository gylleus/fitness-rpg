"""Compare the original and selected Hulk attack on matching raw canvases."""
import json
from pathlib import Path
from PIL import Image,ImageDraw
runs=Path(__file__).resolve().parents[2]/'runs'
roots=[runs/'wetlands-v4',runs/'wetlands-root-attack-retry']
contracts=[json.loads((r/'animations/root_hulk/attack/config.json').read_text()) for r in roots]
for key in ('generation','reference_sha256','model_manifest_sha256'):assert contracts[0][key]==contracts[1][key]
assert contracts[0]['preset']['negative']==contracts[1]['preset']['negative']
assert contracts[0]['preset']['prompt']!=contracts[1]['preset']['prompt']
sheet=Image.new('RGB',(1300,576),'#181425');d=ImageDraw.Draw(sheet)
for row,(root,label) in enumerate(zip(roots,('original verbose prompt','selected shorter prompt'))):
    stage=root/'animations/root_hulk/attack/low'
    frames=[stage/f for f in json.loads((stage/'completed.json').read_text())['files']]
    for col,i in enumerate((0,11,22,33,44)):
        x,y=260*col,288*row
        d.text((x+4,y+6),f'{label} / raw {i}',fill='#ead4aa')
        im=Image.open(frames[i]).resize((128,128),Image.Resampling.NEAREST).resize((256,256),Image.Resampling.NEAREST)
        sheet.paste(im,(x,y+28))
sheet.save(runs/'wetlands-selected/root-attack-prompt-comparison.png')
print('Same reference, seed and model settings verified; only positive motion prompt changed.')
