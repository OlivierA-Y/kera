"""Run in a fresh process after selection; verifies serialization on TRAIN only."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from kera_ml.features import FEATURE_NAMES,extract
from kera_ml.inference import Predictor
from kera_ml.preprocessing import parse_boxes
from kera_ml.train import predict_family
art=Path('artifacts');split=json.loads((art/'split.json').read_text())
df=pd.read_csv('data/features.csv');df=df[df.patient_id.isin(split['train_ids'])]
X=df[FEATURE_NAMES].to_numpy();out={}
for family in ['dummy','ridge','elastic','mlp']:
    p=predict_family(family,art,X);expected=np.load(art/f'reload_expected_{family}.npy')
    np.testing.assert_allclose(p,expected,rtol=0,atol=1e-10)
    out[family]={'max_reload_difference':float(np.max(abs(p-expected))),'device':'cpu'}
spec=Predictor();chosen=spec.spec['model']
np.testing.assert_allclose(spec.predict_features(X),predict_family(chosen,art,X),atol=1e-10)
row=pd.read_csv('data/raw/metadata.csv');row=row[row.PATIENT_ID==int(df.iloc[0].patient_id)].iloc[0]
path=df.iloc[0].image_path;nail=parse_boxes(row.NAIL_BOUNDING_BOXES)[1];skin=parse_boxes(row.SKIN_BOUNDING_BOXES)[1]
p=spec.predict_hemoglobin(path,nail,skin)
np.testing.assert_allclose(p['hemoglobin_g_per_l'],spec.predict_features(X[:1])[0],atol=1e-10)
out['end_to_end_training_image']=p
Path('reports/reload_verification.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
