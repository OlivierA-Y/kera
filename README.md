# Kera ML

A trained, reproducible research pipeline for estimating hemoglobin from middle-finger nail and skin RGB descriptors. **Experimental; not clinically validated.** No frontend or hardware code is included.

The selected deployment model is Elastic Net (alpha 0.2, L1 ratio 0.5), chosen on training-only five-fold grouped CV. It scored **16.78 g/L MAE, 22.22 g/L RMSE** on 50 held-out patients. Low-Hb test patients were overestimated by **17.98 g/L** on average. See [the complete results](reports/RESULTS.md) before using a prediction.

## Delivered files

- `src/kera_ml/`: data acquisition/audit, RGB preprocessing, 42 features, classical/MLP training, evaluation and CPU inference.
- `artifacts/deployment.json`: selected model coefficients plus scaler, schema and preprocessing settings; needs only NumPy/Pillow.
- `artifacts/elastic_net.joblib` and `artifacts/elastic.joblib`: fitted selected sklearn pipeline (equivalent artifacts).
- `artifacts/ridge.joblib`, `dummy.joblib`, `mlp.pt`: frozen comparator models. `mlp.pt` contains three CPU state dictionaries, configurations and training-only feature/target scalers.
- `artifacts/features.csv`: all 250 extracted labeled feature rows, image paths, image hashes, warnings and leakage group IDs. Training reads only the explicit 42 feature columns.
- `artifacts/metadata.json`: evaluation results, feature order, preprocessing/target scaling details, versions and source hashes.
- `artifacts/split.json`, `cv_folds.json`, `selection.json`, `test_access.json`: exact IDs and selection/evaluation audit trail.
- `reports/`: detailed results, all 31 experiments, anonymous OOF/test predictions, plots, audit, reload verification and logs.
- `references/`: downloaded official notebook and Figshare metadata.

Raw data and the local virtual environment are ignored by Git. All deliverables above are already generated in this workspace.

## Setup

The actual run used Python 3.13.16, Linux x86-64, CPU only. Python >=3.11 is supported by the source; use the recorded Python version for the closest numerical reproduction. Exact packages are in `requirements-lock.txt`; future/platform-specific availability may differ.

```bash
python3 -m venv .venv
# Clear host Python paths (this machine has unrelated ROS packages).
export PYTHONPATH=
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
export MPLCONFIGDIR="$PWD/.mplconfig"
export OPENBLAS_NUM_THREADS=1
export OMP_NUM_THREADS=1
.venv/bin/python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-lock.txt
.venv/bin/python -m pip install --no-deps --no-build-isolation -e .
.venv/bin/python -m pip check
```

For compatible unpinned installs, `pip install -e .` installs declared dependencies, but can choose different versions or a larger PyTorch distribution. Only load joblib/PyTorch artifacts from trusted sources.

## Download, audit and extract

```bash
.venv/bin/kera-data download --root data
.venv/bin/kera-data prepare --root data/raw --out data/features.csv --reports reports
# validate is an alias for the same full audit/extraction path.
.venv/bin/kera-data validate --root data/raw --out data/features.csv --reports reports
# Download the upstream notebook used only for feature parity verification.
curl -L --fail 'https://raw.githubusercontent.com/biophotonics-msu/photo-haemoglobin/main/Usage%20Notes.ipynb' -o 'references/Usage Notes.ipynb'
PYTHONPATH=src .venv/bin/python scripts/verify_reference.py
.venv/bin/python -m pytest -q
```

Download uses official Figshare API article 25867432 and file 49504041, validates MD5 and safely extracts `data/raw/`. If network DNS is restricted, allow this command network access in your execution environment. Alternatively place the official `data.zip` in `data/` and rerun download with API access, or extract the verified archive into `data/raw/` and run prepare. No synthetic clinical replacement is used.

The archive contains `photo/`, not an assumed alternate folder name. Paths are resolved from the actual metadata location. All six annotations per patient are validated. One extra unlabelled image is excluded. Likely repeated scans 42/51 remain in one leakage group.

The white region is `[350,300,400,350]` in top/left/bottom/right order. Tissue boxes are central-cropped with the notebook's integer 20%–80% slice. Feature order is NAIL then SKIN, R then G then B, percentiles 5,15,25,50,75,85,95. Divide percentile values by the corresponding image's white-reference channel median. No clipping or colour-space transformation is applied to features.

## Train and evaluate

Existing completed artifacts are protected from accidental retraining or a second test evaluation. The experiment configuration is `configs/experiment.json`. To reproduce into a new directory:

```bash
.venv/bin/kera-train select \
  --features data/features.csv \
  --config configs/experiment.json \
  --artifacts artifacts/reproduction \
  --reports reports/reproduction

# Freezes model selection, saves all four model families and training-only OOF scores.
# Only then evaluate the frozen models:
.venv/bin/kera-train evaluate \
  --features data/features.csv \
  --artifacts artifacts/reproduction \
  --reports reports/reproduction
```

`select` trains classical baselines first, saves the working Elastic Net, then runs all three MLP configurations and three seeds. It uses five patient/image-group-disjoint folds and training-only scaling. MLP early stopping uses an additional inner grouped split, not the outer fold or test set. Balancing is limited to training-fold observations. Final MLP durations are chosen from median fold-selected epochs before full training. Selection uses pooled OOF RMSE, with MAE and fold variability reported alongside it.

`evaluate` checks the feature-cache hash, records an exclusive test-access marker, and evaluates each frozen model family in one batch. It rejects a second call for the same artifact directory. The released test results are already known; replaying this command reproduces an evaluation rather than creating a fresh blind assessment. Do not use the released test cohort for subsequent tuning. A new research iteration requires a new independent cohort for an unbiased final assessment.

Inspect saved results without running any models:

```bash
cat reports/test_metrics.json
cat reports/cv_comparison.csv
cat reports/RESULTS.md
```

Verification of the delivered run (training patients only; does not reopen test evaluation):

```bash
PYTHONPATH=src .venv/bin/python scripts/verify_reload.py
PYTHONPATH=src .venv/bin/python scripts/verify_standalone.py
# Rebuild the human-readable report/plots from existing results only:
PYTHONPATH=src .venv/bin/python scripts/make_report.py
```

These verification/report scripts target the delivered root `artifacts/`, `reports/` and `data/` paths. The training and inference CLIs accept explicit paths for other runs.

## CPU inference

This example uses the delivered sample image 1 and its middle-finger annotations; it is an inference smoke test, not a new validation patient.

```bash
.venv/bin/kera-predict \
  --image data/raw/photo/1.jpg \
  --nail-box '[123,429,183,483]' \
  --skin-box '[148,556,200,614]' \
  --reference-box '[350,300,400,350]' \
  --artifact artifacts/deployment.json
```

```python
from kera_ml.inference import Predictor

predictor = Predictor("artifacts/deployment.json")
result = predictor.predict_hemoglobin(
    image="scan.jpg",  # or an H×W×3 RGB array in 0–255 units
    nail_bounding_box=[123, 429, 183, 483],
    skin_bounding_box=[148, 556, 200, 614],
    reference_region=[350, 300, 400, 350],
)
print(result["hemoglobin_g_per_l"], result["warnings"])
```

Boxes must describe the actual image. The API raises errors for invalid regions, nonfinite values or unusable references, and returns quality warnings for small, clipped or strongly imbalanced regions. It returns no unvalidated confidence percentage. It requires supplied ROI annotations; there is no automatic nail segmentation.

For the minimal Raspberry Pi inference package, copy `src/kera_ml/__init__.py`, `features.py`, `preprocessing.py`, `inference.py` and `artifacts/deployment.json`; install compatible NumPy and Pillow, then set `PYTHONPATH` to the copied source directory and run `python -m kera_ml.inference ...`. Linear JSON inference does not import sklearn, pandas or torch and has no training-dataset dependency. The full sklearn artifact requires matching versions; the JSON avoids that dependency. Actual Pi latency has not been measured.

Kera Dock's camera and lighting differ from this study's Logitech setup. Supply the dock's real white-reference coordinates, control exposure/white balance and collect paired dock scans/laboratory Hb for independent calibration and prospective validation. This model cannot diagnose anemia or establish accurate longitudinal trends.

## Sources

[Scientific Data paper](https://www.nature.com/articles/s41597-024-03895-9), [open full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11447208/), [official dataset](https://springernature.figshare.com/articles/dataset/25867432), [official code](https://github.com/biophotonics-msu/photo-haemoglobin). Methodological differences, source inconsistencies and dataset limitations are documented in `reports/RESULTS.md`. Dataset license: CC0 according to the official API; source-paper and reference-code rights remain with their authors.

## Webcam web app

The new [Kera Camera app](web/README.md) runs the actual trained MLP ensemble in the browser. It supports a live webcam feed, photo capture/upload, three region annotations, and a g/L estimate. Photos never leave the browser. Run `python3 -m http.server 4173 --bind 127.0.0.1 --directory web/dist` and open `http://localhost:4173`. The standalone static app is packaged in `artifacts/kera_web_app.zip`. See `web/README.md` for model export, browser tests, privacy behavior and current hosting status.
