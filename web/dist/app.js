import { initializeVisualAnalysis } from './visual.js';
import { extractFeatures, predict, validateModel, validateBox } from './ml.js';

const $ = id => document.getElementById(id);
const video=$('video'), photo=$('photo'), stage=$('viewfinder');
const context=photo.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
const kinds=['nail','skin','white'];
const labels={nail:'Middle nail',skin:'Nearby skin',white:'White reference'};
const prompts={nail:'Draw around the middle fingernail',skin:'Draw around a clear area of nearby skin',white:'Draw around the plain white reference'};
let model=null, stream=null, cameraRequest=0, facing='user', mode='empty', active='nail', boxes={}, drag=null, snapshot=null, lastSource='camera';
let loadVersion=0;
const visual=initializeVisualAnalysis({getPhoto:()=>snapshot?photo:null});
function photoNotice(message){notice(message+' Hemoglobin estimation stays local; optional visual analysis requires permission to send photos.');}
function show(id,yes){$(id).hidden=!yes;}
function error(message){$('error').textContent=message;show('error',Boolean(message));}
function notice(message){$('notice').textContent=message;}
function cameraStatus(text,live=false){$('camera-status').textContent=text;$('camera-status').classList.toggle('is-live',live);}
function stopTracks(){if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;}
function stopCamera(){cameraRequest++;stopTracks();if(mode==='live')setMode('empty');}
function setMode(next){
  mode=next;
  show('empty-state',next==='empty');show('video',next==='live');show('photo',next==='photo'||next==='result');
  show('frame-note',next==='live');show('drawing-prompt',next==='photo');
  show('prepare-panel',next==='empty'||next==='live');show('annotate-panel',next==='photo');show('result-panel',next==='result');
  show('capture-button',next==='empty'||next==='live');show('retake-button',next==='photo'||next==='result');
  show('switch-camera',next==='live');show('stop-camera',next==='live');
  $('capture-button').disabled=next!=='live'||!video.videoWidth;
  if(next==='empty')cameraStatus('Camera off');
  if(next==='photo'||next==='result')cameraStatus('Photo captured');
  if(next==='live')cameraStatus('Live view',true);
  $('view-heading').textContent=next==='result'?'Your photo':'Your scan';
  photo.style.cursor=next==='photo'?'crosshair':'default';
}
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){error('Camera access needs HTTPS or localhost and a supported browser. You can also upload a photo.');return;}
  const request=++cameraRequest;
  stopTracks();error('');$('start-camera').disabled=true;$('start-camera').lastChild.textContent=' Opening camera…';cameraStatus('Opening camera…');
  try{
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:960}}});
    if(request!==cameraRequest){media.getTracks().forEach(track=>track.stop());return;}
    stream=media;video.srcObject=media;await video.play();
    if(request!==cameraRequest)return;
    if(!video.videoWidth)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
    snapshot=null;boxes={};visual.reset(false);$('box-layer').replaceChildren();setMode('live');notice('Keep your whole middle nail, nearby skin, and a white reference in the frame.');
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
  if(!width||!height)throw new Error('This photo could not be read. Try a JPEG or PNG image.');
  if(width*height>24000000)throw new Error('This photo is too large. Use a photo under 24 megapixels.');
  photo.width=width;photo.height=height;context.drawImage(source,0,0,width,height);
  snapshot=context.getImageData(0,0,width,height);cameraRequest++;stopTracks();
  boxes={};lastSource=origin;visual.reset(true);setMode('photo');selectRegion('nail');error('');
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
  const file=event.target.files[0];if(!file)return;
  const version=++loadVersion;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){error('Choose a JPEG, PNG, or WebP photo.');event.target.value='';return;}
  if(file.size>30000000){error('Choose a photo under 30 MB.');event.target.value='';return;}
  $('upload-button').disabled=true;
  try{
    const bitmap=await createImageBitmap(file);
    try{if(version===loadVersion)loadSnapshot(bitmap,bitmap.width,bitmap.height,'upload');}finally{bitmap.close();}
  }catch(e){error(e.message||'This image could not be opened. Try another JPEG or PNG.');}
  finally{$('upload-button').disabled=false;event.target.value='';}
});
async function retake(){
  error('');snapshot=null;boxes={};drag=null;visual.reset(false);$('box-layer').replaceChildren();context.clearRect(0,0,photo.width,photo.height);setMode('empty');
  if(lastSource==='camera')await startCamera();else{notice('Upload another photo, or turn on your camera.');$('upload-button').focus();}
}
$('retake-button').addEventListener('click',retake);$('new-scan').addEventListener('click',retake);
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
  $('predict-button').disabled=count!==3||!model;
  $('predict-button').textContent=!model?'Waiting for the model…':count===3?'Get estimate ↗':'Mark all three regions';
}
function saveRegion(box){
  validateBox(box,photo.width,photo.height);
  if(box[3]-box[1]<3||box[2]-box[0]<3)throw new Error('Draw a slightly larger box, at least 3 pixels wide and high.');
  boxes[active]=box;error('');updateRegions();
  const next=kinds.find(kind=>!boxes[kind]);selectRegion(next||active);
}
for(const button of document.querySelectorAll('[data-region]'))button.addEventListener('click',()=>selectRegion(button.dataset.region));
photo.addEventListener('pointerdown',event=>{
  if(mode!=='photo'||event.button!==0)return;const p=point(event);if(!p)return;
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
$('predict-button').addEventListener('click',async()=>{
  if(!model||!snapshot)return;
  const button=$('predict-button');button.disabled=true;button.textContent='Reading your photo…';error('');
  // Yield one frame so the working state can paint before CPU feature extraction.
  await new Promise(resolve=>setTimeout(resolve,40));
  try{
    const {features,warnings}=extractFeatures(snapshot,boxes);const estimate=predict(model,features);
    if(estimate<44||estimate>169)warnings.push('This estimate is outside the study’s measured range of 44–169 g/L.');
    $('prediction-value').textContent=estimate.toFixed(1);
    const warningArea=$('quality-warnings');warningArea.replaceChildren();
    if(warnings.length){
      const title=document.createElement('strong');title.textContent='Photo quality notes';const list=document.createElement('ul');
      for(const warning of warnings){const li=document.createElement('li');li.textContent=warning;list.append(li);}warningArea.append(title,list);
    }
    show('quality-warnings',warnings.length>0);setMode('result');drawBoxes();photoNotice('Hemoglobin estimate calculated on your device.');
    $('result-panel').setAttribute('tabindex','-1');$('result-panel').focus({preventScroll:true});
    if(window.innerWidth<740)$('result-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }catch(e){error(e.message);}
  finally{updateRegions();}
});
$('edit-regions').addEventListener('click',()=>{setMode('photo');selectRegion('nail');updateRegions();error('');});
for(const id of ['about-button','footer-about'])$(id).addEventListener('click',()=>$('model-dialog').showModal());
for(const button of document.querySelectorAll('.close-dialog'))button.addEventListener('click',()=>$('model-dialog').close());
$('model-dialog').addEventListener('click',event=>{if(event.target===$('model-dialog')){const r=$('model-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('model-dialog').close();}});
window.addEventListener('pagehide',()=>{cameraRequest++;stopTracks();snapshot=null;context.clearRect(0,0,photo.width,photo.height);});
async function loadModel(){
  try{const response=await fetch(new URL('./assets/model.json',import.meta.url));if(!response.ok)throw new Error('Model download failed');model=validateModel(await response.json());$('model-note').textContent='Trained neural network. Runs on your device.';updateRegions();}
  catch(e){$('model-note').textContent='The trained model could not load. Reload the page to try again.';error('The trained model could not load. Check your connection and reload the app.');}
}
setMode('empty');loadModel();
