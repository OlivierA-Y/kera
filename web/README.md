# Kera Camera

A webcam app using the project's **actual trained three-seed MLP ensemble** for on-device hemoglobin estimation, plus optional OpenRouter vision observations of nail morphology. Photos and individual model calculations stay in the browser; numeric readings go to the local Kera server for the final session average. Visual observations send resized photos through OpenRouter to its selected model provider only after explicit consent.

## Run locally

From the parent Kera workspace:

```bash
npm --prefix web start
```

Open `http://localhost:4173`. A webcam requires browser permission and a secure context (HTTPS or localhost). Open the site directly in a browser if an embedded preview does not allow camera permission. Uploading a JPEG/PNG/WebP is available as an alternative.

1. Select **Hemoglobin**, turn on the camera and capture a photo with the middle fingernail, nearby skin, and plain white paper in the same light.
2. Mark the whole middle nail, an intact skin area on the same finger, and a white-reference area. Draw directly on the photo or enter pixel coordinates in the accessible form. Each completed region advances the selection automatically; select it again to redraw.
3. Choose **Continue scanning** to add this photo and take or upload another. Each photo needs its own three region annotations. Processing runs in a Web Worker, so the interface stays available before earlier readings finish.
4. Choose **End scan now** to add the current marked photo, wait for pending readings, and display one average in g/L. You can also end while preparing the next photo; only photos already added are used. Individual readings stay hidden. The final result shows the number of included readings and every quality warning. Unreadable photos are explicitly identified and left out. **Start a new scan** clears the session.

## Averaged scan sessions

The browser retains full-precision predictions and sends only `{readings:[{id,hemoglobin_g_per_l,warnings}]}` to the local Node server at `POST /api/scans/average` when the session ends. The backend validates the batch, takes the arithmetic mean of every supplied reading, and returns `{hemoglobin_g_per_l,scan_count,warnings}`. Values are rounded only for the final display. No photos or colour features are sent to this endpoint. Nothing is saved to disk or sent to an external service. A failed averaging request can be retried without adding duplicate readings.

Sessions support up to 100 included readings and are held only in page memory; reloading or leaving the page clears them. At most three images and 128 MiB of queued pixels are processed at once. A stalled worker times out after 60 seconds and can restart. A single-photo session returns that one reading. The local Node server is required for the final average; a static file server alone cannot complete a scan session. No API key is needed for averaging.

The interface suggests trying the middle finger on the other hand while keeping the same camera, lighting and distance. Repeated readings may reduce random variation, but improved accuracy for this model and multi-hand setup has not been established. Averaging does not remove systematic bias, make poor photos reliable, diagnose anemia, or replace clinical blood tests.

The camera stops when you capture, stop the feed, end the session, leave the page, or replace it with an uploaded image. Retake replaces the current photo and its regions; previously added readings remain in the session. Photos are kept only in page memory; the browser/OS may have their own lifecycle behavior. No history, accounts, analytics, or photo storage is added by this app.

## Optional visual observations

Select **Skin & nail** (the default mode), then capture or upload a close-up. Add another angle using the photo toolbar if useful. Choose **Continue** to preview the photos and read the data-sharing notice, then check the consent box before sending. No region annotations or white reference are required for this separate flow. It replaces the previous six morphology categories with four review categories: **skin cancer warning signs**, **fungal infection-like changes**, **eczema-like changes** and **psoriasis-like changes**. Results show **Changes to review** or **Cannot assess from photo**, never a positive or negative diagnosis. A clear close-up of affected skin or nail is required; an additional angle is optional. A generic nail photo cannot screen the rest of a person's skin.

The local Node 22+ server uses the OpenRouter Chat Completions API with a strict structured-output schema. Default model: `google/gemini-2.5-flash`; configurable with `OPENROUTER_VISION_MODEL`. To enable it, copy `web/.env.example` to `web/.env`, set `OPENROUTER_API_KEY`, then restart the server. No npm dependencies are needed. Keep the key out of `dist/`; `.env` is ignored by Git. Without a key, the app explains that visual analysis is unavailable and the local hemoglobin estimate still works.

This is an experimental visual review, not a clinically validated detector or diagnostic device. No accuracy, sensitivity, specificity or confidence estimate is available for these four conditions. It cannot confirm or exclude skin cancer, fungal infection, eczema or psoriasis. Many conditions, injuries and benign changes look similar. Skin-cancer warning features receive a prompt in-person review recommendation; all results explain that a photo cannot rule out cancer and advise assessment of new, changing, bleeding or non-healing changes. Clinical follow-up is fixed app copy, separate from the model's descriptive evidence. The model must not prescribe treatment, make definitive diagnoses or reassure a user that a lesion is benign. A clinician may require examination, dermoscopy, a sample or biopsy. See [AAD nail melanoma guidance](https://www.aad.org/public/diseases/skin-cancer/types/common/melanoma/nail-melanoma) and [AAD nail fungus diagnosis](https://www.aad.org/public/diseases/a-z/nail-fungus-treatment).

Privacy: the browser makes resized JPEG copies up to 1600 px on the longest edge, removing original file metadata. Kera does not log or save photos or observations. The server holds them in memory during a request, sends them to the fixed OpenRouter endpoint, which routes them to the selected model provider, and returns structured findings. Requests require support for the schema parameters and by default exclude providers flagged as collecting data (`provider.require_parameters: true`, `data_collection: "deny"`). This routing preference is not a blanket zero-retention guarantee. OpenRouter and the selected provider’s policies still apply. See [OpenRouter privacy policy](https://openrouter.ai/privacy). Canceling or replacing a photo aborts the request but cannot recall photos already sent.

Some free endpoints, including NVIDIA’s free Nemotron vision endpoint, require data collection. To explicitly permit that, set `OPENROUTER_ALLOW_DATA_COLLECTION=true` in `web/.env` and restart. The consent screen then displays a provider data collection notice. Send only non-confidential images without identifying details. Your OpenRouter account privacy settings must also permit the endpoint. The default remains `false`; incompatible privacy/model combinations produce a specific configuration error rather than a generic 502.

The server binds only to localhost, validates Host/Origin, limits body size and requests, allows one analysis at a time, and times out provider calls. It is a local development server; public hosting would require authentication, per-user quotas and a protected deployment. No public deployment is included.

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

```bash
npm --prefix web test
```

The 18 vision unit/integration tests use a synthetic gray JPEG and an injected provider; they never contact OpenRouter. They cover consent, input validation, origins, credential isolation, structured findings, refusal, errors, unsupplied photo views, unusable images, request limits and timeout handling. Browser vision tests additionally exercise consent, optional side photos, results, failure, cancellation, replacing photos during analysis and responsive layouts. They use a local mock provider, not a simulated production result.


- Eight worker tests cover real inference, image ownership, concurrent routing, errors, timeout and recovery. Eleven averaging tests cover arithmetic precision, warning retention, invalid input and endpoint security.
- Eight model tests cover CPU parity, feature ordering/normalization, NumPy-style percentile interpolation, central crop geometry, input validation, overlap/reference rejection, quality warnings and schema checks.
- Chrome integration checks cover initial loading, simulated live media, capture/releasing tracks, actual mouse selection, upload/coordinate selection, prediction, invalid annotations, model notes, network privacy, no JavaScript exceptions, tablet/mobile overflow, and permission-denial fallback.
- Physical webcam hardware was not verified. Chrome's test media device exercises the real getUserMedia/capture code path.
- Responsive screenshots at 1440, 768 and 390 pixels and browser test reports are local in ignored `reports/`. These include a public-study image used for local testing and are excluded from the hosted source and deployment.

`tests/browser.mjs` and `tests/vision-browser.mjs` use the consulted taste skill's zero-dependency Chrome helper. Its import path is specific to this development environment and it needs an installed Chrome plus the original dataset image 1 for the upload smoke test. The production app has no dependency on that helper, Python, PyTorch, or the dataset. The 44 model, worker and API tests need only Node >=22 and the checked-in fixtures. The vision browser test uses its synthetic fixture and never needs the dataset. Run `node web/tests/vision-browser.mjs` from the repository root.

## Design

The camera-first layout follows the approved desktop and mobile mockups. Top tabs separate **Hemoglobin** from **Skin & nail** while retaining the current photo. Keyboard arrow keys switch modes. Skin mode has no annotation overlays; Hemoglobin keeps the three-region workflow and saved boxes. Switching away during remote analysis cancels that request and prevents a stale result from appearing. The Guide opens instructions for the selected mode, retaining the contributed Kera Dock and no-dock instructions for hemoglobin.

Desktop places the camera alongside the active workflow. On mobile the photo and workflow stack, with a fixed **Continue** action for skin review and sufficient bottom clearance to scroll every category/result above it. Nothing is sent by Continue: explicit consent remains a separate step. The optional second photo is available before that step and can be removed from either preview.


Uses the provided logo unchanged as a raster asset, with CSS inversion for the light interface. The direction is the taste skill's **Split stage**, seed **682782689**, adapted to a functional app: the live/captured image is the persistent visual stage, and the quiet adjacent column changes from preparation to annotation to result. Palette and type stay with the supplied monochrome brand. No stock photos, ornamental motion, invented measurements or mock camera feed are shipped. The initial state explicitly shows that the camera is off.

The skill's marketing-page image-count, footage, and motion-floor rules are documented exceptions for a permission-gated camera application. Adding four stock images or an autoplay backdrop would distract from the real feed. The inspector still checks text wrapping, contrast, overflow, gradients, decorative borders, shadows and browser errors. Source lint and final responsive screenshot review are recorded locally. Detailed decisions and critique are in DESIGN.md.

## Hosting

Run `server.mjs` for both the app and optional vision endpoint. A static host can serve the interface, but averaged scan sessions and optional visual analysis require the local Node server. The standalone archive includes the static assets, Node server, configuration example and this guide. The private Site previously registered for the static app has not been deployed; there is no public deployment of the vision backend.

## Research limitations

This model is experimental and is not a diagnostic device. Aggregate held-out MLP MAE was 15.96 g/L on 50 study patients; that is not an individual reading's uncertainty. Low hemoglobin was often overestimated. Webcam and Kera Dock camera transfer have not been clinically validated. The project selected Elastic Net using cross-validation; this app intentionally uses the requested MLP rather than silently substituting that baseline. The model notes explain this distinction. Any health concern requires clinical assessment and laboratory testing.
