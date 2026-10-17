"""CV model selection and separate one-shot locked-test evaluation."""
import argparse, hashlib, json, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from scipy.stats import gaussian_kde
from sklearn.base import clone
from sklearn.dummy import DummyRegressor
from sklearn.linear_model import ElasticNet,Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler,RobustScaler
from sklearn.model_selection import GroupShuffleSplit,GroupKFold
from sklearn.exceptions import ConvergenceWarning
from .features import FEATURE_NAMES,FEATURE_VERSION
from .evaluate import metrics,diagnostics
from .models import choose_epochs,fit_mlp,predict_mlp

def write_json(path,value):
    Path(path).write_text(json.dumps(value,indent=2,allow_nan=False))

def load_table(path):
    df=pd.read_csv(path)
    if df.patient_id.duplicated().any():raise ValueError('Duplicate patient rows')
    if not np.isfinite(df[FEATURE_NAMES+['hb']].to_numpy()).all():raise ValueError('Nonfinite features/labels')
    return df

def lock_split(df,art,cfg):
    path=art/'split.json'
    checksum=hashlib.sha256(df[['patient_id','group_id']].to_csv(index=False).encode()).hexdigest()
    if path.exists():
        split=json.loads(path.read_text())
        if split['population_sha256']!=checksum:raise ValueError('Population changed after split lock')
    else:
        tr,te=next(GroupShuffleSplit(n_splits=1,test_size=cfg['test_fraction'],random_state=cfg['split_seed']).split(df,groups=df.group_id))
        split=dict(train_ids=df.patient_id.iloc[tr].tolist(),test_ids=df.patient_id.iloc[te].tolist(),seed=cfg['split_seed'],population_sha256=checksum)
        write_json(path,split)
    train=df[df.patient_id.isin(split['train_ids'])].reset_index(drop=True)
    test=df[df.patient_id.isin(split['test_ids'])].reset_index(drop=True)
    assert not set(train.patient_id)&set(test.patient_id)
    assert not set(train.group_id)&set(test.group_id)
    assert len(train)+len(test)==len(df)
    return train,test

def select(features,art,reports,config):
    import torch
    cfg=json.loads(Path(config).read_text());art=Path(art);reports=Path(reports)
    art.mkdir(parents=True,exist_ok=True);reports.mkdir(parents=True,exist_ok=True)
    if (art/'test_access.json').exists():raise RuntimeError('Test already accessed. Use a separate output directory for any new research; disclose reuse.')
    if (art/'selection.json').exists():raise RuntimeError('Selection already frozen; use evaluate or a fresh output directory')
    df=load_table(features);train,_=lock_split(df,art,cfg)
    X=train[FEATURE_NAMES].to_numpy();y=train.hb.to_numpy();groups=train.group_id.to_numpy()
    folds=list(GroupKFold(n_splits=cfg['folds'],shuffle=True,random_state=cfg['cv_seed']).split(X,y,groups))
    write_json(art/'cv_folds.json',[dict(train_ids=train.patient_id.iloc[a].tolist(),validation_ids=train.patient_id.iloc[b].tolist()) for a,b in folds])
    write_json(art/'config.json',cfg)
    results=[];predictions={};fitted={};curves=[]
    def record(name,kind,params,pred,fold_metrics,elapsed,extra=None):
        m=metrics(y,pred);result=dict(experiment=name,model=kind,parameters=params,feature_version=FEATURE_VERSION,
            dataset='figshare:25867432:v1:file49504041',training_patients=len(train),folds=cfg['folds'],seeds=cfg['seeds'] if kind=='mlp' else [cfg['cv_seed']],
            metrics=m,fold_metrics=fold_metrics,duration_seconds=elapsed,**(extra or {}))
        results.append(result);predictions[name]=pred
        write_json(reports/'experiments.json',results)
        print(f'{name}: OOF MAE={m["mae"]:.3f} RMSE={m["rmse"]:.3f} ({elapsed:.1f}s)',flush=True)
    def classical(name,kind,model,params,balanced=False):
        start=time.perf_counter();pred=np.empty(len(y));fm=[];warns=[]
        for k,(tr,va) in enumerate(folds):
            assert not set(groups[tr])&set(groups[va])
            use=tr
            if balanced:
                # Notebook uses scipy relative bandwidth factor 0.5, not 0.5 g/L.
                density=gaussian_kde(y[tr],bw_method=.5)(y[tr]);weights=1/density;weights/=weights.sum()
                use=np.random.default_rng(cfg['cv_seed']+k).choice(tr,size=min(100,len(tr)),replace=False,p=weights)
            m=clone(model)
            with warnings.catch_warnings(record=True) as captured:
                warnings.simplefilter('always',ConvergenceWarning);m.fit(X[use],y[use])
            warns.extend(str(w.message) for w in captured)
            pred[va]=m.predict(X[va]);fm.append(metrics(y[va],pred[va]))
        record(name,kind,params,pred,fm,time.perf_counter()-start,dict(convergence_warnings=warns,balanced=balanced))
        fitted[name]=model
    classical('dummy','dummy',DummyRegressor(),{})
    for a in cfg['ridge_alphas']:classical(f'ridge-{a}','ridge',make_pipeline(StandardScaler(),Ridge(alpha=a)),dict(alpha=a,scaler='standard'))
    for a in cfg['elastic_alphas']:
        for ratio in cfg['elastic_l1_ratios']:
            classical(f'elastic-{a}-{ratio}','elastic',make_pipeline(StandardScaler(),ElasticNet(alpha=a,l1_ratio=ratio,max_iter=100000,tol=1e-5)),dict(alpha=a,l1_ratio=ratio,scaler='standard'))
    best_elastic=min((r for r in results if r['model']=='elastic'),key=lambda r:r['metrics']['rmse'])
    params=best_elastic['parameters']
    classical('elastic-robust','elastic',make_pipeline(RobustScaler(),ElasticNet(alpha=params['alpha'],l1_ratio=params['l1_ratio'],max_iter=100000,tol=1e-5)),{**params,'scaler':'robust'})
    classical('elastic-balanced','elastic',fitted[best_elastic['experiment']],params,balanced=True)
    # Save the working classical baseline before neural-network experiments.
    best_classical=min((r for r in results if r['model']=='elastic'),key=lambda r:r['metrics']['rmse'])
    def fit_classical(result):
        use=np.arange(len(y))
        if result.get('balanced'):
            w=1/gaussian_kde(y,bw_method=.5)(y);w/=w.sum()
            use=np.random.default_rng(cfg['cv_seed']).choice(use,size=min(100,len(y)),replace=False,p=w)
        return clone(fitted[result['experiment']]).fit(X[use],y[use])
    joblib.dump(fit_classical(best_classical),art/'elastic_net.joblib')
    for n,mcfg in enumerate(cfg['mlps']):
        start=time.perf_counter();seed_preds=[];epochs_by_seed=[];seed_metrics=[]
        for seed in cfg['seeds']:
            pred=np.empty(len(y));epoch_list=[]
            for k,(tr,va) in enumerate(folds):
                epochs,history=choose_epochs(X[tr],y[tr],groups[tr],mcfg,seed,cfg['max_epochs'])
                bundle,_=fit_mlp(X[tr],y[tr],mcfg,seed,epochs)
                pred[va]=predict_mlp(bundle,X[va]);epoch_list.append(epochs)
                curves.append(dict(experiment=f'mlp-{n}',seed=seed,fold=k,history=history))
            seed_preds.append(pred);epochs_by_seed.append(epoch_list);seed_metrics.append(metrics(y,pred))
        pred=np.mean(seed_preds,axis=0)
        record(f'mlp-{n}','mlp',mcfg,pred,[metrics(y[b],pred[b]) for a,b in folds],time.perf_counter()-start,
               dict(seed_metrics=seed_metrics,epochs_by_seed=epochs_by_seed))
        write_json(reports/'learning_curves.json',curves)
    # Selection criterion frozen before any held-out prediction.
    best_by_family={kind:min((r for r in results if r['model']==kind),key=lambda r:r['metrics']['rmse']) for kind in ['dummy','ridge','elastic','mlp']}
    selected=min(best_by_family.values(),key=lambda r:r['metrics']['rmse'])
    write_json(art/'selection.json',dict(selected=selected['experiment'],criterion=cfg['selection_metric'],best_by_family=best_by_family,
        features_sha256=hashlib.sha256(Path(features).read_bytes()).hexdigest(),feature_names=FEATURE_NAMES,feature_version=FEATURE_VERSION,
        preprocessing=dict(finger_index=1,central_fraction=.6,reference_box=[350,300,400,350],normalization='per-channel median; percentiles then division',rgb_range=[0,255]),
        test_used_for_selection=False))
    all_oof=train[['patient_id','group_id','hb']].copy()
    for kind,result in best_by_family.items():
        name=result['experiment'];all_oof[kind]=predictions[name]
        diagnostics(y,predictions[name],reports/f'cv_{kind}.png',f'{kind}: training-only OOF (configuration selected on these folds)')
        if kind!='mlp':joblib.dump(fit_classical(result),art/f'{kind}.joblib')
        else:
            bundles=[]
            for j,seed in enumerate(cfg['seeds']):
                epochs=int(np.median(result['epochs_by_seed'][j]))
                bundle,_=fit_mlp(X,y,result['parameters'],seed,epochs);bundles.append(bundle)
            torch.save(bundles,art/'mlp.pt')
    all_oof.to_csv(reports/'oof_predictions.csv',index=False)
    # JSON coefficients provide lightweight Pi inference without sklearn/torch for linear model.
    family=selected['model']
    if family in ('ridge','elastic'):
        model=joblib.load(art/f'{family}.joblib');scaler,reg=model.steps[0][1],model.steps[1][1]
        center=scaler.mean_ if hasattr(scaler,'mean_') else scaler.center_
        write_json(art/'deployment.json',dict(model=family,feature_names=FEATURE_NAMES,feature_version=FEATURE_VERSION,
            mean=center.tolist(),scale=scaler.scale_.tolist(),coefficients=reg.coef_.tolist(),intercept=float(reg.intercept_),
            preprocessing=json.loads((art/'selection.json').read_text())['preprocessing']))
    elif family=='dummy':
        model=joblib.load(art/'dummy.joblib');write_json(art/'deployment.json',dict(model='dummy',feature_names=FEATURE_NAMES,feature_version=FEATURE_VERSION,constant=float(model.constant_.ravel()[0])))
    else:
        write_json(art/'deployment.json',dict(model='mlp',weights='mlp.pt',feature_names=FEATURE_NAMES,feature_version=FEATURE_VERSION))
    # Save expected predictions now; fresh-process reload verification needs no test access.
    for kind in best_by_family:
        p=predict_family(kind,art,X)
        np.save(art/f'reload_expected_{kind}.npy',p)
    rows=[]
    for r in results:
        rows.append(dict(experiment=r['experiment'],model=r['model'],**r['metrics'],fold_rmse_sd=float(np.std([m['rmse'] for m in r['fold_metrics']],ddof=1)),
                         duration_seconds=r['duration_seconds'],selected=r['experiment']==selected['experiment'],parameters=json.dumps(r['parameters'])))
    pd.DataFrame(rows).sort_values('rmse').to_csv(reports/'cv_comparison.csv',index=False)
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(1,3,figsize=(15,4),layout='constrained')
    for ax,n in zip(axes,range(len(cfg['mlps']))):
        for curve in [c for c in curves if c['experiment']==f'mlp-{n}' and c['seed']==cfg['seeds'][0]]:
            h=pd.DataFrame(curve['history']);ax.plot(h.epoch,h.train_rmse,color='blue',alpha=.4);ax.plot(h.epoch,h.validation_rmse,color='orange',alpha=.4)
        ax.set(title=f'MLP {n}: inner learning curves',xlabel='Epoch',ylabel='RMSE (g/L)')
    fig.suptitle('Inner training RMSE (blue) and validation RMSE (orange); seed 11, all five folds');fig.savefig(reports/'mlp_learning_curves.png',dpi=150);plt.close(fig)
    print('FROZEN SELECTION:',selected['experiment'],flush=True)

def predict_family(kind,art,X):
    if kind=='mlp':
        import torch
        bundles=torch.load(Path(art)/'mlp.pt',map_location='cpu',weights_only=True)
        return np.mean([predict_mlp(b,X) for b in bundles],axis=0)
    return joblib.load(Path(art)/f'{kind}.joblib').predict(X)

def evaluate(features,art,reports):
    art,reports=Path(art),Path(reports)
    if (art/'test_access.json').exists():raise RuntimeError('Held-out evaluation already performed; inspect saved results')
    selection=json.loads((art/'selection.json').read_text());cfg=json.loads((art/'config.json').read_text())
    if hashlib.sha256(Path(features).read_bytes()).hexdigest()!=selection['features_sha256']:raise ValueError('Feature cache changed')
    df=load_table(features);train,test=lock_split(df,art,cfg)
    # Exclusive marker written before reading test labels/predicting. No tuning follows.
    with (art/'test_access.json').open('x') as f:json.dump(dict(evaluation_time_utc=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),selected=selection['selected'],note='One evaluation of four frozen model families; no subsequent tuning'),f,indent=2)
    X=test[FEATURE_NAMES].to_numpy();y=test.hb.to_numpy();results={};predictions=test[['patient_id','group_id','hb']].copy()
    for kind in selection['best_by_family']:
        p=predict_family(kind,art,X);m=metrics(y,p)
        low=y<cfg['low_hb_threshold_g_per_l']
        m['low_hb_below_120']=metrics(y[low],p[low]) if low.any() else None
        # Patient bootstrap on this fixed test, descriptive only; pair 42/51 is in train for current split.
        rng=np.random.default_rng(4321);boot=[]
        for _ in range(2000):
            idx=rng.integers(0,len(y),len(y));boot.append([float(np.mean(abs(p[idx]-y[idx]))),float(np.sqrt(np.mean((p[idx]-y[idx])**2)))])
        ci=np.percentile(boot,[2.5,97.5],axis=0);m['mae_bootstrap_95_interval']=ci[:,0].tolist();m['rmse_bootstrap_95_interval']=ci[:,1].tolist()
        results[kind]=m;predictions[kind]=p
        diagnostics(y,p,reports/f'test_{kind}.png',f'{kind}: locked held-out test')
    write_json(reports/'test_metrics.json',results);predictions.to_csv(reports/'test_predictions.csv',index=False)
    print(json.dumps(results,indent=2))

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['select','evaluate']);p.add_argument('--features',default='data/features.csv');p.add_argument('--artifacts',default='artifacts');p.add_argument('--reports',default='reports');p.add_argument('--config',default='configs/experiment.json');a=p.parse_args()
    if a.command=='select':select(a.features,a.artifacts,a.reports,a.config)
    else:evaluate(a.features,a.artifacts,a.reports)
if __name__=='__main__':main()
