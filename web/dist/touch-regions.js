/** Local-only enlarged region editor. Display zoom never changes source pixels. */
const names={nail:'Middle nail',skin:'Nearby skin',white:'White reference'};
const $=id=>document.getElementById(id);
export function initializeTouchRegions({getState,onSave}){
 const dialog=$('touch-editor'),canvas=$('touch-canvas'),ctx=canvas.getContext('2d');
 let kind='nail',source=null,draft=null,corner=null,pointer=null,tool='mark',zoom=1,scale=1,x=0,y=0,w=1,h=1;
 function message(text){$('touch-message').textContent=text;}
 function enabled(){return Boolean(draft)&&!corner;}
 function draw(){
  if(!source||!dialog.open)return;
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);w=rect.width;h=rect.height;
  canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.fillStyle='#292929';ctx.fillRect(0,0,w,h);ctx.drawImage(source,x,y,source.width*scale,source.height*scale);
  for(const [key,box] of Object.entries(getState().boxes))if(key!==kind)paint(box,false);
  if(draft)paint(draft,true);
  if(corner){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x+corner.x*scale,y+corner.y*scale,9,0,Math.PI*2);ctx.stroke();}
  $('touch-save').disabled=!enabled();
  $('touch-readout').textContent=draft?`Width ${draft[3]-draft[1]} · Height ${draft[2]-draft[0]} photo pixels`:'Tap two opposite corners, or drag a box.';
 }
 function paint(box,active){
  const bx=x+box[1]*scale,by=y+box[0]*scale,bw=(box[3]-box[1])*scale,bh=(box[2]-box[0])*scale;
  ctx.setLineDash(active?[]:[5,5]);ctx.strokeStyle='#191919';ctx.lineWidth=5;ctx.strokeRect(bx,by,bw,bh);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(bx,by,bw,bh);ctx.setLineDash([]);
  if(active){ctx.fillStyle='#fff';for(const [cx,cy] of [[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]])ctx.fillRect(cx-4,cy-4,8,8);}
 }
 function fit(){scale=Math.min(w/source.width,h/source.height)*zoom;x=(w-source.width*scale)/2;y=(h-source.height*scale)/2;}
 function region(next){kind=next;corner=null;pointer=null;draft=getState().boxes[kind]?.slice()||null;$('touch-title').textContent='Mark '+names[kind].toLowerCase();for(const button of dialog.querySelectorAll('[data-touch-region]'))button.setAttribute('aria-pressed',String(button.dataset.touchRegion===kind));message('Use two taps for opposite corners. Zoom and move the photo for a closer view.');draw();}
 function point(e,clamp=false){const r=canvas.getBoundingClientRect();let px=(e.clientX-r.left-x)/scale,py=(e.clientY-r.top-y)/scale;if(!clamp&&(px<0||py<0||px>source.width||py>source.height))return null;return{x:Math.max(0,Math.min(source.width,px)),y:Math.max(0,Math.min(source.height,py))};}
 function box(a,b){return[Math.floor(Math.min(a.y,b.y)),Math.floor(Math.min(a.x,b.x)),Math.ceil(Math.max(a.y,b.y)),Math.ceil(Math.max(a.x,b.x))];}
 function setTool(next){tool=next;pointer=null;corner=null;for(const button of dialog.querySelectorAll('[data-touch-tool]'))button.setAttribute('aria-pressed',String(button.dataset.touchTool===tool));canvas.style.cursor=tool==='pan'?'grab':'crosshair';draw();}
 function setZoom(value){const old=scale,ax=(w/2-x)/old,ay=(h/2-y)/old;zoom=Math.max(1,Math.min(8,Number(value)));scale=Math.min(w/source.width,h/source.height)*zoom;x=w/2-ax*scale;y=h/2-ay*scale;$('touch-zoom').value=zoom;$('touch-zoom-value').textContent=zoom.toFixed(1)+'×';draw();}
 function close(){pointer=null;corner=null;draft=null;source=null;if(dialog.open)dialog.close();}
 $('touch-editor-button').addEventListener('click',()=>{
  const state=getState();if(!state.editable)return;source=state.source;zoom=1;$('touch-zoom').value=1;$('touch-zoom-value').textContent='1.0×';dialog.showModal();
  const rect=canvas.getBoundingClientRect();w=rect.width;h=rect.height;fit();setTool('mark');region(state.active);
 });
 $('touch-close').addEventListener('click',close);dialog.addEventListener('close',()=>{source=null;pointer=null;corner=null;$('touch-editor-button').focus({preventScroll:true});});
 for(const button of dialog.querySelectorAll('[data-touch-region]'))button.addEventListener('click',()=>region(button.dataset.touchRegion));
 for(const button of dialog.querySelectorAll('[data-touch-tool]'))button.addEventListener('click',()=>setTool(button.dataset.touchTool));
 $('touch-zoom').addEventListener('input',e=>setZoom(e.target.value));
 $('touch-zoom-in').addEventListener('click',()=>setZoom(zoom+.5));$('touch-zoom-out').addEventListener('click',()=>setZoom(zoom-.5));
 $('touch-reset-view').addEventListener('click',()=>{zoom=1;fit();$('touch-zoom').value=1;$('touch-zoom-value').textContent='1.0×';draw();});
 $('touch-redraw').addEventListener('click',()=>{draft=null;corner=null;setTool('mark');message('Tap the first corner, then the opposite corner.');draw();});
 canvas.addEventListener('pointerdown',e=>{
  if(pointer||e.button!==0)return;const p=point(e);if(tool==='mark'&&!p)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);
  pointer={id:e.pointerId,start:p,clientX:e.clientX,clientY:e.clientY,x,y,previous:draft?.slice()||null};
 });
 canvas.addEventListener('pointermove',e=>{
  if(pointer?.id!==e.pointerId)return;e.preventDefault();
  if(tool==='pan'){x=pointer.x+e.clientX-pointer.clientX;y=pointer.y+e.clientY-pointer.clientY;}
  else if(Math.hypot(e.clientX-pointer.clientX,e.clientY-pointer.clientY)>8)draft=box(corner||pointer.start,point(e,true));draw();
 });
 canvas.addEventListener('pointerup',e=>{
  if(pointer?.id!==e.pointerId)return;e.preventDefault();const p=point(e,true),moved=Math.hypot(e.clientX-pointer.clientX,e.clientY-pointer.clientY)>8;
  if(tool==='mark'){
   if(moved||corner){draft=box(corner||pointer.start,p);corner=null;message('Adjust the box if needed, then save it.');}
   else{corner=p;message('Now tap the opposite corner.');}
  }
  pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);draw();
 });
 canvas.addEventListener('pointercancel',()=>{if(pointer)draft=pointer.previous;pointer=null;corner=null;draw();});
 for(const button of dialog.querySelectorAll('[data-touch-adjust]'))button.addEventListener('click',()=>{
  if(!draft||corner)return;const step=Math.max(1,Math.round(2/scale)),[t,l,b,r]=draft,dx=r-l,dy=b-t;let next=draft.slice();
  switch(button.dataset.touchAdjust){
   case 'left':next=[t,Math.max(0,l-step),b,Math.max(0,l-step)+dx];break;
   case 'right':next=[t,Math.min(source.width-dx,l+step),b,Math.min(source.width-dx,l+step)+dx];break;
   case 'up':next=[Math.max(0,t-step),l,Math.max(0,t-step)+dy,r];break;
   case 'down':next=[Math.min(source.height-dy,t+step),l,Math.min(source.height-dy,t+step)+dy,r];break;
   case 'wider':next[3]=Math.min(source.width,r+step);break;
   case 'narrower':next[3]=Math.max(l+3,r-step);break;
   case 'taller':next[2]=Math.min(source.height,b+step);break;
   case 'shorter':next[2]=Math.max(t+3,b-step);break;
  }
  draft=next;draw();
 });
 $('touch-save').addEventListener('click',()=>{
  if(!enabled())return;
  try{onSave(kind,draft.slice());if(Object.keys(getState().boxes).length===3)close();else region(getState().active);}
  catch(e){message(e.message);}
 });
 new ResizeObserver(()=>{if(dialog.open&&source){const rect=canvas.getBoundingClientRect();w=rect.width;h=rect.height;fit();draw();}}).observe(canvas);
 return{close};
}
