import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicDemo} from '../dist/public-demo.js';
import {createDemoDataset,JOHN_ID} from '../scripts/demo-dataset.mjs';
import {openRecords} from '../server/records.mjs';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const demo=storage=>createPublicDemo({storage,load:async()=>createDemoDataset()});
const entry={kind:'hb',source_id:'public-test',captured_at:'2026-10-18T12:00:00Z',model:'SIMULATED demo scenario v1',provider:'Fictional test',data:{readings:[{id:'one',hemoglobin_g_per_l:110,warnings:['Simulated']},{id:'two',hemoglobin_g_per_l:114,warnings:[]}],hemoglobin_g_per_l:999}};
test('Anonymous care demo loads the full fixture without sign-in, survives reload and isolates visitors',async()=>{
 const storage=memory(),a=demo(storage),b=demo(memory());
 assert.equal((await a.enter()).profiles.length,21);await b.enter();
 assert.equal(a.request('backup').results.length,1132);
 const result=a.request(`profiles/${JOHN_ID}/results`,'POST',entry);
 assert.equal(result.data.hemoglobin_g_per_l,112);assert.equal(result.data.scan_count,2);
 assert.equal(a.request(`profiles/${JOHN_ID}/results`,'POST',entry).id,result.id);
 assert.equal(a.request(`profiles/${JOHN_ID}/results`).results.length,53);
 assert.equal(b.request(`profiles/${JOHN_ID}/results`).results.length,52);
 const reloaded=demo(storage);await reloaded.enter();assert.equal(reloaded.request(`profiles/${JOHN_ID}/results`).results.length,53);
 reloaded.request('results/'+result.id,'PATCH',{note:'Demo follow-up'});
 assert.equal(reloaded.request(`profiles/${JOHN_ID}/results`).results[0].note,'Demo follow-up');
 const store=openRecords(':memory:');try{store.restore(reloaded.request('backup'));assert.equal(store.backup(store.actor(reloaded.request('account').identity.id)).results.length,1133);}finally{store.close();}
 reloaded.request('results/'+result.id,'DELETE');assert.equal(reloaded.request(`profiles/${JOHN_ID}/results`).results.length,52);
 reloaded.request('profiles/'+JOHN_ID,'PUT',{...Object.fromEntries(['name','age','sex','pregnancy','conditions','medications','changes','history_unknown'].map(k=>[k,reloaded.request('account').profiles.find(p=>p.id===JOHN_ID)[k]])),name:'John, edited'});
 assert.equal(b.request('account').profiles[0].name,'John');reloaded.reset();assert.equal((await reloaded.enter()).profiles[0].name,'John');
});
test('Storage failures never report a saved change or damage the previous good dataset',async()=>{
 const storage=memory(),a=demo(storage);await a.enter();
 const original=storage.setItem;storage.setItem=()=>{throw Error('Quota exceeded');};
 assert.throws(()=>a.request(`profiles/${JOHN_ID}/results`,'POST',entry),/Quota/);
 assert.equal(a.request('backup').results.length,1132);storage.setItem=original;
 assert.throws(()=>a.request(`profiles/${JOHN_ID}/results`,'POST',{...entry,data:{readings:[{id:'bad',hemoglobin_g_per_l:NaN,warnings:[]}]}}));
 assert.equal(a.request('backup').results.length,1132);
 const reload=demo(storage);await reload.enter();assert.equal(reload.request('backup').results.length,1132);
});
test('Public personal demo never imports resident backgrounds and does not expose team operations',async()=>{
 const storage=memory(),a=createPublicDemo({storage,kind:'personal',load:()=>{throw Error('Must not load worker data');}});
 const workspace=await a.enter();assert.equal(workspace.profiles.length,1);assert.equal(workspace.profiles[0].age,null);assert.equal(workspace.organizations.length,0);
 assert.throws(()=>a.request('organizations/anything/invitations','POST',{}));
 a.request('profiles/'+workspace.profiles[0].id+'/results','POST',entry);
 assert.equal(a.request('backup').results[0].data.hemoglobin_g_per_l,112);
});
