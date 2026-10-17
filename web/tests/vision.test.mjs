import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp, validateInput } from '../server.mjs';
import { FINDINGS, buildRequest, validateObservation, parseProviderResponse, analyzePhotos } from '../server/vision.mjs';
// Synthetic gray image for local transport tests. Tests NEVER contact OpenAI.
const image='data:image/jpeg;base64,'+readFileSync(new URL('./fixtures/synthetic.jpg',import.meta.url)).toString('base64');
const photos=[{view:'top',data_url:image}];
const body={consent:true,photos};
function observation(){return{image_quality:{assessment:'adequate',reason:'The nail surface is in focus.'},observations:Object.fromEntries(Object.keys(FINDINGS).map(key=>[key,{status:'not_observed',evidence:'No clear surface change is visible in the top photo.',view:'top'}]))};}
async function fixture(options,fn){
 const server=createApp(options);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{await fn(base);}finally{await new Promise(resolve=>server.close(resolve));}
}
function post(base,value=body,headers={}){return fetch(base+'/api/vision/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(value)});}
test('Responses payload uses images, strict morphology schema, no persistence and no tools',()=>{
 const request=buildRequest(photos,'gpt-4.1');assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(request.input[0].content[1].type,'input_image');assert.equal(request.tools,undefined);assert.ok(!JSON.stringify(request).includes('Bearer'));
});
test('Consent, image payload, required top view and duplicate views are validated',()=>{
 assert.throws(()=>validateInput({...body,consent:false}),/Permission/);
 assert.throws(()=>validateInput({consent:true,photos:[{view:'top',data_url:'https://example.com/private.jpg'}]}),/JPEG/);
 assert.throws(()=>validateInput({consent:true,photos:[photos[0],photos[0]]}),/unique/);
 assert.throws(()=>validateInput({consent:true,photos:[{...photos[0],view:'side'}]}),/top view/);
 assert.throws(()=>validateInput({consent:true,photos:[{view:'top',data_url:'data:image/jpeg;base64,YWJjZA=='}]}),/JPEG/);
 assert.equal(validateInput(body).length,1);
});
test('No side view overrides even confidently visible shape claims to unclear',()=>{
 const value=observation();value.observations.clubbing={status:'visible',evidence:'The tip looks enlarged.',view:'side'};
 const checked=validateObservation(value,false);assert.equal(checked.observations.clubbing.status,'unclear');assert.equal(checked.observations.spooning.status,'unclear');
});
test('Unusable images yield only unclear findings and reject extra diagnosis fields',()=>{
 const value=observation();value.image_quality.assessment='unusable';
 assert.ok(Object.values(validateObservation(value,true).observations).every(item=>item.status==='unclear'));
 const bad=observation();bad.diagnosis='anything';assert.throws(()=>validateObservation(bad,true),/incomplete/);
});
test('Diagnostic and unvalidated confidence prose fail closed',()=>{
 for(const evidence of ['You have psoriasis.','The nail is healthy.','Confidence 95%.','Use an antifungal medication.']){
  const value=observation();value.observations.pitting.evidence=evidence;assert.throws(()=>validateObservation(value,true),/morphology-only/);
 }
});
test('Provider refusal, incomplete or malformed output returns no observations',()=>{
 assert.throws(()=>parseProviderResponse({status:'completed',output:[{content:[{type:'refusal',refusal:'No'}]}]},false),/could not assess/);
 assert.throws(()=>parseProviderResponse({status:'incomplete',output:[]},false),/did not finish/);
 assert.throws(()=>parseProviderResponse({status:'completed',output:[{content:[{type:'output_text',text:'not JSON'}]}]},false),/unreadable/);
});
test('Provider call uses fixed HTTPS endpoint, server-only bearer and parsed output',async()=>{
 let payload;
 const result=await analyzePhotos(photos,{apiKey:'test-not-a-secret',model:'gpt-4.1',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer test-not-a-secret');payload=JSON.parse(options.body);
  return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(observation())}]}]}),{status:200});
 }});
 assert.equal(payload.store,false);assert.equal(result.observations.clubbing.status,'unclear');
});
test('Provider errors never leak arbitrary response details',async()=>{
 for(const status of [401,403,429,500])await assert.rejects(analyzePhotos(photos,{apiKey:'test',model:'gpt-4.1',fetchImpl:async()=>new Response('SECRET PROVIDER DETAIL',{status})}),e=>!e.message.includes('SECRET'));
});
test('Static app works without a key; API cannot read environment or server source',async()=>{
 await fixture({apiKey:''},async base=>{
  assert.equal((await fetch(base+'/')).status,200);
  const status=await(await fetch(base+'/api/vision/status')).json();assert.equal(status.configured,false);assert.equal(status.model,null);
  for(const route of ['/.env','/server.mjs','/server/vision.mjs','/../.env'])assert.equal((await fetch(base+route)).status,404);
  const result=await post(base);assert.equal(result.status,503);assert.equal((await result.json()).error.code,'not_configured');
 });
});
test('Missing consent, hostile origin, method, Host and media type never call provider',async()=>{
 let calls=0;await fixture({apiKey:'test',provider:async()=>{calls++;return observation();}},async base=>{
  assert.equal((await post(base,{...body,consent:false})).status,400);
  assert.equal((await post(base,body,{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await post(base,body,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await fetch(base+'/api/vision/analyze')).status,405);
  assert.equal(await new Promise((resolve,reject)=>{const req=request(base+'/api/vision/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();}),403);
  assert.equal((await post(base,body,{'Sec-Fetch-Site':'cross-site'})).status,403);
 });assert.equal(calls,0);
});
test('Successful API returns structured observations without photos or credentials',async()=>{
 await fixture({apiKey:'test-hidden-key',provider:async()=>observation()},async base=>{
  const response=await post(base);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const result=await response.json();assert.equal(result.provider,'OpenAI');assert.equal(result.observations.clubbing.status,'unclear');assert.ok(result.limitation.includes('not a diagnosis'));
  const serialized=JSON.stringify(result);assert.ok(!serialized.includes('test-hidden-key'));assert.ok(!serialized.includes('base64'));
 });
});
test('Side-view evidence is retained only when a side view was actually supplied',async()=>{
 await fixture({apiKey:'test',provider:async()=>{const value=observation();value.observations.spooning={status:'visible',evidence:'The nail dips inward in the side photo.',view:'side'};return value;}},async base=>{
  const response=await post(base,{consent:true,photos:[...photos,{view:'side',data_url:image}]});assert.equal(response.status,200);assert.equal((await response.json()).observations.spooning.status,'visible');
 });
});
test('Local rate limit caps paid requests',async()=>{
 let calls=0;await fixture({apiKey:'test',maxRequests:1,provider:async()=>{calls++;return observation();}},async base=>{
  assert.equal((await post(base)).status,200);assert.equal((await post(base)).status,429);
 });assert.equal(calls,1);
});
test('Oversized bodies and arbitrary URLs are rejected before external access',async()=>{
 await fixture({apiKey:'test',provider:async()=>{throw new Error('must not call');}},async base=>{
  const response=await post(base,{consent:true,photos:[{view:'top',data_url:'x'.repeat(5100000)}]});assert.equal(response.status,413);
 });
});
test('Timeout and unexpected provider error fail closed without sensitive text',async()=>{
 await fixture({apiKey:'test',timeoutMs:10,provider:async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('private detail'))))},async base=>{
  const response=await post(base);assert.equal(response.status,504);assert.ok(!JSON.stringify(await response.json()).includes('private detail'));
 });
 await fixture({apiKey:'test',provider:async()=>{throw new Error('Bearer test-hidden-key');}},async base=>{
  const response=await post(base);assert.equal(response.status,500);assert.ok(!JSON.stringify(await response.json()).includes('test-hidden-key'));
 });
});
