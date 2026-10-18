/** In-memory, lossless originals for editing; small JPEGs are thumbnails only. */
export function createScanHistory({root,list,previous,next,position,deleteButton,onDelete,onSelect,onError}) {
  const entries=new Map(),doc=root.ownerDocument;
  let mode='skin',selected=null,busy=false,generation=0,request=0,bytes=0;
  const MAX_BYTES=192*1024*1024;
  const visible=()=>[...entries.values()];
  const name=e=>`Photo ${e.scan.number}`;
  async function select(entry){
    if(busy||entry.scan.state==='pending')return;
    const version=++request,current=generation;
    try{
      const blob=await entry.original;
      if(!blob)throw Error('This photo could not be retained for editing. Take or upload it again.');
      const image=await createImageBitmap(blob);
      try{
        if(version!==request||current!==generation)return;
        await onSelect(entry,image);
        if(version===request){selected=entry.scan.id;update();}
      }finally{image.close();}
    }catch(error){if(version===request)onError(error.message||'This photo could not be opened.');}
  }
  function move(offset){const items=visible(),i=items.findIndex(e=>e.scan.id===selected);if(items[i+offset])void select(items[i+offset]);}
  previous.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
  function update(){
    const items=visible(),i=items.findIndex(e=>e.scan.id===selected);
    root.hidden=!items.length;
    deleteButton.disabled=busy||!selected||entries.get(selected)?.scan.state==='pending';
    deleteButton.dataset.photoName=entries.has(selected)?name(entries.get(selected)):'';
    const current=root.querySelector('.current-photo-label');if(current)current.textContent=entries.has(selected)?'Current picture: '+name(entries.get(selected)):'Select a picture';
    previous.disabled=busy||i<=0;next.disabled=busy||i<0||i>=items.length-1;
    position.textContent=i>=0?`${i+1} of ${items.length}`:`${items.length} photos`;
    for(const entry of entries.values()){
      entry.item.hidden=false;
      entry.label.textContent=name(entry);
      entry.status.textContent=entry.error?'Photo unavailable':!entry.ready?'Saving photo…':mode==='skin'?(entry.scan.review?'Review ready':'Captured'):
        ({complete:'Included',failed:'Not included',pending:'Processing',editing:'Boxes changed · recalculate',draft:'Not added yet'}[entry.scan.state]||'Captured');
      entry.button.disabled=busy||!entry.ready||Boolean(entry.error)||entry.scan.state==='pending';
      entry.button.setAttribute('aria-label',`Select ${name(entry)}: ${entry.status.textContent}`);
      entry.button.setAttribute('aria-pressed',String(selected===entry.scan.id));
    }
  }
  function record(scan,source,boxes={},key=null){
    if(entries.has(scan.id))return;
    const item=doc.createElement('li'),button=doc.createElement('button'),img=doc.createElement('img'),label=doc.createElement('strong'),status=doc.createElement('span');
    button.type='button';img.alt='';img.hidden=true;button.append(img,label,status);item.append(button);list.append(item);
    const entry={scan,key,boxes:structuredClone(boxes),width:source.width,height:source.height,item,button,label,status,url:null,ready:false,error:null};
    entries.set(scan.id,entry);selected=scan.id;button.addEventListener('click',()=>void select(entry));
    const full=doc.createElement('canvas');full.width=source.width;full.height=source.height;full.getContext('2d').drawImage(source,0,0);
    const version=generation;
    entry.original=new Promise(resolve=>{
      full.toBlob(blob=>{
        full.width=full.height=1;
        if(version!==generation||!entries.has(scan.id)){resolve(null);return;}
        if(!blob||bytes+blob.size>MAX_BYTES){entry.error='Session photo memory is full or this photo could not be saved. Reload to clear the session before adding more photos.';resolve(null);}
        else{entry.blob=blob;bytes+=blob.size;entry.ready=true;resolve(blob);}
        update();if(entry.error)onError(entry.error);
      },'image/png');
    });
    const thumb=doc.createElement('canvas'),scale=Math.min(1,240/Math.max(source.width,source.height));
    thumb.width=Math.max(1,Math.round(source.width*scale));thumb.height=Math.max(1,Math.round(source.height*scale));thumb.getContext('2d').drawImage(source,0,0,thumb.width,thumb.height);
    thumb.toBlob(blob=>{thumb.width=thumb.height=1;if(version!==generation||!entries.has(scan.id)||!blob)return;entry.url=URL.createObjectURL(blob);img.src=entry.url;img.hidden=false;},'image/jpeg',.75);
    update();
  }
  function remove(entry){if(entry.url)URL.revokeObjectURL(entry.url);bytes-=entry.blob?.size||0;entry.item.remove();entries.delete(entry.scan.id);}
  deleteButton.addEventListener('click',()=>{
    const entry=entries.get(selected);if(busy||!entry||entry.scan.state==='pending')return;
    if(!doc.defaultView.confirm(`Delete ${name(entry)}, the current picture?\n\nThis removes it from both analysis tabs and clears its session reading and review. Saved profile history is kept.`))return;
    request++;remove(entry);selected=null;
    for(const other of entries.values())if(other.scan.reviewPhotoIds?.includes(entry.scan.id)){other.scan.review=null;other.scan.reviewPhotoIds=[];}
    update();void onDelete(entry.scan.id,visible());
  });
  function resetReadings(){for(const entry of entries.values()){entry.scan.state='draft';entry.scan.result=null;entry.scan.message='';}update();}
  function clear(){generation++;request++;for(const entry of entries.values())remove(entry);selected=null;update();}
  return {record,update,clear,resetReadings,findByKey:key=>key?[...entries.values()].find(e=>e.key===key):null,selectId:async id=>{const e=entries.get(id);if(e)await select(e);},get:id=>entries.get(id),attachReview(id,value,photoIds=[id]){const e=entries.get(id);if(e){e.scan.review=structuredClone(value);e.scan.reviewPhotoIds=[...photoIds];}update();},setMode(value){if(mode!==value)request++;mode=value;update();},setBusy(value){busy=value;update();},selectCurrent(id){selected=id;update();},saveBoxes(id,boxes){const e=entries.get(id);if(e)e.boxes=structuredClone(boxes);}};
}
