import test from 'node:test';
import assert from 'node:assert/strict';
import {createTorchController} from '../dist/torch.js';
function track({capability=true,report=true,reject=false}={}){
 let on=false;const calls=[];
 return{calls,getCapabilities:()=>({torch:capability}),getSettings:()=>report?{torch:on}:{},getConstraints:()=>({width:{ideal:1280},advanced:[{focusMode:'continuous',torch:false}]}),applyConstraints:async value=>{calls.push(value);if(reject)throw new Error('unsupported');on=value.torch;}};
}
test('Rear camera torch is requested on by default and its reported state is displayed',async()=>{
 const t=track(),c=createTorchController();await c.attach(t);assert.equal(t.calls[0].torch,true);assert.equal(c.state.on,true);assert.equal(c.state.busy,false);assert.deepEqual(t.calls[0].width,{ideal:1280});assert.deepEqual(t.calls[0].advanced,[{focusMode:'continuous'},{torch:true}]);
});
test('Toggle switches off and preserves the user choice for the next camera session',async()=>{
 const c=createTorchController(),t=track();await c.attach(t);await c.toggle();assert.equal(c.state.on,false);const next=track();await c.attach(next);assert.equal(next.calls[0].torch,false);await c.toggle();assert.equal(c.state.on,true);
});
test('Unsupported cameras expose an unavailable state without applying constraints',async()=>{
 for(const capability of [false,undefined,[false]]){const t=track({capability}),c=createTorchController();if(capability===undefined)t.getCapabilities=()=>({});await c.attach(t);assert.equal(c.state.supported,false);assert.equal(t.calls.length,0);await c.toggle();assert.equal(t.calls.length,0);}
});
test('Sequence capabilities are supported and unreported settings never claim the light is on',async()=>{
 const c=createTorchController();await c.attach(track({capability:[false,true],report:false}));assert.equal(c.state.supported,true);assert.equal(c.state.on,null);assert.ok(c.state.message.includes('does not report'));await c.toggle();assert.equal(c.state.requested,false);
});
test('Rejected torch changes do not reject camera attachment',async()=>{
 const c=createTorchController();await c.attach(track({reject:true}));assert.equal(c.state.on,false);assert.equal(c.state.busy,false);assert.ok(c.state.message.includes('could not be changed'));
});
test('Stopping a camera ignores an old pending constraint result',async()=>{
 let resolve;const t=track();t.applyConstraints=()=>new Promise(r=>{resolve=r;});const c=createTorchController(),pending=c.attach(t);assert.equal(c.state.busy,true);c.reset();resolve();await pending;assert.equal(c.state.supported,false);assert.equal(c.state.on,null);assert.equal(c.state.busy,false);
});
test('Capability and settings exceptions fail gracefully',async()=>{
 const c=createTorchController(),t=track();t.getCapabilities=()=>{throw new Error();};await c.attach(t);assert.equal(c.state.supported,false);const broken=track({reject:true});broken.getSettings=()=>{throw new Error();};await c.attach(broken);assert.equal(c.state.on,null);assert.equal(c.state.busy,false);
});
