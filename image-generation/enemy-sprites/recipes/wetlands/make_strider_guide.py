"""Deterministic anatomy guide for local img2img; never exported as final art."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).with_name('strider-guide.png')
im = Image.new('RGB', (256, 256), '#aaaaaa')
d = ImageDraw.Draw(im)
# Two articulated load-bearing legs; each ends in one broad water pad.
for points, color in [([(143,88),(186,125),(202,211)],'#606c70'), ([(123,85),(151,132),(130,215)],'#9baba4')]:
    d.line(points, fill='#293537', width=12, joint='curve')
    d.line(points, fill=color, width=7, joint='curve')
    x,y=points[-1]
    d.polygon([(x-16,y),(x+10,y-2),(x+17,y+6),(x-20,y+6)], fill='#293537')
    d.line([(x-14,y+1),(x+10,y)], fill='#606c70', width=2)
# Small elongated body, upturned abdomen, and broad low mask-like head.
d.polygon([(76,69),(103,57),(145,65),(165,56),(183,37),(183,57),(167,82),(142,96),(105,92),(76,84)], fill='#293537')
d.polygon([(83,69),(104,62),(145,71),(169,58),(174,53),(166,77),(140,89),(108,86),(83,80)], fill='#acb9ad')
d.polygon([(109,63),(139,70),(143,77),(109,73)], fill='#d5d8c9')
d.polygon([(113,79),(141,82),(137,89),(110,85)], fill='#778d85')
d.polygon([(45,67),(68,59),(103,66),(105,83),(84,94),(49,88),(43,82)], fill='#293537')
d.polygon([(49,69),(70,64),(98,70),(98,82),(83,88),(50,83)], fill='#bcc5b8')
d.line([(48,78),(86,79),(97,77)],fill='#293537',width=2)
d.rectangle((60,68,64,71),fill='#181f24')
d.rectangle((68,69,71,72),fill='#181f24')
d.line([(76,64),(96,70)],fill='#e1dfce',width=2)
im.resize((1024,1024), Image.Resampling.NEAREST).save(out)
print(out)
