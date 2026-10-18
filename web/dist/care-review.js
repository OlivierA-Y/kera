import { CATEGORIES, associationFor } from './care-evidence.js';

export const LIMITATION = 'This experimental photo review cannot diagnose or rule out disease. An unclear result does not mean normal or disease-free. Clinical assessment is needed for health concerns.';
const STATES = { possible_features: 'Changes to review', unclear: 'Cannot assess from photo' };
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
export function createCareReview(root, { synthetic = false, clipboard = globalThis.navigator?.clipboard } = {}) {
  const doc = root.ownerDocument;
  let version = 0;
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
    const layout = node('div', undefined, 'care-columns');
    const findings = node('section', undefined, 'care-findings');
    const heading = node('h2', 'Changes to review');
    findings.append(heading, node('p', `Image quality: ${review.quality.assessment}. ${review.quality.reason}`, 'care-quality'));
    if (review.quality.assessment === 'unusable') {
      findings.append(node('h3', 'Cannot assess from photo'), node('p', 'Assessment is insufficient. No condition-specific explanations are shown. A different photo may improve visibility; it cannot replace professional assessment.'));
    } else {
      for (const finding of review.findings) {
        const row = node('section', undefined, 'care-finding');
        row.append(node('h3', finding.label), node('p', STATES[finding.status], 'care-state'), node('p', finding.evidence));
        if (finding.association) {
          const context = node('div', undefined, 'care-context');
          context.append(node('h4', 'What this appearance may mean'), node('p', finding.association.text), node('p', finding.association.followUp));
          for (const source of finding.association.sources) {
            const link = node('a', source.title + ' ↗');
            link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; context.append(link);
          }
          row.append(context);
        } else if (finding.status === 'possible_features') {
          row.append(node('p', 'No specific sourced explanation is available for this description. Review the observation with a clinician.', 'care-caution'));
        }
        findings.append(row);
      }
    }
    findings.append(node('p', LIMITATION, 'care-caution'), node('p', 'New, changing, bleeding or non-healing changes need professional assessment, even if the photo review is unclear.', 'care-caution'));
    const noteSection = node('section', undefined, 'care-note');
    const noteHeading = node('h2', 'Care-team handoff');
    const noteHelp = node('p', 'Review the description, edit the draft, then copy it yourself. Keep the note free of names, record numbers and other identifying details.');
    const label = node('label', 'Observation note');
    const textarea = node('textarea');
    textarea.id = 'care-handoff-note'; textarea.rows = 18; textarea.spellcheck = false;
    label.htmlFor = textarea.id; textarea.value = buildHandoff(review, { synthetic });
    const warning = node('p', 'AI-assisted draft. Verify before use.', 'care-note-warning');
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
    noteSection.append(noteHeading, warning, noteHelp, label, textarea, copy, status,
      node('p', synthetic ? 'Edits stay in this page only. Changing the example or clearing the review removes the draft. Nothing is saved or sent automatically.' : 'Edits stay in this page only. Changing the photo, angle or mode, or starting another analysis, clears the draft. Nothing is saved or sent automatically.', 'care-caution'));
    const provenance = node('p', `Source: ${review.metadata.provider} · ${review.metadata.model}. Clinical references describe signs and assessment; they do not validate Kera’s image recognition.`, 'care-provenance');
    layout.append(findings, noteSection); root.append(layout, provenance);
    return true;
  }
  return { show, clear };
}
