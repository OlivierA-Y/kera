import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp, validateInput } from '../server.mjs';
import { FINDINGS, buildRequest, validateObservation, parseProviderResponse, analyzePhotos } from '../server/vision.mjs';
// Synthetic gray image for local transport tests. Tests NEVER contact OpenRouter.
const image='data:image/jpeg;base64,'+readFileSync(new URL('./fixtures/synthetic.jpg',import.meta.url)).toString('base64');
const photos=[{view:'top',data_url:image}];
const body={consent:true,photos};
function observation(){return{image_quality:{assessment:'adequate',reason:'The nail surface is in focus.'},observations:Object.fromEntries(Object.keys(FINDINGS).map(key=>[key,{status:'unclear',evidence:'No clear surface change is visible in the top photo.',view:'top'}]))};}
async function fixture(options,fn){
 const server=createApp(options);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{await fn(base);}finally{await new Promise(resolve=>server.close(resolve));}
}
function post(base,value=body,headers={}){return fetch(base+'/api/vision/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(value)});}
test('OpenRouter payload uses images, strict morphology schema, privacy routing and no tools',()=>{
 const request=buildRequest(photos,'google/gemini-2.5-flash');assert.equal(request.provider.data_collection,'deny');assert.equal(request.provider.require_parameters,true);assert.equal(request.response_format.json_schema.strict,true);assert.equal(request.messages[1].content[1].type,'image_url');assert.equal(request.messages[1].content[1].image_url.url,image);assert.equal(request.stream,false);assert.equal(request.tools,undefined);assert.ok(!JSON.stringify(request).includes('Bearer'));
});
test('Consent, image payload, required top view and duplicate views are validated',()=>{
 assert.throws(()=>validateInput({...body,consent:false}),/Permission/);
 assert.throws(()=>validateInput({consent:true,photos:[{view:'top',data_url:'https://example.com/private.jpg'}]}),/JPEG/);
 assert.throws(()=>validateInput({consent:true,photos:[photos[0],photos[0]]}),/unique/);
 assert.throws(()=>validateInput({consent:true,photos:[{...photos[0],view:'side'}]}),/top view/);
 assert.throws(()=>validateInput({consent:true,photos:[{view:'top',data_url:'data:image/jpeg;base64,YWJjZA=='}]}),/JPEG/);
 assert.equal(validateInput(body).length,1);
});
test('Evidence citing an unsupplied angle becomes unclear',()=>{
 const value=observation();value.observations.eczema={status:'possible_features',evidence:'A cracked patch is visible.',view:'side'};
 const checked=validateObservation(value,false);assert.equal(checked.observations.eczema.status,'unclear');assert.equal(checked.observations.skin_cancer.status,'unclear');
});
test('Unusable images yield only unclear findings and reject extra diagnosis fields',()=>{
 const value=observation();value.image_quality.assessment='unusable';
 assert.ok(Object.values(validateObservation(value,true).observations).every(item=>item.status==='unclear'));
 const bad=observation();bad.diagnosis='anything';assert.throws(()=>validateObservation(bad,true),/incomplete/);
});
test('Diagnostic and unvalidated confidence prose fail closed',()=>{
 for(const evidence of ['You have psoriasis.','You have eczema.','This is skin cancer.','The nail is healthy.','Confidence 95%.','Use an antifungal medication.']){
  const value=observation();value.observations.eczema.evidence=evidence;assert.throws(()=>validateObservation(value,true),/descriptive observations/);
 }
});
test('Provider refusal, incomplete or malformed output returns no observations',()=>{
 assert.throws(()=>parseProviderResponse({choices:[{finish_reason:'stop',message:{role:'assistant',refusal:'No'}}]},false),/could not assess/);
 assert.throws(()=>parseProviderResponse({choices:[{finish_reason:'length',message:{role:'assistant',content:'{}'}}]},false),/did not finish/);
 assert.throws(()=>parseProviderResponse({choices:[{finish_reason:'stop',message:{role:'assistant',content:'not JSON'}}]},false),/unreadable/);
});
test('Provider call uses fixed HTTPS endpoint, server-only bearer and parsed output',async()=>{
 let payload;
 const result=await analyzePhotos(photos,{apiKey:'test-not-a-secret',model:'google/gemini-2.5-flash',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-not-a-secret');payload=JSON.parse(options.body);
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(observation())}}]}),{status:200});
 }});
 assert.equal(payload.provider.data_collection,'deny');assert.equal(payload.model,'google/gemini-2.5-flash');assert.equal(result.observations.skin_cancer.status,'unclear');
});
test('Provider errors never leak arbitrary response details',async()=>{
 for(const status of [401,402,403,429,500])await assert.rejects(analyzePhotos(photos,{apiKey:'test',model:'google/gemini-2.5-flash',fetchImpl:async()=>new Response('SECRET PROVIDER DETAIL',{status})}),e=>!e.message.includes('SECRET'));
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
  const result=await response.json();assert.equal(result.provider,'OpenRouter');assert.equal(result.observations.skin_cancer.status,'unclear');assert.ok(result.limitation.includes('not a diagnosis'));
  const serialized=JSON.stringify(result);assert.ok(!serialized.includes('test-hidden-key'));assert.ok(!serialized.includes('base64'));
 });
});
test('Side-view evidence is retained only when a side view was actually supplied',async()=>{
 await fixture({apiKey:'test',provider:async()=>{const value=observation();value.observations.psoriasis={status:'possible_features',evidence:'A sharply bounded scaly patch is visible in the additional photo.',view:'side'};return value;}},async base=>{
  const response=await post(base,{consent:true,photos:[...photos,{view:'side',data_url:image}]});assert.equal(response.status,200);assert.equal((await response.json()).observations.psoriasis.status,'possible_features');
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
test('Provider data collection requires explicit server opt-in',async()=>{
 assert.equal(buildRequest(photos,'test-model').provider.data_collection,'deny');
 assert.equal(buildRequest(photos,'test-model',true).provider.data_collection,'allow');
 let seen;
 await fixture({apiKey:'test',allowDataCollection:true,provider:async(_,options)=>{seen=options.allowDataCollection;return observation();}},async base=>{
  assert.equal((await (await fetch(base+'/api/vision/status')).json()).dataCollection,'allowed');
  assert.equal((await post(base)).status,200);
 });assert.equal(seen,true);
 await fixture({apiKey:'test',allowDataCollection:false},async base=>assert.equal((await (await fetch(base+'/api/vision/status')).json()).dataCollection,'denied'));
});
test('Privacy and unsupported endpoint errors are actionable without exposing provider text',async()=>{
 for(const [status,message,code] of [[404,'No endpoints found matching your data policy (Free model training). SECRET','provider_privacy'],[404,'No endpoints found supporting the requested parameters SECRET','provider_configuration'],[400,'Unsupported schema SECRET','provider_configuration']]){
  await assert.rejects(analyzePhotos(photos,{apiKey:'test',model:'test',fetchImpl:async()=>new Response(JSON.stringify({error:{message}}),{status})}),e=>e.status===503&&e.code===code&&!e.message.includes('SECRET'));
 }
});

test('Review schema has only the four requested categories and never a negative disease verdict',()=>{
 assert.deepEqual(Object.keys(FINDINGS),['skin_cancer','fungal_infection','eczema','psoriasis']);
 for(const status of ['not_observed','negative','confirmed','detected','low_risk']){
  const value=observation();value.observations.skin_cancer.status=status;assert.throws(()=>validateObservation(value,true),/incomplete/);
 }
 const value=observation();value.observations.skin_cancer={status:'possible_features',evidence:'A dark band has uneven edges in the main photo.',view:'top'};
 assert.equal(validateObservation(value,false).observations.skin_cancer.status,'possible_features');
});
