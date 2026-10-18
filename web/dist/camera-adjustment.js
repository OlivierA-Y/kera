// One user-reported camera comparison; separate from the trained model and raw readings.
const KEY='kera.phone-webcam-adjustment.v1';
export const PHONE_OFFSET_G_PER_L=-15;
export const DEMO_OUTPUT_OFFSET_G_PER_L=15;
export function readCameraAdjustment({storage,userAgent=globalThis.navigator?.userAgent||'',mobile=globalThis.navigator?.userAgentData?.mobile}={}){
  try{const stored=(storage??globalThis.localStorage)?.getItem(KEY);if(stored==='on'||stored==='off')return stored==='on';}catch{}
  return mobile===true||/iPhone|iPod|Android.*Mobile/i.test(userAgent);
}
export function saveCameraAdjustment(enabled,storage){
  try{(storage??globalThis.localStorage)?.setItem(KEY,enabled?'on':'off');}catch{}
}
export function adjustHemoglobin(raw,enabled=false){
  if(typeof raw!=='number'||!Number.isFinite(raw))throw new Error('The raw hemoglobin average must be finite.');
  const offset=enabled?PHONE_OFFSET_G_PER_L:0;
  // Do not clamp or force a target: future readings retain their variation.
  return {raw,offset,value:raw+offset};
}
