import json
import numpy as np
import pandas as pd
import pytest
from kera_ml.train import lock_split
from kera_ml.evaluate import metrics
from kera_ml.models import fit_mlp,predict_mlp
from kera_ml.inference import Predictor
from kera_ml.features import FEATURE_NAMES,FEATURE_VERSION

def test_metrics_units_bias():
    m=metrics(np.array([80.,120.,160.]),np.array([90.,120.,150.]))
    assert m['mae']==pytest.approx(20/3) and m['bias']==0
    assert m['rmse']==pytest.approx(np.sqrt(200/3))

def test_group_split_locked(tmp_path):
    df=pd.DataFrame({'patient_id':range(20),'group_id':[0,0]+list(range(2,20))})
    tr,te=lock_split(df,tmp_path,{'test_fraction':.2,'split_seed':42})
    assert not set(tr.group_id)&set(te.group_id)
    tr2,te2=lock_split(df,tmp_path,{'test_fraction':.2,'split_seed':99})
    assert te.patient_id.tolist()==te2.patient_id.tolist()
    with pytest.raises(ValueError):lock_split(df.iloc[:-1],tmp_path,{'test_fraction':.2,'split_seed':42})

def test_mlp_determinism_and_units():
    rng=np.random.default_rng(12);x=rng.normal(size=(25,42));y=120+5*x[:,0]
    cfg=dict(widths=[4],dropout=0.,lr=.001,weight_decay=.01,loss='huber')
    b,h=fit_mlp(x,y,cfg,7,3);c,_=fit_mlp(x,y,cfg,7,3)
    np.testing.assert_array_equal(predict_mlp(b,x),predict_mlp(c,x))
    assert np.isfinite(predict_mlp(b,x)).all() and 80<predict_mlp(b,x).mean()<160
    np.testing.assert_allclose(b['feature_mean'],x.mean(axis=0))
    assert b['target_mean']==pytest.approx(y.mean())

def test_standalone_linear(tmp_path):
    spec=dict(model='elastic',feature_names=FEATURE_NAMES,feature_version=FEATURE_VERSION,mean=[1.]*42,scale=[2.]*42,coefficients=[3.]*42,intercept=110.)
    path=tmp_path/'deployment.json';path.write_text(json.dumps(spec));p=Predictor(path)
    assert p.predict_features(np.full(42,3.))[0]==236
    for invalid in [np.zeros(41),np.full(42,np.nan),np.zeros((1,2,42))]:
        with pytest.raises(ValueError):p.predict_features(invalid)
    spec['feature_version']='unknown';path.write_text(json.dumps(spec))
    with pytest.raises(ValueError):Predictor(path)
