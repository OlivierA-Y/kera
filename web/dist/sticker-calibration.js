import {validateBox,percentile} from './ml.js';
export const PATCHES=['white','mlhM','mlhL','mlhH'];
export const PROFILE_KEY='kera.mlh-reference.v1';
const FORMAT='kera-mlh-reference-v1';
function overlap(a,b){return Math.min(a[2],b[2])>Math.max(a[0],b[0])&&Math.min(a[3],b[3])>Math.max(a[1],b[1]);}
export function sampleSticker(image,boxes){
  if(!image||image.data?.length!==image.width*image.height*4)throw Error('The sticker photo could not be read.');
  const colors=[];
  for(const [i,key] of PATCHES.entries()){
    const box=validateBox(boxes[key],image.width,image.height);
    if(box[2]-box[0]<5||box[3]-box[1]<5)throw Error('Each sticker patch needs a box at least 5 × 5 photo pixels.');
    for(const previous of PATCHES.slice(0,i))if(overlap(box,boxes[previous]))throw Error('Keep sticker patch boxes separate.');
    for(const tissue of ['nail','skin'])if(boxes[tissue]&&overlap(box,boxes[tissue]))throw Error('Keep the sticker separate from nail and skin regions.');
    const channels=[[],[],[]];let clipped=0;
    for(let y=box[0];y<box[2];y++)for(let x=box[1];x<box[3];x++)for(let c=0;c<3;c++){
      const value=image.data[(y*image.width+x)*4+c];
      if(!Number.isFinite(value)||value<0||value>255)throw Error('The sticker contains invalid pixel values.');
      channels[c].push(value);if(value<=1||value>=254)clipped++;
    }
    if(clipped/(channels[0].length*3)>.02)throw Error('A sticker patch has clipped highlights or deep shadows. Reduce glare and retake.');
    for(const values of channels){values.sort((a,b)=>a-b);if(percentile(values,95)-percentile(values,5)>40)throw Error('A sticker box includes edges, lettering gaps, glare or uneven light. Mark a uniform interior.');}
    colors.push(channels.map(values=>percentile(values,50)));
  }
  validateColors(colors);return colors;
}
function inverse(a){
  const rows=a.map((r,i)=>[...r,...[0,1,2].map(j=>Number(i===j))]);
  for(let c=0;c<3;c++){
    let pivot=c;for(let r=c+1;r<3;r++)if(Math.abs(rows[r][c])>Math.abs(rows[pivot][c]))pivot=r;
    if(Math.abs(rows[pivot][c])<1e-9)throw Error('The sticker colors are too similar. Mark the colored interiors of M, L and H.');
    [rows[c],rows[pivot]]=[rows[pivot],rows[c]];const scale=rows[c][c];rows[c]=rows[c].map(v=>v/scale);
    for(let r=0;r<3;r++)if(r!==c){const k=rows[r][c];rows[r]=rows[r].map((v,j)=>v-k*rows[c][j]);}
  }
  return rows.map(r=>r.slice(3));
}
const gram=x=>[0,1,2].map(i=>[0,1,2].map(j=>x.reduce((s,r)=>s+r[i]*r[j],0)));
const norm=a=>Math.max(...a.map(r=>r.reduce((s,v)=>s+Math.abs(v),0)));
const normalized=colors=>colors.map(rgb=>rgb.map((v,c)=>v/colors[0][c]));
function validateColors(colors){
  if(!Array.isArray(colors)||colors.length!==4||!colors.every(r=>Array.isArray(r)&&r.length===3&&r.every(v=>Number.isFinite(v)&&v>1&&v<254)))throw Error('The sticker reference has invalid colors.');
  if(colors[0].some(v=>v<40||v>250))throw Error('The sticker white is too dark or too bright. Use even light and avoid glare.');
  const x=normalized(colors);
  for(let i=0;i<4;i++)for(let j=0;j<i;j++)if(Math.hypot(...x[i].map((v,c)=>v-x[j][c]))<.15)throw Error('The sticker colors are too similar. Mark M, L, H and white separately.');
  const g=gram(x);if(norm(g)*norm(inverse(g))>1000)throw Error('The sticker colors do not provide a stable correction. Recheck the patch boxes.');
}
export function validateProfile(profile){
  if(profile?.format!==FORMAT||typeof profile.createdAt!=='string'||!Number.isFinite(Date.parse(profile.createdAt)))throw Error('Choose a valid Kera MLH reference JSON file.');
  validateColors(profile.colors);
  return {format:FORMAT,createdAt:profile.createdAt,colors:profile.colors.map(r=>r.slice())};
}
export function createProfile(image,boxes){return validateProfile({format:FORMAT,createdAt:new Date().toISOString(),colors:sampleSticker(image,boxes)});}
export function readProfile(defaultProfile=null,storage){
  try{return validateProfile(JSON.parse((storage??globalThis.localStorage)?.getItem(PROFILE_KEY)));}catch{}
  try{return validateProfile(defaultProfile);}catch{return null;}
}
export function saveProfile(profile){const safe=validateProfile(profile);try{localStorage.setItem(PROFILE_KEY,JSON.stringify(safe));return true;}catch{return false;}}
export function fitStickerCorrection(colors,profile){
  validateColors(colors);const reference=validateProfile(profile),x=normalized(colors),y=normalized(reference.colors),g=gram(x),lambda=.005;
  // Solve X B ≈ Y with an identity prior; no unconstrained affine offset.
  const inv=inverse(g.map((row,i)=>row.map((v,j)=>v+(i===j?lambda:0))));
  const rhs=[0,1,2].map(i=>[0,1,2].map(j=>x.reduce((s,row,k)=>s+row[i]*y[k][j],0)+(i===j?lambda:0)));
  const matrix=inv.map(row=>[0,1,2].map(j=>row.reduce((s,v,k)=>s+v*rhs[k][j],0)));
  const map=rgb=>[0,1,2].map(c=>rgb.reduce((s,v,k)=>s+v/colors[0][k]*matrix[k][c],0)*reference.colors[0][c]);
  const error=Math.sqrt(x.reduce((sum,row,i)=>sum+row.reduce((s,_,c)=>s+(row.reduce((t,v,k)=>t+v*matrix[k][c],0)-y[i][c])**2,0),0)/12);
  if(!Number.isFinite(error)||error>.08||matrix.some(row=>row.some(v=>!Number.isFinite(v)||Math.abs(v)>4)))throw Error('The sticker does not match the saved reference reliably. Check the sticker, lighting and patch boxes.');
  return {matrix,error,transform(rgb){const result=map(rgb);if(result.some(v=>!Number.isFinite(v)||v<0||v>255))throw Error('Sticker correction moves a selected region outside the usable color range. Retake in even light.');return result;}};
}
