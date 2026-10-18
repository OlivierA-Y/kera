# Kera Camera

A webcam app using the project's **actual trained three-seed MLP ensemble** for on-device hemoglobin estimation, plus optional OpenRouter vision observations of nail morphology. Photos and individual model calculations stay in the browser; numeric readings go to the local Kera server for the final session average. Visual observations send resized photos through OpenRouter to its selected model provider only after explicit consent.

## Run locally

From the parent Kera workspace:

```bash
npm --prefix web start
```

Open `http://localhost:4173`. A webcam requires browser permission and a secure context (HTTPS or localhost). Open the site directly in a browser if an embedded preview does not allow camera permission. Uploading a JPEG/PNG/WebP is available as an alternative.

1. On the Logitech reference webcam, select **Hemoglobin → Color reference → Create webcam reference**. Capture the same physical MLH sticker under diffuse, even light. Kera automatically proposes uniform interiors of its white background, orange/red M, blue L and yellow H. Adjust the four boxes if needed, or mark them manually. Save the webcam reference.
2. **Export reference** downloads a small JSON file containing four measured RGB medians and a timestamp, never photo pixels. Transfer it to your phone and choose **Import reference**. Profiles stay in this browser's local storage. A different preview hostname needs an import. When storage is blocked the profile remains usable for this page only; export it before leaving.
3. Choose **Scan with MLH sticker** (the default). Capture your middle nail, nearby skin and the same sticker in one photo, at the same height and under the same light. The four sticker regions are proposed automatically. They are immediately usable and remain editable. Mark nail and skin manually, giving six non-overlapping regions in total. **Find MLH sticker** retries detection; all boxes remain editable. Use **Edit region boxes** for zoom, two-corner taps and fine adjustment; direct drag and coordinate entry also work.
4. **Add another photo** adds the current photo; review the automatically detected sticker boxes and mark nail/skin again in every subsequent photo. **Finish & see result** waits for all pending readings and displays one average. Reference/setup mode does not run hemoglobin inference or add a scan. Scanning with MLH is blocked until a valid measured reference exists.
5. **Plain white reference only** retains the original three-region workflow. The earlier optional −15 g/L device adjustment is available only in this mode; it is never stacked with MLH correction. Reference selection/import is locked once a session has readings. **Discard scans & change reference** clears the session; **Start a new scan** clears a completed one.

## Automatic sticker-region suggestions

A local module worker analyzes a preview capped at 640 pixels on its longest side after capture/upload in Hemoglobin MLH/reference mode. It groups orange/red, blue and yellow pixels into connected components, looks for a roughly collinear M–L–H arrangement with comparable size, and selects interior squares away from colored edges and clipped pixels. Partly clipped letters can still supply a clean sample from another stroke; fully unusable patches still fail the existing calibration checks. A neutral region inside the L's bounding rectangle supplies sticker white. Rotated layouts are supported; ambiguous separate candidates, missing colors, tiny patches and invalid samples fail to manual marking. The small preview is used only to locate boxes; coordinates are mapped inward to the original photo and the full-resolution samples are validated before use. Calibration/inference always uses the original pixels.

This is a color/layout heuristic, not OCR, template identity verification or a trained detector. Similar colored objects can still produce false suggestions. Detected boxes are immediately usable after passing sample validation, with no confirmation checkbox. Users can adjust any box before saving the reference or adding a scan. Manual marking is available when detection fails. Existing manually marked sticker boxes are preserved by background detection; explicitly retrying replaces patch boxes only after all four new proposals pass validation. Nail and skin annotations remain intact. Retaking, switching reference mode, leaving the page and stale worker responses cannot apply old boxes to a new photo. A worker failure or 10-second timeout leaves manual marking usable. No image is sent to an external API.

## Experimental MLH color correction

The supplied webcam reference (`kera-mlh-reference.json`, captured 2026-10-18) is bundled in `dist/default-sticker-reference.js` and loads by default for every browser without a saved profile. A valid saved browser profile takes precedence. Users can still measure and import their own reference for their physical sticker. The four sampled RGB medians are divided channel-wise by sticker white. A 3×3 matrix maps current normalized sticker RGB to reference normalized RGB using least squares with an identity regularizer (λ = 0.005), with no affine bias. This is an empirical mapping in the browser's decoded sRGB encoding, not a physical spectral or raw-camera calibration.

Correction runs in the existing scan worker. Each nail/skin/white pixel is transformed, restored to reference white scale, and only then passed through the original central crops, percentiles and white-median normalization. Fractional corrected channel values are retained without re-quantization. The source photo and frozen network weights remain untouched. Processing transforms just the sampled regions without allocating a second full-resolution float image. Existing raw-photo warnings and corrected-photo warnings are retained. Results explicitly identify MLH correction and its lack of clinical validation.

Patch sampling requires at least 5×5 pixels per region and rejects overlap with patches or tissue, excessive clipping, large within-patch variation, dark/overbright white, insufficient color separation and ill-conditioned colors. Matrix fitting rejects large residuals or extreme coefficients. Corrected selected pixels outside the usable RGB range fail that photo, with no clipping or silent fallback. These thresholds are engineering checks, not clinically validated image-quality criteria, and cannot establish that the right physical sticker was selected or quantify blur. Reference files are capped at 8 KB, schema-checked and stripped of unrelated fields.

Use consistent diffuse light, exposure and flash conditions. Physical printing, gloss, ageing, camera processing and lighting spectra can still change nail colors differently from sticker inks. Three colored patches cannot cover all skin/nail colors. Better camera agreement does not establish hemoglobin accuracy. Validate on paired camera captures excluded from fitting and against laboratory reference measurements before claiming improved accuracy. Physical Logitech/iPhone color transfer has not been verified. Automatic detection was checked on the supplied sticker-only photo; this is not a clinical or general detection-accuracy evaluation.

## Averaged scan sessions

The browser retains full-precision predictions and sends only `{readings:[{id,hemoglobin_g_per_l,warnings}]}` to the local Node server at `POST /api/scans/average` when the session ends. The backend validates the batch, takes the arithmetic mean of every supplied reading, and returns `{hemoglobin_g_per_l,scan_count,warnings}`. Values are rounded only for the final display. No photos or colour features are sent to this endpoint. Nothing is saved to disk or sent to an external service. A failed averaging request can be retried without adding duplicate readings.

Sessions support up to 100 included readings and are held only in page memory; reloading or leaving the page clears them. At most three images and 128 MiB of queued pixels are processed at once. A stalled worker times out after 60 seconds and can restart. A single-photo session returns that one reading. The local Node server is required for the final average; a static file server alone cannot complete a scan session. No API key is needed for averaging.

The interface suggests trying the middle finger on the other hand while keeping the same camera, lighting and distance. Repeated readings may reduce random variation, but improved accuracy for this model and multi-hand setup has not been established. Averaging does not remove systematic bias, make poor photos reliable, diagnose anemia, or replace clinical blood tests.

The camera toolbar includes **Take photo in 5s** alongside the immediate shutter. With a ready live camera, it starts a visible 5–1 countdown and then uses the normal capture/region-detection flow. The same button becomes **Cancel timer** while counting. Taking a photo immediately, stopping/switching cameras, changing flash or analysis mode, opening photo upload, leaving live mode, hiding/leaving the page, or ending the scan cancels the pending shutter. Readiness is checked again at capture time. There is no delayed upload or remote analysis. Six deterministic timer tests cover deadlines, cancellation/stale callbacks, restart, camera readiness and delayed ticks. Physical timed camera capture has not been verified.

The live camera prefers the rear lens and requests its flashlight on by default when torch capability is available. Use **Flash: on/off** to toggle it; the choice is remembered for subsequent captures in the current page session. The UI uses the track’s reported state, and explicitly says when the browser cannot report it. Unsupported cameras show **Flash unavailable**, while capture/upload remain usable. Changing the light preserves the camera’s existing constraints. Capture waits during a flashlight change; Stop camera remains available. Stopping/capturing releases the track and its light. Physical iPhone flashlight hardware was not tested.

The camera stops when you capture, stop the feed, end the session, leave the page, or replace it with an uploaded image. Retake replaces the current photo and its regions; previously added readings remain in the session. Photos are kept only in page memory; the browser/OS may have their own lifecycle behavior. No history, accounts, analytics, or photo storage is added by this app.

## Camera adjustment and evaluation error

A separate browser-side device adjustment uses the reported phone 170 g/L → webcam 155 g/L comparison: **adjusted average = raw average − 15 g/L**. It does not retrain the network, modify its weights/features, alter individual readings or the averaging API, force future readings to 155, or claim clinical calibration. The result displays the raw and adjusted averages. The offset and its limitations are explained under Camera adjustment. No clipping is applied; implausible values should not be hidden.

**Camera adjustment** in Hemoglobin mode allows switching this profile off for webcam photos. First visits default it on for phone browsers (mobile browser signal or iPhone/Android Mobile user agent), off for desktop; an explicit choice is saved only in that browser's local storage. If storage is unavailable the current page still works. A new temporary preview hostname has a separate browser preference. The selected adjustment applies to the entire session, including uploaded photos: do not mix cameras, and turn it off for uploads from another device. It is locked while finalizing and after a result, and can be changed again after starting a new scan.

This one comparison assumes a constant bias and does not establish accuracy across people, devices, exposure, lighting, flash state or hemoglobin levels. The reference is the user's reported webcam estimate, not a laboratory blood result. Matching the study's Logitech C615 does not reproduce its controlled lighting and fixed exposure setup. Clinical validation and laboratory reference measurements remain necessary.

Results display the deployed MLP ensemble's held-out metrics from `reports/RESULTS.md`: MAE 15.96 g/L, RMSE 21.29 g/L, 50 held-out patient records from the published dataset; the 11 records with lab Hb below 120 g/L had average overestimation of 16.26 g/L. These are group statistics, not an individual uncertainty interval. Phone/dock transfer and repeated-photo averaging remain unvalidated.

## Marking on a small touchscreen

In Hemoglobin mode, capture or upload a photo and choose **Mark regions**, beside the photo heading on mobile. Tap two opposite corners to create a box, or drag to draw it. Use the zoom slider/buttons and **Move photo** to inspect small areas. **Move or resize this box** adjusts the box with large buttons. Completed boxes save automatically after the second corner tap, a completed drag, or each move/resize button press. **Next region** advances to the next unmarked region; **Done** closes the editor once all regions are marked. Closing keeps completed boxes and discards an incomplete gesture. Invalid boxes show an error and do not replace the last saved box. Display zoom does not resize the source image or change the model's pixel coordinates. The existing direct-drag and coordinate-entry methods remain available.

On phones, **Add another photo** and **Finish & see result** appear in a bottom action bar once a photo has every required region marked, or a scan session has readings underway. The same original buttons are moved into a direct child of the document body, avoiding transformed containers that can break fixed positioning. Bottom clearance tracks the bar's actual height. At tablet/desktop widths the buttons return to their original workflow location.

## Optional visual observations

The app opens in **Hemoglobin** mode. Select **Skin & nail**, then capture or upload a close-up. Add another angle using the photo toolbar if useful. Choose **Preview photos** to preview the photos and read the data-sharing notice, then check the consent box before sending. No region annotations or white reference are required for this separate flow. It replaces the previous six morphology categories with four review categories: **skin cancer warning signs**, **fungal infection-like changes**, **eczema-like changes** and **psoriasis-like changes**. Results distinguish **Visible changes · possible match**, **No visible features identified**, and **Could not assess**, without claiming a diagnosis or a negative disease test. The no-visible-features state requires adequate quality and a supplied, available view. A clear close-up of affected skin or nail is required; an additional angle is optional. A generic nail photo cannot screen the rest of a person's skin.

The local Node 22+ server uses the OpenRouter Chat Completions API with a strict structured-output schema. Default model: `google/gemini-2.5-flash`; configurable with `OPENROUTER_VISION_MODEL`. To enable it, copy `web/.env.example` to `web/.env`, set `OPENROUTER_API_KEY`, then restart the server. No npm dependencies are needed. Keep the key out of `dist/`; `.env` is ignored by Git. Without a key, the app explains that visual analysis is unavailable and the local hemoglobin estimate still works.

This is an experimental visual review, not a clinically validated detector or diagnostic device. No accuracy, sensitivity, specificity or confidence estimate is available for these four conditions. It cannot confirm or exclude skin cancer, fungal infection, eczema or psoriasis. Many conditions, injuries and benign changes look similar. Skin-cancer warning features receive a prompt in-person review recommendation; all results explain that a photo cannot rule out cancer and advise assessment of new, changing, bleeding or non-healing changes. Clinical follow-up is fixed app copy, separate from the model's descriptive evidence. The model must not prescribe treatment, make definitive diagnoses or reassure a user that a lesion is benign. A clinician may require examination, dermoscopy, a sample or biopsy. See [AAD nail melanoma guidance](https://www.aad.org/public/diseases/skin-cancer/types/common/melanoma/nail-melanoma) and [AAD nail fungus diagnosis](https://www.aad.org/public/diseases/a-z/nail-fungus-treatment).

Privacy: the browser makes resized JPEG copies up to 1600 px on the longest edge, removing original file metadata. Kera does not log or save photos or observations. The server holds them in memory during a request, sends them to the fixed OpenRouter endpoint, which routes them to the selected model provider, and returns structured findings. Requests require support for the schema parameters and by default exclude providers flagged as collecting data (`provider.require_parameters: true`, `data_collection: "deny"`). This routing preference is not a blanket zero-retention guarantee. OpenRouter and the selected provider’s policies still apply. See [OpenRouter privacy policy](https://openrouter.ai/privacy). Canceling or replacing a photo aborts the request but cannot recall photos already sent.

Some free endpoints, including NVIDIA’s free Nemotron vision endpoint, require data collection. To explicitly permit that, set `OPENROUTER_ALLOW_DATA_COLLECTION=true` in `web/.env` and restart. The consent screen then displays a provider data collection notice. Send only non-confidential images without identifying details. Your OpenRouter account privacy settings must also permit the endpoint. The default remains `false`; incompatible privacy/model combinations produce a specific configuration error rather than a generic 502.

The server binds only to localhost, validates Host/Origin, limits body size and requests, allows one analysis at a time, and times out provider calls. Local mode accepts localhost only. The Vercel adapter accepts exact HTTPS deployment origins; its in-memory rate limit applies per function instance, rather than across the deployment.

## The real neural network

`dist/assets/model.json` exports the frozen state dictionaries in `../artifacts/mlp.pt`, plus every ensemble member's training-only feature and target normalization. The three networks have architecture 42→16→8→1, ReLU hidden layers and linear output; inference disables training dropout, as PyTorch does in eval mode. The three predictions are averaged. No model is retrained for the app.

`dist/ml.js` reproduces the middle-finger central 20%–80% crops, the seven RGB percentiles and channel-wise white-reference median normalization. Unlike the dataset pipeline, users must supply the actual reference location for each camera photo. The original white-only path introduces no resizing, histogram correction, gamma adjustment or model-specific color augmentation. Optional MLH preprocessing is described above and has not been clinically evaluated. The canvas uses the browser's sRGB image decode; small decoder differences from Pillow are possible. Browser arithmetic uses JavaScript numbers, compared against the saved CPU PyTorch outputs to 0.0001 g/L tolerance.

Region overlap, invalid geometry, nonfinite features and an unusably dark reference block prediction. Clipping, small ROIs, reference color cast and estimates outside the study's label range produce warnings. These are engineering checks, not validated clinical image-quality criteria. Users can still mark an incorrect tissue or reference; automatic nail detection is not supplied.

To regenerate the browser model **from the existing trained artifact**, from the parent workspace:

```bash
PYTHONPATH=src .venv/bin/python web/scripts/export_model.py
node web/tests/ml.test.mjs
```

The parity fixtures use ten training patients, with no labels or patient identifiers. Model export does not read or evaluate the held-out test set.

## Verification

MLH tests use synthetic colors: median sampling/profile round trips, known cross-channel correction on unseen tissue color, identity/feature preservation, rejected clipping/uneven/degenerate/overlapping patches, and a real worker inference comparison. No patient images or external provider requests are used.

Seven torch-controller tests cover default-on behavior, toggling and preference retention, unsupported/sequence capabilities, missing state reports, failures, camera-stop races and browser API exceptions. These use simulated tracks; physical flashlight hardware still needs device testing.

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

Desktop places the camera alongside the active workflow. On mobile the photo and workflow stack, with the **Continue** action after the categories or results in normal document flow, so it cannot cover content. Nothing is sent by Continue: explicit consent remains a separate step. The optional second photo is available before that step and can be removed from either preview.


Uses the provided logo unchanged as a raster asset, with CSS inversion for the light interface. The direction is the taste skill's **Split stage**, seed **682782689**, adapted to a functional app: the live/captured image is the persistent visual stage, and the quiet adjacent column changes from preparation to annotation to result. Palette and type stay with the supplied monochrome brand. No stock photos, ornamental motion, invented measurements or mock camera feed are shipped. The initial state explicitly shows that the camera is off.

The skill's marketing-page image-count, footage, and motion-floor rules are documented exceptions for a permission-gated camera application. Adding four stock images or an autoplay backdrop would distract from the real feed. The inspector still checks text wrapping, contrast, overflow, gradients, decorative borders, shadows and browser errors. Source lint and final responsive screenshot review are recorded locally. Detailed decisions and critique are in DESIGN.md.

## Hosting

Production: https://kera-alpha.vercel.app. Deploy from `web/` with `npx vercel --prod`. `vercel.json` serves `dist/` and routes averaging and vision requests to `api/index.mjs`, which reuses the Node server handlers. Node 22 is required.

Configure `OPENROUTER_API_KEY`, `OPENROUTER_VISION_MODEL` and `OPENROUTER_ALLOW_DATA_COLLECTION` as server-side production environment variables, then redeploy. Local `.env` files and `.vercel/` metadata are excluded from Git and deployment uploads. Custom domains must be added as exact HTTPS origins in `KERA_ALLOWED_ORIGINS` (comma-separated). Camera access requires HTTPS or localhost.

For local development, run `server.mjs` for the interface and API. A static-only host cannot provide averaged sessions or optional visual analysis.

## Research limitations

This model is experimental and is not a diagnostic device. Aggregate held-out MLP MAE was 15.96 g/L on 50 held-out patient records from the published dataset; that is not an individual reading's uncertainty. Low hemoglobin was often overestimated. Webcam and Kera Dock camera transfer have not been clinically validated. The project selected Elastic Net using cross-validation; this app intentionally uses the requested MLP rather than silently substituting that baseline. The model notes explain this distinction. Any health concern requires clinical assessment and laboratory testing.

## Dedicated visual results

A successful consent-based review opens the full-page `#review` route. It names possible explanations from the reported categories, shows the actual descriptive evidence, and links verified AAD patient resources for the corresponding category. It does not perform a live literature search or allow the model to generate source URLs. Category reading is explicitly educational; it does not establish a diagnosis or validate the image model. Detailed limitations and clinician questions are expandable. General category references remain available when a description does not match the narrower feature-specific editorial rule.

Back returns to the same captured photo; View your results reopens the in-memory result without another upload. Browser history supports returning to the results. Changing photos/angles/modes or starting another review clears the previous review. Reloading does not restore results. No images or reviews are added to local storage, session storage, URLs or server persistence.

## Session scan history

Each added Hb scan now retains a local JPEG preview (maximum 960 px along its longest edge and 512 KiB), the original region coordinates, processing status, numeric estimate and quality warnings for read-only review. Photos in this session remains available during capture and after the final average. Opening a saved scan uses a separate dialog and never replaces the current photo, changes its annotations, reprocesses a reading or adds it to the average again. Failed readings remain visible as excluded scans. Preview pixels are not used for inference; the original captured pixels remain its source.

Only the current open session is retained. Start a new scan, reload or leave the page to clear the history. Blob URLs are revoked and the preview canvas is cleared. No persistence or photo upload is added. A preview that cannot be encoded is labelled unavailable; its numeric status remains accessible.

The box editor action now says Edit region boxes and explains that the larger view supports drawing, moving and resizing the three measurement regions. The dialog names the active box, and movement/resize tools are explicitly labelled.

Shared photo collection: both modes and the dedicated review page use the same session originals and photo IDs. Switching tabs never creates another photo. Re-uploading an identical file selects its existing photo, including files first added as an additional angle. Hb boxes and readings belong to that photo; Skin & nail hides the box overlays. Selecting a thumbnail loads the original directly for editing. Previous/Next switches through the shared collection. Delete selected photo removes it from both modes, removes its Hb reading, and invalidates any average or joint AI review that depended on it. A new Hb session resets readings while retaining photos and their boxes. Reloading clears all session data.

## Direct photo selection and editing

Photo thumbnails now select the actual workspace photo, without opening the former description dialog. The strip is filtered by the active mode. Skin & nail restores a clean photo and any saved review, without Hb overlays. Hemoglobin restores the original-resolution lossless PNG and its saved box geometry for normal drawing, coordinate edits or Edit region boxes. JPEGs are thumbnails only and never feed recalculation. Selection preserves unfinished photo boxes in their history entry.

Changing the boxes of an included Hb photo marks that reading for recalculation. Finish or Add another photo updates that same reading ID instead of appending a duplicate. Finalization stops if another edited photo still needs recalculation. Originals remain in memory only, with a 192 MiB session budget; an unavailable editing copy is explicitly labelled. Reloading clears retained photos.

Results layout: the analysis now uses stacked, icon-led sections and an At a glance overview. Category counts are not risk scores. Cancer-category flags produce a prominent first-position warning panel; no such banner is shown for clear or inconclusive cases. The clear result says the AI did not spot worrying changes only when all four checks have adequate-quality no-visible-features states, and a visible adjacent note states that AI is not a doctor and cannot confirm or rule out a condition. Source links remain directly visible; detailed limits/questions are expandable.

Photo controls: the optional additional-angle UI has been removed from the toolbar and consent dialog. Each visual review uses the selected photo. The upload action reads Replace photo while a file-origin photo is selected, including gallery selections; Upload a photo remains the label before selection and for camera photos. Selecting a replacement retains earlier photos in the shared session gallery.
