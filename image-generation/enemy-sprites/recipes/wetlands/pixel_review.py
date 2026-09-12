"""Create sharp 2x native-pixel QA sheets for assets exported so far."""
import argparse,json
from pathlib import Path
from PIL import Image,ImageDraw
p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);a=p.parse_args()
run=a.run.resolve();qa=run/'qa';qa.mkdir(exist_ok=True)
for entry in json.loads((run/'config.json').read_text())['assets']:
    key=entry['asset']['id']
    if not (run/'exports'/key/'manifest.json').exists():continue
    # Sharp 2x native enlargement: four actions, two reducer rows each, six poses.
    sheet=Image.new('RGB',(6*132,8*156),'#181425');d=ImageDraw.Draw(sheet)
    for row,action in enumerate(('idle','attack','walk','death')):
        for m,method in enumerate(('nearest','pyxelate')):
            folder=run/'exports'/key/action/method
            files=sorted(folder.glob('frame-*.png'))
            indices=sorted(set((0,len(files)//4,len(files)//2,3*len(files)//4,len(files)-2,len(files)-1)))
            y=(row*2+m)*156
            d.text((4,y+2),key+' / '+action+' / '+method,fill='#ead4aa')
            for col,i in enumerate(indices):
                tile=Image.new('RGBA',(64,64),'#3a4466');tile.alpha_composite(Image.open(files[i]))
                sheet.paste(tile.convert('RGB').resize((128,128),Image.Resampling.NEAREST),(col*132,y+26))
                d.text((col*132+2,y+14),f'pose {i}',fill='#c0cbdc')
    sheet.save(qa/(key+'.png'))
    print(key)
