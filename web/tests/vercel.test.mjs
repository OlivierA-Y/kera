import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createApp} from '../server.mjs';
const keys=['VERCEL_URL','VERCEL_PROJECT_PRODUCTION_URL','VERCEL_BRANCH_URL','KERA_ALLOWED_ORIGINS'];
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
process.env.VERCEL_URL='kera-test.vercel.app';for(const k of keys.slice(1))delete process.env[k];
const {default:handler}=await import('../api/index.mjs');
for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
async function fixture(run,{parsedBody}={}){
 const server=createServer((req,res)=>{if(parsedBody!==undefined)req.body=parsedBody;void handler(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run((path,{method='GET',body='',origin='https://kera-test.vercel.app',host='kera-test.vercel.app'}={})=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:server.address().port,path,method,headers:{Host:host,Origin:origin,'Content-Type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body);
 }));}finally{await new Promise(resolve=>server.close(resolve));}
}
const payload={readings:[{id:'one',hemoglobin_g_per_l:110,warnings:[]},{id:'two',hemoglobin_g_per_l:130,warnings:[]}]};
test('Vercel route adapter handles averaging with an exact HTTPS deployment origin',async()=>{
 await fixture(async call=>{const r=await call('/api/index?endpoint=average',{method:'POST',body:JSON.stringify(payload)});assert.equal(r.status,200);assert.equal(r.body.hemoglobin_g_per_l,120);assert.equal(r.body.scan_count,2);
  assert.equal((await call('/api/index?endpoint=average',{method:'POST',body:JSON.stringify(payload),origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/index?endpoint=status',{host:'evil.example'})).status,403);
  assert.equal((await call('/api/index?endpoint=analyze',{method:'POST',body:'{}'})).body.error.code,'consent_required');
  assert.equal((await call('/api/vision/status')).status,200);
 });
});
test('Preparsed Vercel request bodies preserve averaging validation',async()=>{
 await fixture(async call=>assert.equal((await call('/api/index?endpoint=average',{method:'POST'})).body.hemoglobin_g_per_l,120),{parsedBody:payload});
 await fixture(async call=>assert.equal((await call('/api/index?endpoint=average',{method:'POST'})).body.error.code,'invalid_json'),{parsedBody:'{broken'});
});
test('Deployment allowlist rejects non-HTTPS or non-origin configuration',()=>{
 for(const origin of ['http://kera.example','https://kera.example/path','https://user:pass@kera.example'])assert.throws(()=>createApp({allowedOrigins:[origin]}));
});
