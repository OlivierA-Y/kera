/* Exact published descriptors and frozen MLP inference. No learned browser preprocessing. */
export const PERCENTILES = [5, 15, 25, 50, 75, 85, 95];
export const FEATURE_VERSION = 'middle-rgb-percentiles-white-median-v1';
export function percentile(sorted, p) {
  if (!sorted.length) throw new Error('The selected region is empty.');
  const position = (sorted.length - 1) * p / 100;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
export function validateBox(box, width, height) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isInteger)) throw new Error('Each region needs four whole-pixel coordinates.');
  const [top, left, bottom, right] = box;
  if (!(top >= 0 && left >= 0 && bottom <= height && right <= width && bottom > top && right > left)) throw new Error('Keep every region completely inside the photo.');
  return box;
}
export function centralBox(box) {
  const [top, left, bottom, right] = box;
  const h = bottom - top, w = right - left;
  const inner = [top + Math.floor(.2 * h), left + Math.floor(.2 * w), top + Math.floor(.8 * h), left + Math.floor(.8 * w)];
  if (inner[0] >= inner[2] || inner[1] >= inner[3]) throw new Error('That region is too small. Draw a larger region.');
  return inner;
}
function channels(image, box, transform=null) {
  const [top, left, bottom, right] = validateBox(box, image.width, image.height);
  const out = [[], [], []];
  let extreme = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const offset = (y * image.width + x) * 4;
    const rgb=[image.data[offset],image.data[offset+1],image.data[offset+2]];
    if(!rgb.every(value=>Number.isFinite(value)&&value>=0&&value<=255))throw new Error('The photo contains invalid color values.');
    const corrected=transform?transform(rgb):rgb;
    for (let c = 0; c < 3; c++) {
      const value = corrected[c];
      if (!Number.isFinite(value) || value < 0 || value > 255) throw new Error('The photo contains invalid color values.');
      out[c].push(value);
      if (value <= 1 || value >= 254) extreme++;
    }
  }
  for (const values of out) values.sort((a, b) => a - b);
  return { values: out, extreme: extreme / (out[0].length * 3) };
}
export function extractFeatures(image, boxes, transform=null) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.data?.length !== image.width * image.height * 4) throw new Error('The captured photo could not be read.');
  for (const kind of ['nail', 'skin', 'white']) validateBox(boxes[kind], image.width, image.height);
  // Overlapping annotations usually mean the wrong tissue/reference was selected.
  for (const [a, b] of [['nail','skin'], ['nail','white'], ['skin','white']]) {
    const x=boxes[a], y=boxes[b];
    if (Math.min(x[2],y[2]) > Math.max(x[0],y[0]) && Math.min(x[3],y[3]) > Math.max(x[1],y[1])) throw new Error('Choose separate, non-overlapping nail, skin, and white-reference regions.');
  }
  const ref = channels(image, boxes.white, transform);
  const white = ref.values.map(values => percentile(values, 50));
  if (white.some(value => value < 5)) throw new Error('The white reference is too dark. Choose a well-lit area of plain white paper.');
  const warnings = [], features = [];
  for (const kind of ['nail', 'skin']) {
    const box = centralBox(boxes[kind]);
    const { values, extreme } = channels(image, box, transform);
    if (Math.min(box[2]-box[0], box[3]-box[1]) < 10) warnings.push(`The ${kind} region is small. Move closer for a clearer scan.`);
    if (extreme > .01) warnings.push(`The ${kind} region has clipped highlights or deep shadows.`);
    for (let c = 0; c < 3; c++) for (const p of PERCENTILES) features.push(percentile(values[c], p) / white[c]);
  }
  if (ref.extreme > .01) warnings.push('The white reference has clipped highlights or deep shadows.');
  if (Math.max(...white) / Math.min(...white) > 1.5) warnings.push('The reference has a strong color cast. Use even, neutral lighting.');
  if (features.length !== 42 || !features.every(Number.isFinite)) throw new Error('The color features could not be calculated.');
  return { features, warnings };
}
export function validateModel(model) {
  if (model?.format !== 'kera-mlp-browser-v1' || model.feature_version !== FEATURE_VERSION || model.models?.length !== 3) throw new Error('The trained model is incompatible. Reload the app.');
  const names=['NAIL','SKIN'].flatMap(t=>[...'RGB'].flatMap(c=>PERCENTILES.map(p=>`${t}_${c}_p=${p}`)));
  if (JSON.stringify(model.feature_names) !== JSON.stringify(names)) throw new Error('The model feature order is incompatible.');
  for (const network of model.models) {
    if (network.feature_mean?.length !== 42 || network.feature_scale?.length !== 42 || !network.feature_mean.every(Number.isFinite) || !network.feature_scale.every(x=>Number.isFinite(x)&&x>0) || !Number.isFinite(network.target_mean) || !(network.target_scale > 0)) throw new Error('The trained model has invalid scaling.');
    let inputs=42;
    for (const layer of network.layers) {
      if (!Array.isArray(layer.weight) || layer.weight.length !== layer.bias?.length || !layer.bias.every(Number.isFinite) || !layer.weight.every(row=>row.length===inputs&&row.every(Number.isFinite))) throw new Error('The trained model has invalid weights.');
      inputs=layer.bias.length;
    }
    if (inputs!==1) throw new Error('The trained model must return one estimate.');
  }
  return model;
}
export function predict(model, features) {
  if (features.length !== 42 || !features.every(Number.isFinite)) throw new Error('Expected 42 valid color features.');
  const predictions = model.models.map(network => {
    let values=features.map((value,i)=>(value-network.feature_mean[i])/network.feature_scale[i]);
    network.layers.forEach((layer,index)=> {
      values=layer.weight.map((row,j)=> {
        let value=layer.bias[j];
        for (let i=0;i<row.length;i++) value+=row[i]*values[i];
        return index===network.layers.length-1?value:Math.max(0,value);
      });
    });
    return values[0]*network.target_scale+network.target_mean;
  });
  const prediction=predictions.reduce((a,b)=>a+b,0)/predictions.length;
  if (!Number.isFinite(prediction)) throw new Error('The model could not return a valid estimate.');
  return prediction;
}
