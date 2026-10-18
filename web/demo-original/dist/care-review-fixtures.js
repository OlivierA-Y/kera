/** Synthetic text-only examples. No image, resident, provider call, or clinical result. */
import { CATEGORIES } from './care-evidence.js';
function base() {
  return {
    image_quality: { assessment: 'limited', reason: 'Synthetic example. Fine surface detail is difficult to see.' },
    observations: Object.fromEntries(Object.keys(CATEGORIES).map(key => [key, { status: 'unclear', evidence: 'The supplied view does not establish specific visible features.', view: 'top' }])),
    provider: 'Synthetic fixture', model: 'No model call',
  };
}
export const EXAMPLES = Object.freeze({
  specific: { label: 'Nail buildup', make() {
    const value = base();
    value.observations.fungal_infection = { status: 'possible_features', evidence: 'Buildup beneath the nail is visible at the free edge.', view: 'top' };
    return value;
  } },
  clear: { label: 'No visible features', make() {
    const value=base();value.image_quality={assessment:'adequate',reason:'Synthetic example. The photographed skin and nail surfaces are clearly visible.'};
    for(const key of Object.keys(value.observations))value.observations[key]={status:'no_visible_features',evidence:'No specific surface changes for this check are visible in the photographed area.',view:'top'};
    return value;
  } },
  overlapping: { label: 'Overlapping skin and nail patterns', make() {
    const value=base();value.image_quality={assessment:'adequate',reason:'Synthetic example. The photographed nail surfaces and surrounding skin are visible.'};
    value.observations.eczema={status:'possible_features',evidence:'Dry, cracked skin surrounds the cuticle on two fingers.',view:'top'};
    value.observations.psoriasis={status:'possible_features',evidence:'Small pits and surface ridges are visible on two nail plates.',view:'top'};
    return value;
  } },
  unclear: { label: 'Cannot assess', make: base },
  unusable: { label: 'Unusable image', make() {
    const value = base(); value.image_quality = { assessment: 'unusable', reason: 'Synthetic example. Glare obscures the photographed area.' };
    // Deliberate contradiction verifies that the UI still abstains.
    value.observations.fungal_infection = { status: 'possible_features', evidence: 'Buildup beneath the nail is visible.', view: 'top' };
    return value;
  } },
  pigmentation: { label: 'Pigmented band', make() {
    const value = base(); value.observations.skin_cancer = { status: 'possible_features', evidence: 'A dark nail band with uneven edges is visible in the main photo.', view: 'top' }; return value;
  } },
  skin: { label: 'Skin changes', make() {
    const value = base(); value.observations.eczema = { status: 'possible_features', evidence: 'Dry skin is visible beside the nail.', view: 'top' }; return value;
  } },
  pitting: { label: 'Nail pits', make() {
    const value = base(); value.observations.psoriasis = { status: 'possible_features', evidence: 'Small pits in the nail are visible near the centre.', view: 'top' }; return value;
  } },
});
