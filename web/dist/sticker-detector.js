import {sampleSticker} from './sticker-calibration.js';
// Local color/layout heuristic, not OCR or a clinically validated classifier.
// Input is a small decoded image. The caller keeps original pixels for inference.
function colorClass(r,g,b){
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b);
  if(hi<30||hi>252||(hi-lo)/hi<.22)return 0;
  if(r>g*1.18&&r>b*1.35&&(r-g)/(r-b)>.38)return 1;
  if(b>r*1.12&&b>g*1.05)return 2;
  if(r>b*1.45&&g>b*1.45&&r/g>.78&&r/g<1.65)return 3;
  return 0;
}
function components(mask,w,h,color){
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length),out=[];
  for(let start=0;start<mask.length;start++){
    if(seen[start]||mask[start]!==color)continue;
    let head=0,tail=1;queue[0]=start;seen[start]=1;
    let left=w,right=0,top=h,bottom=0,sx=0,sy=0;
    while(head<tail){
      const index=queue[head++],x=index%w,y=Math.floor(index/w);left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);sx+=x+.5;sy+=y+.5;
      for(const next of [x>0?index-1:-1,x+1<w?index+1:-1,y>0?index-w:-1,y+1<h?index+w:-1])if(next>=0&&!seen[next]&&mask[next]===color){seen[next]=1;queue[tail++]=next;}
    }
    const width=right-left,height=bottom-top,fill=tail/(width*height);
    if(tail>=25&&width>=7&&height>=7&&width/height>.18&&width/height<5&&fill>.12&&fill<.92)out.push({left,right,top,bottom,area:tail,x:sx/tail,y:sy/tail});
  }
  return out.sort((a,b)=>b.area-a.area).slice(0,8);
}
// Largest axis-aligned square fully inside one mask avoids letter edges/gaps.
function interior(mask,w,bounds,predicate){
  const previous=new Uint16Array(w+1),current=new Uint16Array(w+1);let best=0,bx=0,by=0;
  for(let y=bounds.top;y<bounds.bottom;y++){
    current.fill(0);
    for(let x=bounds.left;x<bounds.right;x++)if(predicate(mask[y*w+x],x,y)){
      const side=1+Math.min(current[x],previous[x],previous[x+1]);current[x+1]=side;
      if(side>best){best=side;bx=x;by=y;}
    }
    previous.set(current);
  }
  // Leave an extra pixel of breathing room around the sampled interior.
  const size=Math.floor(best*.6);if(size<5)return null;
  const inset=Math.floor((best-size)/2),left=bx-best+1+inset,top=by-best+1+inset;
  return [top,left,top+size,left+size];
}
export function detectSticker(image){
  const {width:w,height:h,data}=image||{};
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>800||h>800||data?.length!==w*h*4)throw Error('Sticker detection needs a decoded preview no larger than 800 pixels per side.');
  const mask=new Uint8Array(w*h);
  for(let i=0;i<mask.length;i++)mask[i]=colorClass(data[i*4],data[i*4+1],data[i*4+2]);
  const groups=[1,2,3].map(c=>components(mask,w,h,c)),candidates=[];
  for(const m of groups[0])for(const l of groups[1])for(const yellow of groups[2]){
    const dx=yellow.x-m.x,dy=yellow.y-m.y,length=Math.hypot(dx,dy);if(length<25)continue;
    const position=((l.x-m.x)*dx+(l.y-m.y)*dy)/(length*length);
    const deviation=Math.abs((l.x-m.x)*dy-(l.y-m.y)*dx)/(length*length);
    const areas=[m.area,l.area,yellow.area];
    if(position<.2||position>.8||deviation>.18||Math.max(...areas)/Math.min(...areas)>5)continue;
    const sizes=[m,l,yellow].map(c=>Math.hypot(c.right-c.left,c.bottom-c.top));
    if(length/Math.max(...sizes)<.9||length/Math.min(...sizes)>5)continue;
    // A large colored interior can contain clipped camera pixels (especially
    // yellow ink's blue channel). Search for a clean interior instead of taking
    // the largest color-only square and rejecting the entire visible logo.
    const cleanColor=color=>(v,x,y)=>{
      const i=(y*w+x)*4;
      return v===color&&Math.min(data[i],data[i+1],data[i+2])>3&&Math.max(data[i],data[i+1],data[i+2])<251;
    };
    const b={mlhM:interior(mask,w,m,cleanColor(1)),mlhL:interior(mask,w,l,cleanColor(2)),mlhH:interior(mask,w,yellow,cleanColor(3))};
    if(Object.values(b).some(box=>!box))continue;
    // Empty interior of the L's bounding rectangle is on the printed white backing,
    // rather than an arbitrary bright object elsewhere in the photograph.
    const margin=2,whiteBounds={left:l.left+margin,right:l.right-margin,top:l.top+margin,bottom:l.bottom-margin};
    b.white=interior(mask,w,whiteBounds,(v,x,y)=>{
      const i=(y*w+x)*4,r=data[i],g=data[i+1],blue=data[i+2];
      return v===0&&Math.min(r,g,blue)>=45&&Math.max(r,g,blue)<251&&Math.max(r,g,blue)/Math.min(r,g,blue)<1.5;
    });
    if(!b.white)continue;
    try{sampleSticker(image,b);}catch{continue;}
    const score=deviation+Math.abs(position-.5)*.3;
    candidates.push({boxes:b,score,center:[(m.x+yellow.x)/2,(m.y+yellow.y)/2],span:length});
  }
  candidates.sort((a,b)=>a.score-b.score);
  if(!candidates.length)return {boxes:null,reason:'No clear MLH sticker found. Keep the full logo sharp and well lit, or mark white, M, L and H manually.'};
  const first=candidates[0];
  if(candidates.some((other,i)=>i>0&&Math.hypot(other.center[0]-first.center[0],other.center[1]-first.center[1])>Math.min(other.span,first.span)*.5&&other.score-first.score<.08))return {boxes:null,reason:'More than one possible MLH sticker found. Keep just one in view, or mark the patches manually.'};
  return {boxes:first.boxes,reason:'Sticker regions found. Adjust any box if needed.'};
}
export function scaleStickerBoxes(boxes,fromWidth,fromHeight,toWidth,toHeight){
  const sx=toWidth/fromWidth,sy=toHeight/fromHeight;
  return Object.fromEntries(Object.entries(boxes).map(([key,[t,l,b,r]])=>[key,[Math.ceil(t*sy),Math.ceil(l*sx),Math.floor(b*sy),Math.floor(r*sx)]]));
}
