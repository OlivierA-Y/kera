import { createCareReview } from './care-review.js';
/** Read-only session previews. Full-resolution pixels still go only to local inference. */
export function createScanHistory({ root, list, dialog, canvas, title, detail, close, previous, next, position, reviewRoot }) {
  const entries = new Map();
  const doc = root.ownerDocument;
  let generation = 0, selected = null, drawVersion = 0;
  const reviewView = createCareReview(reviewRoot, { handoffId: 'history-handoff-note' });
  function move(offset) {
    const values=[...entries.values()], index=values.findIndex(entry=>entry.scan.id===selected);
    if(values[index+offset])void open(values[index+offset]);
  }
  previous.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
  function navigation(){
    const values=[...entries.keys()], index=values.indexOf(selected);
    previous.disabled=index<=0;next.disabled=index<0||index>=values.length-1;
    position.textContent=`${index+1} of ${values.length}`;
    for(const entry of entries.values())entry.button.setAttribute('aria-pressed',String(entry.scan.id===selected));
  }
  function name(entry){return entry.scan.type==='skin'?`Skin & nail photo ${entry.scan.number}`:`Hb scan ${entry.scan.number}`;}
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    selected = null; drawVersion++;reviewView.clear();navigation();
    canvas.width = canvas.height = 1;
  });
  function describe(entry) {
    const scan = entry.scan;
    if(scan.type==='skin')return scan.review?'Saved AI review of this photo and any additional angle supplied with it.':'Captured photo. No saved AI review for this image.';
    return scan.state === 'complete'
      ? `Experimental estimate: ${scan.result.hemoglobin_g_per_l.toFixed(1)} g/L. Included in the session average.`
      : scan.state === 'failed' ? `Not included: ${scan.message}` : 'Processing this photo…';
  }
  function updateDetail(entry) {
    detail.replaceChildren();
    const status = doc.createElement('p'); status.textContent = describe(entry); detail.append(status);
    if (entry.previewError) {
      const note = doc.createElement('p'); note.textContent = entry.previewError; detail.append(note);
    }
    for (const warning of entry.scan.result?.warnings || []) {
      const note = doc.createElement('p'); note.textContent = warning; detail.append(note);
    }
  }
  async function open(entry) {
    selected = entry.scan.id;
    const version = ++drawVersion;
    title.textContent = name(entry);navigation();reviewView.clear();
    if(entry.scan.review)reviewView.show(entry.scan.review);
    updateDetail(entry);
    canvas.hidden = true;
    canvas.setAttribute('aria-label',entry.scan.type==='skin'?'Saved skin or nail photo':'Saved Hb photo with marked middle nail, nearby skin and white-reference regions');
    dialog.scrollTop=0;
    if (!dialog.open) dialog.showModal();
    if (!entry.url) return;
    try {
      const image = new Image(); image.src = entry.url; await image.decode();
      if (version !== drawVersion || selected !== entry.scan.id || !dialog.open) return;
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);canvas.hidden=false;
      const scaleX = canvas.width / entry.width, scaleY = canvas.height / entry.height;
      const labels = { nail: 'Middle nail', skin: 'Nearby skin', white: 'White reference' };
      ctx.lineWidth = 2; ctx.font = '14px sans-serif';
      for (const [kind, [top, left, bottom, right]] of Object.entries(entry.boxes)) {
        const x = left * scaleX, y = top * scaleY, w = (right-left)*scaleX, h = (bottom-top)*scaleY;
        ctx.strokeStyle = '#191919'; ctx.lineWidth = 4; ctx.strokeRect(x,y,w,h);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(x,y,w,h);
        const label = labels[kind], labelWidth = ctx.measureText(label).width + 12;
        const labelX = Math.max(0, Math.min(x, canvas.width-labelWidth));
        const labelY = Math.max(0, Math.min(y-22, canvas.height-22));
        ctx.fillStyle = '#191919'; ctx.fillRect(labelX,labelY,labelWidth,22);
        ctx.fillStyle = '#ffffff'; ctx.fillText(label,labelX+6,labelY+16);
      }
    } catch {
      if (version === drawVersion) {
        canvas.hidden = true;
        const error = doc.createElement('p'); error.textContent = 'This preview could not be opened. The saved reading is unchanged.';
        detail.append(error);
      }
    }
  }
  function update() {
    root.hidden = entries.size === 0;
    for (const entry of entries.values()) {
      entry.label.textContent = name(entry);
      entry.status.textContent = entry.scan.type==='skin'?(entry.scan.review?'Review ready':'Captured'):entry.scan.state === 'complete' ? 'Included' : entry.scan.state === 'failed' ? 'Not included' : 'Processing';
      entry.button.setAttribute('aria-label', `View ${name(entry)}: ${entry.status.textContent}`);
      if (selected === entry.scan.id) updateDetail(entry);
    }
  }
  function record(scan, source, boxes) {
    const item = doc.createElement('li'), button = doc.createElement('button');
    button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog');
    const img = doc.createElement('img'); img.alt = ''; img.hidden = true;
    const label = doc.createElement('strong'), status = doc.createElement('span');
    button.append(img,label,status); item.append(button); list.append(item);
    const entry = { scan, boxes: structuredClone(boxes), width: source.width, height: source.height, button, label, status, img, url: null, previewError: null };
    entries.set(scan.id, entry);navigation();button.addEventListener('click', () => open(entry)); update();
    // Bound retained image size. Never retain another full-resolution ImageData per scan.
    const preview = doc.createElement('canvas');
    const scale = Math.min(1, 960 / Math.max(source.width, source.height));
    preview.width = Math.max(1, Math.round(source.width*scale));
    preview.height = Math.max(1, Math.round(source.height*scale));
    preview.getContext('2d').drawImage(source,0,0,preview.width,preview.height);
    const version = generation;
    preview.toBlob(blob => {
      preview.width = preview.height = 1;
      if (version !== generation || !entries.has(scan.id)) return;
      if (blob && blob.size <= 512*1024) {
        entry.url = URL.createObjectURL(blob); img.src = entry.url; img.hidden = false;
      } else entry.previewError = 'A photo preview is unavailable for this scan. Its processing status and reading are still available.';
      if (selected === scan.id) void open(entry);
    }, 'image/jpeg', .75);
  }
  function attachReview(id,value) {
    const entry=entries.get(id);if(!entry)return;entry.scan.review=structuredClone(value);update();
    if(selected===id)reviewView.show(entry.scan.review);
  }
  function clearType(type){
    if(dialog.open)dialog.close();
    for(const [id,entry]of entries)if((entry.scan.type||'hb')===type){if(entry.url)URL.revokeObjectURL(entry.url);entry.button.parentElement.remove();entries.delete(id);}
    update();
  }
  function clear() {
    generation++; drawVersion++; selected = null;
    if (dialog.open) dialog.close();
    for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
    entries.clear(); list.replaceChildren(); root.hidden = true;
    canvas.width = canvas.height = 1; detail.replaceChildren();reviewView.clear();
  }
  return { record, update, clear, clearType, attachReview };
}
