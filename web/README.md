# Kera Camera

October 18 care-home video fixture: [demo dataset and rehearsal instructions](demo-data/README.md). Includes one care worker, 20 fictional residents, six months of weekly Hb and visual records, a pending John scenario, restore-ready JSON and CSV exports. Sign in uses one Saved profiles button leading to a separate page with a Back action. Generate with `node web/scripts/demo-dataset.mjs` from the repository root. The dedicated `web/tests/demo-dataset-browser.mjs` harness uses an isolated database to check seven viewport sizes, saved-profile navigation and John's explicitly labeled simulated low check-in.

A webcam app using the project's **actual trained three-seed MLP ensemble** for on-device hemoglobin estimation, plus optional OpenRouter vision observations of nail morphology. Photos and individual model calculations stay in the browser; numeric readings go to the local Kera server for the final session average. Visual observations send resized photos through OpenRouter to its selected model provider only after explicit consent.

## Teammate review branch

The account and onboarding work is on `codex/accounts-onboarding-history`, for local review before integration into `main`. Checking out this branch does not change the deployed project. Automatic Vercel deployment is disabled for this branch only. Do not deploy this branch to the existing Vercel project: the account store requires a persistent Node server, and the current serverless adapter does not provide it.

From an existing clone with a clean working tree:

```sh
git fetch origin
git switch --track origin/codex/accounts-onboarding-history
npm --prefix web start
```

Use Node 22.13 or newer, then open `http://localhost:4173`. No npm install or Python setup is required for the web app. Select Demo to skip onboarding, or create an Individual or Healthcare worker demo identity. Hemoglobin inference works without an API key. Visual analysis and optional Hb background insights require your own server-side `OPENROUTER_API_KEY` in ignored `web/.env`, using `web/.env.example` as the template.

Each teammate gets a separate local database in `web/.data/kera.sqlite`. Restarting the server or clearing cookies retains its records. A fresh clone does not contain anyone else’s data. Use Settings to export/restore a workspace backup when you intentionally want to transfer demonstration records. Database files, backups, credentials and photos are not included in Git.

This work preserves the explicitly requested pre-account Demo snapshot at commit `15d1810`. `main` has newer MLH sticker-capture and Vercel changes developed separately. They must be reconciled before merging this review branch; this branch is not a production release. The existing downloadable ZIP predates the account work, so run the checked-out source to review these changes.

## Demo identities and saved history

The entry screen offers **Individual**, **Healthcare worker**, **Demo**, and a matching **Saved profiles** action. Restore backup is a small text action at the bottom right. Every audience has both hemoglobin workflows: **Color reference** is selected first, using the supplied bundled reference and automatic patch suggestions; **Plain white reference only** retains the original three-region path. The visual section is called **Nail Health Analysis** throughout capture and saved history. Delete current photo sits below the photo strip beside the selected picture name, asks for confirmation, and removes only that picture and its temporary session results. Saved profile history remains separate.

Demo serves this shared frontend at `http://localhost:4173/demo/?entry=1`, with no onboarding or health background, and a dedicated persistent Demo history. It ignores saved profile cookies. The entry parameter is consumed; reload or restored navigation returns to sign in. Its analysis and averaging APIs remain isolated through the original guest server. The old source snapshot and checksums remain unchanged in `web/demo-original/`; the previous frontend freeze was superseded by Sadman's explicit request for both reference workflows and shared labels in Demo.

Individual onboarding collects age, optional sex and optional editable health background. Sex choices are Male, Female and Other / prefer not to answer, with an unprovided state. Healthcare workers onboard their professional details, create an organization or accept an owner-created local invitation, then add Residents separately. Organization members share resident records. App permissions are separate from job titles, and owners can revoke invitations or deactivate colleagues without deleting resident histories. Invitations are copyable links, not sent emails, and work against the same local database.

The browser cookie remembers a selected demo identity for 30 days (or the browser session if Remember is unchecked). It is a preference, not an authentication credential. Profiles, onboarding drafts, structured Hb sessions, visual observations, notes and dated context live in `web/.data/kera.sqlite`, outside the public `dist/` tree and ignored by Git. `KERA_DATA_PATH=/absolute/path/kera.sqlite` selects another durable data file. Clearing cookies, browser storage or restarting the server does not delete it. Re-select the saved identity from the entry screen. Settings offers a versioned JSON workspace backup and transactional restore; conflicting records are rejected instead of overwriting current data. Store a backup elsewhere to protect against losing the server's disk. Keep the SQLite file, its WAL/SHM companions when running, and backup exports private.

This is a localhost-only demo using unverified profile selection. It is not real authentication, a secure clinical record system, or an actual PointClickCare integration. Identity resolution, domain records and storage are separate so verified sessions and hosted storage can later bind to the existing stable IDs. No public hosting or cross-device sync is added.

Onboarded photo reviews preview the age, sex and health background sent with the photo consent. Names, emails and record identifiers are excluded. Unknown/withheld history is not forwarded. The provider receives that context as untrusted reported information and returns separate background considerations; photo evidence remains descriptive. Guest requests retain the original general prompt/schema. Hb inference stays local and unchanged. Optional background insights send the displayed context and numeric estimate through the existing OpenRouter connection after the user chooses Generate insights. No Hb photo is sent by that request. Insight generation can fail while the original result and saved history remain available.

Hb reference context uses [MedlinePlus common adult laboratory intervals](https://medlineplus.gov/ency/article/003645.htm), explicitly as intervals rather than population averages. A single interval is not assigned for missing/other sex, pregnancy or children; age/sex do not establish a valid personal reference range. These intervals do not validate photo-based estimates. [MedlinePlus](https://medlineplus.gov/lab-tests/hemoglobin-test/) explains why laboratory, medical history and other factors matter. Personal context never changes the numerical model output or establishes a diagnosis.

History includes date/type filters, Hb charts, same-type result comparisons, notes, CSV/JSON export and confirmed deletion. Saved rows include original model/provider information, units, quality notes and the background at capture time, without pictures or thumbnails. Profile changes do not rewrite past context. On profile changes, pending visual requests, camera tracks, image gallery, region boxes and Hb workers are cleared. Failed saves remain visibly unsaved with a retry that does not repeat paid analysis.

## Run locally

From the parent Kera workspace:

```bash
npm --prefix web start
```

Requires Node 22.13 or newer with `node:sqlite` support (tested on Node 25.9). Open `http://localhost:4173`. A webcam requires browser permission and a secure context (HTTPS or localhost). Open the site directly in a browser if an embedded preview does not allow camera permission. Uploading a JPEG/PNG/WebP is available as an alternative.

1. Select **Hemoglobin**, turn on the camera and capture a photo with the middle fingernail, nearby skin, and plain white paper in the same light.
2. Mark the whole middle nail, an intact skin area on the same finger, and a white-reference area. Draw directly on the photo or enter pixel coordinates in the accessible form. Each completed region advances the selection automatically; select it again to redraw.
3. Choose **Add another photo** to add this photo and take or upload another. Each photo needs its own three region annotations. Processing runs in a Web Worker, so the interface stays available before earlier readings finish.
4. Choose **Finish & see result** to add the current marked photo, wait for pending readings, and display one average in g/L. You can also end while preparing the next photo; only photos already added are used. Individual readings stay hidden. The final result shows the number of included readings and every quality warning. Unreadable photos are explicitly identified and left out. **Start a new scan** clears the session.

## Averaged scan sessions

The browser retains full-precision predictions and sends only `{readings:[{id,hemoglobin_g_per_l,warnings}]}` to the local Node server at `POST /api/scans/average` when the session ends. The backend validates the batch, takes the arithmetic mean of every supplied reading, and returns `{hemoglobin_g_per_l,scan_count,warnings}`. Values are rounded only for the final display. No photos or colour features are sent to this endpoint. The averaging endpoint itself stores nothing and sends nothing to an external service. In Individual/Care team mode, the completed structured result is then saved separately to the selected profile; Demo saves them to its separate Demo profile. A failed averaging request can be retried without adding duplicate readings.

Sessions support up to 100 included readings and are held only in page memory; reloading or leaving the page clears them. At most three images and 128 MiB of queued pixels are processed at once. A stalled worker times out after 60 seconds and can restart. A single-photo session returns that one reading. The local Node server is required for the final average; a static file server alone cannot complete a scan session. No API key is needed for averaging.

The interface suggests trying the middle finger on the other hand while keeping the same camera, lighting and distance. Repeated readings may reduce random variation, but improved accuracy for this model and multi-hand setup has not been established. Averaging does not remove systematic bias, make poor photos reliable, diagnose anemia, or replace clinical blood tests.

The live camera prefers the rear lens and requests its flashlight on by default when torch capability is available. Use **Flash: on/off** to toggle it; the choice is remembered for subsequent captures in the current page session. The UI uses the track’s reported state, and explicitly says when the browser cannot report it. Unsupported cameras show **Flash unavailable**, while capture/upload remain usable. Changing the light preserves the camera’s existing constraints. Capture waits during a flashlight change; Stop camera remains available. Stopping/capturing releases the track and its light. Physical iPhone flashlight hardware was not tested.

The camera stops when you capture, stop the feed, end the session, leave the page, or replace it with an uploaded image. Retake replaces the current photo and its regions; previously added readings remain in the session. Photos are kept only in page memory; the browser/OS may have their own lifecycle behavior. Individual and Care team demo identities now have persistent structured results; Demo mode remains session-only. Photos are never added to the persistent database.

## Raw estimates and evaluation error

The live app no longer applies the experimental phone-to-webcam offset or reads its stored preference. Every result uses the raw model average. The old helper is retained only as historical code and is not imported by the app.

Results display the deployed MLP ensemble's held-out metrics from `reports/RESULTS.md`: MAE 15.96 g/L, RMSE 21.29 g/L, 50 held-out patient records from the published dataset; the 11 records with lab Hb below 120 g/L had average overestimation of 16.26 g/L. These are group statistics, not an individual uncertainty interval. Phone/dock transfer and repeated-photo averaging remain unvalidated.

## Marking on a small touchscreen

In Hemoglobin mode, capture or upload a photo and choose **Edit region boxes**. Tap two opposite corners to create a box, or drag to draw it. Use the zoom slider/buttons and **Move photo** to inspect small areas. **Move or resize this box** moves or resizes the draft with large buttons. **Save box & continue** saves the selected region and advances to the next; saving all three returns to the main photo. Closing the editor discards only the unsaved draft. Display zoom does not resize the source image or change the model's pixel coordinates. The existing direct-drag and coordinate-entry methods remain available.

On phones, **Add another photo** and **Finish & see result** appear in a bottom action bar once a photo has all three regions marked, or a scan session has readings underway. The same original buttons are moved into a direct child of the document body, avoiding transformed containers that can break fixed positioning. Bottom clearance tracks the bar's actual height. At tablet/desktop widths the buttons return to their original workflow location.

## Optional visual observations

Select **Skin & nail** (the default mode), then capture or upload a close-up. Add another angle using the photo toolbar if useful. Choose **Preview photos** to preview the photos and read the data-sharing notice, then check the consent box before sending. No region annotations or white reference are required for this separate flow. It replaces the previous six morphology categories with four review categories: **skin cancer warning signs**, **fungal infection-like changes**, **eczema-like changes** and **psoriasis-like changes**. Results distinguish **Visible changes · possible match**, **No visible features identified**, and **Could not assess**, without claiming a diagnosis or a negative disease test. The no-visible-features state requires adequate quality and a supplied, available view. A clear close-up of affected skin or nail is required; an additional angle is optional. A generic nail photo cannot screen the rest of a person's skin.

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

Run `server.mjs` for both the app and optional vision endpoint. A static host can serve the interface, but averaged scan sessions and optional visual analysis require the local Node server. The standalone archive includes the static assets, Node server, configuration example and this guide. The private Site previously registered for the static app has not been deployed; there is no public deployment of the vision backend.

## Research limitations

This model is experimental and is not a diagnostic device. Aggregate held-out MLP MAE was 15.96 g/L on 50 held-out patient records from the published dataset; that is not an individual reading's uncertainty. Low hemoglobin was often overestimated. Webcam and Kera Dock camera transfer have not been clinically validated. The project selected Elastic Net using cross-validation; this app intentionally uses the requested MLP rather than silently substituting that baseline. The model notes explain this distinction. Any health concern requires clinical assessment and laboratory testing.

## Dedicated visual results

A successful consent-based review opens the full-page `#review` route. It names possible explanations from the reported categories, shows the actual descriptive evidence, and links verified AAD patient resources for the corresponding category. It does not perform a live literature search or allow the model to generate source URLs. Category reading is explicitly educational; it does not establish a diagnosis or validate the image model. Detailed limitations and clinician questions are expandable. General category references remain available when a description does not match the narrower feature-specific editorial rule.

Back returns to the same captured photo; View your results reopens the in-memory result without another upload. Browser history supports returning to the results. Changing photos/angles/modes or starting another review clears the previous review. Reloading clears temporary photos and the live results route. Onboarded profiles can reopen completed structured reviews from History. Photos are not added to browser storage, URLs or server persistence; structured results are saved in the local database for Individual, Healthcare worker and Demo profiles.

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

## Account/history verification

`npm --prefix web test` includes durable storage, transactional restore, shared memberships, invitation handling and context-adapter checks. Run `node web/tests/accounts-browser.mjs` from the repository root with `KERA_PLAYWRIGHT_MODULE` set to an installed Playwright module and, when needed, `KERA_CHROME_EXECUTABLE` set to a Chrome executable. The browser harness uses temporary SQLite data, synthetic photos and a mocked AI provider. It does not upload patient photos or call a paid provider. Existing earlier browser scripts describe the older entry flow and some retired extra-angle controls; use the accounts harness for the current complete workflow.

The Individual/Care team camera uses a cancelable five-second timer. Stop camera, profile/mode changes, and selecting a file cancel pending capture. Both workspaces use a folder-icon photo-file chooser and an accessible × deletion control. Setup fills wide viewports edge to edge, with a graphite-and-ivory sculpture that fits beneath the copy within the opening viewport; mobile setup omits the left panel.

## Logged-in workspace presentation

Individual, Healthcare worker and Demo workspaces use a desktop sidebar, with an accessible navigation drawer on phones and tablets. The existing analysis controls remain wired to the same capture controller, including its five-second timer. History uses a searchable table, result/date filters, ten-row pagination and selection across pages for same-type comparisons. Hb trends are collapsed until requested.

Hb results say “Your estimated hemoglobin levels.” The age/sex reference comparison appears directly under the raw number, with within/below/above or an explicit unavailable state. Health history never silently changes a reference interval or the model output. Reference explanations, sharing preview and optional AI background insights are expandable. The common adult intervals come from [MedlinePlus](https://medlineplus.gov/ency/article/003645.htm); they are educational comparisons, not proof of health. Saved results use the background snapshot captured at analysis time.


The cross-audience browser regression is `web/tests/reference-controls-browser.mjs`, using the same Playwright environment variables as the accounts harness. It exercises both real inference paths on synthetic pixels, exactly two reference options with no webcam-reference setup, six-region editing, naming, and photo-delete cancel/confirm behavior in capture and review. No live provider is called. The raw model result is preserved; the optional MLH path applies experimental color matching before feature extraction and is not clinically validated.


Navigation is shared across all three audiences: one **Health checker** sidebar action opens the checker, with **Hemoglobin levels** and **Nail Health Analysis** in the horizontal header switch. Demo now saves Hb and analysis results in the local SQLite database under its own stable identity. Reopening Demo reconnects that history, including notes, comparisons, export and deletion. No age, sex or conditions are invented for Demo, and no health background is sent with its general photo analysis. It ignores other profile-selection cookies. The original one-visit entry behavior remains, so a reload returns to sign in and a new Demo entry reconnects its saved history. Photos stay temporary.


## Main-branch integration

The profile/history work and shared color-reference checker are merged with the newer main branch. The existing Vercel API adapter, exact HTTPS deployment-origin allowlist, parsed-request-body support and their regression tests are retained. Automatic Git deployments are disabled for main and the former review branch because the account frontend requires the local persistent SQLite server; pushing code does not deploy a working hosted account service. The earlier deployed application remains unchanged. Run this version locally with Node 22.13 or newer and restore the supplied fictional dataset through Restore backup to reproduce the video workspace on another computer.
