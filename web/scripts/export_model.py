"""Export the frozen trained MLP ensemble, never retrain or access test labels."""
import json, hashlib
from pathlib import Path
import numpy as np
import pandas as pd
import torch
from kera_ml.features import FEATURE_NAMES, FEATURE_VERSION
from kera_ml.models import predict_mlp
root=Path(__file__).resolve().parents[2]
path=root/'artifacts/mlp.pt'
bundles=torch.load(path,map_location='cpu',weights_only=True)
models=[]
for b in bundles:
    state=b['state_dict']; layers=[]
    for name,tensor in state.items():
        if name.endswith('.weight'):
            prefix=name.removesuffix('.weight')
            layers.append(dict(weight=tensor.tolist(),bias=state[prefix+'.bias'].tolist()))
    models.append(dict(layers=layers,feature_mean=b['feature_mean'],feature_scale=b['feature_scale'],
                       target_mean=b['target_mean'],target_scale=b['target_scale'],seed=b['seed'],epochs=b['epochs']))
export=dict(format='kera-mlp-browser-v1',feature_version=FEATURE_VERSION,feature_names=FEATURE_NAMES,
            source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),models=models,
            architecture=[42,16,8,1],study_range=[44,169],test_mae=15.963409957885743,test_rmse=21.293136393041255)
(root/'web/dist/assets/model.json').write_text(json.dumps(export,separators=(',',':')))
# Independent CPU parity fixtures use TRAINING patients only.
split=json.loads((root/'artifacts/split.json').read_text())
df=pd.read_csv(root/'artifacts/features.csv');df=df[df.patient_id.isin(split['train_ids'])].head(10)
x=df[FEATURE_NAMES].to_numpy()
p=np.mean([predict_mlp(b,x) for b in bundles],axis=0)
(root/'web/tests/parity-fixtures.json').write_text(json.dumps(dict(features=x.tolist(),predictions=p.tolist())))
print('Exported three frozen MLPs and ten training-only CPU parity fixtures.')
