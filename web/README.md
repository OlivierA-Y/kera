# Kera Camera

A static, private webcam app using the project's **actual trained three-seed MLP ensemble**. No backend or third-party inference service is involved. All image processing and model inference happen in the browser; photos are not transmitted or persisted by the application.

## Run locally

From the parent Kera workspace:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory web/dist
```

Open `http://localhost:4173`. A webcam requires browser permission and a secure context (HTTPS or localhost). Open the site directly in a browser if an embedded preview does not allow camera permission. Uploading a JPEG/PNG/WebP is available as an alternative.

1. Turn on the camera and capture a photo with the middle fingernail, nearby skin, and plain white paper in the same light.
2. Mark the whole middle nail, an intact skin area on the same finger, and a white-reference area. Draw directly on the photo or enter pixel coordinates in the accessible form. Each completed region advances the selection automatically; select it again to redraw.
3. Choose **Get estimate**. The result is a continuous hemoglobin estimate in g/L, with photo-quality warnings when applicable.

The camera stops when you capture, stop the feed, leave the page, or replace it with an uploaded image. A retake clears the previous prediction. Photos are kept only in page memory; the browser/OS may have their own lifecycle behavior. No history, accounts, analytics, or photo storage is added by this app.

## The real neural network

`dist/assets/model.json` exports the frozen state dictionaries in `../artifacts/mlp.pt`, plus every ensemble member's training-only feature and target normalization. The three networks have architecture 42→16→8→1, ReLU hidden layers and linear output; inference disables training dropout, as PyTorch does in eval mode. The three predictions are averaged. No model is retrained for the app.

`dist/ml.js` reproduces the middle-finger central 20%–80% crops, the seven RGB percentiles and channel-wise white-reference median normalization. Unlike the dataset pipeline, users must supply the actual reference location for each camera photo. No resizing, histogram correction, gamma adjustment, or model-specific color augmentation is introduced. The canvas uses the browser's sRGB image decode; small decoder differences from Pillow are possible. Browser arithmetic uses JavaScript numbers, compared against the saved CPU PyTorch outputs to 0.0001 g/L tolerance.

Region overlap, invalid geometry, nonfinite features and an unusably dark reference block prediction. Clipping, small ROIs, reference color cast and estimates outside the study's label range produce warnings. These are engineering checks, not validated clinical image-quality criteria. Users can still mark an incorrect tissue or reference; automatic nail detection is not supplied.

To regenerate the browser model **from the existing trained artifact**, from the parent workspace:

```bash
PYTHONPATH=src .venv/bin/python web/scripts/export_model.py
node web/tests/ml.test.mjs
```

The parity fixtures use ten training patients, with no labels or patient identifiers. Model export does not read or evaluate the held-out test set.

## Verification

- Eight Node tests cover CPU parity, feature ordering/normalization, NumPy-style percentile interpolation, central crop geometry, input validation, overlap/reference rejection, quality warnings and schema checks.
- Thirteen Chrome integration checks cover initial loading, simulated live media, capture/releasing tracks, actual mouse selection, upload/coordinate selection, prediction, invalid annotations, model notes, network privacy, no JavaScript exceptions, tablet/mobile overflow, and permission-denial fallback.
- Physical webcam hardware was not verified. Chrome's test media device exercises the real getUserMedia/capture code path.
- Responsive screenshots at 1440, 768 and 390 pixels and browser test reports are local in ignored `reports/`. These include a public-study image used for local testing and are excluded from the hosted source and deployment.

`tests/browser.mjs` uses the consulted taste skill's zero-dependency Chrome helper. Its import path is specific to this development environment and it needs an installed Chrome plus the original dataset image 1 for the upload smoke test. The production app has no dependency on that helper, Python, PyTorch, or the dataset. The eight inference tests need only Node >=22 and the exported fixtures.

## Design

Uses the provided logo unchanged as a raster asset, with CSS inversion for the light interface. The direction is the taste skill's **Split stage**, seed **682782689**, adapted to a functional app: the live/captured image is the persistent visual stage, and the quiet adjacent column changes from preparation to annotation to result. Palette and type stay with the supplied monochrome brand. No stock photos, ornamental motion, invented measurements or mock camera feed are shipped. The initial state explicitly shows that the camera is off.

The skill's marketing-page image-count, footage, and motion-floor rules are documented exceptions for a permission-gated camera application. Adding four stock images or an autoplay backdrop would distract from the real feed. The inspector still checks text wrapping, contrast, overflow, gradients, decorative borders, shadows and browser errors. Source lint and final responsive screenshot review are recorded locally. Detailed decisions and critique are in DESIGN.md.

## Hosting

`.openai/hosting.json` identifies the private Site and serves the buildless `dist/` directory. Only the static app, user-provided logo and frozen neural weights are required for deployment. No patient images are in `dist/`; no camera upload endpoint exists. A deployment archive is generated outside the web source directory by the Sites source helper.

## Research limitations

This model is experimental and is not a diagnostic device. Aggregate held-out MLP MAE was 15.96 g/L on 50 study patients; that is not an individual reading's uncertainty. Low hemoglobin was often overestimated. Webcam and Kera Dock camera transfer have not been clinically validated. The project selected Elastic Net using cross-validation; this app intentionally uses the requested MLP rather than silently substituting that baseline. The model notes explain this distinction. Any health concern requires clinical assessment and laboratory testing.

Current delivery status: the app is complete and verified locally at `http://localhost:4173`; the standalone archive is `../artifacts/kera_web_app.zip`. A private Site was registered, but its source/model have **not been pushed or deployed**. Automatic approval review rejected external publication because deployment to that hosting destination was not explicitly authorized. The existing Site ID is retained for a later approved deployment; do not create another Site.
