"""Reproducible coarse profile silhouettes for local SDXL img2img."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
import json

root=Path(__file__).parent
bg='#aaaaaa'
def save(im,key):
    im.resize((1024,1024),Image.Resampling.NEAREST).save(root/(key+'-guide.png'))
# A fat cadaver in left profile with garments and two staggered feet.
im=Image.new('RGB',(256,256),bg);d=ImageDraw.Draw(im)
d.polygon([(119,159),(153,160),(154,201),(173,213),(171,222),(143,222),(134,198)],fill='#302c30')
d.polygon([(97,161),(132,162),(123,204),(137,214),(135,226),(95,226),(91,217),(100,195)],fill='#56423d')
d.polygon([(103,202),(121,205),(119,216),(139,218),(137,228),(93,228),(92,218)],fill='#2d2a2e')
d.polygon([(117,77),(148,90),(156,116),(151,162),(129,184),(95,180),(78,158),(77,130),(89,106)],fill='#302e31')
d.polygon([(116,85),(143,94),(149,124),(142,160),(123,176),(94,173),(84,152),(86,127),(97,106)],fill='#716154')
d.polygon([(112,95),(125,102),(123,148),(111,162),(96,158),(99,147),(108,138)],fill='#454638')
d.polygon([(105,144),(106,164),(94,175),(81,171),(80,155),(91,146)],fill='#7d8971')
d.polygon([(104,57),(125,55),(138,66),(138,85),(124,102),(103,96),(99,87),(86,82),(91,75),(93,62)],fill='#374239')
d.polygon([(102,61),(125,61),(131,70),(128,85),(117,94),(104,90),(103,80),(94,80),(99,73)],fill='#86917b')
d.rectangle((99,68,108,74),fill='#22262a');d.line([(96,84),(113,86)],fill='#41383f',width=3)
d.line([(100,57),(120,54),(132,59)],fill='#252b2b',width=4)
save(im,'drowned_corpse')
# A stooped clawed hag; deliberately no staff or hat.
im=Image.new('RGB',(256,256),bg);d=ImageDraw.Draw(im)
d.polygon([(121,124),(159,128),(162,175),(153,215),(101,214),(114,176)],fill='#292932')
d.polygon([(125,134),(151,137),(153,184),(144,207),(111,207),(120,174)],fill='#464449')
d.polygon([(109,208),(123,210),(121,222),(102,224),(94,220)],fill='#6c7e6c')
d.polygon([(143,207),(153,209),(156,220),(139,222),(132,220)],fill='#536653')
d.polygon([(118,75),(142,91),(158,119),(156,139),(123,135),(115,108),(96,97)],fill='#382d33')
d.polygon([(117,83),(135,96),(151,121),(149,131),(128,127),(120,101),(103,96)],fill='#6d5445')
d.polygon([(110,58),(123,66),(120,88),(109,98),(91,89),(86,81),(77,80),(86,73),(91,58)],fill='#293133')
d.polygon([(95,61),(107,64),(111,77),(105,88),(96,85),(96,77),(87,76)],fill='#879382')
d.rectangle((91,67,96,70),fill='#c4c9bb');d.line([(104,58),(118,64),(123,86),(118,111)],fill='#292b32',width=9)
d.line([(121,100),(107,127),(83,153)],fill='#312d32',width=14)
d.line([(120,102),(108,127),(84,153)],fill='#748269',width=8)
d.polygon([(83,144),(95,153),(85,168),(71,172),(65,166),(73,153)],fill='#53644f')
for x,y in [(67,164),(72,168),(79,166)]:d.line([(x,y),(x-5,y+12),(x+1,y+14)],fill='#b2b79c',width=2)
save(im,'bog_hag')
# Stocky root mass in profile with heavy long arms and low woody head.
im=Image.new('RGB',(256,256),bg);d=ImageDraw.Draw(im)
d.polygon([(140,163),(177,162),(171,207),(190,215),(185,224),(146,222),(134,194)],fill='#403133')
d.polygon([(104,166),(145,170),(129,206),(141,223),(98,225),(89,215)],fill='#5c4037')
d.polygon([(112,58),(158,63),(182,88),(183,142),(156,181),(112,181),(93,153),(92,97)],fill='#352c30')
d.polygon([(116,67),(151,71),(172,92),(172,141),(151,169),(117,169),(105,146),(104,99)],fill='#795640')
d.polygon([(80,67),(110,60),(129,76),(126,98),(110,112),(86,107),(79,98)],fill='#352c30')
d.polygon([(88,72),(108,69),(118,79),(117,96),(108,104),(89,100)],fill='#8b684d')
d.line([(84,85),(104,83)],fill='#211e27',width=4);d.line([(84,97),(108,98)],fill='#211e27',width=3)
d.line([(120,96),(111,129),(94,171)],fill='#342a2c',width=31)
d.line([(118,99),(109,132),(94,173)],fill='#805b44',width=22)
d.polygon([(78,158),(103,159),(113,186),(106,202),(73,202),(67,185)],fill='#362c2e')
d.polygon([(79,166),(97,166),(104,185),(99,194),(79,195),(75,183)],fill='#87634c')
# Root fibers and green vine bindings follow the existing body mass.
for pts in [[(140,76),(149,107),(139,137),(144,164)],[(158,86),(163,113),(153,151)],[(92,74),(98,79),(92,99)],[(119,104),(105,135),(91,171)],[(88,171),(85,189)],[(120,176),(110,204),(109,218)]]:
 d.line(pts,fill='#ae8b63',width=3)
for pts in [[(133,71),(133,107),(119,141),(145,158)],[(101,123),(113,128),(118,135)],[(99,180),(78,184)],[(155,186),(170,191)]]:
 d.line(pts,fill='#49604a',width=5)
save(im,'root_hulk')
# Use the successful squat toad candidate as an image guide, mirrored left.
source=root/'toad-source.png'
ImageOps.mirror(Image.open(source)).save(root/'bog_toad-guide.png')
guides={k:{'image':k+'-guide.png','strength':(.3 if k=='bog_toad' else .62)} for k in ['bog_toad','drowned_corpse','bog_hag','root_hulk']}
guides['giant_water_strider']={'image':'strider-guide.png','strength':.62}
(root/'guides.json').write_text(json.dumps(guides,indent=2)+'\n')
