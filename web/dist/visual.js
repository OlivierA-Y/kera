/** Optional remote observations. No image leaves the browser before the consent submit. */
const FINDINGS={pitting:'Surface pits',lifting:'Nail lifting',splitting_crumbling:'Splitting or crumbling',nail_fold_swelling:'Swelling around the nail',spooning:'Spoon-like shape',clubbing:'Clubbing-like shape'};
const STATUS={visible:'Visible in photo',not_observed:'Not observed in photo',unclear:'Unclear'};
const $=id=>document.getElementById(id);
function encodePhoto(source){
  const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
  if(!width||!height)throw new Error('Take or upload a photo first.');
  const scale=Math.min(1,1600/Math.max(width,height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',.85);canvas.width=1;canvas.height=1;
  if(data.length>2500000)throw new Error('This photo is too detailed to send. Try a closer crop of the finger.');
  return data;
}
export function initializeVisualAnalysis({getPhoto}){
  let ready=false,topData=null,sideData=null,controller=null,generation=0,busy=false,sideVersion=0,remoteSent=false;
  const dialog=$('vision-dialog'),send=$('send-vision'),consent=$('vision-consent');
  function feedback(message){$('vision-error').textContent=message;$('vision-error').hidden=!message;}
  function updateSend(){send.disabled=!ready||!topData||!consent.checked||busy;}
  async function checkServer(){
    ready=false;updateSend();
    try{
      const response=await fetch('./api/vision/status',{cache:'no-store'});
      if(!response.ok)throw new Error('no server');
      const status=await response.json();ready=status.configured===true;
      $('vision-connection').textContent=ready?'OpenRouter connection ready. Nothing is sent until you choose “Send photos”.':'Visual analysis is not connected on this server yet. Hemoglobin estimation still works on this device.';
    }catch{
      $('vision-connection').textContent='Visual analysis needs the Kera local server. The local hemoglobin estimate remains available.';
    }
    updateSend();
  }
  function clearResults(){ $('vision-results').replaceChildren();$('vision-results').hidden=true; }
  function reset(hasPhoto){
    generation++;sideVersion++;controller?.abort();controller=null;busy=false;topData=null;sideData=null;remoteSent=false;
    consent.checked=false;send.textContent='Send photos';$('side-input').value='';$('side-preview').removeAttribute('src');$('side-preview').hidden=true;$('remove-side').hidden=true;
    $('top-preview').removeAttribute('src');$('vision-preview-area').hidden=false;
    $('side-label').textContent='Add a side view';$('side-input').disabled=false;
    $('vision-busy').hidden=true;$('cancel-vision').hidden=true;$('open-vision').disabled=false;
    $('vision-remote-note').hidden=true;feedback('');clearResults();
    $('visual-analysis').hidden=!hasPhoto;if(dialog.open)dialog.close();updateSend();
  }
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
    const file=event.target.files[0];if(!file)return;const version=++sideVersion,current=generation;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>30000000){feedback('Choose a JPEG, PNG, or WebP side photo under 30 MB.');event.target.value='';return;}
    $('side-input').disabled=true;send.disabled=true;
    try{
      const bitmap=await createImageBitmap(file);
      try{
        if(version!==sideVersion||current!==generation)return;
        if(bitmap.width*bitmap.height>24000000)throw new Error('Use a side photo under 24 megapixels.');
        sideData=encodePhoto(bitmap);$('side-preview').src=sideData;$('side-preview').hidden=false;$('remove-side').hidden=false;$('side-label').textContent='Replace side view';
        consent.checked=false;feedback('');
      }finally{bitmap.close();}
    }catch(e){feedback(e.message||'The side view could not be read.');}
    finally{if(version===sideVersion&&current===generation){$('side-input').disabled=false;event.target.value='';updateSend();}}
  });
  $('remove-side').addEventListener('click',()=>{sideVersion++;sideData=null;$('side-preview').removeAttribute('src');$('side-preview').hidden=true;$('remove-side').hidden=true;$('side-label').textContent='Add a side view';consent.checked=false;updateSend();});
  function renderResult(value){
    if(!value?.image_quality||!value.observations||!Object.keys(FINDINGS).every(key=>STATUS[value.observations[key]?.status]&&typeof value.observations[key]?.evidence==='string'))throw new Error('The observation response could not be read. No findings are shown.');
    const container=$('vision-results');container.replaceChildren();
    const heading=document.createElement('h3');heading.textContent='What the photos show';container.append(heading);
    const quality=document.createElement('p');quality.className='vision-quality';quality.textContent=`Image quality: ${value.image_quality.assessment}. ${value.image_quality.reason}`;container.append(quality);
    for(const [key,label] of Object.entries(FINDINGS)){
      const finding=value.observations[key],section=document.createElement('div');section.className='visual-finding';
      const title=document.createElement('h4');title.textContent=label;
      const state=document.createElement('span');state.className='visual-state';state.textContent=STATUS[finding.status];
      const evidence=document.createElement('p');evidence.textContent=finding.evidence;
      section.append(title,state,evidence);container.append(section);
    }
    const limitation=document.createElement('p');limitation.className='vision-limitation';limitation.textContent='These are experimental observations, not diagnoses. “Not observed” does not rule out a finding or mean a nail is healthy. A clinician can assess the cause of any changes.';container.append(limitation);
    container.hidden=false;container.setAttribute('tabindex','-1');container.focus({preventScroll:true});
  }
  $('vision-form').addEventListener('submit',async(event)=>{
    event.preventDefault();if(!ready||!topData||!consent.checked||busy)return;
    const current=generation;controller=new AbortController();const requestController=controller;
    busy=true;updateSend();feedback('');clearResults();dialog.close();
    $('vision-busy').hidden=false;$('cancel-vision').hidden=false;$('open-vision').disabled=true;
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
      feedback(requestController.signal.aborted?'The request was canceled or timed out. Photos already sent may have reached OpenRouter. No observations are shown.':e.message||'The vision service could not be reached.');
    }finally{
      clearTimeout(timer);
      if(current===generation){busy=false;controller=null;consent.checked=false;topData=null;sideData=null;$('top-preview').removeAttribute('src');$('side-preview').removeAttribute('src');$('side-preview').hidden=true;$('remove-side').hidden=true;$('side-label').textContent='Add a side view';$('vision-busy').hidden=true;$('cancel-vision').hidden=true;$('open-vision').disabled=false;updateSend();}
    }
  });
  $('cancel-vision').addEventListener('click',()=>controller?.abort('user'));
  window.addEventListener('pagehide',()=>reset(false));
  return{reset};
}
