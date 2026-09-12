"""Assemble the preferred 20 clips without new inference or pixel changes."""
import copy,json,os,shutil,hashlib
from pathlib import Path
runs=Path(__file__).resolve().parents[2]/'runs'
base=runs/'wetlands-v4';retry=runs/'wetlands-root-attack-retry';out=runs/'wetlands-selected'
base_config=json.loads((base/'config.json').read_text());config=copy.deepcopy(base_config)
retry_entry=json.loads((retry/'config.json').read_text())['assets'][0]
for entry in config['assets']:
    if entry['asset']['id']=='root_hulk':
        entry['prompts']['motions']['attack']=retry_entry['prompts']['motions']['attack']
        entry['seeds']['attack']=retry_entry['seeds']['attack']
config['source']['selected_motion_take']={'root_hulk/attack':{'run':'wetlands-root-attack-retry',
    'reason':'Shorter appearance-based prompt reduced frontal humanoid drift; attack still needs two-fist slam cleanup.',
    'same_seed':True,'original_run':'wetlands-v4'}}
out.mkdir(exist_ok=True)
p=out/'config.json'
if p.exists() and json.loads(p.read_text())!=config:raise ValueError('Selected run differs; choose a new directory')
p.write_text(json.dumps(config,indent=2)+'\n')
def copy_file(src,dst):
    if Path(src).suffix=='.json':return shutil.copy2(src,dst)
    os.link(src,dst);return dst
def clone(src,dst):
    if not dst.exists():shutil.copytree(src,dst,copy_function=copy_file)
selections={}
for entry in config['assets']:
    key=entry['asset']['id']
    (out/'selected-originals').mkdir(exist_ok=True)
    for suffix in ('.png','.json'):
        src=base/'originals'/(key+suffix);dst=out/'selected-originals'/(key+suffix)
        if not dst.exists():copy_file(src,dst)
    clone(base/'references'/key,out/'references'/key)
    selections[key]={'source':f'../wetlands-v4/originals/{key}.png','reason':'Reuse the exact selected reference and its existing cutout; no pixel edits.'}
    p=out/'references'/key/'source.json';d=json.loads(p.read_text());d['selection']=selections[key]
    p.write_text(json.dumps(d,indent=2)+'\n')
    # Root's retry export already measures all four states together; other
    # enemies retain their base exports. All palettes/timing/settings match.
    export_run=retry if key=='root_hulk' else base
    clone(export_run/'exports'/key,out/'exports'/key)
    for act in config['actions']:
        src_run=retry if (key,act)==('root_hulk','attack') else base
        src=src_run/'animations'/key/act;dst=out/'animations'/key/act
        assert (src/'tracking/tracking.json').exists()
        source_contract=json.loads((src/'config.json').read_text())
        ref_hash=hashlib.sha256((out/'references'/key/'reference.png').read_bytes()).hexdigest()
        assert source_contract['reference_sha256']==ref_hash
        assert source_contract['preset']['prompt']==entry['prompts']['motions'][act]
        assert source_contract['generation']['seed']==entry['seeds'][act]
        existed=dst.exists();clone(src,dst)
        if not existed:
            stages={}
            for stage in ('high','low'):
                p=dst/stage/'completed.json';d=json.loads(p.read_text())
                d['shared_expert_session']=os.path.relpath(src_run/d['shared_expert_session'],out)
                p.write_text(json.dumps(d,indent=2)+'\n');stages[stage]=d
            p=dst/'generation.json';d=json.loads(p.read_text());d['stages']=stages
            d['selected_from_run']=src_run.name
            p.write_text(json.dumps(d,indent=2)+'\n')
(out/'selection.json').write_text(json.dumps(selections,indent=2)+'\n')
for name in ('reference-review.json','reference-environment.json','hardware.json','followups.json'):
    shutil.copyfile(base/name,out/name)
reviews=json.loads((base/'visual-review.json').read_text())
reviews['jobs']['root_hulk/attack']={'status':'improved_candidate_needs_cleanup','pixel_reviewed':True,
    'notes':'Selected shorter-prompt retry. Retains the hunched wooden body and left-facing tendency much better, then recovers toward the reference. Still yaws and sweeps a fist rather than delivering a clean simultaneous two-fist ground slam. Original failed take is preserved in wetlands-v4. At 64px nearest keeps more wood/vine detail than Pyxelate; outlines and fist positions still need cleanup.'}
for action in ('idle','walk','death'):
    job=reviews['jobs']['root_hulk/'+action]
    job['notes']=job['notes'].replace('The large transformed attack forces extra shared framing, reducing the standing reference to fewer native pixels.', 'The selected set uses the tighter shared crop from the improved attack; these three motions are otherwise unchanged.')
(out/'visual-review.json').write_text(json.dumps(reviews,indent=2)+'\n')
print(out)
