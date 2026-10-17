import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentile, centralBox, validateBox, extractFeatures, validateModel, predict } from '../dist/ml.js';
const model=validateModel(JSON.parse(readFileSync(new URL('../dist/assets/model.json',import.meta.url))));
const fixtures=JSON.parse(readFileSync(new URL('./parity-fixtures.json',import.meta.url)));
test('Frozen browser ensemble matches PyTorch CPU on ten training patients',()=>{
  let max=0;
  fixtures.features.forEach((f,i)=>{const diff=Math.abs(predict(model,f)-fixtures.predictions[i]);max=Math.max(max,diff);assert.ok(diff<.0001,`difference ${diff}`);});
  console.log(`Maximum browser/PyTorch difference: ${max} g/L`);
});
test('Percentile uses NumPy linear interpolation',()=>{assert.equal(percentile([0,10,20,30],15),4.5);assert.equal(percentile([1,9],50),5);});
test('Central geometry follows notebook floor convention',()=>assert.deepEqual(centralBox([0,0,11,17]),[2,3,8,13]));
test('Invalid boxes and nonfinite features rejected',()=>{
  for(const box of [[0,0,31,2],[0,0,1.2,3],[0,0,0,2],[-1,0,3,3]])assert.throws(()=>validateBox(box,30,30));
  assert.throws(()=>predict(model,Array(42).fill(NaN)));assert.throws(()=>predict(model,Array(41).fill(0)));
});
function fixture(){const data=new Uint8ClampedArray(30*40*4);for(let y=0;y<30;y++)for(let x=0;x<40;x++){const rgb=y<10&&x<10?[100,25,10]:y>=10&&y<20&&x>=10&&x<20?[40,60,20]:[200,100,50];data.set([...rgb,255],(y*40+x)*4);}return{width:40,height:30,data};}
const boxes={nail:[0,0,10,10],skin:[10,10,20,20],white:[20,20,30,30]};
test('All 42 synthetic RGB descriptors have exact channel/tissue ordering',()=>{
  const {features}=extractFeatures(fixture(),boxes);const expected=[.5,.25,.2,.2,.6,.4].flatMap(value=>Array(7).fill(value));assert.deepEqual(features,expected);
});
test('Black reference rejected and overlapping tissue/reference rejected',()=>{
  const image=fixture();for(let y=20;y<30;y++)for(let x=20;x<30;x++)image.data.set([0,0,0,255],(y*40+x)*4);
  assert.throws(()=>extractFeatures(image,boxes),/too dark/);assert.throws(()=>extractFeatures(fixture(),{...boxes,skin:boxes.nail}),/non-overlapping/);
});
test('Quality warnings are returned without fabricated confidence',()=>{
  const image=fixture();for(let y=0;y<10;y++)for(let x=0;x<10;x++)image.data.set([255,255,255,255],(y*40+x)*4);
  const result=extractFeatures(image,boxes);assert.ok(result.warnings.some(w=>w.includes('clipped')));assert.equal(result.confidence,undefined);
});
test('Model schema protects feature order and version',()=>{
  assert.throws(()=>validateModel({...model,feature_version:'wrong'}));assert.throws(()=>validateModel({...model,feature_names:[...model.feature_names].reverse()}));
});
