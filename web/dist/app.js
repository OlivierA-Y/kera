import { initializeVisualAnalysis } from './visual.js';
import { validateModel, validateBox } from './ml.js';
import { createScanProcessor } from './scan-processor.js';

const $ = id => document.getElementById(id);
const video=$('video'), photo=$('photo'), stage=$('viewfinder');
const context=photo.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
const kinds=['nail','skin','white'];
const labels={nail:'Middle nail',skin:'Nearby skin',white:'White reference'};
const prompts={nail:'Draw around the whole middle fingernail',skin:'Draw on skin between the middle finger’s two joints',white:'Draw around the plain white reference'};
let model=null, stream=null, cameraRequest=0, facing='user', mode='empty', active='nail', boxes={}, drag=null, snapshot=null, lastSource='camera';
let loadVersion=0;
const MAX_SCANS=100;
const MAX_PENDING_SCANS=3,MAX_PENDING_BYTES=128*1024*1024;
let scans=[],processor=createScanProcessor(),sessionVersion=0,currentScanId=null,finalizing=false,actionBusy=false,uploadBusy=false,averageController=null;
const visual=initializeVisualAnalysis({getPhoto:()=>snapshot?photo:null});
function photoNotice(message){notice(message+' Photos stay in your browser. Optional visual analysis requires permission to send photos.');}
function show(id,yes){$(id).hidden=!yes;}
function error(message){$('error').textContent=message;show('error',Boolean(message));}
function notice(message){$('notice').textContent=message;}
function cameraStatus(text,live=false){$('camera-status').textContent=text;$('camera-status').classList.toggle('is-live',live);}
function stopTracks(){if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;}
function stopCamera(){cameraRequest++;stopTracks();if(mode==='live')setMode('empty');}
function setMode(next){
  mode=next;
  show('empty-state',next==='empty');show('video',next==='live');show('photo',(next==='photo'||next==='result')&&Boolean(snapshot));
  show('session-complete-state',next==='result'&&!snapshot);
  show('frame-note',next==='live');show('drawing-prompt',next==='photo');
  show('prepare-panel',next==='empty'||next==='live');show('annotate-panel',next==='photo');show('result-panel',next==='result');
  show('capture-button',next==='empty'||next==='live');show('retake-button',next==='photo');
  show('switch-camera',next==='live');show('stop-camera',next==='live');
  $('capture-button').disabled=next!=='live'||!video.videoWidth;
  if(next==='empty')cameraStatus('Camera off');
  if(next==='photo'||next==='result')cameraStatus('Photo captured');
  if(next==='live')cameraStatus('Live view',true);
  $('view-heading').textContent=next==='result'?'Last photo':'Your scan';
  photo.style.cursor=next==='photo'?'crosshair':'default';
  renderSession();
}
async function startCamera(){
  if(finalizing||mode==='result')return;
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
    snapshot=null;boxes={};currentScanId=null;visual.reset(false);$('box-layer').replaceChildren();setMode('live');updateRegions();photoNotice('Keep your whole middle nail, skin between its two joints, and a white reference in the frame.');
    const track=media.getVideoTracks()[0];track.addEventListener('ended',()=>{if(mode==='live'){stopCamera();error('The camera disconnected. Reconnect it or upload a photo.');}});
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
  if(finalizing||mode==='result')return;
  if(!width||!height)throw new Error('This photo could not be read. Try a JPEG or PNG image.');
  if(width*height>24000000)throw new Error('This photo is too large. Use a photo under 24 megapixels.');
  photo.width=width;photo.height=height;context.drawImage(source,0,0,width,height);
  snapshot=context.getImageData(0,0,width,height);cameraRequest++;stopTracks();
  boxes={};currentScanId=null;lastSource=origin;visual.reset(true);setMode('photo');selectRegion('nail');updateRegions();error('');
  photoNotice('Photo captured. Mark the three regions for hemoglobin, or look at visible features below.');
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
  if(finalizing||actionBusy||mode==='result'){event.target.value='';return;}
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
  if(activeScanCount()>=MAX_SCANS){notice('This session has reached 100 photos. Choose End scan now.');return;}
  if(lastSource==='camera'){
    await startCamera();if(mode==='live')$('capture-button').focus({preventScroll:true});
  }else{notice('Upload another photo, or turn on your camera.');$('upload-button').focus({preventScroll:true});}
  if(window.innerWidth<740)document.querySelector('.camera-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
$('retake-button').addEventListener('click',retake);
$('new-scan').addEventListener('click',async()=>{
  sessionVersion++;averageController?.abort();averageController=null;processor.close();processor=createScanProcessor();scans=[];currentScanId=null;
  $('prediction-value').textContent='—';$('average-caption').textContent='';$('quality-warnings').replaceChildren();show('quality-warnings',false);
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
  if(finalizing||currentScanId)throw new Error('This photo has already been added. Continue scanning to add another photo, or end the scan now.');
  validateBox(box,photo.width,photo.height);
  if(box[3]-box[1]<3||box[2]-box[0]<3)throw new Error('Draw a slightly larger box, at least 3 pixels wide and high.');
  boxes[active]=box;error('');updateRegions();
  const next=kinds.find(kind=>!boxes[kind]);selectRegion(next||active);
}
for(const button of document.querySelectorAll('[data-region]'))button.addEventListener('click',()=>selectRegion(button.dataset.region));
photo.addEventListener('pointerdown',event=>{
  if(mode!=='photo'||event.button!==0||finalizing||currentScanId)return;const p=point(event);if(!p)return;
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
function currentReady(){return mode==='photo'&&snapshot&&model&&kinds.every(kind=>boxes[kind])&&!currentScanId;}
function activeScanCount(){return scans.filter(scan=>scan.state!=='failed').length;}
function hasWorkerCapacity(){const pending=scans.filter(scan=>scan.state==='pending');return pending.length<MAX_PENDING_SCANS&&pending.reduce((sum,scan)=>sum+scan.bytes,0)+(snapshot?.data.byteLength||0)<=MAX_PENDING_BYTES;}
function renderSession(){
  const pending=scans.filter(scan=>scan.state==='pending').length;
  const included=scans.filter(scan=>scan.state==='complete').length;
  const failed=scans.filter(scan=>scan.state==='failed');
  const regionsMarked=mode==='photo'&&kinds.every(kind=>boxes[kind]);
  show('scan-session',scans.length>0&&mode!=='result');
  show('session-actions',mode!=='result'&&(regionsMarked||scans.length>0));
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
  const full=activeScanCount()>=MAX_SCANS,waitingForCapacity=currentReady()&&!full&&!hasWorkerCapacity();
  $('predict-button').disabled=blocked||(!currentReady()&&pending+included===0);
  $('continue-scan').disabled=blocked||(!currentReady()&&!currentScanId)||full||waitingForCapacity;
  $('session-action-note').textContent=finalizing?'Please wait. Your photos are still being processed.':
    full?'This session has reached 100 photos. Choose End scan now.':
    waitingForCapacity?'Photos are still processing. End scan now will wait and include this photo.':
    currentScanId?'This photo has been added. You can continue or try ending the scan again.':
    currentReady()?'Both buttons add this photo. Continue scanning lets you take another.':
    scans.length?'End now uses the photos already added. Finish marking this photo to include it.':'Mark all three regions, then choose a button below.';
  for(const button of document.querySelectorAll('[data-region]'))button.disabled=blocked||Boolean(currentScanId);
  for(const input of $('coordinate-form').elements)input.disabled=blocked||Boolean(currentScanId);
  $('upload-button').disabled=blocked||mode==='result'||full;$('file-input').disabled=blocked||mode==='result'||full;
  $('retake-button').disabled=blocked||full;$('start-camera').disabled=blocked||full;
  $('capture-button').disabled=blocked||full||mode!=='live'||!video.videoWidth;
  $('switch-camera').disabled=blocked;
  photo.style.cursor=mode==='photo'&&!currentScanId&&!blocked?'crosshair':'default';
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
  if(finalizing||actionBusy||(!currentReady()&&!currentScanId))return;
  const version=sessionVersion;
  actionBusy=true;error('');
  try{addCurrentScan();await retake();photoNotice('Photo added. Take or upload your next photo, or choose End scan now.');}
  catch(e){error(e.message);}
  finally{if(version===sessionVersion){actionBusy=false;renderSession();(activeScanCount()>=MAX_SCANS?$('predict-button'):mode==='live'?$('capture-button'):$('upload-button')).focus({preventScroll:true});}}
});
$('predict-button').addEventListener('click',async()=>{
  if(finalizing||actionBusy)return;
  error('');
  if(!currentReady()&&!scans.some(scan=>scan.state==='pending'||scan.state==='complete'))return;
  const version=sessionVersion;finalizing=true;loadVersion++;cameraRequest++;stopTracks();
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
    $('prediction-value').textContent=result.hemoglobin_g_per_l.toFixed(1);
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
$('region-help-button').addEventListener('click',()=>{regionHelp.showModal();$('region-help-title').focus();});
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
regionHelp.addEventListener('close',()=>$('region-help-button').focus({preventScroll:true}));
regionHelp.addEventListener('click',event=>{
  if(event.target!==regionHelp)return;
  const r=regionHelp.getBoundingClientRect();
  if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)regionHelp.close();
});
for(const id of ['about-button','footer-about'])$(id).addEventListener('click',()=>$('model-dialog').showModal());
for(const button of document.querySelectorAll('.close-dialog'))button.addEventListener('click',()=>$('model-dialog').close());
$('model-dialog').addEventListener('click',event=>{if(event.target===$('model-dialog')){const r=$('model-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('model-dialog').close();}});
window.addEventListener('pagehide',()=>{sessionVersion++;cameraRequest++;loadVersion++;averageController?.abort();processor.close();scans=[];stopTracks();snapshot=null;context.clearRect(0,0,photo.width,photo.height);});
window.addEventListener('pageshow',event=>{if(event.persisted){processor=createScanProcessor();currentScanId=null;boxes={};finalizing=false;actionBusy=false;uploadBusy=false;visual.reset(false);$('prediction-value').textContent='—';setMode('empty');updateRegions();}});
async function loadModel(){
  try{const response=await fetch(new URL('./assets/model.json',import.meta.url));if(!response.ok)throw new Error('Model download failed');model=validateModel(await response.json());$('model-note').textContent='Trained neural network. Runs on your device.';updateRegions();}
  catch(e){$('model-note').textContent='The trained model could not load. Reload the page to try again.';error('The trained model could not load. Check your connection and reload the app.');}
}
setMode('empty');loadModel();
