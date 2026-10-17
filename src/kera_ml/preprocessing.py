"""RGB only. Boxes are [top,left,bottom,right], endpoints exclusive."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

REFERENCE = (350, 300, 400, 350)

def parse_boxes(value):
    try:
        boxes = np.asarray(json.loads(value) if isinstance(value, str) else value)
    except (ValueError, TypeError) as e:
        raise ValueError('Invalid JSON bounding boxes') from e
    if boxes.shape != (3, 4) or boxes.dtype.kind not in 'iu' or boxes.dtype.kind == 'b':
        raise ValueError('Expected three integer [top,left,bottom,right] boxes')
    return boxes

def load_rgb(image):
    if isinstance(image, (str, Path)):
        with Image.open(image) as im:
            if im.mode != 'RGB':
                raise ValueError('Expected RGB image; colour conversion must be explicit')
            arr = np.array(im)
    else:
        arr = np.asarray(image)
    if arr.ndim != 3 or arr.shape[2] != 3 or not arr.size:
        raise ValueError('Expected nonempty H x W x 3 RGB image')
    if not np.issubdtype(arr.dtype, np.number) or not np.isfinite(arr).all() or arr.min() < 0 or arr.max() > 255:
        raise ValueError('RGB values must be finite in [0,255]')
    return arr

def crop(image, box):
    b = np.asarray(box)
    if b.shape != (4,) or b.dtype.kind not in 'iu':
        raise ValueError('Box must contain four integers')
    t, l, btm, r = b.tolist()
    h, w = image.shape[:2]
    if not (0 <= t < btm <= h and 0 <= l < r <= w):
        raise ValueError(f'Invalid or out-of-bounds box: {box}, image {h}x{w}')
    return image[t:btm, l:r]

def central_crop(image):
    h, w = image.shape[:2]
    result = image[int(.2*h):int(.8*h), int(.2*w):int(.8*w)]
    if not result.size:
        raise ValueError('Empty central crop')
    return result

def regions(image, nail_box, skin_box, reference=REFERENCE):
    image = load_rgb(image)
    nail, skin = [central_crop(crop(image, box)) for box in (nail_box, skin_box)]
    ref = crop(image, reference)
    median = np.median(ref, axis=(0,1)).astype(float)
    if np.any(median < 5):
        raise ValueError('Invalid white reference: channel median below 5/255')
    warnings = []
    for name, arr in [('nail', nail), ('skin', skin), ('reference', ref)]:
        if np.mean((arr <= 1) | (arr >= 254)) > .01:
            warnings.append(f'{name}: >1% channel values near saturation or black')
        if np.min(arr.shape[:2]) < 10:
            warnings.append(f'{name}: region smaller than 10 pixels')
    if median.max()/median.min() > 1.5:
        warnings.append('white reference has strong channel imbalance')
    return nail, skin, median, warnings
