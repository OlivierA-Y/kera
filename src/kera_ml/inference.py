"""Standalone CPU inference. Deployment JSON needs only NumPy and Pillow."""
import argparse,json
from pathlib import Path
import numpy as np
from .features import extract,FEATURE_NAMES,FEATURE_VERSION
from .preprocessing import REFERENCE

class Predictor:
    def __init__(self,artifact='artifacts/deployment.json'):
        self.path=Path(artifact);self.spec=json.loads(self.path.read_text())
        if self.spec['feature_names']!=FEATURE_NAMES or self.spec['feature_version']!=FEATURE_VERSION:
            raise ValueError('Artifact feature schema/version mismatch')
    def predict_features(self,features):
        x=np.asarray(features,dtype=float)
        if x.ndim==1:x=x[None,:]
        if x.ndim!=2 or x.shape[1]!=42 or not np.isfinite(x).all():raise ValueError('Expected finite N x 42 features')
        spec=self.spec
        if spec['model'] in ('ridge','elastic'):
            p=((x-spec['mean'])/spec['scale'])@np.array(spec['coefficients'])+spec['intercept']
        elif spec['model']=='dummy':p=np.repeat(spec['constant'],len(x))
        elif spec['model']=='mlp':
            import torch
            from .models import predict_mlp
            bundles=torch.load(self.path.parent/spec['weights'],map_location='cpu',weights_only=True)
            p=np.mean([predict_mlp(b,x) for b in bundles],axis=0)
        else:raise ValueError('Unsupported model')
        if not np.isfinite(p).all():raise ValueError('Nonfinite model prediction')
        return p
    def predict_hemoglobin(self,image,nail_bounding_box,skin_bounding_box,reference_region=REFERENCE):
        f,warnings=extract(image,nail_bounding_box,skin_bounding_box,reference_region)
        p=float(self.predict_features(f)[0])
        if p<44 or p>169:warnings.append('Estimate outside observed training-study label range (44–169 g/L)')
        return dict(hemoglobin_g_per_l=p,warnings=warnings,model=self.spec['model'],
                    status='Experimental research estimate; not clinically validated. Kera Dock requires independent camera calibration and validation.')

def predict_hemoglobin(image,nail_bounding_box,skin_bounding_box,reference_region=REFERENCE,artifact='artifacts/deployment.json'):
    return Predictor(artifact).predict_hemoglobin(image,nail_bounding_box,skin_bounding_box,reference_region)

def main():
    p=argparse.ArgumentParser();p.add_argument('--image',required=True);p.add_argument('--nail-box',required=True,type=json.loads);p.add_argument('--skin-box',required=True,type=json.loads)
    p.add_argument('--reference-box',type=json.loads,default=list(REFERENCE));p.add_argument('--artifact',default='artifacts/deployment.json');a=p.parse_args()
    print(json.dumps(predict_hemoglobin(a.image,a.nail_box,a.skin_box,a.reference_box,a.artifact),indent=2))
if __name__=='__main__':main()
