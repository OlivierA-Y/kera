"""Summarize saved predictions only; never refit or reevaluate models."""
import hashlib,json,shutil
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from kera_ml.evaluate import metrics
root=Path(__file__).resolve().parents[1]
art=root/'artifacts';rep=root/'reports'
selection=json.loads((art/'selection.json').read_text());test=json.loads((rep/'test_metrics.json').read_text());audit=json.loads((rep/'data_audit.json').read_text())
experiments=json.loads((rep/'experiments.json').read_text());oof=pd.read_csv(rep/'oof_predictions.csv')
low=oof.hb<120
low_metrics={name:metrics(oof.hb[low].to_numpy(),oof[name][low].to_numpy()) for name in selection['best_by_family']}
(rep/'low_hb_cv_metrics.json').write_text(json.dumps(low_metrics,indent=2))
curves=json.loads((rep/'learning_curves.json').read_text())
for squared in [False,True]:
    fig,axes=plt.subplots(1,3,figsize=(14,4),layout='constrained')
    for n,ax in enumerate(axes):
        for curve in [c for c in curves if c['experiment']==f'mlp-{n}' and c['seed']==11]:
            h=pd.DataFrame(curve['history']);power=2 if squared else 1
            ax.plot(h.epoch,h.train_rmse**power,color='blue',alpha=.4)
            ax.plot(h.epoch,h.validation_rmse**power,color='orange',alpha=.4)
        ax.set(title=f'MLP {n}',xlabel='Epoch',ylabel='MSE (g²/L²)' if squared else 'RMSE (g/L)')
    fig.suptitle('Inner training (blue) and validation (orange); seed 11, all five folds'+('\nEvaluation MSE loss; optimization uses standardized Huber or MSE as configured' if squared else ''))
    fig.savefig(rep/('mlp_loss_curves.png' if squared else 'mlp_learning_curves.png'),dpi=150);plt.close(fig)
rows=[]
for kind,r in selection['best_by_family'].items():
    m=r['metrics'];t=test[kind];rows.append(f'| {kind} | {m["mae"]:.2f} | {m["rmse"]:.2f} | {t["mae"]:.2f} | {t["rmse"]:.2f} | {t["r2"]:.3f} | {t["bias"]:+.2f} | {t["median_absolute_error"]:.2f} |')
lowrows=[]
for kind,m in low_metrics.items():
    t=test[kind]['low_hb_below_120'];lowrows.append(f'| {kind} | {m["mae"]:.2f} | {m["rmse"]:.2f} | {m["bias"]:+.2f} | {t["mae"]:.2f} | {t["rmse"]:.2f} | {t["bias"]:+.2f} |')
text='''# Kera hemoglobin regression — completed research run

## Result and selection

Elastic Net is the frozen deployment candidate: training-only StandardScaler, alpha **0.2**, L1 ratio **0.5**, max_iter 100000, tolerance 1e-5. It improves on the mean baseline but has substantial individual errors. Model selection used pooled five-fold OOF RMSE on 200 training patients. The 50 held-out patients were evaluated once after selection. No models were adjusted after seeing test scores.

| Model | CV MAE | CV RMSE | Test MAE | Test RMSE | Test R² | Test bias | Test median AE |
|---|---:|---:|---:|---:|---:|---:|---:|
'''+ '\n'.join(rows)+'''

All error metrics and bias are in g/L; positive bias means overestimation. CV scores are pooled predictions for configurations selected using these same folds, so they are model-selection estimates, not nested-CV unbiased performance estimates. The held-out test supplies the independent assessment. Differences between Ridge, Elastic Net, and MLP are small relative to this sample's uncertainty; these results do not establish statistical superiority of one family.

Elastic Net test MAE bootstrap 95% interval is **12.74–20.99 g/L**, RMSE interval **17.47–26.24 g/L** (2000 patient resamples, fixed seed 4321). These are uncertainty intervals for aggregate test error, not individual prediction confidence. The near-duplicate pair is entirely in training, so all 50 test observations are separate image groups.

The MLP's test result is numerically better than Elastic Net. It remains an alternative artifact because selecting it on the basis of these test results would violate the predeclared selection procedure.

## Dataset and leakage audit

Official Figshare article 25867432, version 1, file 49504041, data.zip (91,619,743 bytes). Verified MD5: `7bd86daf16c69e370173d9a7a92474b0`. Dataset license in the official API: CC0. Downloaded images remain in ignored `data/`.

There are **250 unique labeled patient IDs**, **251 JPEGs**, and **250 usable labeled images**. Image 185.jpg has no metadata row and is excluded. No missing labels, unreadable labeled images, malformed/out-of-bounds annotations, duplicate patient IDs, or pixel-identical images were found. Hb spans **44–169 g/L**, mean **127.592**, median **131.5**, sample SD **26.710**.

The near-duplicate audit combines decoded-image SHA-256 with 64×64 RGB thumbnail RMSE. The pair **42 / 51** has thumbnail RMSE 2.506/255, matching hand appearance and different labels (138 versus 133 g/L). Visual review is saved in `duplicate_review.png`. Both remain in one image group throughout train/test and CV; patient identity cannot be resolved from these anonymized records. Coarse dHash alone produced many false candidates because the scene is fixed. The next nearest RGB pair (166/168; RMSE 8.497) was visually reviewed and shows different hands/positions. The audit cannot rule out all undocumented repeat participants or images transformed by substantial repositioning.

Patient split seed 20261017; 200 training / 50 test. Five-fold shuffled GroupKFold seed 42 on training only, with IDs and exact folds saved in artifacts. All feature and target scalers are fitted inside their training folds. IDs, paths, dates and labels never enter the 42-dimensional predictor. The whole-population target summary/histogram is audit-only and was not used for split stratification or model choices.

`data_audit.json` records every original image and central crop dimension, target statistics, warnings, hashes and annotation audit. `crops.png` shows six raw and normalized middle nail/skin examples; normalized display values are clipped to [0,1] for display only. Features are never clipped.

## Reproduction of the source method

Source paper: [Yakimov et al., Scientific Data 2024](https://www.nature.com/articles/s41597-024-03895-9), [full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11447208/). Official [Usage Notes notebook](https://github.com/biophotonics-msu/photo-haemoglobin) is saved in references.

Boxes are JSON integer `[top,left,bottom,right]`, exclusive bottom/right; middle finger uses array index 1. Each ROI is sliced from `int(.2*height)` to `int(.8*height)` and likewise for width. Features are seven percentiles (5,15,25,50,75,85,95), channel-major R/G/B, nail then skin: 42 values. Divide each percentile by the same image's corresponding white-reference channel median. White-reference slice is `image[350:400,300:350]`, matching the notebook calculation and paper coordinates X=300,Y=350. The notebook's illustrative rectangle swaps these coordinates; we follow its extraction calculation. All 42 values match the official notebook helper **exactly** on ten real samples (reference_comparison.json).

No gamma, colour-space conversion, histogram equalization or learned colour correction is introduced. Inputs must already be RGB in 0–255 units. White medians below 5/255 cause rejection; small ROIs, extreme pixel values and reference colour imbalance produce warnings. These quality checks are engineering guards, not validated medical quality criteria.

Differences from the source: fixed natural-distribution test split; five grouped folds instead of seven folds on a prebalanced sample; StandardScaler main baseline, with RobustScaler comparison; a bounded alpha grid rather than the much larger source search. Notebook KDE uses scipy `bw_method=.5`, a dimensionless bandwidth factor, despite the paper's description of 0.5 g/L. Our optional balancing experiment reproduces the notebook factor and samples 100 observations only within each training fold. This avoids label-dependent selection of the test population. Source RMSE values cannot be directly compared because its balanced training and remainder test distributions differ.

## Experiments and neural network

All meaningful runs (31 configurations) are in experiments.json and cv_comparison.csv, including hyperparameters, seeds, five fold metrics, elapsed duration and selection flag in the CSV. The initial network is 42→32→16→1, ReLU, AdamW lr .001, decay .01, standardized target and SmoothL1 loss. Alternative experiments use 16→8 with dropout .1/decay .1, and 32→16 with dropout .1/decay .1 and MSE. No larger architecture was tried.

The best MLP is **42→16→8→1**, ReLU, dropout .1, AdamW lr .001, weight decay .1, SmoothL1 on standardized targets, batch 16. It averages seeds **11,29,47**. Maximum 200 epochs, patience 25. Each outer training fold uses its own grouped 80/20 inner split to select epochs, restores the best inner checkpoint, then retrains from the seed on the complete outer training fold for that duration. Outer validation labels never select epochs. Final full-training durations are median inner-selected fold durations: **91,176,32 epochs** for the three seeds. Target predictions are converted back to g/L.

Individual-seed OOF RMSE: **21.55,21.03,22.58 g/L**; ensemble **20.70**. Initial MLP ensemble RMSE **22.70**; MSE variant **22.02**. Their learning curves show training error continuing to fall while validation plateaus, consistent with overfitting. The smaller regularized network improves validation, but does not beat Elastic Net in CV. Curves include inner train/validation RMSE and derived MSE evaluation loss; optimized loss is standardized Huber or MSE per configuration. All per-epoch records are saved.

Elastic Net's RobustScaler variant RMSE is **20.34** and balancing variant **20.76**, versus **20.30** for unbalanced StandardScaler. No convergence warnings occurred. This bounded experiment set is sufficient to establish a defensible baseline; no further search was performed after test access.

## Lower hemoglobin and failure modes

Below 120 g/L is a descriptive analysis band, not a sex/age-specific diagnostic cutoff. There are **58 training OOF observations** and **11 test observations** in this band.

| Model | Low CV MAE | Low CV RMSE | Low CV bias | Low test MAE | Low test RMSE | Low test bias |
|---|---:|---:|---:|---:|---:|---:|
'''+ '\n'.join(lowrows)+'''

Low Hb is consistently overestimated. Elastic Net's approximately **+18 g/L** low-range bias creates a false-reassurance risk; even a reading near the usual range cannot rule out low laboratory Hb. Predictions also regress toward the mean at high Hb. Overall bias near −3 g/L hides these opposing errors. The diagnostic plots show broad Bland–Altman limits, substantial outliers, and occasional predictions beyond the study label range. No diagnostic sensitivity/specificity or individual confidence percentage is claimed.

## Engineering verification and delivery

25 automated tests cover safe box parsing, coordinate conventions, finger selection, central geometry, RGB order, percentiles, reference medians/normalization, feature ordering/dimensions, missing images, invalid/nonfinite values, degenerate crops, grouped locked splits, metric units/bias, deterministic CPU MLP training and deployment schema checks. Ten-sample real notebook comparison passes. All four model families reload in a fresh CPU process with **zero prediction difference** on the training population. The portable JSON reproduces the selected sklearn pipeline within 1e-10 g/L. End-to-end inference succeeds in a fresh isolated process from a temporary directory containing only a copied scan, its boxes and the deployment artifact; no pandas/sklearn/torch is imported.

No GPU was used. Environment versions, dependency lock, test logs, split manifests, training logs and anonymous predictions are saved. A host ROS pytest-plugin import conflict was resolved with PYTEST_DISABLE_PLUGIN_AUTOLOAD=1; this does not alter test logic. pip check reports no broken requirements with host PYTHONPATH cleared.

## Limits and next steps

This is an experimental research model, not a clinically validated diagnostic device. The small, single-camera dataset supports limited precision, uncertain subgroup performance and no demonstrated longitudinal-trend accuracy. The source population is not specifically older adults, and darker skin tones are sparsely represented; no fairness claim follows from this run.

CPU compatibility was verified on x86-64; actual Raspberry Pi execution/latency and Kera Dock images could not be tested because neither hardware nor dock scans are available. ROI annotation is required; automatic segmentation is outside this model's scope. Do not apply the dataset's reference coordinates blindly to a new camera geometry: supply the real white-reference box and middle nail/skin boxes.

Next collect paired Kera Dock scans and laboratory Hb across the intended older-adult population, the full Hb range and diverse skin/nail characteristics. Lock exposure/white balance, record camera/lighting settings and reference quality, validate repeatability, then perform subject-disjoint external calibration and prospective validation. Establish usable-image criteria and abstention behavior before caregiver use. Until then, any health decision requires standard clinical assessment and laboratory confirmation.
'''
(rep/'RESULTS.md').write_text(text)
# Portable artifact directory with explicit provenance and evaluation metadata.
shutil.copy(root/'data/features.csv',art/'features.csv')
meta=dict(selected=selection['selected'],feature_names=selection['feature_names'],feature_version=selection['feature_version'],preprocessing=selection['preprocessing'],
          target_normalization=dict(elastic='none; direct g/L regression',mlp='per-training-fit mean/std, stored separately for each seed'),
          dataset=dict(article=25867432,version=1,file=49504041,md5='7bd86daf16c69e370173d9a7a92474b0',license='CC0'),
          environment=json.loads((rep/'environment.json').read_text()),test_metrics=test,cv=selection['best_by_family'],clinical_validation=False,
          source_hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'src').rglob('*.py'))},
          reference_notebook_sha256=hashlib.sha256((root/'references/Usage Notes.ipynb').read_bytes()).hexdigest())
(art/'metadata.json').write_text(json.dumps(meta,indent=2))
print('Wrote reports/RESULTS.md, artifacts/metadata.json and portable feature table')
