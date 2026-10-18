import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createApp, DEMO_UI_HEAD } from '../server.mjs';
const root=new URL('../demo-original/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('FROZEN.json',root)));
test('every frozen Demo file matches the original pre-change snapshot hash',()=>{for(const f of manifest.files)assert.equal(createHash('sha256').update(readFileSync(new URL(f.path,root))).digest('hex'),f.sha256,f.path);});
test('Demo serves the shared dual-reference frontend and keeps guest averaging/privacy endpoints isolated',async()=>{
 const server=createApp({dataPath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const f of manifest.files.filter(f=>f.path.startsWith('dist/'))){const url=base+'/demo/'+f.path.slice(5);const r=await fetch(url);assert.equal(r.status,200,f.path);const bytes=Buffer.from(await r.arrayBuffer());const original=f.path==='dist/index.html'?Buffer.from(bytes.toString('utf8').replace(DEMO_UI_HEAD,'')):bytes;assert.deepEqual(original,readFileSync(new URL('../'+f.path,import.meta.url)),f.path);}
  const readings=[{id:'demo',hemoglobin_g_per_l:123.4,warnings:[]}];let r=await fetch(base+'/demo/api/scans/average',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({readings})});assert.equal(r.status,200);assert.equal((await r.json()).hemoglobin_g_per_l,123.4);
  r=await fetch(base+'/demo/api/vision/status');assert.match((await r.json()).privacy,/saved to Demo history/);
  r=await fetch(base+'/api/demo-workspace',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);const demo=await r.json();assert.equal(demo.identity.name,'Demo');assert.equal(demo.profiles[0].age,null);
  r=await fetch(base+'/api/demo-workspace',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
  r=await fetch(base+'/demo/api/accounts');assert.equal(r.status,404);
  r=await fetch(base+'/demo/api/scans/average',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:JSON.stringify({readings})});assert.equal(r.status,403);
  r=await fetch(base+'/demo/server.mjs');assert.equal(r.status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
