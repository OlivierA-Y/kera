import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDataset, DEMO_WORKER_ID, JOHN_ID, JAD_PROFILE } from '../scripts/demo-dataset.mjs';
import { openRecords } from '../server/records.mjs';

test('Fictional fixture has 21 residents, six months of paired weekly results and only John pending today',()=>{
  const data=createDemoDataset();assert.deepEqual(createDemoDataset(),data);
  assert.equal(data.identities.length,1);assert.equal(data.profiles.length,21);assert.equal(data.results.length,1132);
  const john=data.profiles.find(p=>p.id===JOHN_ID);assert.equal(john.name,'John');
  const jad=data.profiles.find(p=>p.name==='Jad');assert.deepEqual(jad,JAD_PROFILE);const poor=data.results.filter(r=>r.profile_id===jad.id);assert.equal(poor.length,54);assert.ok(poor.filter(r=>r.kind==='hb').every(r=>r.data.hemoglobin_g_per_l>=50&&r.data.hemoglobin_g_per_l<=85));assert.ok(poor.filter(r=>r.kind==='visual').every(r=>Object.values(r.data.observations).every(o=>o.status==='possible_features')));
  const ids=new Set();
  for(const p of data.profiles){
    assert.ok(p.age>=65&&p.age<=100);assert.ok(p.conditions&&p.medications&&p.changes);
    const results=data.results.filter(r=>r.profile_id===p.id),dates=[...new Set(results.map(r=>r.captured_at))].sort();
    assert.equal(results.length,p.id===JOHN_ID?52:54);assert.equal(dates[0].slice(0,10),'2026-04-19');
    assert.equal(dates.at(-1).slice(0,10),p.id===JOHN_ID?'2026-10-11':'2026-10-18');
    for(let n=1;n<dates.length;n++)assert.equal(Date.parse(dates[n])-Date.parse(dates[n-1]),7*86400000);
    for(const date of dates)assert.deepEqual(results.filter(r=>r.captured_at===date).map(r=>r.kind).sort(),['hb','visual']);
    for(const r of results){assert.ok(!ids.has(r.id));ids.add(r.id);assert.match(r.model,/SIMULATED/);assert.match(r.note,/FICTIONAL/);if(p.id===JOHN_ID&&r.kind==='hb')assert.ok(r.data.hemoglobin_g_per_l>=145&&r.data.hemoglobin_g_per_l<=154);}
  }
  const store=openRecords(':memory:');try{
    store.restore(data);assert.equal(store.restore(data).restored,0);
    const actor=store.actor(DEMO_WORKER_ID);assert.equal(store.workspace(actor).profiles.length,21);
    assert.equal(store.backup(actor).results.length,1132);assert.equal(store.results(actor,JOHN_ID).length,52);
    const other=store.createIdentity({kind:'personal',name:'Existing profile'});assert.ok(store.actor(other.id));
    assert.equal(store.restore(data).restored,0);assert.ok(store.actor(other.id));
  }finally{store.close();}
});
