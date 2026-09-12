"""Make one controlled motion-prompt retry, reusing the other three finished clips."""
import copy,json,os,shutil
from pathlib import Path

base=Path(__file__).resolve().parents[2]/'runs/wetlands-v4'
out=base.with_name('wetlands-root-attack-retry')
key='root_hulk'
config=json.loads((base/'config.json').read_text())
entry=copy.deepcopy(next(e for e in config['assets'] if e['asset']['id']==key))
original_prompt=entry['prompts']['motions']['attack']
entry['prompts']['motions']['attack']=(
    'Side-view pixel art animation of the wooden root golem in the reference. '
    'The golem faces LEFT for the entire clip. Its nose, chest and toes point left; only the near side of its body is seen. '
    'It plants both feet, raises both heavy wooden fists above its head, bends at the hips and slams both fists down onto the ground to its LEFT, '
    'then rises back to the reference stance. One heavy slam. Fixed camera, no turning, no travel. '
    'Keep the same hunched log-and-root body, small knot head, long arms and green vine bindings. Solid gray-blue background.')
config['assets']=[entry]
config['source']['motion_prompt_experiment']={
    'base_run':'wetlands-v4','action':'root_hulk/attack','original_prompt':original_prompt,
    'change':'Shorter appearance-based motion prompt without the display name; same reference, seed and model settings. Canonical visual description and action remain unchanged.',
    'reused_actions':['idle','walk','death']}
out.mkdir(parents=True,exist_ok=True)
path=out/'config.json'
if path.exists() and json.loads(path.read_text())!=config:raise ValueError('Retry config differs; choose a new experiment directory')
path.write_text(json.dumps(config,indent=2)+'\n')
def copy_file(src,dst):
    if Path(src).suffix=='.json':return shutil.copy2(src,dst)
    os.link(src,dst);return dst
refs=out/'references'/key
if not refs.exists():shutil.copytree(base/'references'/key,refs,copy_function=copy_file)
selection={'source':'../wetlands-v4/originals/root_hulk.png','reason':'Reuse the exact previously prepared source, with no pixel edits.'}
(out/'selection.json').write_text(json.dumps({key:selection},indent=2)+'\n')
source=json.loads((refs/'source.json').read_text());source['selection']=selection
(refs/'source.json').write_text(json.dumps(source,indent=2)+'\n')
for act in ('idle','walk','death'):
    src=base/'animations'/key/act;dst=out/'animations'/key/act
    if not (src/'tracking/tracking.json').exists():raise ValueError('Wait until the base batch has finished tracking')
    if not dst.exists():
        shutil.copytree(src,dst,copy_function=copy_file)
        for stage in ('high','low'):
            p=dst/stage/'completed.json';d=json.loads(p.read_text())
            d['shared_expert_session']=os.path.relpath(base/d['shared_expert_session'],out)
            p.write_text(json.dumps(d,indent=2)+'\n')
print(out)
