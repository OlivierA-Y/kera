import {DEFAULT_STICKER_REFERENCE} from './default-sticker-reference.js';
import {createCaptureTimer} from './capture-timer.js';
import {scaleStickerBoxes} from './sticker-detector.js';
import {PATCHES,readProfile,saveProfile,validateProfile,createProfile,sampleSticker} from './sticker-calibration.js';
import { readCameraAdjustment, saveCameraAdjustment, adjustHemoglobin } from './camera-adjustment.js';
import { createScanHistory } from './scan-history.js';
import { createTorchController } from './torch.js';
import { initializeTouchRegions } from './touch-regions.js';
import { initializeVisualAnalysis } from './visual.js';
import { validateModel, validateBox } from './ml.js';
import { createScanProcessor } from './scan-processor.js';

const $ = id => document.getElementById(id);
const video=$('video'), photo=$('photo'), stage=$('viewfinder');
const context=photo.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
let stickerMode='mlh',stickerProfile=readProfile(DEFAULT_STICKER_REFERENCE);
let detectionWorker=null,detectionTimer=null,detectionVersion=0,detectionBusy=false;
let kinds=['nail','skin','white','mlhM','mlhL','mlhH'];
const labels={nail:'Middle nail',skin:'Nearby skin',white:'White reference',mlhM:'M · Orange/red',mlhL:'L · Blue',mlhH:'H · Yellow'};
const prompts={nail:'Draw around the whole middle fingernail',skin:'Draw on skin between the middle finger’s two joints',white:'Mark a clean white area of the sticker background',mlhM:'Mark a solid orange/red interior of M, avoiding edges',mlhL:'Mark a solid blue interior of L, avoiding edges',mlhH:'Mark a solid yellow interior of H, avoiding edges'};
let model=null, stream=null, cameraRequest=0, facing='environment', mode='empty', active='nail', boxes={}, drag=null, snapshot=null, lastSource='camera';
let loadVersion=0, analysis='hb',hbResultReady=false;
let currentPhotoId=null,photoNumber=0;
function recordPhoto(source,key=null){
  const existing=scanHistory.findByKey(key);if(existing)return existing.scan.id;
  const scan={id:crypto.randomUUID(),number:++photoNumber,state:'draft',result:null,message:'',review:null,origin:key?'upload':'camera'};
  scanHistory.record(scan,source,{},key);return scan.id;
}
const MAX_SCANS=100;
const MAX_PENDING_SCANS=3,MAX_PENDING_BYTES=128*1024*1024;
let scans=[],processor=createScanProcessor(),sessionVersion=0,currentScanId=null,finalizing=false,actionBusy=false,uploadBusy=false,averageController=null;
const visual=initializeVisualAnalysis({getPhoto:()=>snapshot?photo:null,onResult:value=>{if(currentPhotoId)scanHistory.attachReview(currentPhotoId,value);}});
const touchEditor=initializeTouchRegions({getState:()=>({source:photo,boxes,active,kinds,labels,editable:analysis==='hb'&&mode==='photo'&&Boolean(snapshot)&&!currentScanId&&!finalizing&&!actionBusy&&!uploadBusy}),onSave:(kind,box)=>{selectRegion(kind);saveRegion(box);}});
const scanHistory=createScanHistory({root:$('scan-history'),list:$('scan-history-list'),previous:$('previous-saved-photo'),next:$('next-saved-photo'),position:$('saved-photo-position'),deleteButton:$('delete-session-photo'),onDelete:deleteHistoryPhoto,onSelect:restoreHistoryPhoto,onError:error});
function restoreHistoryPhoto(entry,image){
  if(finalizing||actionBusy||uploadBusy)return;
  clearStickerDetection();cameraRequest++;loadVersion++;stopTracks();touchEditor.close();
  photo.width=image.width;photo.height=image.height;context.drawImage(image,0,0);
  snapshot=context.getImageData(0,0,photo.width,photo.height);drag=null;lastSource=entry.scan.origin||'upload';currentScanId=null;
  boxes=structuredClone(entry.boxes);currentPhotoId=entry.scan.id;
  if(analysis==='hb')hbResultReady=false;
  visual.reset(true);setMode('photo');selectRegion(kinds.find(kind=>!boxes[kind])||kinds[0]);updateRegions();findSticker();
  if(analysis==='skin'&&entry.scan.review)visual.restoreReview(entry.scan.review);
  error('');photoNotice(analysis==='hb'?'Saved photo selected. Edit its boxes; finishing replaces this reading rather than adding a duplicate.':'Saved photo selected. Skin & nail shows the original photo without region boxes.');
}

async function deleteHistoryPhoto(id,remaining){
  scans=scans.filter(scan=>scan.id!==id);hbResultReady=false;
  visual.reset(Boolean(snapshot));
  $('prediction-value').textContent='-';$('adjustment-caption').textContent='';$('average-caption').textContent='';
  if(currentPhotoId===id){
    clearStickerDetection();cameraRequest++;loadVersion++;stopTracks();currentPhotoId=null;currentScanId=null;snapshot=null;boxes={};drag=null;
    visual.reset(false);$('box-layer').replaceChildren();context.clearRect(0,0,photo.width,photo.height);setMode('empty');updateRegions();
    const next=remaining.find(entry=>entry.ready&&entry.scan.state!=='pending');if(next)await scanHistory.selectId(next.scan.id);
  }else{
    if(mode==='result')setMode(snapshot?'photo':'empty');
    const review=scanHistory.get(currentPhotoId)?.scan.review;if(analysis==='skin'&&review)visual.restoreReview(review);
  }
  renderSession();photoNotice('Photo deleted from both tabs, including its hemoglobin reading. Finish again to update the session result.');
}

let cameraAdjustment=readCameraAdjustment();
$('camera-adjustment').checked=cameraAdjustment;
$('camera-adjustment').addEventListener('change',()=>{cameraAdjustment=$('camera-adjustment').checked;saveCameraAdjustment(cameraAdjustment);});
const torch=createTorchController({onChange:renderTorch});
const captureTimer=createCaptureTimer({canCapture:canCapturePhoto,onCapture:capturePhoto,onChange:seconds=>{
  $('capture-delay').textContent=seconds?'Cancel timer':'Take photo in 5s';
  $('countdown-number').textContent=seconds||'';show('capture-countdown',seconds>0);
  renderSession();
}});
function canCapturePhoto(){return !document.hidden&&mode==='live'&&video.videoWidth>0&&video.readyState>=2&&stream?.active!==false&&Boolean(stream)&&stream.getVideoTracks().some(track=>track.readyState==='live')&&!torch.state.busy&&!finalizing&&!actionBusy&&!uploadBusy&&!(analysis==='hb'&&activeScanCount()>=MAX_SCANS);}
function capturePhoto(){
  captureTimer.cancel();if(!canCapturePhoto())return;
  try{loadSnapshot(video,video.videoWidth,video.videoHeight,'camera');}catch(e){error(e.message);}
}
$('capture-delay').addEventListener('click',()=>{if(captureTimer.active){captureTimer.cancel();notice('Timer canceled. The camera is still live.');}else captureTimer.start();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)captureTimer.cancel();renderSession();});

function renderTorch(state=torch.state){
  const live=mode==='live',button=$('torch-button');
  button.hidden=!live;button.disabled=!state.supported||state.busy;
  button.setAttribute('aria-pressed',state.supported&&state.on===null?'mixed':String(state.on===true));
  button.textContent=state.busy?'Changing flash…':!state.supported?'Flash unavailable':state.on===null?(state.requested?'Flash: on requested':'Flash: off requested'):state.on?'Flash: on':'Flash: off';
  $('torch-note').textContent=state.message;$('torch-note').hidden=!live||!state.message;
  renderSession();
}
$('torch-button').addEventListener('click',()=>{captureTimer.cancel();void torch.toggle();});
function stopStickerDetection(){detectionVersion++;clearTimeout(detectionTimer);detectionWorker?.terminate();detectionWorker=null;detectionBusy=false;}
function clearStickerDetection(){stopStickerDetection();$('sticker-detection-note').textContent='';}
function findSticker(replace=false){
  if(analysis!=='hb'||stickerMode==='plain'||mode!=='photo'||!snapshot||currentScanId||finalizing)return;
  stopStickerDetection();const version=detectionVersion;
  const done=()=>{clearTimeout(detectionTimer);detectionWorker?.terminate();detectionWorker=null;detectionBusy=false;renderSession();};
  const failed=()=>{if(version!==detectionVersion)return;$('sticker-detection-note').textContent='Automatic detection is unavailable. Mark the four sticker patches manually.';done();};
  detectionBusy=true;$('sticker-detection-note').textContent='Finding the MLH sticker…';renderSession();
  try{
    const scale=Math.min(1,640/Math.max(photo.width,photo.height)),preview=document.createElement('canvas');
    preview.width=Math.max(1,Math.round(photo.width*scale));preview.height=Math.max(1,Math.round(photo.height*scale));
    const ctx=preview.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});ctx.drawImage(photo,0,0,preview.width,preview.height);
    const pixels=ctx.getImageData(0,0,preview.width,preview.height);
    detectionWorker=new Worker(new URL('./sticker-detector-worker.js',import.meta.url),{type:'module',name:'kera-sticker-detector'});
    detectionWorker.onmessage=({data})=>{
      if(version!==detectionVersion)return;
      try{
        if(!data.boxes){$('sticker-detection-note').textContent=data.reason;return;}
        if(!replace&&PATCHES.some(key=>boxes[key])){$('sticker-detection-note').textContent='Your manually marked sticker regions were kept.';return;}
        const suggested=scaleStickerBoxes(data.boxes,preview.width,preview.height,photo.width,photo.height);
        sampleSticker(snapshot,{...boxes,...suggested});
        Object.assign(boxes,suggested);if(currentPhotoId)scanHistory.saveBoxes(currentPhotoId,boxes);
        const saved=scans.find(scan=>scan.id===currentPhotoId);if(saved){saved.state='editing';saved.result=null;hbResultReady=false;}
        $('sticker-detection-note').textContent=data.reason;selectRegion(kinds.find(key=>!boxes[key])||'white');updateRegions();
      }catch(e){$('sticker-detection-note').textContent=`Sticker suggestions could not be used: ${e.message} Mark the four patches manually.`;}
      finally{done();}
    };
    detectionWorker.onerror=failed;detectionWorker.onmessageerror=failed;detectionTimer=setTimeout(failed,10000);
    detectionWorker.postMessage({width:preview.width,height:preview.height,buffer:pixels.data.buffer},[pixels.data.buffer]);
  }catch{failed();}
}
$('sticker-detect').addEventListener('click',()=>findSticker(true));
function renderSticker(){
  const locked=finalizing||actionBusy||uploadBusy||scans.length>0||hbResultReady;
  for(const id of ['sticker-mode','sticker-import','sticker-file'])$(id).disabled=locked;
  $('sticker-export').disabled=!stickerProfile;
  show('sticker-reset',scans.length>0&&!hbResultReady);$('sticker-reset').disabled=finalizing||actionBusy||uploadBusy;
  $('sticker-status').textContent=stickerMode==='reference'?'Capture the sticker with your reference webcam. Review the detected white, M, L and H boxes, or mark them manually, then save.':stickerMode==='plain'?'Original white-reference workflow. No MLH color correction.':stickerProfile?`Reference ready · ${new Date(stickerProfile.createdAt).toLocaleDateString()}. Mark nail and skin, then review the four detected sticker boxes in each photo.`:'A webcam reference is needed. Create one on your webcam, or import its exported JSON file. Scanning stays blocked until it is ready.';
  show('sticker-detection',stickerMode!=='plain'&&mode==='photo');
  $('sticker-detect').disabled=detectionBusy||finalizing||actionBusy||uploadBusy||Boolean(currentScanId);
  show('sticker-save',stickerMode==='reference'&&mode==='photo');
  $('sticker-save').disabled=locked||detectionBusy||!snapshot||!PATCHES.every(key=>boxes[key]);
  $('camera-adjustment').closest('details').hidden=stickerMode!=='plain';
  for(const button of document.querySelectorAll('[data-region]'))button.hidden=!kinds.includes(button.dataset.region);
}
function changeStickerMode(next){
  captureTimer.cancel();clearStickerDetection();touchEditor.close();stickerMode=next;$('sticker-mode').value=next;
  kinds=next==='reference'?[...PATCHES]:next==='mlh'?['nail','skin',...PATCHES]:['nail','skin','white'];
  prompts.white=next==='plain'?'Draw around the plain white reference':'Mark a clean white area of the sticker background';
  boxes={};drag=null;if(currentPhotoId)scanHistory.saveBoxes(currentPhotoId,boxes);selectRegion(kinds[0]);updateRegions();renderAnalysis();findSticker();
}
$('sticker-reset').addEventListener('click',()=>$('new-scan').click());
$('sticker-mode').addEventListener('change',e=>changeStickerMode(e.target.value));
$('sticker-save').addEventListener('click',()=>{
  try{
    const profile=createProfile(snapshot,boxes),stored=saveProfile(profile);stickerProfile=profile;
    snapshot=null;currentPhotoId=null;context.clearRect(0,0,photo.width,photo.height);changeStickerMode('mlh');setMode('empty');
    error('');notice(stored?'Webcam reference saved. Export it to use on your phone. Capture a new photo with your finger and sticker.':'Reference ready for this page only: browser storage is unavailable. Export it before leaving.');
  }catch(e){error(e.message);}
});
$('sticker-export').addEventListener('click',()=>{
  if(!stickerProfile)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(stickerProfile,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='kera-mlh-reference.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('sticker-import').addEventListener('click',()=>$('sticker-file').click());
$('sticker-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  const version=sessionVersion;uploadBusy=true;renderSession();
  try{
    if(file.size>8192)throw Error('Choose a Kera reference JSON file smaller than 8 KB.');
    const profile=validateProfile(JSON.parse(await file.text()));if(version!==sessionVersion)return;
    const stored=saveProfile(profile);stickerProfile=profile;changeStickerMode('mlh');error('');
    notice(stored?'MLH reference imported. Use the same physical sticker for your scans.':'Reference imported for this page. Browser storage is unavailable; keep the reference file.');
  }catch(e){error(e instanceof SyntaxError?'The reference file is not valid JSON.':e.message);}
  finally{uploadBusy=false;e.target.value='';renderSession();}
});
function photoNotice(message){notice(message+' Photos stay in your browser. Optional visual analysis requires permission to send photos.');}
function show(id,yes){$(id).hidden=!yes;}
function error(message){$('error').textContent=message;show('error',Boolean(message));}
function notice(message){$('notice').textContent=message;}
function cameraStatus(text,live=false){$('camera-status').textContent=text;$('camera-status').classList.toggle('is-live',live);}
function stopTracks(){captureTimer.cancel();torch.reset();if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;}
function stopCamera(){cameraRequest++;stopTracks();if(mode==='live')setMode('empty');}
function setMode(next){
  if(next!=='live')captureTimer.cancel();touchEditor.close();mode=next;
  show('empty-state',next==='empty');show('video',next==='live');show('photo',(next==='photo'||next==='result')&&Boolean(snapshot));
  show('session-complete-state',next==='result'&&!snapshot);
  show('frame-note',next==='live');show('drawing-prompt',next==='photo'&&analysis==='hb');
  show('prepare-panel',next==='empty'||next==='live');show('annotate-panel',next==='photo');show('result-panel',next==='result');
  show('capture-delay',next==='empty'||next==='live');show('capture-button',next==='empty'||next==='live');show('retake-button',next==='photo');
  show('switch-camera',next==='live');show('stop-camera',next==='live');
  $('capture-button').disabled=next!=='live'||!video.videoWidth;
  if(next==='empty')cameraStatus('Camera off');
  if(next==='photo'||next==='result')cameraStatus('Photo captured');
  if(next==='live')cameraStatus('Live view',true);
  $('view-heading').textContent=next==='result'?'Last photo':'Your scan';
  photo.style.cursor=next==='photo'&&analysis==='hb'?'crosshair':'default';
  renderAnalysis();
  renderTorch();
  renderSession();
}
function renderAnalysis(){
  const skin=analysis==='skin',hasPhoto=Boolean(snapshot);
  document.body.dataset.analysis=analysis;scanHistory.setMode(analysis);scanHistory.selectCurrent(currentPhotoId);
  show('hb-workflow',!skin);show('visual-analysis',skin);
  show('box-layer',!skin);show('drawing-prompt',!skin&&mode==='photo');
  $('upload-label').textContent=hasPhoto&&lastSource==='upload'?'Replace photo':'Upload a photo';
  $('workflow-label').textContent=skin?'Skin & nail':'Hemoglobin';
  $('workflow-step').textContent=skin?(hasPhoto?'02 / Review':'Capture'):mode==='result'?'03 / Estimate':hasPhoto?'02 / Mark regions':'Capture';
  $('view-heading').textContent=!skin&&mode==='result'?(hasPhoto?'Last photo':'Scan complete'):hasPhoto?'Your photo':'Your camera';
  $('capture-instruction').textContent=skin?'Bring the affected skin or nail into clear, even light.':stickerMode==='reference'?'Keep the entire MLH sticker in view.':stickerMode==='mlh'?'Keep your middle finger and MLH sticker in view.':'Keep your middle finger and a white reference in view.';
  $('frame-note').textContent=skin?'Keep the affected area in focus.':stickerMode==='reference'?'Reference capture: sticker only.':stickerMode==='mlh'?'Keep nail and all sticker colors in view.':'Keep your whole middle nail and white reference in view.';
  const referenceSetup=stickerMode==='reference';
  $('preparation-title').textContent=referenceSetup?'Start with your webcam.':'A little preparation. A better photo.';
  const guidance=referenceSetup?[
    ['Use your reference webcam.','Capture the physical sticker you will also use with your phone.'],
    ['Find even light.','Use diffuse light. Keep the sticker sharp and avoid glare or shadows.'],
    ['Sample solid colors.','Mark white, orange/red M, blue L and yellow H. Keep boxes inside the ink.']
  ]:[['Find even light.','Use diffused, neutral light. Avoid glare and deep shadows.'],[stickerMode==='mlh'?'Include your sticker.':'Make room for white.',stickerMode==='mlh'?'Place the same MLH sticker beside your finger at the same height and in the same light.':'Place plain white paper beside your finger in the same light.'],['Show your middle nail.','Keep the whole nail and nearby skin visible, without nail polish.']];
  $('preparation-guidance').replaceChildren(...guidance.map(([title,copy])=>{const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=title;p.append(strong,document.createElement('br'),copy);return p;}));
  $('preparation-next').textContent=referenceSetup?'Save and export the reference, then import it on your phone.':`After capture, mark ${kinds.length} regions. Each photo needs its own marks.`;
  $('skin-instruction').textContent=hasPhoto?'Visible changes to discuss with a clinician.':'Capture a close-up of the area you want to review.';
  photo.setAttribute('aria-label',skin?'Captured skin or nail photo.':'Captured photo. Mark regions using the region controls, or enter coordinates.');
  photo.style.cursor=!skin&&mode==='photo'&&!currentScanId&&!finalizing?'crosshair':'default';
  for(const [id,value] of [['tab-hb','hb'],['tab-skin','skin']]){
    $(id).setAttribute('aria-selected',String(analysis===value));$(id).tabIndex=analysis===value?0:-1;
  }
}
function selectAnalysis(next){
  if(next===analysis||finalizing||actionBusy||uploadBusy)return;
  captureTimer.cancel();visual.deactivate();
  touchEditor.close();analysis=next;drag=null;if(next==='skin')stopStickerDetection();
  if(snapshot&&currentPhotoId)boxes=structuredClone(scanHistory.get(currentPhotoId)?.boxes||{});
  updateRegions();
  if(next==='hb'&&hbResultReady){cameraRequest++;stopTracks();setMode('result');}
  else if(next==='skin'&&mode==='result')setMode(snapshot?'photo':'empty');
  else{renderAnalysis();renderSession();}
  if(next==='hb'&&snapshot&&!PATCHES.some(key=>boxes[key]))findSticker();
  const review=scanHistory.get(currentPhotoId)?.scan.review;if(next==='skin'&&review)visual.restoreReview(review);
  notice(snapshot?(next==='skin'?'Select a saved photo or continue to preview and consent.':'Hemoglobin uses the selected sticker or white-reference workflow. Mark every required region.'):(next==='skin'?'Take or upload a close-up. Nothing is sent without your permission.':'Capture your middle nail, nearby skin and a white reference. Estimation stays on this device.'));
}
for(const [id,value] of [['tab-hb','hb'],['tab-skin','skin']]){
  $(id).addEventListener('click',()=>selectAnalysis(value));
  $(id).addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?'hb':event.key==='End'?'skin':analysis==='skin'?'hb':'skin';selectAnalysis(next);$(next==='skin'?'tab-skin':'tab-hb').focus();
  });
}
async function startCamera(){
  if(finalizing||(analysis==='hb'&&mode==='result'))return;
  loadVersion++;uploadBusy=false;
  if(!navigator.mediaDevices?.getUserMedia){error('Camera access needs HTTPS or localhost and a supported browser. You can also upload a photo.');return;}
  clearStickerDetection();const request=++cameraRequest;
  stopTracks();error('');$('start-camera').disabled=true;$('start-camera').lastChild.textContent=' Opening camera…';cameraStatus('Opening camera…');
  try{
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:960}}});
    if(request!==cameraRequest){media.getTracks().forEach(track=>track.stop());return;}
    stream=media;video.srcObject=media;await video.play();
    if(request!==cameraRequest)return;
    if(!video.videoWidth)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
    snapshot=null;boxes={};currentScanId=null;visual.reset(false);$('box-layer').replaceChildren();setMode('live');updateRegions();photoNotice(analysis==='skin'?'Keep the affected skin or nail in focus.':'Keep your whole middle nail, skin between its two joints, and a white reference in the frame.');
    const track=media.getVideoTracks()[0];void torch.attach(track);track.addEventListener('ended',()=>{if(mode==='live'){stopCamera();error('The camera disconnected. Reconnect it or upload a photo.');}});
  }catch(e){
    if(request!==cameraRequest)return;
    stopTracks();setMode('empty');
    const messages={NotAllowedError:'Camera permission was declined. Allow camera access in your browser, or upload a photo.',NotFoundError:'No camera was found. Connect a webcam or upload a photo.',NotReadableError:'The camera is in use or could not be opened. Close other camera apps and try again.',OverconstrainedError:'This camera does not support the requested settings. Try another camera or upload a photo.'};
    error(messages[e.name]||'The camera could not start. Check your browser permissions, or upload a photo.');
  }finally{
    if(request===cameraRequest){$('start-camera').disabled=false;$('start-camera').lastChild.textContent='Turn on camera';}
  }
}
function loadSnapshot(source,width,height,origin,key=null){
  if(finalizing||(analysis==='hb'&&mode==='result'))return;
  if(!width||!height)throw new Error('This photo could not be read. Try a JPEG or PNG image.');
  if(width*height>24000000)throw new Error('This photo is too large. Use a photo under 24 megapixels.');
  clearStickerDetection();photo.width=width;photo.height=height;context.drawImage(source,0,0,width,height);
  snapshot=context.getImageData(0,0,width,height);cameraRequest++;stopTracks();
  boxes={};currentScanId=null;currentPhotoId=null;lastSource=origin;visual.reset(true);setMode('photo');selectRegion(kinds[0]);updateRegions();error('');
  currentPhotoId=recordPhoto(photo,key);if(scanHistory.get(currentPhotoId).scan.state==='pending')currentScanId=currentPhotoId;boxes=structuredClone(scanHistory.get(currentPhotoId).boxes);selectRegion(kinds.find(kind=>!boxes[kind])||kinds[0]);updateRegions();renderAnalysis();
  findSticker();
  if(analysis==='skin'&&scanHistory.get(currentPhotoId).scan.review)visual.restoreReview(scanHistory.get(currentPhotoId).scan.review);
  photoNotice(analysis==='skin'?'Photo selected. Continue to preview and consent.':stickerMode==='reference'?'Photo captured. Review the detected sticker boxes, then save your webcam reference.':`Photo captured. Mark all ${kinds.length} regions to add this hemoglobin reading.`);
}
$('start-camera').addEventListener('click',startCamera);
$('capture-button').addEventListener('click',capturePhoto);
$('stop-camera').addEventListener('click',()=>{stopCamera();photoNotice('Camera stopped.');});
$('switch-camera').addEventListener('click',async()=>{
  $('switch-camera').disabled=true;facing=facing==='user'?'environment':'user';
  try{await startCamera();}finally{$('switch-camera').disabled=false;}
});
$('upload-button').addEventListener('click',()=>{captureTimer.cancel();$('file-input').click();});
$('file-input').addEventListener('change',async event=>{
  if(finalizing||actionBusy||(analysis==='hb'&&mode==='result')){event.target.value='';return;}
  const file=event.target.files[0];if(!file)return;
  const version=++loadVersion;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){error('Choose a JPEG, PNG, or WebP photo.');event.target.value='';return;}
  if(file.size>30000000){error('Choose a photo under 30 MB.');event.target.value='';return;}
  uploadBusy=true;renderSession();
  try{
    const bitmap=await createImageBitmap(file);
    try{
      const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
      if(version===loadVersion)loadSnapshot(bitmap,bitmap.width,bitmap.height,'upload',key);
    }finally{bitmap.close();}
  }catch(e){error(e.message||'This image could not be opened. Try another JPEG or PNG.');}
  finally{if(version===loadVersion){uploadBusy=false;renderSession();event.target.value='';}}
});
async function retake(){
  if(finalizing)return;
  clearStickerDetection();loadVersion++;uploadBusy=false;currentScanId=null;currentPhotoId=null;
  error('');snapshot=null;boxes={};drag=null;visual.reset(false);$('box-layer').replaceChildren();context.clearRect(0,0,photo.width,photo.height);setMode('empty');
  updateRegions();
  if(analysis==='hb'&&activeScanCount()>=MAX_SCANS){notice('This session has reached 100 photos. Choose Finish & see result.');return;}
  if(lastSource==='camera'){
    await startCamera();if(mode==='live')$('capture-button').focus({preventScroll:true});
  }else{notice('Upload another photo, or turn on your camera.');$('upload-button').focus({preventScroll:true});}
  if(window.innerWidth<740)document.querySelector('.camera-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
$('retake-button').addEventListener('click',retake);
$('new-scan').addEventListener('click',async()=>{
  scanHistory.resetReadings();currentPhotoId=null;hbResultReady=false;sessionVersion++;averageController?.abort();averageController=null;processor.close();processor=createScanProcessor();scans=[];currentScanId=null;
  $('prediction-value').textContent='—';$('adjustment-caption').textContent='';$('average-caption').textContent='';$('quality-warnings').replaceChildren();show('quality-warnings',false);
  setMode('empty');await retake();
});
function displayGeometry(){
  const r=stage.getBoundingClientRect(), scale=Math.min(r.width/photo.width,r.height/photo.height);
  return{scale,width:photo.width*scale,height:photo.height*scale,x:(r.width-photo.width*scale)/2,y:(r.height-photo.height*scale)/2,rect:r};
}
function point(event,clamp=false){
  const g=displayGeometry();let x=(event.clientX-g.rect.left-g.x)/g.scale,y=(event.clientY-g.rect.top-g.y)/g.scale;
  if(!clamp&&(x<0||y<0||x>photo.width||y>photo.height))return null;
  return{x:Math.max(0,Math.min(photo.width,x)),y:Math.max(0,Math.min(photo.height,y))};
}
function selection(a,b){return[Math.floor(Math.min(a.y,b.y)),Math.floor(Math.min(a.x,b.x)),Math.ceil(Math.max(a.y,b.y)),Math.ceil(Math.max(a.x,b.x))];}
function drawBoxes(preview=null){
  const g=displayGeometry();$('box-layer').replaceChildren();
  for(const kind of kinds){
    const box=preview&&active===kind?preview:boxes[kind];if(!box)continue;
    const node=document.createElement('div');node.dataset.stickerPatch=String(stickerMode!=='plain'&&PATCHES.includes(kind));node.className=`selection-box${active===kind&&mode==='photo'?' is-active':''}`;
    const top=g.y+box[0]*g.scale;
    Object.assign(node.style,{left:`${g.x+box[1]*g.scale}px`,top:`${top}px`,width:`${(box[3]-box[1])*g.scale}px`,height:`${(box[2]-box[0])*g.scale}px`});
    const label=document.createElement('span');label.textContent=labels[kind];if(top<28)label.style.top='2px';node.append(label);$('box-layer').append(node);
  }
}
function selectRegion(kind){
  active=kind;$('drawing-prompt').textContent=prompts[kind];
  for(const button of document.querySelectorAll('[data-region]'))button.setAttribute('aria-pressed',String(button.dataset.region===kind));
  const b=boxes[kind];
  for(const [id,value] of Object.entries({left:b?.[1]??'',top:b?.[0]??'',width:b?b[3]-b[1]:'',height:b?b[2]-b[0]:''}))$('coord-'+id).value=value;
  drawBoxes();
}
function updateRegions(){
  const count=kinds.filter(kind=>boxes[kind]).length;
  for(const button of document.querySelectorAll('[data-region]')){
    const marked=Boolean(boxes[button.dataset.region]);button.classList.toggle('is-marked',marked);
    button.setAttribute('aria-label',`${labels[button.dataset.region]}${marked?', marked. Select to redraw.':', not marked.'}`);
  }
  $('region-count').textContent=count===kinds.length?'All required regions marked. Ready when you are.':`${count} of ${kinds.length} regions marked.`;
  renderSession();
}
function saveRegion(box){
  if(analysis!=='hb')return;
  if(finalizing||currentScanId)throw new Error('This photo has already been added. Choose Add another photo to continue, or Finish & see result.');
  validateBox(box,photo.width,photo.height);
  if(box[3]-box[1]<3||box[2]-box[0]<3)throw new Error('Draw a slightly larger box, at least 3 pixels wide and high.');
  boxes[active]=box;scanHistory.saveBoxes(currentPhotoId,boxes);
  const saved=scans.find(scan=>scan.id===currentPhotoId);if(saved){saved.state='editing';saved.result=null;hbResultReady=false;}
  error('');updateRegions();
  const next=kinds.find(kind=>!boxes[kind]);selectRegion(next||active);
}
for(const button of document.querySelectorAll('[data-region]'))button.addEventListener('click',()=>selectRegion(button.dataset.region));
photo.addEventListener('pointerdown',event=>{
  if(mode!=='photo'||analysis!=='hb'||event.button!==0||finalizing||currentScanId)return;const p=point(event);if(!p)return;
  event.preventDefault();drag={start:p,id:event.pointerId};photo.setPointerCapture(event.pointerId);
});
photo.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;event.preventDefault();drawBoxes(selection(drag.start,point(event,true)));
});
photo.addEventListener('pointerup',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  const box=selection(drag.start,point(event,true));drag=null;if(photo.hasPointerCapture(event.pointerId))photo.releasePointerCapture(event.pointerId);
  try{saveRegion(box);}catch(e){error(e.message);drawBoxes();}
});
photo.addEventListener('pointercancel',()=>{drag=null;drawBoxes();});
$('coordinate-form').addEventListener('submit',event=>{
  event.preventDefault();const left=Number($('coord-left').value),top=Number($('coord-top').value),width=Number($('coord-width').value),height=Number($('coord-height').value);
  try{saveRegion([top,left,top+height,left+width]);}catch(e){error(e.message);}
});
new ResizeObserver(()=>{if(snapshot)drawBoxes();}).observe(stage);
function currentReady(){return analysis==='hb'&&!detectionBusy&&stickerMode!=='reference'&&(stickerMode!=='mlh'||Boolean(stickerProfile))&&mode==='photo'&&snapshot&&model&&kinds.every(kind=>boxes[kind])&&!currentScanId;}
function activeScanCount(){return scans.filter(scan=>scan.state!=='failed').length;}
function hasWorkerCapacity(){const pending=scans.filter(scan=>scan.state==='pending');return pending.length<MAX_PENDING_SCANS&&pending.reduce((sum,scan)=>sum+scan.bytes,0)+(snapshot?.data.byteLength||0)<=MAX_PENDING_BYTES;}
function renderSession(){
  scanHistory.update();
  const pending=scans.filter(scan=>scan.state==='pending').length;
  const included=scans.filter(scan=>scan.state==='complete').length;
  const failed=scans.filter(scan=>scan.state==='failed');
  const hb=analysis==='hb';
  const regionsMarked=hb&&stickerMode!=='reference'&&mode==='photo'&&kinds.every(kind=>boxes[kind]);
  show('scan-session',hb&&scans.length>0&&mode!=='result');
  show('session-actions',hb&&mode!=='result'&&(regionsMarked||scans.length>0));
  show('continue-scan',regionsMarked);
  for(const guidance of document.querySelectorAll('.other-hand-tip,.averaging-note'))guidance.hidden=!regionsMarked;
  $('session-count').textContent=`${scans.length} ${scans.length===1?'photo added':'photos added'}`;
  $('session-progress').textContent=finalizing?(pending?`Finishing your scan. Waiting for ${pending} ${pending===1?'photo':'photos'}…`:'Calculating your average…'):
    pending?`Processing ${pending} ${pending===1?'photo':'photos'} in the background. You can continue scanning.`:
    included?`${included} ${included===1?'reading is':'readings are'} ready. Choose Finish & see result for your result.`:'Take another photo to continue.';
  const failures=$('session-failures');failures.replaceChildren();
  for(const scan of failed){const li=document.createElement('li');li.textContent=`Photo ${scan.number} was not included: ${scan.message}`;failures.append(li);}
  show('session-failures',failed.length>0);
  const blocked=finalizing||actionBusy||uploadBusy||detectionBusy;
  renderSticker();
  $('camera-adjustment').disabled=blocked||hbResultReady;
  scanHistory.setBusy(blocked);
  $('touch-editor-button').disabled=blocked||Boolean(currentScanId)||!snapshot;
  const dockVisible=scanDockMedia.matches&&hb&&mode!=='result'&&(regionsMarked||scans.length>0);
  show('mobile-scan-dock',dockVisible);document.body.classList.toggle('has-scan-dock',Boolean(dockVisible));
  $('mobile-scan-note').textContent=finalizing?'Finishing your scan…':pending?`Processing ${pending} photo${pending===1?'':'s'}…`:regionsMarked?'Ready to add this photo':`${included} reading${included===1?'':'s'} ready`;

  const full=hb&&activeScanCount()>=MAX_SCANS,waitingForCapacity=currentReady()&&!full&&!hasWorkerCapacity();
  $('predict-button').disabled=blocked||(!currentReady()&&pending+included===0);
  $('continue-scan').disabled=blocked||(!currentReady()&&!currentScanId)||full||waitingForCapacity;
  $('session-action-note').textContent=finalizing?'Please wait. Your photos are still being processed.':
    full?'This session has reached 100 photos. Choose Finish & see result.':
    waitingForCapacity?'Photos are still processing. Finish & see result will wait and include this photo.':
    currentScanId?'This photo has been added. You can continue or try ending the scan again.':
    currentReady()?'Both buttons include this photo. Add another photo continues capturing; Finish & see result shows the average.':
    scans.length?'End now uses the photos already added. Finish marking this photo to include it.':'Mark every required region, then choose a button below.';
  for(const id of ['tab-hb','tab-skin'])$(id).disabled=blocked;
  for(const button of document.querySelectorAll('[data-region]'))button.disabled=blocked||Boolean(currentScanId);
  for(const input of $('coordinate-form').elements)input.disabled=blocked||Boolean(currentScanId);
  $('upload-button').disabled=blocked||(hb&&mode==='result')||full;$('file-input').disabled=blocked||(hb&&mode==='result')||full;
  $('retake-button').disabled=blocked||full;$('start-camera').disabled=blocked||full;
  $('capture-button').disabled=blocked||full||!canCapturePhoto();
  $('capture-delay').disabled=!captureTimer.active&&(blocked||full||!canCapturePhoto());
  $('switch-camera').disabled=blocked;
  photo.style.cursor=hb&&mode==='photo'&&!currentScanId&&!blocked?'crosshair':'default';
}
function addCurrentScan(){
  if(currentScanId)return;
  if(!currentReady())throw new Error('Mark every required region and load a reference before adding this photo.');
  if(activeScanCount()>=MAX_SCANS&&!scans.some(scan=>scan.id===currentPhotoId))throw new Error('This session has reached 100 photos. Choose Finish & see result.');
  if(!hasWorkerCapacity())throw new Error('Please wait for a photo to finish processing, then try again.');
  for(let a=0;a<kinds.length;a++)for(let b=a+1;b<kinds.length;b++){
    const x=boxes[kinds[a]],y=boxes[kinds[b]];
    if(Math.max(x[0],y[0])<Math.min(x[2],y[2])&&Math.max(x[1],y[1])<Math.min(x[3],y[3]))throw new Error('Keep every region box separate. Adjust overlapping boxes first.');
  }
  const version=sessionVersion;
  const scan=scanHistory.get(currentPhotoId)?.scan;
  if(!scan)throw new Error('Select or capture a photo before adding a reading.');
  Object.assign(scan,{state:'pending',bytes:snapshot.data.byteLength,result:null,message:''});
  currentScanId=scan.id;if(!scans.includes(scan))scans.push(scan);
  scanHistory.saveBoxes(scan.id,boxes);
  scan.promise=processor.process({id:scan.id,model,image:snapshot,boxes:structuredClone(boxes),calibration:stickerMode==='mlh'?structuredClone(stickerProfile):null}).then(result=>{
    if(version!==sessionVersion)return;
    scan.state='complete';scan.result=result;renderSession();
  }).catch(e=>{
    if(version!==sessionVersion)return;
    scan.state='failed';scan.message=e.message||'This photo could not be read. Please retake it.';
    if(currentScanId===scan.id)currentScanId=null;
    renderSession();
  });
  renderSession();
}
$('continue-scan').addEventListener('click',async()=>{
  if(analysis!=='hb'||finalizing||actionBusy||(!currentReady()&&!currentScanId))return;
  const version=sessionVersion;
  actionBusy=true;error('');
  try{addCurrentScan();await retake();photoNotice('Photo added. Take or upload your next photo, or choose Finish & see result.');}
  catch(e){error(e.message);}
  finally{if(version===sessionVersion){actionBusy=false;renderSession();(activeScanCount()>=MAX_SCANS?$('predict-button'):mode==='live'?$('capture-button'):$('upload-button')).focus({preventScroll:true});}}
});
$('predict-button').addEventListener('click',async()=>{
  if(analysis!=='hb'||finalizing||actionBusy)return;
  error('');
  if(!currentReady()&&!scans.some(scan=>scan.state==='pending'||scan.state==='complete'))return;
  const version=sessionVersion,adjustmentEnabled=stickerMode==='plain'&&cameraAdjustment;finalizing=true;loadVersion++;cameraRequest++;stopTracks();
  if(mode==='live')setMode('empty');renderSession();
  try{
    if(currentReady()&&(activeScanCount()<MAX_SCANS||scans.some(scan=>scan.id===currentPhotoId))){
      while(!hasWorkerCapacity()){
        await Promise.race(scans.filter(scan=>scan.state==='pending').map(scan=>scan.promise));
        if(version!==sessionVersion)return;
      }
      addCurrentScan();
    }
    await Promise.all(scans.map(scan=>scan.promise));
    if(version!==sessionVersion)return;
    if(scans.some(scan=>scan.state==='editing'))throw new Error('An earlier photo has edited boxes. Select it and choose Finish & see result to recalculate it first.');
    const readings=scans.filter(scan=>scan.state==='complete').map(scan=>scan.result);
    if(!readings.length)throw new Error('No photos could be read. Please retake a clear photo and mark every required region.');
    averageController=new AbortController();const timer=setTimeout(()=>averageController?.abort(),15000);
    let response;
    try{response=await fetch('./api/scans/average',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readings}),signal:averageController.signal});}
    catch{throw new Error('Your readings are still here. Make sure the local Kera server is running, then choose Finish & see result again.');}
    finally{clearTimeout(timer);averageController=null;}
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(result?.error?.message||'The average could not be calculated. Choose Finish & see result to try again.');
    if(!result||!Number.isFinite(result.hemoglobin_g_per_l)||result.scan_count!==readings.length||!Array.isArray(result.warnings))throw new Error('The average response could not be read. Choose Finish & see result to try again.');
    if(version!==sessionVersion)return;
    hbResultReady=true;
    const adjusted=adjustHemoglobin(result.hemoglobin_g_per_l,adjustmentEnabled);
    $('prediction-value').textContent=adjusted.value.toFixed(1);
    $('result-caption').textContent=stickerMode==='mlh'?'Color-corrected average estimate':adjustmentEnabled?'Camera-adjusted average estimate':'Average estimated hemoglobin';
    $('adjustment-caption').textContent=adjustmentEnabled?`Raw model average: ${adjusted.raw.toFixed(1)} g/L.`:'';
    const failed=scans.filter(scan=>scan.state==='failed').length;
    $('average-caption').textContent=`Based on ${result.scan_count} ${result.scan_count===1?'reading':'readings'}.${failed?` ${failed} ${failed===1?'photo could':'photos could'} not be read and ${failed===1?'was':'were'} left out.`:''}`;
    const warningArea=$('quality-warnings');warningArea.replaceChildren();
    if(result.warnings.length||failed){
      const title=document.createElement('strong');title.textContent='Photo quality notes';const list=document.createElement('ul');
      for(const warning of result.warnings){const li=document.createElement('li');li.textContent=warning;list.append(li);}
      for(const scan of scans.filter(scan=>scan.state==='failed')){const li=document.createElement('li');li.textContent=`Photo ${scan.number} was not included: ${scan.message}`;list.append(li);}
      warningArea.append(title,list);
    }
    show('quality-warnings',result.warnings.length>0||failed>0);
    if(!currentScanId){snapshot=null;boxes={};visual.reset(false);$('box-layer').replaceChildren();context.clearRect(0,0,photo.width,photo.height);}
    setMode('result');drawBoxes();photoNotice('Your scan is complete. The local Kera server calculated one average from your readings.');
    $('result-panel').setAttribute('tabindex','-1');$('result-panel').focus({preventScroll:true});
    if(window.innerWidth<740)$('result-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }catch(e){error(e.message);}
  finally{if(version===sessionVersion){finalizing=false;renderSession();}}
});
const regionHelp=$('region-help-dialog');
let guideTrigger=$('guide-button');
for(const id of ['region-help-button','guide-button'])$(id).addEventListener('click',()=>{guideTrigger=$(id);show('guide-skin',analysis==='skin');show('guide-hb',analysis==='hb');$('region-help-title').textContent=analysis==='skin'?'Skin & nail guide':'Photo and region guide';regionHelp.showModal();$('region-help-title').focus();});
for(const button of document.querySelectorAll('[data-close-region-help]'))button.addEventListener('click',()=>regionHelp.close());
regionHelp.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const [first,last]=regionHelp.querySelectorAll('[data-close-region-help]');
  if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  else if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('region-help-title'))){event.preventDefault();last.focus();}
});
regionHelp.addEventListener('close',()=>guideTrigger.focus({preventScroll:true}));
regionHelp.addEventListener('click',event=>{
  if(event.target!==regionHelp)return;
  const r=regionHelp.getBoundingClientRect();
  if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)regionHelp.close();
});
for(const id of ['about-button','footer-about'])$(id).addEventListener('click',()=>$('model-dialog').showModal());
for(const button of document.querySelectorAll('.close-dialog'))button.addEventListener('click',()=>$('model-dialog').close());
$('model-dialog').addEventListener('click',event=>{if(event.target===$('model-dialog')){const r=$('model-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('model-dialog').close();}});
window.addEventListener('pagehide',()=>{stopStickerDetection();scanHistory.clear();sessionVersion++;cameraRequest++;loadVersion++;averageController?.abort();processor.close();scans=[];stopTracks();snapshot=null;context.clearRect(0,0,photo.width,photo.height);});
window.addEventListener('pageshow',event=>{if(event.persisted){hbResultReady=false;processor=createScanProcessor();currentScanId=null;boxes={};finalizing=false;actionBusy=false;uploadBusy=false;visual.reset(false);$('prediction-value').textContent='—';setMode('empty');updateRegions();}});
async function loadModel(){
  try{const response=await fetch(new URL('./assets/model.json',import.meta.url));if(!response.ok)throw new Error('Model download failed');model=validateModel(await response.json());$('model-note').textContent='Trained neural network. Runs on your device.';updateRegions();}
  catch(e){$('model-note').textContent='The trained model could not load. Reload the page to try again.';error('The trained model could not load. Check your connection and reload the app.');}
}
const scanDockMedia=matchMedia('(max-width: 740px)');
function mountScanActions(){(scanDockMedia.matches?$('mobile-scan-dock'):$('session-button-slot')).append($('session-buttons'));renderSession();}
scanDockMedia.addEventListener('change',mountScanActions);
new ResizeObserver(()=>document.documentElement.style.setProperty('--scan-dock-height',$('mobile-scan-dock').getBoundingClientRect().height+'px')).observe($('mobile-scan-dock'));
mountScanActions();
setMode('empty');notice('Capture your middle nail, nearby skin and MLH sticker. Estimation stays on this device.');loadModel();

