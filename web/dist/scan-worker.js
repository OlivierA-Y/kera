import {sampleSticker,fitStickerCorrection} from './sticker-calibration.js';
import { validateModel, extractFeatures, predict } from './ml.js';

// Photo processing stays in this worker. Only an estimate and quality warnings
// return to the page; neither photo pixels nor extracted color features do.
self.addEventListener('message', ({ data }) => {
  const id = data?.id;
  try {
    const { model, image, boxes } = data;
    validateModel(model);
    if (!(image?.buffer instanceof ArrayBuffer)) {
      throw new Error('The captured photo could not be read. Please take it again.');
    }
    const pixels = {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.buffer),
    };
    let { features, warnings } = extractFeatures(pixels, boxes);
    if(data.calibration){
      const correction=fitStickerCorrection(sampleSticker(pixels,boxes),data.calibration);
      const corrected=extractFeatures(pixels,boxes,correction.transform);
      features=corrected.features;warnings=[...new Set([...warnings,...corrected.warnings])];
      warnings.push('Experimental color-reference correction applied using the bundled reference. Color matching does not establish hemoglobin accuracy.');
    }
    const estimate = predict(model, features);
    if (!Number.isFinite(estimate) || estimate <= 0 || estimate > 1000) {
      throw new Error('The photo did not produce a usable estimate. Please take another photo.');
    }
    if (estimate < 44 || estimate > 169) {
      warnings.push('This estimate is outside the study’s measured range of 44–169 g/L.');
    }
    self.postMessage({ id, result: { id, hemoglobin_g_per_l: estimate, warnings } });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error && error.message
        ? error.message
        : 'This photo could not be processed. Please try again.',
    });
  }
});
