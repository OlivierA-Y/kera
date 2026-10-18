import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server.mjs';
import { averageReadings, MAX_AVERAGE_BODY } from '../server/averaging.mjs';

const reading = (value, id='scan-1', warnings=[]) => ({ id, hemoglobin_g_per_l:value, warnings });
const payload = (...values) => ({ readings:values.map((value,index)=>reading(value,`scan-${index+1}`)) });
async function fixture(fn) {
  const server=createApp({apiKey:'',provider:async()=>{throw new Error('Averaging must not call the vision provider.');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise(resolve=>server.close(resolve)); }
}
function post(base, body=payload(100,140), headers={}) {
  return fetch(base+'/api/scans/average',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
}
function rawRequest(base, {body='',method='POST',headers={}}={}) {
  return new Promise((resolve,reject)=>{
    const req=request(base+'/api/scans/average',{method,headers:{'Content-Type':'application/json',Origin:base,...headers}},res=>{
      let response='';res.setEncoding('utf8');res.on('data',chunk=>response+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(response)}));
    });
    req.on('error',reject);req.end(body);
  });
}

test('One, two and a full 100-reading batch use every reading equally',()=>{
  assert.deepEqual(averageReadings(payload(123.456)),{hemoglobin_g_per_l:123.456,scan_count:1,warnings:[]});
  assert.equal(averageReadings(payload(100,140)).hemoglobin_g_per_l,120);
  const values=Array.from({length:100},(_,index)=>index+1);
  assert.deepEqual(averageReadings(payload(...values)),{hemoglobin_g_per_l:50.5,scan_count:100,warnings:[]});
  // A valid extreme is still included rather than silently removed as an outlier.
  assert.equal(averageReadings(payload(1,1000)).hemoglobin_g_per_l,500.5);
});

test('Fractional estimates are averaged before any display rounding',()=>{
  const result=averageReadings(payload(100.01,100.04));
  assert.equal(result.hemoglobin_g_per_l,100.025);
  assert.notEqual(result.hemoglobin_g_per_l,Number(result.hemoglobin_g_per_l.toFixed(1)));
});

test('Warnings from every scan survive once, in first-seen order, without mutating readings',()=>{
  const body={readings:[reading(100,'first',['glare','shadow']),reading(120,'second',['shadow','low contrast'])]};
  const before=structuredClone(body);
  assert.deepEqual(averageReadings(body).warnings,['glare','shadow','low contrast']);
  assert.deepEqual(body,before);
});

test('Empty, missing, oversized and malformed batches are rejected',()=>{
  for (const body of [undefined,null,[],{}, {readings:null},{readings:[]},{readings:[null]},payload(...Array(101).fill(100))]) {
    assert.throws(()=>averageReadings(body),error=>error.status===400&&error.code==='invalid_readings');
  }
});

test('Every scan needs a unique non-empty string id',()=>{
  for (const id of [undefined,null,1,'',' ',' scan ','x'.repeat(129)]) {
    assert.throws(()=>averageReadings({readings:[{...reading(100),id}]}),/id/);
  }
  assert.throws(()=>averageReadings({readings:[reading(100),reading(120)]}),/unique/);
});

test('Invalid estimates fail the whole batch instead of being coerced or filtered',()=>{
  for (const value of [undefined,null,'123',true,NaN,Infinity,-Infinity,Number.MAX_VALUE,0,-0,-1,1000.01]) {
    assert.throws(()=>averageReadings({readings:[reading(100,'valid'),reading(value,'invalid')]}),error=>error.status===400);
  }
});

test('Warning lists and payload shape reject malformed values and image data',()=>{
  for (const warnings of [undefined,null,'glare',[null],[42],[''],[' '],['x'.repeat(257)],Array(21).fill('warning')]) {
    assert.throws(()=>averageReadings({readings:[{id:'one',hemoglobin_g_per_l:100,warnings}]}),error=>error.status===400);
  }
  assert.throws(()=>averageReadings({...payload(100),photos:[]}),error=>error.status===400);
  assert.throws(()=>averageReadings({readings:[{...reading(100),data_url:'private photo'}]}),error=>error.status===400);
});

test('The local endpoint returns one mean with no API key, photos or cached response',async()=>{
  await fixture(async base=>{
    const response=await post(base,{readings:[reading(110.01,'left',['glare']),reading(130.04,'right',['glare','shadow'])]});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{hemoglobin_g_per_l:120.025,scan_count:2,warnings:['glare','shadow']});
    // A second request receives only its own readings, with no retained session state.
    assert.deepEqual(await (await post(base,payload(77))).json(),{hemoglobin_g_per_l:77,scan_count:1,warnings:[]});
  });
});

test('Foreign or absent origin, cross-site metadata, Host, methods and media type are rejected',async()=>{
  await fixture(async base=>{
    assert.equal((await post(base,payload(100),{Origin:'https://example.com'})).status,403);
    assert.equal((await rawRequest(base,{body:JSON.stringify(payload(100)),headers:{Origin:''}})).status,403);
    assert.equal((await post(base,payload(100),{'Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await rawRequest(base,{body:JSON.stringify(payload(100)),headers:{Host:'evil.example'}})).status,403);
    for (const method of ['GET','PUT','DELETE']) assert.equal((await fetch(base+'/api/scans/average',{method})).status,405);
    assert.equal((await post(base,payload(100),{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post(base,payload(100),{'Content-Type':'application/json; charset=utf-8'})).status,200);
  });
});

test('Malformed, nonfinite JSON, nulls and duplicate scans return structured errors',async()=>{
  await fixture(async base=>{
    for (const body of ['', '{', '{"readings":[{"id":"one","hemoglobin_g_per_l":NaN,"warnings":[]}]}']) {
      const result=await rawRequest(base,{body});assert.equal(result.status,400);assert.equal(result.body.error.code,'invalid_json');
    }
    for (const body of ['{"readings":[{"id":"one","hemoglobin_g_per_l":1e999,"warnings":[]}]}',JSON.stringify(payload(null)),JSON.stringify({readings:[reading(100),reading(120)]})]) {
      const result=await rawRequest(base,{body});assert.equal(result.status,400);assert.equal(result.body.error.code,'invalid_readings');
    }
  });
});

test('The body cap rejects both declared and chunked oversized input',async()=>{
  await fixture(async base=>{
    const oversized=' '.repeat(MAX_AVERAGE_BODY)+JSON.stringify(payload(100));
    assert.equal((await rawRequest(base,{body:oversized,headers:{'Content-Length':String(Buffer.byteLength(oversized))}})).status,413);
    const response=await rawRequest(base,{body:oversized,headers:{'Transfer-Encoding':'chunked'}});
    assert.equal(response.status,413);assert.equal(response.body.error.code,'too_large');
    assert.equal((await post(base)).status,200);
  });
});
