"""Check complete Wetlands batch coverage."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('run',type=Path)
a=parser.parse_args();run=a.run.resolve()
config=json.loads((run/'config.json').read_text())
keys=[e['asset']['id'] for e in config['assets']]
expected=['bog_toad','drowned_corpse','bog_hag','root_hulk','giant_water_strider']
assert keys==expected, keys
assert config['actions']==['idle','attack','walk','death']
index=json.loads((run/'index.json').read_text())
assert index['completed_animations']==20 and index['completed_stills']==5
assert len({(x['asset_id'],x['action']) for x in index['animations']})==25
allowed={tuple(bytes.fromhex(c[1:])) for c in config['export']['palette']['colors']}
result={'assets':5,'animations':20,'stills':5,'native_frames':0,'raw_frames':0,'atlases':0,'jobs':{},
        'note':'Technical audit only. Motion quality, identity and seam acceptability require visual inspection.'}
for key in keys:
    manifest=json.loads((run/'exports'/key/'manifest.json').read_text())
    assert set(manifest['actions'])=={'idle','attack','walk','death','reference'}
    for action in ('idle','attack','walk','death','reference'):
        spec=manifest['actions'][action]
        repeat=action in ('idle','walk')
        count=1 if action=='reference' else (22 if repeat else 23)
        duration=1000 if action=='reference' else (2750 if repeat else 2812)
        assert spec['timing']['repeat']==repeat
        assert len(spec['timing']['indices'])==count
        checks={}
        for method in ('nearest','pyxelate'):
            folder=run/'exports'/key/action/method
            atlas=json.loads((folder/'spritesheet.json').read_text())
            assert atlas['meta']['repeat']==repeat
            assert atlas['meta']['fixed_source_crop']==manifest['shared_crop']
            assert spec['variants'][method]['status']=='valid'
            assert len(atlas['frames'])==count
            assert sum(f['duration'] for f in atlas['frames'])==duration
            seq=[]
            for f in atlas['frames']:
                path=folder/f['filename'];im=Image.open(path)
                assert hashlib.sha256(path.read_bytes()).hexdigest()==f['sha256']
                assert im.mode=='RGBA' and im.size==(64,64)
                pixels=np.asarray(im)
                assert set(np.unique(pixels[:,:,3]))<={0,255}
                assert pixels[:,:,3].any(), (key,action,method,f['filename'],'empty sprite')
                assert (pixels[pixels[:,:,3]==0,:3]==0).all()
                assert set(map(tuple,pixels[pixels[:,:,3]>0,:3]))<=allowed
                seq.append(pixels);result['native_frames']+=1
            result['atlases']+=1
            if action!='reference':
                checks[method]={'wrap':spec['variants'][method]['transition_metrics'],
                    'last_two_frames_changed_pixels':int(np.any(seq[-1]!=seq[-2],axis=-1).sum())}
        if action=='reference':continue
        folder=run/'animations'/key/action
        raw=sorted((folder/'frames').glob('*.png'))
        cutouts=sorted((folder/'tracking/cutouts').glob('*.png'))
        assert len(raw)==len(cutouts)==45
        low=json.loads((folder/'low/completed.json').read_text())
        expected_raw=list(low['files'].values())
        assert len(expected_raw)==45
        for p,digest in zip(raw,expected_raw):
            assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
            with Image.open(p) as im:assert im.size==(512,512)
        for p in cutouts:
            assert hashlib.sha256(p.read_bytes()).hexdigest()==manifest['cutout_sha256'][action][p.name]
        entry=next(e for e in config['assets'] if e['asset']['id']==key)
        contract=json.loads((folder/'config.json').read_text())
        assert contract['preset']['prompt']==entry['prompts']['motions'][action]
        assert contract['generation']['seed']==entry['seeds'][action]
        assert contract['reference_sha256']==hashlib.sha256((run/'references'/key/'reference.png').read_bytes()).hexdigest()
        result['raw_frames']+=len(raw)
        tracking=json.loads((folder/'tracking/tracking.json').read_text())
        checks['mask_check_iou']=tracking['biref_check_iou']
        result['jobs'][key+'/'+action]=checks
assert result['native_frames']==910 and result['raw_frames']==900 and result['atlases']==50
(run/'technical-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='jobs'},indent=2))
