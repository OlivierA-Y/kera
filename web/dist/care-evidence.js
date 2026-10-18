/** Editorial reference mappings, verified 2026-10-17. Never model-generated citations.
 * These are conservative copy gates, not a validated feature recognizer.
 */
export const CATEGORIES = Object.freeze({
  skin_cancer: 'Skin cancer warning signs',
  fungal_infection: 'Fungal infection-like changes',
  eczema: 'Eczema-like changes',
  psoriasis: 'Psoriasis-like changes',
});
export const SOURCES = Object.freeze({
  C1: { title: 'AAD: Nail melanoma warning signs', url: 'https://www.aad.org/public/diseases/skin-cancer/types/common/melanoma/nail-melanoma' },
  F2: { title: 'AAD: How nail fungus is diagnosed', url: 'https://www.aad.org/public/diseases/a-z/nail-fungus-treatment' },
  E1: { title: 'AAD: Hand eczema', url: 'https://www.aad.org/public/diseases/eczema/types/hand-eczema' },
  P2: { title: 'AAD: Nail psoriasis', url: 'https://www.aad.org/public/diseases/psoriasis/treatment/genitals/nails' },
});
const RULES = {
  skin_cancer: {
    feature: /\b(?:dark|pigmented|brown|black)\s+(?:nail\s+)?(?:band|streak)\b/i,
    context: /\bnail\b/i,
    text: 'A pigmented nail band is a reason for professional review. A photograph cannot establish its cause or rule out cancer.',
    followUp: 'Arrange prompt in-person assessment with a dermatologist or other clinician. Report any known change in the band separately; a still photo cannot establish when it appeared.',
    limits: 'The image cannot tell when a band appeared, how it has changed, or what caused it. A photo review cannot rule out cancer.',
    questions: ['When was the band first noticed, and has it changed?', 'What examination is needed to establish its cause?'],
    sources: ['C1'],
  },
  fungal_infection: {
    feature: /\b(?:debris|buildup|build-up)\s+(?:is\s+visible\s+)?(?:beneath|under)\s+(?:the\s+)?nail\b/i,
    context: /\bnail\b/i,
    text: 'Buildup beneath a nail can occur with a fungal infection. Nail injury and psoriasis can look similar; a photo cannot identify the cause.',
    followUp: 'A clinician can examine the nail and may take a sample to check the cause.',
    limits: 'The image cannot confirm an infection or distinguish every look-alike condition. A sample may help establish the cause.',
    questions: ['Could injury or another nail condition explain the appearance?', 'Would a nail sample help confirm the cause?'],
    sources: ['F2'],
  },
  eczema: {
    feature: /\b(?:dry|scaly|cracked)\s+(?:and\s+(?:dry|scaly|cracked)\s+)?skin\b/i,
    context: /\bskin\b/i,
    text: 'Dry, scaly or cracked skin can occur with hand eczema and can resemble other skin problems. A photograph cannot establish the cause.',
    followUp: 'A clinician can review the skin and relevant history. Itch, pain and duration must be reported by the person, not inferred from this photo.',
    limits: 'A still image cannot establish itch, pain, triggers or duration. Dryness alone does not establish eczema.',
    questions: ['What symptoms and timing should be shared with the clinician?', 'Could products or repeated contact with irritants be relevant?'],
    sources: ['E1'],
  },
  psoriasis: {
    feature: /\b(?:nail\s+(?:pits|pitting)|(?:pits|pitting|dents)\s+(?:are\s+visible\s+)?(?:in|on)\s+(?:the\s+)?nail)\b/i,
    context: /\bnail\b/i,
    text: 'Small nail pits or dents can occur with psoriasis. Appearance alone does not establish psoriasis or distinguish it from other causes.',
    followUp: 'A clinician can assess the nail alongside skin findings and relevant history.',
    limits: 'Nail appearance alone cannot establish psoriasis. A clinician needs to assess these changes in context.',
    questions: ['Are there other nail or skin changes to show the clinician?', 'What else could explain the pits or dents?'],
    sources: ['P2'],
  },
};
// Suppress education when prose negates, questions, or merely suggests a feature.
// Deliberately abstains on many valid phrasings. It never changes a model's diagnosis.
const UNCERTAIN = /\b(?:no|not|without|absent|absence|cannot|can't|unable|unclear|possibly|possible|perhaps|might|may|could|if|whether|suspected|questionable|uncertain|unlikely|lacks?|lacking|free\s+of|ruled\s+out|fails?\s+to)\b|\b\w+n['’]t\b|\?/i;
export function associationFor(key, finding, quality) {
  const rule = RULES[key];
  if (!rule || quality === 'unusable' || finding.status !== 'possible_features' || finding.view === 'unavailable' || UNCERTAIN.test(finding.evidence)) return null;
  return rule.feature.test(finding.evidence) && rule.context.test(finding.evidence)
    ? { text: rule.text, followUp: rule.followUp, limits: rule.limits, questions: [...rule.questions], sources: rule.sources.map(id => ({ id, ...SOURCES[id] })) }
    : null;
}

// General category references are educational reading, not evidence that this image has a disease.
export function categoryReferenceFor(key) {
  const rule = RULES[key];
  const text = {
    skin_cancer: 'Some nail changes warrant assessment for melanoma, alongside other possible causes. The linked guide describes warning signs; it does not determine the cause of this photo’s changes.',
    fungal_infection: 'Nail fungus, nail injury and nail psoriasis can resemble one another. Examination and sometimes a nail sample are needed to distinguish them.',
    eczema: 'Hand eczema can involve dry, scaly or cracked skin. Irritation and other skin conditions can look similar; appearance alone cannot establish the cause.',
    psoriasis: 'Nail psoriasis can involve pits, discoloration, thickening or separation from the nail bed. Other nail conditions can resemble it.',
  }[key];
  return rule ? { text, followUp: rule.followUp, limits: rule.limits, questions: [...rule.questions], sources: rule.sources.map(id => ({ id, ...SOURCES[id] })) } : null;
}
