"""Fresh-process inference with only a copied image and artifact in a temp directory."""
import json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
import pandas as pd
root=Path(__file__).resolve().parents[1]
split=json.loads((root/'artifacts/split.json').read_text());pid=split['train_ids'][0]
row=pd.read_csv(root/'data/raw/metadata.csv').set_index('PATIENT_ID').loc[pid]
with tempfile.TemporaryDirectory(prefix='kera-standalone-') as folder:
    tmp=Path(folder)
    shutil.copy(root/'artifacts/deployment.json',tmp/'model.json')
    shutil.copy(root/f'data/raw/photo/{pid}.jpg',tmp/'scan.jpg')
    (tmp/'regions.json').write_text(json.dumps(dict(nail=json.loads(row.NAIL_BOUNDING_BOXES)[1],skin=json.loads(row.SKIN_BOUNDING_BOXES)[1])))
    # No dataset path is supplied to the subprocess; do not import training libraries.
    code='''import json,sys
sys.path.insert(0,sys.argv[1])
from kera_ml.inference import Predictor
regions=json.load(open('regions.json'))
result=Predictor('model.json').predict_hemoglobin('scan.jpg',regions['nail'],regions['skin'])
result['training_libraries_loaded']=[name for name in ['torch','sklearn','pandas'] if name in sys.modules]
assert not result['training_libraries_loaded']
print(json.dumps(result))'''
    proc=subprocess.run([sys.executable,'-I','-c',code,str(root/'src')],cwd=tmp,capture_output=True,text=True,check=True)
    result=json.loads(proc.stdout)
(root/'reports/standalone_verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
