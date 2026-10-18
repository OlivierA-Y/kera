import test from 'node:test';
import assert from 'node:assert/strict';
import {readCameraAdjustment,saveCameraAdjustment,adjustHemoglobin} from '../dist/camera-adjustment.js';
const storage=initial=>{let value=initial;return{getItem:()=>value,setItem:(_,next)=>{value=next;}};};
test('Reported comparison uses an additive offset without overwriting raw values or forcing all readings to 155',()=>{
  assert.deepEqual(adjustHemoglobin(170,true),{raw:170,offset:-15,value:155});
  assert.equal(adjustHemoglobin(180,true).value,165);
  assert.equal(adjustHemoglobin(155,false).value,155);
  assert.equal(adjustHemoglobin(100).value,100);
  assert.equal(adjustHemoglobin(10,true).value,-5);
  const mean=(167.123+172.456)/2;
  assert.equal(adjustHemoglobin(mean,true).value,mean-15);
  for(const input of [NaN,Infinity,null,'170'])assert.throws(()=>adjustHemoglobin(input,true));
});
test('Phone default is independent of viewport size and desktop stays raw',()=>{
  for(const userAgent of ['Mozilla iPhone OS 18','Mozilla Android 14 Mobile'])assert.equal(readCameraAdjustment({storage:storage(null),userAgent,mobile:false}),true);
  assert.equal(readCameraAdjustment({storage:storage(null),userAgent:'Desktop Chrome',mobile:false}),false);
  assert.equal(readCameraAdjustment({storage:storage(null),userAgent:'',mobile:true}),true);
});
test('Explicit browser preference overrides detection and survives subsequent reads',()=>{
  const local=storage(null);saveCameraAdjustment(false,local);
  assert.equal(readCameraAdjustment({storage:local,userAgent:'iPhone'}),false);
  saveCameraAdjustment(true,local);assert.equal(readCameraAdjustment({storage:local,userAgent:'Desktop'}),true);
  assert.equal(readCameraAdjustment({storage:storage('invalid'),userAgent:'Desktop',mobile:false}),false);
});
test('Blocked storage still permits using camera adjustment for the page',()=>{
  const blocked={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}};
  assert.doesNotThrow(()=>saveCameraAdjustment(true,blocked));
  assert.equal(readCameraAdjustment({storage:blocked,userAgent:'iPhone'}),true);
});
