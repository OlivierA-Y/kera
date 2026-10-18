import { CATEGORIES, associationFor, categoryReferenceFor } from './care-evidence.js';

export const LIMITATION = 'This experimental photo review cannot diagnose or rule out disease. An unclear result does not mean normal or disease-free. Clinical assessment is needed for health concerns.';
const STATES = { possible_features: 'Visible changes · possible match', no_visible_features: 'No visible features identified', unclear: 'Could not assess' };
const MATCH_NAMES = {skin_cancer:'skin or nail warning signs needing assessment', fungal_infection:'fungal nail changes', eczema:'eczema', psoriasis:'psoriasis'};
const VIEWS = ['top', 'side', 'both', 'unavailable'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, limit = 600) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
const UNSAFE_PROSE = /%|\b(?:diagnos\w*|healthy|normal|benign|malignan\w*|cancer|melanoma|psoriasis|eczema|fungal|infection|anemia|anaemia|deficien\w*|oxygen|hemoglobin|haemoglobin|treat\w*|antibiotic\w*|antifungal\w*|medication\w*|probability|confidence)\b/i;

export function normalizeReview(value) {
  const invalid = () => { throw new Error('This response is incomplete or unsupported. No review or handoff draft is shown. Try another photo or retry the analysis.'); };
  if (!value || !exact(value.image_quality, ['assessment', 'reason']) || !['adequate', 'limited', 'unusable'].includes(value.image_quality.assessment) || !text(value.image_quality.reason) || !exact(value.observations, Object.keys(CATEGORIES))) invalid();
  const quality = { ...value.image_quality };
  const findings = Object.entries(CATEGORIES).map(([key, label]) => {
    const item = value.observations[key];
    if (!exact(item, ['status', 'evidence', 'view']) || typeof item.status !== 'string' || !Object.hasOwn(STATES, item.status) || !VIEWS.includes(item.view) || !text(item.evidence)) invalid();
    if (UNSAFE_PROSE.test(item.evidence)) invalid();
    const finding = quality.assessment === 'unusable' || item.view === 'unavailable'
      ? { status: 'unclear', evidence: quality.assessment === 'unusable' ? 'The photo quality does not support a visual assessment.' : item.evidence, view: 'unavailable' }
      : quality.assessment !== 'adequate' && item.status === 'no_visible_features'
        ? { status: 'unclear', evidence: 'Photo detail is limited, so this check cannot be assessed reliably.', view: item.view }
        : { ...item };
    return { key, label, ...finding, association: associationFor(key, finding, quality.assessment) };
  });
  if (UNSAFE_PROSE.test(quality.reason)) invalid();
  const metadata = {};
  for (const key of ['provider', 'model']) {
    if (value[key] !== undefined && !text(value[key], 160)) invalid();
    metadata[key] = value[key] || 'Not supplied';
  }
  return { quality, findings, metadata };
}

export function reviewHeadline(review) {
  const reported=review.findings.filter(item=>item.status==='possible_features');
  const notObserved=review.findings.filter(item=>item.status==='no_visible_features');
  return review.quality.assessment === 'unusable' ? 'This photo cannot be assessed.'
      : reported.length ? `Possible explanations: ${reported.map(item => MATCH_NAMES[item.key]).join(', ')}.`
        : notObserved.length === review.findings.length ? 'No visible issues identified in these checks.'
          : notObserved.length ? 'No specific changes identified; some checks remain inconclusive.' : 'Not enough detail for a clear assessment.';
}

export function buildHandoff(review, { synthetic = false } = {}) {
  const lines = [
    ...(synthetic ? ['SIMULATED EXAMPLE. No image or model was used. Do not use as a clinical record.', ''] : []),
    'AI-assisted observational draft. Verify before use. Not a diagnosis.',
    'Photo appearance reviewed; descriptions are AI-reported and are not clinician-verified.',
    `Image quality: ${review.quality.assessment}. ${review.quality.reason}`,
    '',
  ];
  if (review.quality.assessment === 'unusable') {
    lines.push('Assessment is insufficient. No condition-specific conclusions can be drawn from this image.');
  } else {
    for (const finding of review.findings) {
      lines.push(`${finding.label}: ${STATES[finding.status]}. AI-reported description: ${finding.evidence}`);
      if (finding.association) {
        lines.push(`Educational context, not a diagnosis: ${finding.association.text}`);
        lines.push(`Professional review: ${finding.association.followUp}`);
        for (const source of finding.association.sources) lines.push(`${source.title}: ${source.url}`);
      }
    }
  }
  lines.push('', LIMITATION, 'New, changing, bleeding or non-healing skin or nail changes warrant professional assessment, even when this review is unclear.',
    `Review source: ${review.metadata.provider}. Model: ${review.metadata.model}.`,
    'Care-team review and any follow-up remain to be documented by the reviewing professional.');
  return lines.join('\n');
}

/** Isolated, network-free component. Future integration must call clear() on any
 * capture/mode/angle change, new request, cancellation, or remote failure.
 */
export function createCareReview(root, { synthetic = false, clipboard = globalThis.navigator?.clipboard, handoffId = 'care-handoff-note' } = {}) {
  const doc = root.ownerDocument;
  let version = 0, largeText = false;
  function node(tag, content, className) {
    const el = doc.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (className) el.className = className;
    return el;
  }
  function clear() { version++; root.replaceChildren(); }
  function show(value) {
    clear();
    let review;
    try { review = normalizeReview(value); }
    catch (error) {
      const alert = node('p', error.message, 'care-message');
      alert.setAttribute('role', 'alert'); root.append(alert); return false;
    }
    const current = version;
    root.classList.add('care-review'); root.classList.toggle('care-large-text', largeText);
    const reported = review.findings.filter(item => item.status === 'possible_features');
    const unclear = review.findings.filter(item => item.status === 'unclear');
    const notObserved = review.findings.filter(item => item.status === 'no_visible_features');
    const summary = node('section', undefined, 'care-overview');
    const topline = node('div', undefined, 'care-overview-top');
    const heading = node('h2', 'Your photo review');
    const size = node('button', 'Larger text', 'care-text-size'); size.type = 'button';
    size.setAttribute('aria-pressed', String(largeText));
    size.addEventListener('click', () => {
      largeText = !largeText; root.classList.toggle('care-large-text', largeText); size.setAttribute('aria-pressed', String(largeText));
    });
    topline.append(heading, size);
    const headline = reviewHeadline(review);
    const qualityLabel = { adequate: 'Photo detail is visible', limited: 'Some photo detail is hard to see', unusable: 'Photo detail is not clear enough' }[review.quality.assessment];
    const summaryCopy = reported.length
      ? 'These are possible matches to visible patterns, not confirmed diagnoses. Similar changes can have different causes.'
      : notObserved.length === review.findings.length
        ? 'The AI did not identify specific visible features for the four checks in this photo. This does not rule out disease or replace an examination.'
        : 'Some details could not be assessed reliably. An inconclusive check does not mean that a condition is absent.';
    summary.append(topline, node('p', headline, 'care-headline'), node('p', summaryCopy, 'care-summary-copy'));
    const quality = node('details', undefined, 'care-quality-detail');
    quality.append(node('summary', qualityLabel), node('p', review.quality.reason)); summary.append(quality);
    const next = node('div', undefined, 'care-next-step');
    const warning = reported.find(item => item.key === 'skin_cancer' && item.association);
    next.append(node('h3', 'What to do next'), node('p', warning ? warning.association.followUp
      : review.quality.assessment === 'unusable' ? 'Use a clearer photo if you want to try again. A photo review cannot replace professional assessment.'
        : 'Review the descriptions below. Share concerning changes with a clinician, using the note if it helps.'));
    summary.append(next);
    const actions = node('div', undefined, 'care-overview-actions');
    const prepare = node('button', 'Prepare a care-team note', 'button dark-button'); prepare.type = 'button';
    actions.append(prepare); summary.append(actions);
    const layout = node('div', undefined, 'care-columns');
    const findings = node('section', undefined, 'care-findings');
    findings.append(node('h2', reported.length ? 'What the photo suggests' : 'What was checked'));
    if (review.quality.assessment === 'unusable') {
      findings.append(node('h3', 'Cannot assess from photo'), node('p', 'Assessment is insufficient. No condition-specific explanations are shown. A different photo may improve visibility; it cannot replace professional assessment.'));
    } else {
      function findingRow(finding, open = false) {
        const row = node('details', undefined, 'care-finding'); row.open = open;
        const toggle = node('summary');
        const title = node('span', undefined, 'care-finding-title');
        title.append(node('span', finding.label), node('span', STATES[finding.status], 'care-state'));
        toggle.append(title); row.append(toggle);
        const content = node('div', undefined, 'care-finding-body');
        content.append(node('h3', 'What the AI described'), node('p', finding.evidence));
        const contextInfo = finding.association || (finding.status === 'possible_features' ? categoryReferenceFor(finding.key) : null);
        if (contextInfo) {
          const context = node('section', undefined, 'care-context');
          context.append(node('h4', finding.association ? 'Why this may be relevant' : 'About this possible match'));
          const explanation = node('div', undefined, 'care-explanation');
          explanation.append(node('p', contextInfo.text));
          const further = node('details', undefined, 'care-further-context');
          further.append(node('summary', 'Limits and questions for a clinician'), node('p', contextInfo.limits));
          const questions = node('ul');
          for (const question of contextInfo.questions) questions.append(node('li', question));
          further.append(questions, node('p', contextInfo.followUp));
          for (const source of contextInfo.sources) {
            const link = node('a', source.title + ' ↗');
            link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; explanation.append(link);
          }
          explanation.append(further);context.append(explanation); content.append(context);
        } else if (finding.status === 'possible_features') {
          content.append(node('p', 'No specific sourced explanation is available for this description. Review the observation with a clinician.', 'care-caution'));
        } else if (finding.status === 'no_visible_features') {
          content.append(node('p', 'No specific visible features were identified for this check in the photographed area. This is not a negative disease test.', 'care-caution'));
        } else {
          content.append(node('p', 'This check is unanswered. It does not exclude the condition. A clinician can assess any concern.', 'care-caution'));
        }
        row.append(content); return row;
      }
      reported.forEach(finding => findings.append(findingRow(finding, true)));
      if (notObserved.length) {
        const group = node('details', undefined, 'care-clear-group');
        group.append(node('summary', `${notObserved.length} checks with no visible features identified`), node('p', 'Applies only to the visible area in this photo; it does not rule out disease.'));
        for (const finding of notObserved) group.append(findingRow(finding));
        findings.append(group);
      }
      if (unclear.length) {
        const group = node('details', undefined, 'care-uncertain-group');
        group.append(node('summary', `${unclear.length} ${unclear.length === 1 ? 'check the photo could not answer' : 'checks the photo could not answer'}`),
          node('p', 'Open a check to read its visibility limits. These are not negative results.'));
        for (const finding of unclear) group.append(findingRow(finding));
        findings.append(group);
      }
    }
    findings.append(node('p', 'New, changing, bleeding or non-healing changes need professional assessment, even if the photo review is unclear.', 'care-caution'));
    const noteSection = node('details', undefined, 'care-note');
    const noteHeading = node('summary', 'Care-team handoff');
    const noteHelp = node('p', 'Review the description, edit the draft, then copy it yourself. Keep the note free of names, record numbers and other identifying details.');
    const label = node('label', 'Observation note');
    const textarea = node('textarea');
    textarea.id = handoffId; textarea.rows = 18; textarea.spellcheck = false;
    label.htmlFor = textarea.id; textarea.value = buildHandoff(review, { synthetic });
    const noteWarning = node('p', 'AI-assisted draft. Verify before use.', 'care-note-warning');
    const copy = node('button', 'Copy draft', 'button dark-button'); copy.type = 'button';
    const status = node('p', '', 'care-copy-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    textarea.addEventListener('input', () => { status.textContent = ''; });
    copy.addEventListener('click', async () => {
      const value = textarea.value;
      if (!value.trim()) { status.textContent = 'The draft is empty. Add a note before copying.'; return; }
      copy.disabled = true;
      try {
        if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
        await clipboard.writeText(value);
        if (version === current) status.textContent = 'Draft copied. Review it before sharing.';
      } catch {
        if (version === current) {
          status.textContent = 'Clipboard access is unavailable. Select and copy the draft manually.';
          textarea.focus(); textarea.select();
        }
      } finally { if (version === current) copy.disabled = false; }
    });
    noteSection.append(noteHeading, noteWarning, noteHelp, label, textarea, copy, status,
      node('p', synthetic ? 'Edits stay in this page only. Changing the example or clearing the review removes the draft. Nothing is saved or sent automatically.' : 'Edits stay in this page only. Changing the photo, angle or mode, or starting another analysis, clears the draft. Nothing is saved or sent automatically.', 'care-caution'));
    prepare.addEventListener('click', () => {
      noteSection.open = true; textarea.focus({ preventScroll: true });
      noteSection.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    const provenance = node('details', undefined, 'care-provenance');
    provenance.append(node('summary', 'Sources and limits of this review'), node('p', LIMITATION),
      node('p', 'Clinical references describe signs and assessment. They do not validate Kera’s image recognition. The explanations are curated educational context, separate from the AI description.'));
    const usedSources = new Map(review.findings.flatMap(item => (item.association || (item.status === 'possible_features' ? categoryReferenceFor(item.key) : null))?.sources || []).map(source => [source.id, source]));
    for (const source of usedSources.values()) {
      const link = node('a', source.title + ' ↗'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; provenance.append(link);
    }
    provenance.append(node('p', `Analysis provider: ${review.metadata.provider}. Model: ${review.metadata.model}.`));
    layout.append(findings, noteSection); root.append(summary, layout, provenance);
    return true;
  }
  return { show, clear };
}
