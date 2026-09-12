"""Build contact sheets from completed Wan stages before masking finishes."""
import argparse,json
from pathlib import Path
from PIL import Image,ImageDraw
p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);a=p.parse_args()
r=a.run.resolve();dest=r/'raw-review';dest.mkdir(exist_ok=True)
for entry in json.loads((r/'config.json').read_text())['assets']:
 key=entry['asset']['id'];rows=[]
 for act in ('idle','attack','walk','death'):
  stage=r/'animations'/key/act/'low';done=stage/'completed.json'
  if not done.exists():continue
  frames=[stage/f for f in json.loads(done.read_text())['files']]
  assert len(frames)==45
  rows.append((act,frames))
 if not rows:continue
 sheet=Image.new('RGB',(5*260,len(rows)*288),'#181425');d=ImageDraw.Draw(sheet)
 for row,(act,frames) in enumerate(rows):
  for col,i in enumerate((0,11,22,33,44)):
   x,y=col*260,row*288
   d.text((x+4,y+4),f'{key} / {act} / raw {i}',fill='#ead4aa')
   # Raw 512px sources sampled to 128px, then integer 2x nearest enlargement.
   im=Image.open(frames[i]).resize((128,128),Image.Resampling.NEAREST).resize((256,256),Image.Resampling.NEAREST)
   sheet.paste(im,(x,y+28))
 sheet.save(dest/(key+'.png'))
 print(key,','.join(act for act,_ in rows))
