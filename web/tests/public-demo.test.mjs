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

test('Hosted Individual resumes intake and preserves personal context and history separately from Demo',async()=>{
 const storage=memory(),load=()=>{throw Error('Individual must not load fictional residents');};
 const create=()=>createPublicDemo({storage,kind:'individual',load});let a=create();
 assert.equal((await a.enter()).identity.complete,false);assert.equal(a.request('account').profiles.length,0);
 a.request('account/draft','PATCH',{step:1,fields:{name:'Individual QA',age:36,sex:'male',conditions:'Reported anemia',medications:'Reported medication',history_unknown:false}});
 a=create();assert.equal((await a.enter()).identity.draft.fields.conditions,'Reported anemia');
 const workspace=a.request('account/complete','POST',{name:'Individual QA',profile:{name:'Individual QA',age:36,sex:'male',conditions:'Reported anemia',history_unknown:false}});
 assert.equal(workspace.identity.complete,true);assert.equal(workspace.profiles[0].sex,'male');const p=workspace.profiles[0];
 a.request('profiles/'+p.id+'/results','POST',entry);
 a.request('profiles/'+p.id,'PUT',{name:p.name,age:36,sex:'female',pregnancy:'not_pregnant'});
 assert.equal(a.request('profiles/'+p.id+'/results').results[0].context.sex,'male');
 a=create();await a.enter();assert.equal(a.request('account').profiles[0].sex,'female');assert.equal(a.request('backup').results.length,1);
 const demo=createPublicDemo({storage,kind:'personal'});await demo.enter();assert.equal(demo.request('backup').results.length,0);assert.equal(demo.request('account').profiles[0].age,null);
 const store=openRecords(':memory:');try{store.restore(a.request('backup'));assert.equal(store.results(store.actor(workspace.identity.id),p.id).length,1);}finally{store.close();}
 a.reset();assert.equal((await a.enter()).identity.complete,false);assert.equal(demo.request('account').identity.name,'Demo');
});

test('Regular worker setup resumes, starts empty and preserves resident history separately from demos',async()=>{
 const storage=memory(),create=()=>createPublicDemo({storage,kind:'worker-workspace',load:()=>{throw Error('Regular setup must not load demo data');}});
 let app=create();assert.equal((await app.enter()).identity.complete,false);
 app.request('account/draft','PATCH',{step:1,fields:{name:'Worker QA',email:'qa@example.com',job_role:'Nurse',organization_name:'Care QA',care_setting:'Clinic',timezone:'America/Toronto'}});
 app=create();assert.equal((await app.enter()).identity.draft.fields.organization_name,'Care QA');
 const payload={name:'Worker QA',email:'qa@example.com',job_role:'Nurse',organization:{name:'Care QA',care_setting:'Clinic',facility_name:'',timezone:'America/Toronto'}};
 const before=app.request('backup');assert.throws(()=>app.request('account/complete','POST',{...payload,organization:{...payload.organization,timezone:'bad-zone'}}),/time zone/);assert.deepEqual(app.request('backup').organizations,before.organizations);assert.equal(app.request('account').identity.complete,false);
 const workspace=app.request('account/complete','POST',payload);assert.equal(workspace.identity.kind,'worker');assert.equal(workspace.identity.complete,true);assert.equal(workspace.profiles.length,0);assert.equal(workspace.memberships[0].role,'owner');assert.equal(workspace.facilities[0].name,'Care QA');
 const p=app.request('profiles','POST',{name:'Resident QA',age:64,sex:'male',organization_id:workspace.organizations[0].id});
 const r=app.request('profiles/'+p.id+'/results','POST',entry);assert.equal(r.context.sex,'male');assert.equal(r.data.hemoglobin_g_per_l,112);
 app=create();await app.enter();assert.equal(app.request('account').profiles.length,1);assert.equal(app.request('profiles/'+p.id+'/results').results.length,1);
 const sample=demo(storage);assert.equal((await sample.enter()).profiles.length,21);
 const store=openRecords(':memory:');try{store.restore(app.request('backup'));assert.equal(store.results(store.actor(workspace.identity.id),p.id).length,1);}finally{store.close();}
 app.reset();assert.equal((await app.enter()).identity.complete,false);assert.equal(sample.request('account').profiles.length,21);
});

test('Regular worker setup rolls back storage failures and rejects incomplete professional details',async()=>{
 const storage=memory(),app=createPublicDemo({storage,kind:'worker-workspace'});await app.enter();
 const payload={name:'Worker QA',email:'qa@example.com',job_role:'Nurse',organization:{name:'Care QA',care_setting:'Clinic',timezone:'America/Toronto'}};
 assert.throws(()=>app.request('account/complete','POST',{...payload,email:'bad'}),/valid work email/);
 assert.throws(()=>app.request('account/complete','POST',{...payload,invite:'unsupported'}),/invitations/);
 const save=storage.setItem;storage.setItem=()=>{throw Error('Storage full');};assert.throws(()=>app.request('account/complete','POST',payload),/Storage full/);assert.equal(app.request('account').identity.complete,false);assert.equal(app.request('account').organizations.length,0);
 storage.setItem=save;assert.equal(app.request('account/complete','POST',payload).identity.complete,true);
});
