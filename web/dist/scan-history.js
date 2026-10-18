/** In-memory, lossless originals for editing; small JPEGs are thumbnails only. */
export function createScanHistory({root,list,previous,next,position,onSelect,onError}) {
  const entries=new Map(),doc=root.ownerDocument;
  let mode='skin',selected=null,busy=false,generation=0,request=0,bytes=0;
  const MAX_BYTES=192*1024*1024;
  const visible=()=>[...entries.values()].filter(e=>(e.scan.type||'hb')===mode);
  const name=e=>e.scan.type==='skin'?`Skin & nail photo ${e.scan.number}`:`Hb photo ${e.scan.number}`;
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
    previous.disabled=busy||i<=0;next.disabled=busy||i<0||i>=items.length-1;
    position.textContent=i>=0?`${i+1} of ${items.length}`:`${items.length} photos`;
    for(const entry of entries.values()){
      entry.item.hidden=(entry.scan.type||'hb')!==mode;
      entry.label.textContent=name(entry);
      entry.status.textContent=entry.error?'Photo unavailable':!entry.ready?'Saving photo…':entry.scan.type==='skin'?(entry.scan.review?'Review ready':'Captured'):
        ({complete:'Included',failed:'Not included',pending:'Processing',editing:'Boxes changed · recalculate',draft:'Not added yet'}[entry.scan.state]||'Captured');
      entry.button.disabled=busy||!entry.ready||Boolean(entry.error)||entry.scan.state==='pending';
      entry.button.setAttribute('aria-label',`Select ${name(entry)}: ${entry.status.textContent}`);
      entry.button.setAttribute('aria-pressed',String(selected===entry.scan.id));
    }
  }
  function record(scan,source,boxes={}){
    if(entries.has(scan.id))return;
    const item=doc.createElement('li'),button=doc.createElement('button'),img=doc.createElement('img'),label=doc.createElement('strong'),status=doc.createElement('span');
    button.type='button';img.alt='';img.hidden=true;button.append(img,label,status);item.append(button);list.append(item);
    const entry={scan,boxes:structuredClone(boxes),width:source.width,height:source.height,item,button,label,status,url:null,ready:false,error:null};
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
  function clearType(type){request++;for(const entry of entries.values())if((entry.scan.type||'hb')===type)remove(entry);if(!entries.has(selected))selected=null;update();}
  function clear(){generation++;request++;for(const entry of entries.values())remove(entry);selected=null;update();}
  return {record,update,clear,clearType,get:id=>entries.get(id),attachReview(id,value){const e=entries.get(id);if(e)e.scan.review=structuredClone(value);update();},setMode(value){if(mode!==value)request++;mode=value;update();},setBusy(value){busy=value;update();},selectCurrent(id){selected=id;update();},saveBoxes(id,boxes){const e=entries.get(id);if(e)e.boxes=structuredClone(boxes);}};
}
