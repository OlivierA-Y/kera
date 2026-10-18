import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfile,validateProfile,sampleSticker,fitStickerCorrection,PATCHES,readProfile} from '../dist/sticker-calibration.js';
import {extractFeatures} from '../dist/ml.js';
const colors=[[210,210,210],[180,65,40],[55,65,155],[190,165,40]];
const boxes=Object.fromEntries(PATCHES.map((k,i)=>[k,[0,i*10,8,i*10+8]]));
function image(samples=colors){const data=new Uint8ClampedArray(40*10*4);for(let y=0;y<10;y++)for(let x=0;x<40;x++)data.set([...samples[Math.floor(x/10)],255],(y*40+x)*4);return{width:40,height:10,data};}
test('Reference samples come from median image pixels and profile validation strips unrelated data',()=>{
  const photo=image(),original=photo.data.slice(),profile=createProfile(photo,boxes);
  assert.deepEqual(profile.colors,colors);assert.deepEqual(photo.data,original);
  assert.deepEqual(validateProfile({...profile,photo:'must not persist',key:'secret'}),profile);
  const parsed=JSON.parse(JSON.stringify(profile));assert.deepEqual(validateProfile(parsed),profile);
  for(const bad of [null,{}, {...profile,format:'other'}, {...profile,createdAt:'invalid'}, {...profile,colors:[[1,2,3]]}])assert.throws(()=>validateProfile(bad));
});
test('Identical camera and sticker produce an identity correction within floating-point tolerance',()=>{
  const reference=createProfile(image(),boxes),fit=fitStickerCorrection(colors,reference);
  for(const rgb of [[90,60,55],[150,90,75],colors[0]])fit.transform(rgb).forEach((v,c)=>assert.ok(Math.abs(v-rgb[c])<1e-8));
  assert.ok(fit.error<1e-8);
});
test('Known cross-channel camera mixing is recovered on an unseen tissue color',()=>{
  const mix=rgb=>[.85*rgb[0]+.1*rgb[1],.1*rgb[0]+.85*rgb[1],.95*rgb[2]];
  const current=colors.map(mix),reference=createProfile(image(),boxes),fit=fitStickerCorrection(current,reference);
  const tissue=[145,95,80],mapped=fit.transform(mix(tissue));
  assert.ok(Math.hypot(...mapped.map((v,c)=>v-tissue[c]))<1);
  assert.ok(fit.error<.01);
});
test('Glare, dark reference, mixed edges, tiny/overlapping patches and color-degenerate selections are rejected',()=>{
  for(const samples of [colors.map(c=>c.map(()=>255)),colors.map(c=>c.map(()=>20)),Array(4).fill([150,150,150])])assert.throws(()=>sampleSticker(image(samples),boxes));
  assert.throws(()=>sampleSticker(image(),{...boxes,mlhM:boxes.white}),/separate/);
  assert.throws(()=>sampleSticker(image(),{...boxes,white:[0,0,3,3]}),/5 × 5/);
  assert.throws(()=>sampleSticker(image(),{...boxes,nail:boxes.white}),/separate/);
  const noisy=image();for(let y=0;y<8;y++)for(let x=0;x<4;x++)noisy.data[(y*40+x)*4]=70;
  assert.throws(()=>sampleSticker(noisy,boxes),/uniform/);
});
test('Correction rejects out-of-gamut tissue rather than clipping it into a plausible result',()=>{
  const reference=createProfile(image(),boxes),fit=fitStickerCorrection(colors,reference);
  assert.throws(()=>fit.transform([-10,60,50]),/usable color range/);
});
test('Identity correction preserves the existing feature definition and source photo',()=>{
  const data=new Uint8ClampedArray(30*10*4);
  for(let y=0;y<10;y++)for(let x=0;x<30;x++)data.set([x<10?100:x<20?130:210,80,65,255],(y*30+x)*4);
  const photo={width:30,height:10,data},regions={nail:[0,0,10,10],skin:[0,10,10,20],white:[0,20,10,30]};
  const baseline=extractFeatures(photo,regions),actual=extractFeatures(photo,regions,rgb=>rgb.slice());
  assert.deepEqual(actual,baseline);
});

test('A validated default reference is used only when browser storage has no valid profile',()=>{
 const reference=createProfile(image(),boxes);
 const saved={...reference,createdAt:'2026-10-18T00:00:00.000Z'};
 assert.deepEqual(readProfile(reference,{getItem:()=>null}),reference);
 assert.deepEqual(readProfile(reference,{getItem:()=>'{bad'}),reference);
 assert.deepEqual(readProfile(reference,{getItem:()=>{throw Error('blocked');}}),reference);
 assert.deepEqual(readProfile(reference,{getItem:()=>JSON.stringify(saved)}),saved);
 assert.equal(readProfile(null,{getItem:()=>null}),null);
 const loaded=readProfile(reference,{getItem:()=>null});loaded.colors[0][0]=0;assert.equal(reference.colors[0][0],210);
});
