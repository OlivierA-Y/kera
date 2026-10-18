import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureTimer} from '../dist/capture-timer.js';
function clock(){let time=0,id=0;const tasks=new Map();return{now:()=>time,schedule(fn,delay){const key=++id;tasks.set(key,{fn,at:time+delay});return key;},unschedule:key=>tasks.delete(key),get tasks(){return tasks;},advance(ms){const target=time+ms;for(;;){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=target;},jump(ms){time+=ms;const all=[...tasks.values()];tasks.clear();for(const task of all)task.fn();}};}
function setup(){const fake=clock(),changes=[];let ready=true,captures=0;const timer=createCaptureTimer({...fake,canCapture:()=>ready,onCapture:()=>captures++,onChange:s=>changes.push(s)});return{fake,timer,changes,get captures(){return captures;},set ready(v){ready=v;}};}
test('Five-second shutter counts down and captures exactly once, never early',()=>{
 const f=setup();assert.equal(f.timer.start(),true);assert.equal(f.timer.active,true);assert.deepEqual(f.changes,[5]);assert.equal(f.timer.start(),false);
 f.fake.advance(4999);assert.equal(f.captures,0);assert.deepEqual(f.changes,[5,4,3,2,1]);
 f.fake.advance(1);assert.equal(f.captures,1);assert.equal(f.timer.active,false);assert.deepEqual(f.changes,[5,4,3,2,1,0]);f.fake.advance(10000);assert.equal(f.captures,1);
});
test('Cancel, stopping camera or hiding the page prevents even a queued callback from capturing',()=>{
 const f=setup();f.timer.start();const old=[...f.fake.tasks.values()][0].fn;f.fake.advance(1000);f.timer.cancel();old();f.fake.advance(10000);
 assert.equal(f.captures,0);assert.equal(f.timer.active,false);assert.equal(f.fake.tasks.size,0);assert.equal(f.changes.at(-1),0);
});
test('A canceled generation cannot fire during a newly started countdown',()=>{
 const f=setup();f.timer.start();const old=[...f.fake.tasks.values()][0].fn;f.timer.cancel();f.timer.start();old();f.fake.advance(4999);assert.equal(f.captures,0);f.fake.advance(1);assert.equal(f.captures,1);
});
test('Camera must be ready both when starting and throughout the countdown',()=>{
 const f=setup();f.ready=false;assert.equal(f.timer.start(),false);assert.deepEqual(f.changes,[]);f.ready=true;f.timer.start();f.fake.advance(4000);f.ready=false;f.fake.advance(1000);assert.equal(f.captures,0);assert.equal(f.timer.active,false);f.ready=true;f.fake.advance(5000);assert.equal(f.captures,0);
});
test('Delayed ticks use elapsed time rather than extending the countdown',()=>{
 const f=setup();f.timer.start();f.fake.jump(6000);assert.equal(f.captures,1);assert.deepEqual(f.changes,[5,0]);assert.equal(f.timer.active,false);
});
test('Readiness is rechecked at the shutter after rendering the end of the timer',()=>{
 const fake=clock();let ready=true,captured=false;const timer=createCaptureTimer({...fake,canCapture:()=>ready,onChange:s=>{if(s===0)ready=false;},onCapture:()=>{captured=true;}});timer.start();fake.advance(5000);assert.equal(captured,false);
});
