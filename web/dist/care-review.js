import { validateInsights } from './health-context.js';
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
        : notObserved.length === review.findings.length ? 'The AI did not spot worrying changes in this photo.'
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
  function icon(kind, className='') {
    const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    svg.setAttribute('class','care-icon '+className);svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
    svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    const add=(tag,attrs)=>{const el=doc.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);svg.append(el);};
    if(kind==='warning'){add('path',{d:'M12 3 22 21H2L12 3Z'});add('path',{d:'M12 9v5'});add('circle',{cx:'12',cy:'17',r:'.6',fill:'currentColor'});}
    else {add('circle',{cx:'12',cy:'12',r:'9'});add('path',{d:kind==='quiet'?'M8 12h8':'M10 9a2 2 0 0 1 4 0c0 2-2 2-2 4'});if(kind!=='quiet')add('circle',{cx:'12',cy:'16',r:'.6',fill:'currentColor'});}
    return svg;
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
    const reported = review.findings.filter(item => item.status === 'possible_features').sort((a,b)=>Number(b.key==='skin_cancer')-Number(a.key==='skin_cancer'));
    const unclear = review.findings.filter(item => item.status === 'unclear');
    const notObserved = review.findings.filter(item => item.status === 'no_visible_features');
    const summary = node('section', undefined, 'care-overview');
    const topline = node('div', undefined, 'care-overview-top');
    const heading = node('h2', 'At a glance');
    const size = node('button', 'Larger text', 'care-text-size'); size.type = 'button';
    size.setAttribute('aria-pressed', String(largeText));
    size.addEventListener('click', () => {
      largeText = !largeText; root.classList.toggle('care-large-text', largeText); size.setAttribute('aria-pressed', String(largeText));
    });
    topline.append(heading, size);
    const warning=reported.find(item=>item.key==='skin_cancer');
    let priority=null;
    if(warning){
      priority=node('section',undefined,'care-priority');priority.setAttribute('aria-label','Important warning signs');
      const warningTitle=node('div',undefined,'care-priority-title');
      warningTitle.append(icon('warning'),node('h2','Possible skin or nail cancer warning signs'));
      priority.append(warningTitle,node('p','A visible change needs in-person medical assessment. This photo does not establish cancer; other causes are possible.'));
      const action=node('p','Arrange an appointment with a dermatologist or another clinician.','care-priority-action');priority.append(action);
      const reference=categoryReferenceFor('skin_cancer').sources[0];
      const link=node('a','Read the warning-sign guide ↗');link.href=reference.url;link.target='_blank';link.rel='noopener noreferrer';priority.append(link);
    }
    const headline=reported.length?`${reported.length} ${reported.length===1?'pattern':'patterns'} to discuss with a clinician.`:reviewHeadline(review);
    summary.append(topline,node('p',headline,'care-headline'),node('p','AI is not a doctor. This result cannot confirm or rule out a condition.','care-review-disclaimer'));
    const overview=node('ul',undefined,'care-at-glance');overview.setAttribute('aria-label','Overview of four review categories');
    for(const item of [
      {kind:'warning',label:'Changes to review',count:reported.length},
      {kind:'quiet',label:'No specific changes seen',count:notObserved.length},
      {kind:'question',label:'Could not assess',count:unclear.length},
    ]){
      const row=node('li');row.append(icon(item.kind),node('span',item.label),node('strong',String(item.count)));overview.append(row);
    }
    summary.append(overview,node('p','Four photo checks. Counts describe observations, not disease risk.','care-summary-copy'));
    const qualityLabel={adequate:'Photo quality: enough detail',limited:'Photo quality: some detail is limited',unusable:'Photo quality: not enough detail'}[review.quality.assessment];
    const quality=node('details',undefined,'care-quality-detail');quality.append(node('summary',qualityLabel),node('p',review.quality.reason));summary.append(quality);
    const next=node('div',undefined,'care-next-step');
    next.append(node('h3',warning?'Medical review is the next step':review.quality.assessment==='unusable'?'Take a clearer photo':'What to do next'),
      node('p',warning?'See the warning above and the observed change below.':review.quality.assessment==='unusable'?'Use even light and bring the area into focus.':reported.length?'Show the observations below to a clinician if the changes persist or concern you.':'If you have symptoms or a changing area, seek assessment even when no specific feature was identified.'));
    summary.append(next);
    const actions=node('div',undefined,'care-overview-actions');
    const prepare=node('button','Prepare a care-team note','text-button');prepare.type='button';actions.append(prepare);summary.append(actions);
    const layout = node('div', undefined, 'care-columns');
    const findings = node('section', undefined, 'care-findings');
    findings.append(node('h2', reported.length ? 'Your observations' : 'Checks in detail'));
    if (review.quality.assessment === 'unusable') {
      findings.append(node('h3', 'Cannot assess from photo'), node('p', 'Assessment is insufficient. No condition-specific explanations are shown. A different photo may improve visibility; it cannot replace professional assessment.'));
    } else {
      function findingRow(finding, open = false) {
        const row = node('details', undefined, 'care-finding'+(finding.key==='skin_cancer'&&finding.status==='possible_features'?' care-finding-priority':'')); row.open = open;
        const toggle = node('summary');
        const title = node('span', undefined, 'care-finding-title');
        title.append(node('span', finding.label), node('span', finding.status==='possible_features'?'Possible explanation · not a diagnosis':STATES[finding.status], 'care-state'));
        toggle.append(icon(finding.status==='possible_features'?'warning':finding.status==='unclear'?'question':'quiet'),title); row.append(toggle);
        const content = node('div', undefined, 'care-finding-body');
        content.append(node('h3', 'What was seen'), node('p', finding.evidence,'care-observed-text'));
        const contextInfo = finding.association || (finding.status === 'possible_features' ? categoryReferenceFor(finding.key) : null);
        if (contextInfo) {
          const context = node('section', undefined, 'care-context');
          context.append(node('h4', 'What it may mean'));
          const explanation = node('div', undefined, 'care-explanation');
          explanation.append(node('p', contextInfo.text));
          const further = node('details', undefined, 'care-further-context');
          further.append(node('summary', 'Limits and questions for a clinician'), node('p', contextInfo.limits));
          const questions = node('ul');
          for (const question of contextInfo.questions) questions.append(node('li', question));
          further.append(questions, node('p', contextInfo.followUp));
          const sources=node('div',undefined,'care-source-links');
          sources.append(node('span','Source','care-source-label'));
          for (const source of contextInfo.sources) {
            const link = node('a', source.title + ' ↗');
            link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
          }
          explanation.append(sources,further);context.append(explanation); content.append(context);
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
        group.append(node('summary', `${notObserved.length} checks with no specific changes seen`), node('p', 'Applies only to the visible area in this photo; it does not rule out disease.'));
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
    findings.append(node('p', 'Seek medical assessment for new, changing, bleeding or non-healing skin or nail changes, even if this review is unclear.', 'care-caution'));
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
    layout.append(findings, noteSection);if(priority)root.append(priority);root.append(summary, layout, provenance);
    if(value.context_warning)root.append(node('p','Background insights were unavailable. The visual observations are unchanged.','small-note'));
    if(value.context_insights){try{const insights=validateInsights(value.context_insights),section=node('section',undefined,'care-context-insights');section.append(node('h2','Your background, considered'),node('p',insights.summary));for(const c of insights.considerations)section.append(node('h3',c.reported_detail),node('p',c.why_it_matters),node('p',c.question_for_clinician));section.append(node('p',insights.limitations,'small-note'));root.append(section);}catch{root.append(node('p','Background insights were unavailable. The visual observations above are unchanged.','small-note'));}}
    return true;
  }
  return { show, clear };
}
