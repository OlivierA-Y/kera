import { readCameraAdjustment, saveCameraAdjustment, adjustHemoglobin } from './camera-adjustment.js';
import { createTorchController } from './torch.js';
import { initializeTouchRegions } from './touch-regions.js';
import { initializeVisualAnalysis } from './visual.js';
import { validateModel, validateBox } from './ml.js';
import { createScanProcessor } from './scan-processor.js';

const $ = id => document.getElementById(id);
const video=$('video'), photo=$('photo'), stage=$('viewfinder');
const context=photo.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
const kinds=['nail','skin','white'];
const labels={nail:'Middle nail',skin:'Nearby skin',white:'White reference'};
const prompts={nail:'Draw around the whole middle fingernail',skin:'Draw on skin between the middle finger’s two joints',white:'Draw around the plain white reference'};
let model=null, stream=null, cameraRequest=0, facing='environment', mode='empty', active='nail', boxes={}, drag=null, snapshot=null, lastSource='camera';
let loadVersion=0, analysis='skin',hbResultReady=false;
const MAX_SCANS=100;
const MAX_PENDING_SCANS=3,MAX_PENDING_BYTES=128*1024*1024;
let scans=[],processor=createScanProcessor(),sessionVersion=0,currentScanId=null,finalizing=false,actionBusy=false,uploadBusy=false,averageController=null;
const visual=initializeVisualAnalysis({getPhoto:()=>snapshot?photo:null});
const touchEditor=initializeTouchRegions({getState:()=>({source:photo,boxes,active,editable:analysis==='hb'&&mode==='photo'&&Boolean(snapshot)&&!currentScanId&&!finalizing&&!actionBusy&&!uploadBusy}),onSave:(kind,box)=>{selectRegion(kind);saveRegion(box);}});
let cameraAdjustment=readCameraAdjustment();
$('camera-adjustment').checked=cameraAdjustment;
$('camera-adjustment').addEventListener('change',()=>{cameraAdjustment=$('camera-adjustment').checked;saveCameraAdjustment(cameraAdjustment);});
const torch=createTorchController({onChange:renderTorch});
function renderTorch(state=torch.state){
  const live=mode==='live',button=$('torch-button');
  button.hidden=!live;button.disabled=!state.supported||state.busy;
  button.setAttribute('aria-pressed',state.supported&&state.on===null?'mixed':String(state.on===true));
  button.textContent=state.busy?'Changing flash…':!state.supported?'Flash unavailable':state.on===null?(state.requested?'Flash: on requested':'Flash: off requested'):state.on?'Flash: on':'Flash: off';
  $('torch-note').textContent=state.message;$('torch-note').hidden=!live||!state.message;
  renderSession();
}
$('torch-button').addEventListener('click',()=>torch.toggle());
function photoNotice(message){notice(message+' Photos stay in your browser. Optional visual analysis requires permission to send photos.');}
function show(id,yes){$(id).hidden=!yes;}
function error(message){$('error').textContent=message;show('error',Boolean(message));}
function notice(message){$('notice').textContent=message;}
function cameraStatus(text,live=false){$('camera-status').textContent=text;$('camera-status').classList.toggle('is-live',live);}
function stopTracks(){torch.reset();if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;}
function stopCamera(){cameraRequest++;stopTracks();if(mode==='live')setMode('empty');}
function setMode(next){
  touchEditor.close();mode=next;
  show('empty-state',next==='empty');show('video',next==='live');show('photo',(next==='photo'||next==='result')&&Boolean(snapshot));
  show('session-complete-state',next==='result'&&!snapshot);
  show('frame-note',next==='live');show('drawing-prompt',next==='photo'&&analysis==='hb');
  show('prepare-panel',next==='empty'||next==='live');show('annotate-panel',next==='photo');show('result-panel',next==='result');
  show('capture-button',next==='empty'||next==='live');show('retake-button',next==='photo');
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
  document.body.dataset.analysis=analysis;
  show('hb-workflow',!skin);show('visual-analysis',skin);
  show('box-layer',!skin);show('drawing-prompt',!skin&&mode==='photo');
  show('add-angle',skin&&hasPhoto);
  $('workflow-label').textContent=skin?'Skin & nail':'Hemoglobin';
  $('workflow-step').textContent=skin?(hasPhoto?'02 / Review':'01 / Capture'):mode==='result'?'03 / Estimate':hasPhoto?'02 / Mark regions':'01 / Capture';
  $('view-heading').textContent=!skin&&mode==='result'?(hasPhoto?'Last photo':'Scan complete'):hasPhoto?'Your photo':'Your camera';
  $('capture-instruction').textContent=skin?'Bring the affected skin or nail into clear, even light.':'Keep your middle finger and a white reference in view.';
  $('frame-note').textContent=skin?'Keep the affected area in focus.':'Keep your whole middle nail and white reference in view.';
  $('skin-instruction').textContent=hasPhoto?'Visible changes to discuss with a clinician.':'Capture a close-up of the area you want to review.';
  photo.setAttribute('aria-label',skin?'Captured skin or nail photo.':'Captured photo. Mark regions using the region controls, or enter coordinates.');
  photo.style.cursor=!skin&&mode==='photo'&&!currentScanId&&!finalizing?'crosshair':'default';
  for(const [id,value] of [['tab-hb','hb'],['tab-skin','skin']]){
    $(id).setAttribute('aria-selected',String(analysis===value));$(id).tabIndex=analysis===value?0:-1;
  }
}
function selectAnalysis(next){
  if(next===analysis||finalizing||actionBusy||uploadBusy)return;
  visual.deactivate();
  touchEditor.close();analysis=next;drag=null;
  if(next==='hb'&&hbResultReady){cameraRequest++;stopTracks();setMode('result');}
  else if(next==='skin'&&mode==='result')setMode(snapshot?'photo':'empty');
  else{renderAnalysis();renderSession();}
  notice(snapshot?(next==='skin'?'Add another angle if useful, then continue to preview and consent.':'Hemoglobin requires the middle nail, nearby skin and white reference in the same photo.'):(next==='skin'?'Take or upload a close-up. Nothing is sent without your permission.':'Capture your middle nail, nearby skin and a white reference. Estimation stays on this device.'));
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
  const request=++cameraRequest;
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
function loadSnapshot(source,width,height,origin){
  if(finalizing||(analysis==='hb'&&mode==='result'))return;
  if(!width||!height)throw new Error('This photo could not be read. Try a JPEG or PNG image.');
  if(width*height>24000000)throw new Error('This photo is too large. Use a photo under 24 megapixels.');
  photo.width=width;photo.height=height;context.drawImage(source,0,0,width,height);
  snapshot=context.getImageData(0,0,width,height);cameraRequest++;stopTracks();
  boxes={};currentScanId=null;lastSource=origin;visual.reset(true);setMode('photo');selectRegion('nail');updateRegions();error('');
  photoNotice(analysis==='skin'?'Photo captured. Add another angle if useful, then continue.':'Photo captured. Mark the three regions to add this hemoglobin reading.');
}
$('start-camera').addEventListener('click',startCamera);
$('capture-button').addEventListener('click',()=>{
  if(mode!=='live'||!video.videoWidth)return;
  try{loadSnapshot(video,video.videoWidth,video.videoHeight,'camera');}catch(e){error(e.message);}
});
$('stop-camera').addEventListener('click',()=>{stopCamera();photoNotice('Camera stopped.');});
$('switch-camera').addEventListener('click',async()=>{
  $('switch-camera').disabled=true;facing=facing==='user'?'environment':'user';
  try{await startCamera();}finally{$('switch-camera').disabled=false;}
});
$('upload-button').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async event=>{
  if(finalizing||actionBusy||(analysis==='hb'&&mode==='result')){event.target.value='';return;}
  const file=event.target.files[0];if(!file)return;
  const version=++loadVersion;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){error('Choose a JPEG, PNG, or WebP photo.');event.target.value='';return;}
  if(file.size>30000000){error('Choose a photo under 30 MB.');event.target.value='';return;}
  uploadBusy=true;renderSession();
  try{
    const bitmap=await createImageBitmap(file);
    try{if(version===loadVersion)loadSnapshot(bitmap,bitmap.width,bitmap.height,'upload');}finally{bitmap.close();}
  }catch(e){error(e.message||'This image could not be opened. Try another JPEG or PNG.');}
  finally{if(version===loadVersion){uploadBusy=false;renderSession();event.target.value='';}}
});
async function retake(){
  if(finalizing)return;
  loadVersion++;uploadBusy=false;currentScanId=null;
  error('');snapshot=null;boxes={};drag=null;visual.reset(false);$('box-layer').replaceChildren();context.clearRect(0,0,photo.width,photo.height);setMode('empty');
  updateRegions();
  if(analysis==='hb'&&activeScanCount()>=MAX_SCANS){notice('This session has reached 100 photos. Choose End scan now.');return;}
  if(lastSource==='camera'){
    await startCamera();if(mode==='live')$('capture-button').focus({preventScroll:true});
  }else{notice('Upload another photo, or turn on your camera.');$('upload-button').focus({preventScroll:true});}
  if(window.innerWidth<740)document.querySelector('.camera-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
$('retake-button').addEventListener('click',retake);
$('new-scan').addEventListener('click',async()=>{
  hbResultReady=false;sessionVersion++;averageController?.abort();averageController=null;processor.close();processor=createScanProcessor();scans=[];currentScanId=null;
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
    const node=document.createElement('div');node.className=`selection-box${active===kind&&mode==='photo'?' is-active':''}`;
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
  $('region-count').textContent=count===3?'All three regions marked. Ready when you are.':`${count} of 3 regions marked.`;
  renderSession();
}
function saveRegion(box){
  if(analysis!=='hb')return;
  if(finalizing||currentScanId)throw new Error('This photo has already been added. Choose Next scan to add another photo, or end the scan now.');
  validateBox(box,photo.width,photo.height);
  if(box[3]-box[1]<3||box[2]-box[0]<3)throw new Error('Draw a slightly larger box, at least 3 pixels wide and high.');
  boxes[active]=box;error('');updateRegions();
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
function currentReady(){return analysis==='hb'&&mode==='photo'&&snapshot&&model&&kinds.every(kind=>boxes[kind])&&!currentScanId;}
function activeScanCount(){return scans.filter(scan=>scan.state!=='failed').length;}
function hasWorkerCapacity(){const pending=scans.filter(scan=>scan.state==='pending');return pending.length<MAX_PENDING_SCANS&&pending.reduce((sum,scan)=>sum+scan.bytes,0)+(snapshot?.data.byteLength||0)<=MAX_PENDING_BYTES;}
function renderSession(){
  const pending=scans.filter(scan=>scan.state==='pending').length;
  const included=scans.filter(scan=>scan.state==='complete').length;
  const failed=scans.filter(scan=>scan.state==='failed');
  const hb=analysis==='hb';
  const regionsMarked=hb&&mode==='photo'&&kinds.every(kind=>boxes[kind]);
  show('scan-session',hb&&scans.length>0&&mode!=='result');
  show('session-actions',hb&&mode!=='result'&&(regionsMarked||scans.length>0));
  show('continue-scan',regionsMarked);
  for(const guidance of document.querySelectorAll('.other-hand-tip,.averaging-note'))guidance.hidden=!regionsMarked;
  $('session-count').textContent=`${scans.length} ${scans.length===1?'photo added':'photos added'}`;
  $('session-progress').textContent=finalizing?(pending?`Finishing your scan. Waiting for ${pending} ${pending===1?'photo':'photos'}…`:'Calculating your average…'):
    pending?`Processing ${pending} ${pending===1?'photo':'photos'} in the background. You can continue scanning.`:
    included?`${included} ${included===1?'reading is':'readings are'} ready. Choose End scan now for your result.`:'Take another photo to continue.';
  const failures=$('session-failures');failures.replaceChildren();
  for(const scan of failed){const li=document.createElement('li');li.textContent=`Photo ${scan.number} was not included: ${scan.message}`;failures.append(li);}
  show('session-failures',failed.length>0);
  const blocked=finalizing||actionBusy||uploadBusy;
  $('camera-adjustment').disabled=blocked||hbResultReady;
  $('touch-editor-button').disabled=blocked||Boolean(currentScanId)||!snapshot;
  const dockVisible=scanDockMedia.matches&&hb&&mode!=='result'&&(regionsMarked||scans.length>0);
  show('mobile-scan-dock',dockVisible);document.body.classList.toggle('has-scan-dock',Boolean(dockVisible));
  $('mobile-scan-note').textContent=finalizing?'Finishing your scan…':pending?`Processing ${pending} photo${pending===1?'':'s'}…`:regionsMarked?'Ready to add this photo':`${included} reading${included===1?'':'s'} ready`;

  const full=hb&&activeScanCount()>=MAX_SCANS,waitingForCapacity=currentReady()&&!full&&!hasWorkerCapacity();
  $('predict-button').disabled=blocked||(!currentReady()&&pending+included===0);
  $('continue-scan').disabled=blocked||(!currentReady()&&!currentScanId)||full||waitingForCapacity;
  $('session-action-note').textContent=finalizing?'Please wait. Your photos are still being processed.':
    full?'This session has reached 100 photos. Choose End scan now.':
    waitingForCapacity?'Photos are still processing. End scan now will wait and include this photo.':
    currentScanId?'This photo has been added. You can continue or try ending the scan again.':
    currentReady()?'Both buttons add this photo. Next scan lets you take another.':
    scans.length?'End now uses the photos already added. Finish marking this photo to include it.':'Mark all three regions, then choose a button below.';
  for(const id of ['tab-hb','tab-skin'])$(id).disabled=blocked;
  for(const button of document.querySelectorAll('[data-region]'))button.disabled=blocked||Boolean(currentScanId);
  for(const input of $('coordinate-form').elements)input.disabled=blocked||Boolean(currentScanId);
  $('upload-button').disabled=blocked||(hb&&mode==='result')||full;$('file-input').disabled=blocked||(hb&&mode==='result')||full;
  $('retake-button').disabled=blocked||full;$('start-camera').disabled=blocked||full;
  $('capture-button').disabled=blocked||full||mode!=='live'||!video.videoWidth||torch.state.busy;
  $('switch-camera').disabled=blocked;
  photo.style.cursor=hb&&mode==='photo'&&!currentScanId&&!blocked?'crosshair':'default';
}
function addCurrentScan(){
  if(currentScanId)return;
  if(!currentReady())throw new Error('Mark all three regions before adding this photo.');
  if(activeScanCount()>=MAX_SCANS)throw new Error('This session has reached 100 photos. Choose End scan now.');
  if(!hasWorkerCapacity())throw new Error('Please wait for a photo to finish processing, then try again.');
  for(let a=0;a<kinds.length;a++)for(let b=a+1;b<kinds.length;b++){
    const x=boxes[kinds[a]],y=boxes[kinds[b]];
    if(Math.max(x[0],y[0])<Math.min(x[2],y[2])&&Math.max(x[1],y[1])<Math.min(x[3],y[3]))throw new Error('Keep all three region boxes separate. Adjust overlapping boxes first.');
  }
  const version=sessionVersion,scan={id:crypto.randomUUID(),number:scans.length+1,state:'pending',bytes:snapshot.data.byteLength,result:null,message:''};
  currentScanId=scan.id;scans.push(scan);
  scan.promise=processor.process({id:scan.id,model,image:snapshot,boxes:structuredClone(boxes)}).then(result=>{
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
  try{addCurrentScan();await retake();photoNotice('Photo added. Take or upload your next photo, or choose End scan now.');}
  catch(e){error(e.message);}
  finally{if(version===sessionVersion){actionBusy=false;renderSession();(activeScanCount()>=MAX_SCANS?$('predict-button'):mode==='live'?$('capture-button'):$('upload-button')).focus({preventScroll:true});}}
});
$('predict-button').addEventListener('click',async()=>{
  if(analysis!=='hb'||finalizing||actionBusy)return;
  error('');
  if(!currentReady()&&!scans.some(scan=>scan.state==='pending'||scan.state==='complete'))return;
  const version=sessionVersion,adjustmentEnabled=cameraAdjustment;finalizing=true;loadVersion++;cameraRequest++;stopTracks();
  if(mode==='live')setMode('empty');renderSession();
  try{
    if(currentReady()&&activeScanCount()<MAX_SCANS){
      while(!hasWorkerCapacity()){
        await Promise.race(scans.filter(scan=>scan.state==='pending').map(scan=>scan.promise));
        if(version!==sessionVersion)return;
      }
      addCurrentScan();
    }
    await Promise.all(scans.map(scan=>scan.promise));
    if(version!==sessionVersion)return;
    const readings=scans.filter(scan=>scan.state==='complete').map(scan=>scan.result);
    if(!readings.length)throw new Error('No photos could be read. Please retake a clear photo and mark the three regions.');
    averageController=new AbortController();const timer=setTimeout(()=>averageController?.abort(),15000);
    let response;
    try{response=await fetch('./api/scans/average',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readings}),signal:averageController.signal});}
    catch{throw new Error('Your readings are still here. Make sure the local Kera server is running, then choose End scan now again.');}
    finally{clearTimeout(timer);averageController=null;}
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(result?.error?.message||'The average could not be calculated. Choose End scan now to try again.');
    if(!result||!Number.isFinite(result.hemoglobin_g_per_l)||result.scan_count!==readings.length||!Array.isArray(result.warnings))throw new Error('The average response could not be read. Choose End scan now to try again.');
    if(version!==sessionVersion)return;
    hbResultReady=true;
    const adjusted=adjustHemoglobin(result.hemoglobin_g_per_l,adjustmentEnabled);
    $('prediction-value').textContent=adjusted.value.toFixed(1);
    $('result-caption').textContent=adjustmentEnabled?'Camera-adjusted average estimate':'Average estimated hemoglobin';
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
for(const choice of document.querySelectorAll('[name="region-help-setup"]'))choice.addEventListener('change',()=>{
  show('region-help-dock',choice.value==='dock');show('region-help-phone',choice.value==='phone');
});
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
window.addEventListener('pagehide',()=>{sessionVersion++;cameraRequest++;loadVersion++;averageController?.abort();processor.close();scans=[];stopTracks();snapshot=null;context.clearRect(0,0,photo.width,photo.height);});
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
setMode('empty');notice('Take or upload a close-up. Nothing is sent without your permission.');loadModel();

