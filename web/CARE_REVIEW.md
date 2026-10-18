# Care-Team Review

Current status: milestone 2 connects the panel to the app's existing visual-analysis response and reset lifecycle. The original standalone preview remains available. Historical milestone 1 details below describe that checkpoint; the milestone 2 section records the current integration.

Approved scope: isolated synthetic preview, sourced explanations and editable/copyable handoff. Built on `codex/care-review` from `91ba86d45885180e8243200f71e0ccb74750f48a`. Existing capture, guide, provider backend, inference and model files are unchanged.

Run the existing server with `npm --prefix web start`, then open `http://localhost:4173/care-review.html`. The preview does not import the app/capture controller, fetch provider status or submit photos. It uses invented text fixtures only. Each generated note retains a simulation label. No Hb value is fabricated or combined with a visual result.

## Evidence-to-copy map

Verified against official AAD pages on October 17, 2026. These patient-education references support descriptions and clinical follow-up, not Kera image-recognition accuracy, clinical validation, sensitivity or specificity. Copy is paraphrased; no source images are reproduced. No numerical detection claims or treatment recommendations are included.

| Source ID | Explicit feature gate | Permitted interpretation and limit | Reference |
|---|---|---|---|
| C1 | Dark/pigmented/brown/black nail band or streak | Reason for professional review; cannot establish cause or exclude cancer. Prompt in-person assessment is fixed editorial guidance, not model-computed urgency. New/change requires history. | [AAD nail melanoma](https://www.aad.org/public/diseases/skin-cancer/types/common/melanoma/nail-melanoma) |
| F2 | Buildup/debris beneath the nail | Fungal infection is one possible cause; injury/psoriasis can resemble it. Examination and possibly a sample are needed. | [AAD diagnosis](https://www.aad.org/public/diseases/a-z/nail-fungus-treatment) |
| E1 | Explicit dry/scaly/cracked skin | May occur with hand eczema; photo cannot establish cause. Never infer itch, pain, allergy or duration. | [AAD hand eczema](https://www.aad.org/public/diseases/eczema/types/hand-eczema) |
| P2 | Explicit nail pits/pitting/dents | May occur with psoriasis; appearance alone cannot establish cause. | [AAD nail psoriasis](https://www.aad.org/public/diseases/psoriasis/treatment/genitals/nails) |

`care-evidence.js` is the sole citation/association registry. The conservative text gates are editorial rules, not a validated NLP or medical classifier. They intentionally miss many phrasings. Negation/uncertainty, vague prose, `unclear`, unavailable views and unusable quality suppress associations. No automatic link or diagnosis is taken from provider prose. The note attributes observations to AI, leaves professional verification pending, and does not assert any clinician action has occurred.

## Interface and next integration boundary

`createCareReview(root, { synthetic, clipboard })` returns `show(response)` and `clear()`.

- `show` clears prior content before validating. It accepts existing four-category responses and optional provider/model strings; it ignores other top-level metadata. Invalid responses show an error with no note.
- Unusable quality overrides contradictory possible features. The UI renders only abstention, general limitations and an appropriately limited note.
- DOM content is created with `textContent`, never provider HTML. Source URLs come from the fixed registry.
- The draft is editable and copied only by button action. Clipboard failure selects the text for manual copying. No automatic sending, storage, identity fields, guessed timestamps or EHR integration.
- **Before live wiring**, coordinate `visual.js` and `app.js` ownership. The host must call `clear()` on new captures, angle changes, mode changes, new analyses, errors and cancellation. The component does not implement provider selection or consent.
- Future direct Gemini/NVIDIA integration stays with its separately confirmed backend owner. This milestone provides no proof of direct Gemini use or prize eligibility.

## Checks

`npm --prefix web test` runs the existing inference/API tests and the new care-review unit cases. All providers in API tests are injected mocks.

The new browser check uses an existing Playwright installation without adding a project dependency:

```sh
KERA_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
KERA_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node web/tests/care-review-browser.mjs
```

It starts an ephemeral localhost server with an explicit empty key and uses only synthetic text. It checks edited copy, clipboard rejection, resets, malformed responses, HTML escaping, six fixture states at 390/768/1440px, keyboard focus, and absence of API/external requests or storage. Screenshots go to ignored `web/reports/care-review/`. The original teammate browser tests require an unavailable machine-specific helper and are not claimed to run here.

Decision log: keep milestone isolated; preserve existing monochrome design; use deterministic sources; abstain without explicit evidence; no live providers, model changes, deployment or push. Next milestone is coordinated integration into the current result/reset lifecycle.

## Executed validation

October 17, 2026, 22:54 EDT. macOS, Node v25.9.0, installed Google Chrome with bundled Playwright. Base commit `91ba86d45885180e8243200f71e0ccb74750f48a`; all milestone files are uncommitted additions on `codex/care-review`.

- `npm --prefix web test`: **35 passed, 0 failed, 0 skipped**, including nine new care-review tests. Existing CPU parity maximum difference: 0.000013475244003302578 g/L on saved training-only fixtures. No new test-cohort evaluation.
- Browser command above, using the bundled Playwright and installed Chrome: **12 checks passed**, including six synthetic states at each of 390, 768 and 1440px. No runtime errors, API requests, external requests or browser storage. Clipboard calls intercepted for tests; OS clipboard unchanged.
- All three generated viewport screenshots inspected. No clipping or horizontal overflow found. Original teammate browser harness was not run.
- Impeccable detector on the new HTML/CSS/component/preview/evidence files: **0 findings**. Independent review found a negation-gate bug; expanded conservative suppression and dedicated regression cases repair it. Focused re-review found no remaining issue.
- `git diff --exit-code`: existing tracked files unchanged. All nine added files checked for the prohibited em dash character; none found. No credentials or real patient data used.

Added files: `dist/care-evidence.js`, `dist/care-review.js`, `dist/care-review-fixtures.js`, `dist/care-review-preview.js`, `dist/care-review.html`, `dist/care-review.css`, `tests/care-review.test.mjs`, `tests/care-review-browser.mjs`, and this document. No commit, push, provider test, deployment or live-capture integration was performed.

## Milestone 2: app integration

Authorized by Sadman after deferring the Hb accuracy issue to another ChatGPT agent. Branch fast-forwarded to teammate main `2a0d843fe389bcd2b2b45fd10d599c0e97196b6d` before edits, preserving its multiple-image Hb scanning work.

- `dist/index.html`: adds the care-review stylesheet.
- `dist/visual.js`: delegates validated results to the care-review module, displays provider/model from the existing status endpoint before consent, and clears the review/draft on new analysis, photo/angle changes, errors and cancellation. Uses the existing request route and consent payload; no new remote requests.
- `dist/app.js`: one mode-switch hook calls visual reset in either direction. Hb estimation, averaging, worker/session implementation and models are untouched relative to the updated main.
- `dist/care-review.js` and `.css`: live wording and a stacked review/note layout inside the existing reading column. The synthetic preview retains its simulation labels. A live note is never populated from the demo fixtures.
- `tests/vision-browser.mjs`: legacy readiness/selector assertions and warning-sign fixture adapted for the new review. Its original machine-specific helper remains unavailable here, so this harness was not run.
- New `tests/care-integration-browser.mjs`: portable Playwright integration through the real app controller, mocked localhost provider, and synthetic gray JPEG. No external API calls or real clinical data.

Run the integration harness using the same `KERA_PLAYWRIGHT_MODULE` and `KERA_CHROME_EXECUTABLE` settings above, replacing the script with `web/tests/care-integration-browser.mjs`.

Executed checks: **54 unit/API tests passed, 0 failed/skipped** (includes teammate averaging and scan-worker tests); **13 browser integration checks passed**. These cover consent/provider disclosure, source mapping, edited copy, completed and pending mode resets, angle/photo/retake resets, repeated analysis, error/cancel/malformed response, unusable quality, fixed pigmentation follow-up, 390/768/1440px layouts, and Hb controls/model loading. The initial browser expectation incorrectly assumed Hb session controls appeared before region marking; the corrected test verifies their intended behavior before and after marking. All three integration screenshots were visually checked.

Detector: three warnings for pre-existing, hidden photo-preview elements whose `src` is assigned when photos exist; no new findings. Backend/provider/Hb files compare identical to `origin/main`. `git diff --check` passes. Changes remain uncommitted and unpushed. No model tuning or clinical performance evaluation was performed. A successful real provider response and confirmed teammate ownership remain integration/release evidence to obtain separately; direct Google Gemini is still the separate backend task.
