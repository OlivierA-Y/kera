import numpy as np
from .preprocessing import REFERENCE, regions
PERCENTILES = [5,15,25,50,75,85,95]
FEATURE_NAMES = [f'{t}_{c}_p={p}' for t in ('NAIL','SKIN') for c in 'RGB' for p in PERCENTILES]
FEATURE_VERSION = 'middle-rgb-percentiles-white-median-v1'

def extract(image, nail_box, skin_box, reference=REFERENCE):
    nail, skin, white, warnings = regions(image, nail_box, skin_box, reference)
    features = np.concatenate([
        np.percentile(arr[:,:,c], PERCENTILES)/white[c]
        for arr in (nail, skin) for c in range(3)])
    if features.shape != (42,) or not np.isfinite(features).all():
        raise ValueError('Nonfinite or malformed features')
    return features, warnings
