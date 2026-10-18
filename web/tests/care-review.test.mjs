import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReview, buildHandoff } from '../dist/care-review.js';
import { CATEGORIES, SOURCES } from '../dist/care-evidence.js';
import { EXAMPLES } from '../dist/care-review-fixtures.js';

test('Every supplied example normalizes without mutating its input', () => {
  for (const example of Object.values(EXAMPLES)) {
    const value = example.make(), snapshot = JSON.stringify(value);
    assert.equal(normalizeReview(value).findings.length, 4);
    assert.equal(JSON.stringify(value), snapshot);
  }
});
test('Unclear findings and unusable images never receive associations', () => {
  for (const key of ['unclear', 'unusable']) {
    const review = normalizeReview(EXAMPLES[key].make());
    assert.ok(review.findings.every(item => item.status === 'unclear' && item.association === null));
    const note = buildHandoff(review);
    assert.ok(!note.includes('Educational context'));
    assert.match(note, /unclear result does not mean normal or disease-free/);
  }
});
test('Specific observations select only the fixed supporting source', () => {
  for (const [example, category, source] of [['specific', 'fungal_infection', 'F2'], ['pigmentation', 'skin_cancer', 'C1'], ['skin', 'eczema', 'E1'], ['pitting', 'psoriasis', 'P2']]) {
    const review = normalizeReview(EXAMPLES[example].make());
    const associated = review.findings.filter(item => item.association);
    assert.deepEqual(associated.map(item => item.key), [category]);
    assert.equal(associated[0].association.sources[0].url, SOURCES[source].url);
  }
});
test('Vague, negated, hypothetical, and unsupplied-view descriptions suppress education', () => {
  for (const evidence of ['There are visible changes.', 'No buildup beneath the nail is visible.', 'Buildup beneath the nail is not visible.', 'Possibly buildup beneath the nail.', 'If buildup beneath the nail were visible.', 'Buildup beneath the nail?']) {
    const value = EXAMPLES.specific.make(); value.observations.fungal_infection.evidence = evidence;
    assert.equal(normalizeReview(value).findings[1].association, null);
  }
  const value = EXAMPLES.specific.make(); value.observations.fungal_infection.view = 'unavailable';
  assert.equal(normalizeReview(value).findings[1].status, 'unclear');
});
test('Missing/extra categories, malformed fields, and unsupported states fail closed', () => {
  const mutations = [
    value => delete value.observations.eczema,
    value => value.observations.other = value.observations.eczema,
    value => value.observations.eczema.status = 'negative',
    value => value.observations.eczema.status = 'toString',
    value => value.observations.eczema.status = ['unclear'],
    value => value.observations.eczema.evidence = '',
    value => value.observations.eczema.evidence = 'x'.repeat(601),
    value => value.observations.eczema.view = 'imaginary',
    value => value.observations.eczema.confidence = 0.9,
    value => value.image_quality.assessment = 'good',
    value => value.image_quality.reason = null,
    value => value.provider = {},
  ];
  for (const mutate of mutations) { const value = EXAMPLES.unclear.make(); mutate(value); assert.throws(() => normalizeReview(value)); }
});
test('Common negation forms cannot produce association or referral text in a handoff', () => {
  for (const [key, evidence] of [
    ['skin_cancer', 'The nail lacks a dark band or streak.'],
    ['skin_cancer', 'A dark nail band was ruled out.'],
    ['eczema', 'Skin is free of dry skin.'],
    ['psoriasis', "Nail pitting isn't visible."],
    ['psoriasis', 'Nail pitting isn’t visible.'],
    ['fungal_infection', 'The photo fails to show buildup beneath the nail.'],
  ]) {
    const value = EXAMPLES.unclear.make();
    value.observations[key] = { status: 'possible_features', evidence, view: 'top' };
    const review = normalizeReview(value);
    assert.equal(review.findings.find(item => item.key === key).association, null);
    const note = buildHandoff(review);
    assert.ok(!note.includes('Educational context'));
    assert.ok(!note.includes('Arrange prompt in-person assessment'));
  }
});
test('Diagnostic, treatment, and confidence prose is rejected before a note is generated', () => {
  for (const evidence of ['This is skin cancer.', 'You have psoriasis.', 'The nail is healthy.', '95% confidence.', 'Use an antifungal medication.']) {
    const value = EXAMPLES.specific.make(); value.observations.fungal_infection.evidence = evidence;
    assert.throws(() => normalizeReview(value));
  }
});
test('Synthetic handoff preserves provenance, uncertainty, sources, and clinician review', () => {
  const note = buildHandoff(normalizeReview(EXAMPLES.pigmentation.make()), { synthetic: true });
  assert.match(note, /^SIMULATED EXAMPLE/);
  assert.match(note, /Photo appearance reviewed/);
  assert.match(note, /not clinician-verified/);
  assert.match(note, /prompt in-person assessment/);
  assert.ok(note.includes(SOURCES.C1.url));
  assert.match(note, /No model call/);
  assert.ok(!/\b(?:Patient name|Record number|Date of birth):/.test(note));
});
test('All source mappings are fixed HTTPS AAD references and all four categories are covered', () => {
  assert.equal(Object.keys(CATEGORIES).length, 4);
  for (const source of Object.values(SOURCES)) assert.equal(new URL(source.url).hostname, 'www.aad.org');
});
