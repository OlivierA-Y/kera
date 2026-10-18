import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSticker,scaleStickerBoxes} from '../dist/sticker-detector.js';
import {sampleSticker} from '../dist/sticker-calibration.js';
function scene({angle=0,missing=false,duplicate=false,rectangles=false}={}){
 const width=600,height=350,data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4)data.set([205,200,192,255],i);
 const colors=[[180,65,40],[55,65,155],[190,155,40]],rects=[[[0,0,14,70],[24,0,38,70],[46,0,60,70],[0,0,60,14]],[[0,0,14,70],[0,56,60,70]],[[0,0,14,70],[46,0,60,70],[0,28,60,42]]];
 function logo(cx,cy){for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const px=(x-cx)*Math.cos(angle)+(y-cy)*Math.sin(angle)+120,py=-(x-cx)*Math.sin(angle)+(y-cy)*Math.cos(angle)+35;
   for(let k=0;k<(missing?2:3);k++)if((rectangles?[[0,0,60,70]]:rects[k]).some(([l,t,r,b])=>px-k*90>=l&&px-k*90<r&&py>=t&&py<b))data.set([...colors[k],255],(y*width+x)*4);
 }}
 logo(200,170);if(duplicate)logo(490,170);
 return{width,height,data};
}
test('Finds MLH color/layout and places four valid uniform patch boxes',()=>{
 const image=scene(),result=detectSticker(image);assert.ok(result.boxes,result.reason);
 const colors=sampleSticker(image,result.boxes);assert.ok(colors[1][0]>colors[1][1]);assert.ok(colors[2][2]>colors[2][0]);assert.ok(colors[3][1]>colors[3][2]);
});
test('Handles rotated logos without swapping color labels',()=>{
 for(const angle of [-.32,.35,Math.PI/2,Math.PI]){const image=scene({angle}),r=detectSticker(image);assert.ok(r.boxes,`angle ${angle}: ${r.reason}`);sampleSticker(image,r.boxes);}
});
test('Rejects missing colors, filled color rectangles and ambiguous duplicate logos',()=>{
 assert.equal(detectSticker(scene({missing:true})).boxes,null);
 assert.equal(detectSticker(scene({rectangles:true})).boxes,null);
 const double=detectSticker(scene({duplicate:true}));assert.equal(double.boxes,null,double.reason);
});
test('Empty/neutral images fail safely; inputs are bounded and untouched',()=>{
 const image=scene(),original=image.data.slice();detectSticker(image);assert.deepEqual(image.data,original);
 const empty={width:32,height:32,data:new Uint8ClampedArray(32*32*4).fill(200)};assert.equal(detectSticker(empty).boxes,null);
 for(const bad of [null,{}, {width:900,height:1,data:new Uint8ClampedArray(3600)}])assert.throws(()=>detectSticker(bad));
});
test('Maps interior boxes back to original image pixels without expanding their edges',()=>{
 assert.deepEqual(scaleStickerBoxes({white:[1,2,7,9]},10,10,33,25),{white:[3,7,17,29]});
});
test('Browser detector module runs in a separate worker and returns usable regions',async t=>{
 const {Worker}=await import('node:worker_threads');
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={addEventListener(type,fn){parentPort.on(type,data=>fn({data}));},postMessage(data){parentPort.postMessage(data);}};import(${JSON.stringify(new URL('../dist/sticker-detector-worker.js',import.meta.url).href)});`,{eval:true});
 t.after(()=>worker.terminate());
 const image=scene(),copy=image.data.slice();
 const response=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
 worker.postMessage({width:image.width,height:image.height,buffer:copy.buffer},[copy.buffer]);
 const result=await response;assert.ok(result.boxes,result.reason);sampleSticker(image,result.boxes);
});
test('A partly clipped yellow letter uses another clean interior instead of rejecting the whole logo',()=>{
 const image=scene(),first=detectSticker(image);assert.ok(first.boxes);
 // Real-capture regression: yellow ink's blue channel can hit zero in part
 // of a letter while the rest of the printed patch remains usable.
 for(let y=135;y<205;y+=3)for(let x=260;x<274;x+=3)image.data[(y*image.width+x)*4+2]=0;
 assert.throws(()=>sampleSticker(image,first.boxes),/clipped/);
 const fixed=detectSticker(image);assert.ok(fixed.boxes,fixed.reason);
 assert.ok(fixed.boxes.mlhH[1]>=306,'uses the clean right stem');
 sampleSticker(image,fixed.boxes);
 // Fully clipped ink still fails; detection must not relax calibration checks.
 for(let y=0;y<image.height;y++)for(let x=260;x<320;x++){
  const i=(y*image.width+x)*4;if(image.data[i]===190&&image.data[i+1]===155)image.data[i+2]=0;
 }
 assert.equal(detectSticker(image).boxes,null);
});
