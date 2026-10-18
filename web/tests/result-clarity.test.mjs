import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeReview, reviewHeadline, buildHandoff } from '../dist/care-review.js';
import { categoryReferenceFor } from '../dist/care-evidence.js';
import { EXAMPLES } from '../dist/care-review-fixtures.js';
import { validateObservation } from '../server/vision.mjs';

test('Clear photos with no identified features are distinguished from inconclusive photos', () => {
  const review = normalizeReview(EXAMPLES.clear.make());
  assert.match(reviewHeadline(review), /^No visible issues identified/);
  assert.ok(review.findings.every(item => item.status === 'no_visible_features' && !item.association));
  assert.match(buildHandoff(review), /No visible features identified/);
  assert.match(reviewHeadline(normalizeReview(EXAMPLES.unclear.make())), /Not enough detail/);
  const mixed = EXAMPLES.clear.make(); mixed.observations.eczema.status = 'unclear';
  assert.match(reviewHeadline(normalizeReview(mixed)), /some checks remain inconclusive/);
});

test('Limited, unusable, unavailable or unsupplied views cannot become clear-photo negatives', () => {
  for (const quality of ['limited', 'unusable']) {
    const value = EXAMPLES.clear.make(); value.image_quality.assessment = quality;
    assert.ok(normalizeReview(value).findings.every(item => item.status === 'unclear'));
    delete value.provider; delete value.model;
    assert.ok(Object.values(validateObservation(value, false).observations).every(item => item.status === 'unclear'));
  }
  for (const view of ['side', 'both', 'unavailable']) {
    const value = EXAMPLES.clear.make(); delete value.provider; delete value.model;
    value.observations.eczema.view = view;
    assert.equal(validateObservation(value, false).observations.eczema.status, 'unclear');
  }
});

test('Named possible explanations include overlapping matches without a confirmed diagnosis', () => {
  const review = normalizeReview(EXAMPLES.overlapping.make());
  assert.equal(reviewHeadline(review), 'Possible explanations: eczema, psoriasis.');
  for (const finding of review.findings.filter(item => item.status === 'possible_features')) {
    const context = finding.association || categoryReferenceFor(finding.key);
    assert.ok(context.text && context.sources.length);
    assert.ok(context.sources.every(source => new URL(source.url).hostname === 'www.aad.org'));
  }
});

test('Live Hb results use raw output and show the deployed network error figures', () => {
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const report = readFileSync(new URL('../../reports/RESULTS.md', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /readCameraAdjustment|adjustHemoglobin|adjustmentEnabled/);
  assert.doesNotMatch(html, /id="camera-adjustment"/);
  assert.match(app, /prediction-value'\)\.textContent=result\.hemoglobin_g_per_l\.toFixed/);
  for (const metric of ['15.96', '21.29', '16.26']) {
    assert.ok(html.includes(metric)); assert.ok(report.includes(metric));
  }
  assert.match(html, /not a ±15\.96 g\/L range or a confidence interval/);
});
