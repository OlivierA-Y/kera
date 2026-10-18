/** Optional remote observations. No image leaves the browser before the consent submit. */
import { createCareReview } from './care-review.js';
const $=id=>document.getElementById(id);
function encodePhoto(source){
  const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
  if(!width||!height)throw new Error('Take or upload a photo first.');
  const scale=Math.min(1,1600/Math.max(width,height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',.85);canvas.width=1;canvas.height=1;
  if(data.length>2500000)throw new Error('This photo is too detailed to send. Try a closer crop of the affected area.');
  return data;
}
export function initializeVisualAnalysis({getPhoto,onResult=()=>{},onAdditionalPhoto=()=>{}}){
  let ready=false,topData=null,sideData=null,controller=null,generation=0,busy=false,photoReady=false,sideVersion=0,remoteSent=false;
  const dialog=$('vision-dialog'),send=$('send-vision'),consent=$('vision-consent');
  const careReview=createCareReview($('vision-results'));
  let hasReview=false,sideHistoryId=null;
  function displayReview(open){
    $('workspace').hidden=open;
    $(open?'review-history-slot':'photo-history-slot').append($('scan-history'));
    $('review-page').hidden=!open;
    document.querySelector('.skip-link').href=open?'#review-page-title':'#workspace';
    document.querySelector('.skip-link').textContent=open?'Skip to results':'Skip to camera';
    if(open){$('review-page-title').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
  }
  function openResults(){
    if(!hasReview)return;
    if(location.hash!=='#review')history.pushState(null,'','#review');
    displayReview(true);
  }
  function closeResults(){
    displayReview(false);
    if(location.hash==='#review')history.replaceState(null,'',location.pathname+location.search);
  }
  $('back-to-capture').addEventListener('click',()=>{
    if(location.hash==='#review')history.back();else closeResults();
  });
  $('reopen-review').addEventListener('click',openResults);
  window.addEventListener('popstate',()=>{
    if(location.hash==='#review'&&hasReview)displayReview(true);else closeResults();
  });
  // Reviews live in memory only. A reload must not suggest a recovered result.
  if(location.hash==='#review')closeResults();
  function feedback(message){$('vision-error').textContent=message;$('vision-error').hidden=!message;}
  function updateSend(){send.disabled=!ready||!topData||!consent.checked||busy||$('side-input').disabled;}
  async function checkServer(){
    ready=false;$('vision-data-policy').hidden=true;updateSend();
    try{
      const response=await fetch('./api/vision/status',{cache:'no-store'});
      if(!response.ok)throw new Error('no server');
      const status=await response.json();ready=status.configured===true;
      $('vision-data-policy').hidden=status.dataCollection!=='allowed';
      const provider=typeof status.provider==='string'?status.provider:'Provider not supplied';
      const model=typeof status.model==='string'?status.model:'Model not supplied';
      $('vision-connection').textContent=ready?`${provider} · ${model}. Nothing is sent until you choose “Send photos”.`:'Visual analysis is not connected on this server yet. Hemoglobin estimation still works on this device.';
    }catch{
      $('vision-connection').textContent='Visual analysis needs the Kera local server. The local hemoglobin estimate remains available.';
    }
    updateSend();
  }
  function clearResults(){ hasReview=false;closeResults();$('reopen-review').hidden=true;careReview.clear();$('vision-results').hidden=true;$('review-categories').hidden=false;document.querySelector('.visual-intro').hidden=false; }
  function reset(hasPhoto){
    photoReady=hasPhoto;sideHistoryId=null;generation++;sideVersion++;controller?.abort();controller=null;busy=false;topData=null;sideData=null;remoteSent=false;
    consent.checked=false;send.textContent='Send photos';$('side-input').value='';$('side-preview').removeAttribute('src');$('side-preview').hidden=true;$('remove-side').hidden=true;
    $('top-preview').removeAttribute('src');$('vision-preview-area').hidden=false;
    $('side-label').textContent='Add another angle';$('side-input').disabled=false;
    $('vision-busy').hidden=true;$('cancel-vision').hidden=true;$('open-vision').disabled=false;$('add-angle').disabled=false;
    $('vision-remote-note').hidden=true;feedback('');clearResults();
    $('open-vision').disabled=!hasPhoto;$('open-vision').textContent=hasPhoto?'Preview photos':'Take or upload a photo';clearSidePreview();if(dialog.open)dialog.close();updateSend();
  }
  function clearSidePreview(){
    $('additional-preview').removeAttribute('src');$('additional-photo').hidden=true;
    $('add-angle').textContent='＋ Another angle';
  }
  function removeSide(){
    generation++;controller?.abort();controller=null;busy=false;sideVersion++;sideData=null;sideHistoryId=null;
    $('vision-busy').hidden=true;$('cancel-vision').hidden=true;$('side-input').disabled=false;
    $('open-vision').disabled=!photoReady;$('open-vision').textContent='Preview photos';$('add-angle').disabled=false;
    $('side-preview').removeAttribute('src');$('side-preview').hidden=true;$('remove-side').hidden=true;
    $('side-label').textContent='Add another angle';consent.checked=false;clearResults();clearSidePreview();feedback('');updateSend();
  }
  for(const id of ['choose-side','add-angle'])$(id).addEventListener('click',()=>$('side-input').click());
  $('remove-angle').addEventListener('click',removeSide);
  $('open-vision').addEventListener('click',()=>{
    feedback('');clearResults();const photo=getPhoto();if(!photo)return;
    try{topData=encodePhoto(photo);}catch(e){feedback(e.message);return;}
    consent.checked=false;$('top-preview').src=topData;$('vision-preview-area').hidden=false;
    $('vision-remote-note').hidden=!remoteSent;
    dialog.showModal();checkServer();
  });
  $('close-vision').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  consent.addEventListener('change',updateSend);
  $('side-input').addEventListener('change',async(event)=>{
    const file=event.target.files[0];if(!file)return;
    // A changed view invalidates the review immediately, including a pending result.
    generation++;controller?.abort();controller=null;busy=false;clearResults();consent.checked=false;
    $('vision-busy').hidden=true;$('cancel-vision').hidden=true;$('open-vision').textContent='Preview photos';$('add-angle').disabled=false;
    const version=++sideVersion,current=generation;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>30000000){feedback('Choose a JPEG, PNG, or WebP additional photo under 30 MB.');event.target.value='';return;}
    $('side-input').disabled=true;consent.checked=false;$('open-vision').disabled=true;send.disabled=true;
    try{
      const bitmap=await createImageBitmap(file);
      try{
        if(version!==sideVersion||current!==generation)return;
        if(bitmap.width*bitmap.height>24000000)throw new Error('Use an additional photo under 24 megapixels.');
        sideData=encodePhoto(bitmap);sideHistoryId=onAdditionalPhoto(bitmap);$('additional-preview').src=sideData;$('additional-photo').hidden=false;$('add-angle').textContent='＋ Replace angle';$('side-preview').src=sideData;$('side-preview').hidden=false;$('remove-side').hidden=false;$('side-label').textContent='Replace additional photo';
        consent.checked=false;feedback('');
      }finally{bitmap.close();}
    }catch(e){feedback(e.message||'The additional photo could not be read.');}
    finally{if(version===sideVersion&&current===generation){$('side-input').disabled=false;$('open-vision').disabled=!photoReady||busy;event.target.value='';updateSend();}}
  });
  $('remove-side').addEventListener('click',removeSide);
  function renderResult(value){
    const container=$('vision-results');
    if(!careReview.show(value))throw new Error('The observation response is incomplete or unsupported. No findings or handoff draft are shown. Try again.');
    $('review-categories').hidden=true;document.querySelector('.visual-intro').hidden=true;$('open-vision').textContent='Review again';container.hidden=false;container.setAttribute('tabindex','-1');container.focus({preventScroll:true});
    onResult(value,sideHistoryId);hasReview=true;$('reopen-review').hidden=false;openResults();
  }
  $('vision-form').addEventListener('submit',async(event)=>{
    event.preventDefault();if(!ready||!topData||!consent.checked||busy)return;
    const current=generation;controller=new AbortController();const requestController=controller;
    busy=true;updateSend();feedback('');clearResults();dialog.close();$('review-categories').hidden=true;$('open-vision').textContent='Reviewing photos…';
    $('vision-busy').hidden=false;$('cancel-vision').hidden=false;$('open-vision').disabled=true;$('add-angle').disabled=true;
    const photos=[{view:'top',data_url:topData}];if(sideData)photos.push({view:'side',data_url:sideData});
    remoteSent=true;$('vision-remote-note').hidden=false;
    const timer=setTimeout(()=>requestController.abort('timeout'),55000);
    try{
      const response=await fetch('./api/vision/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,photos}),signal:requestController.signal});
      let body;try{body=await response.json();}catch{throw new Error('The server returned an unreadable response. No observations are shown.');}
      if(current!==generation)return;
      if(!response.ok)throw new Error(body.error?.message||'Visual analysis could not complete. Try again.');
      renderResult(body);
    }catch(e){
      if(current!==generation)return;
      clearResults();feedback(requestController.signal.aborted?'The request was canceled or timed out. Photos already sent may have reached OpenRouter. No observations are shown.':e.message||'The vision service could not be reached.');
    }finally{
      clearTimeout(timer);
      if(current===generation){busy=false;controller=null;consent.checked=false;topData=null;sideData=null;$('top-preview').removeAttribute('src');$('side-preview').removeAttribute('src');$('side-preview').hidden=true;$('remove-side').hidden=true;$('side-label').textContent='Add another angle';$('vision-busy').hidden=true;$('cancel-vision').hidden=true;$('open-vision').disabled=!photoReady;$('open-vision').textContent=$('vision-results').hidden?'Preview photos':'Review again';$('add-angle').disabled=false;clearSidePreview();updateSend();}
    }
  });
  $('cancel-vision').addEventListener('click',()=>controller?.abort('user'));
  window.addEventListener('pagehide',()=>reset(false));
  function restoreReview(value){
    if(!careReview.show(value))return;
    hasReview=true;$('vision-results').hidden=false;$('reopen-review').hidden=false;$('open-vision').textContent='Review again';
  }
  return{reset,restoreReview,deactivate(){reset(photoReady);}};
}
