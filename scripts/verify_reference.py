"""Execute only the notebook's feature helper cell; compare all 42 values."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
from PIL import Image
from kera_ml.preprocessing import parse_boxes
from kera_ml.features import extract,FEATURE_NAMES
nb=json.load(open('references/Usage Notes.ipynb'))
cell=next(''.join(c['source']) for c in nb['cells'] if c['cell_type']=='code' and ''.join(c['source']).startswith('def cut_image'))
namespace={'np':np};exec(compile(cell,'official-notebook-feature-helpers','exec'),namespace)
df=pd.read_csv('data/raw/metadata.csv'); results=[]
for row in df.head(10).itertuples():
    im=np.asarray(Image.open(f'data/raw/photo/{row.PATIENT_ID}.jpg'))
    expected=[]
    white=np.median(im[350:400,300:350],axis=(0,1))
    for boxes in [row.NAIL_BOUNDING_BOXES,row.SKIN_BOUNDING_BOXES]:
        t,l,b,r=json.loads(boxes)[1]
        vals=namespace['calculate_features'](im[t:b,l:r])
        expected.extend(v/white['RGB'.index(k[0])] for k,v in vals.items())
    actual,_=extract(im,parse_boxes(row.NAIL_BOUNDING_BOXES)[1],parse_boxes(row.SKIN_BOUNDING_BOXES)[1])
    np.testing.assert_allclose(actual,expected,atol=1e-12,rtol=0)
    results.append({'patient_id':int(row.PATIENT_ID),'max_absolute_difference':float(np.max(np.abs(actual-expected)))})
Path('reports/reference_comparison.json').write_text(json.dumps(results,indent=2))
print('All 42 features match official helper on 10 real samples; max difference:',max(r['max_absolute_difference'] for r in results))
