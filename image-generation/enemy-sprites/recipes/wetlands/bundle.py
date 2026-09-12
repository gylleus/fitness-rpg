"""Package a Wetlands review and include its small reproducibility inputs."""
import argparse,subprocess,sys
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);a=p.parse_args()
recipe=Path(__file__).resolve().parent;enemy=recipe.parents[1];repo=recipe.parents[3]
subprocess.run([sys.executable,str(enemy/'batch.py'),'package','--run',str(a.run)],check=True)
files=[p for p in recipe.iterdir() if p.is_file() and p.suffix in ('.py','.json','.md','.png')]
files.extend(enemy/name for name in ('wetlands.captions.json','wetlands.motions.json','batch.py','README.md'))
files.append(repo/'scripts/content.py')
with ZipFile(a.run/'sprites.zip','a',ZIP_DEFLATED) as z:
    for path in sorted(files):z.write(path,'reproduction/'+str(path.relative_to(repo)))
    for job in sorted((a.run/'animations').glob('*/*')):
        if not job.is_dir():continue
        for name in ('config.json','provenance.json','generation.json','masking-settings.json','tracking/tracking.json',
                     'high/completed.json','high/workflow-api.json','low/completed.json','low/workflow-api.json'):
            path=job/name
            if path.is_file():z.write(path,'animation-provenance/'+str(path.relative_to(a.run/'animations')))
    for folder in ('qa','raw-review'):
        for path in sorted((a.run/folder).glob('*.png')):z.write(path,str(path.relative_to(a.run)))
with ZipFile(a.run/'sprites.zip') as z:
    assert len(z.namelist())==len(set(z.namelist()))
    assert z.testzip() is None
    print('Verified archive:',len(z.namelist()),'files')
