import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openRecords } from '../server/records.mjs';
import { createApp } from '../server.mjs';
import { EXAMPLES } from '../dist/care-review-fixtures.js';
import { cleanContext, hemoglobinContext, hemoglobinSummary } from '../dist/health-context.js';
import { buildRequest, parseProviderResponse } from '../server/vision.mjs';
import { analyzeHbContext } from '../server/context.mjs';

export const insight={summary:'The reported background can help a clinician interpret this check-in.',considerations:[{reported_detail:'Reported anemia history',why_it_matters:'A photo estimate cannot show whether the reported condition has changed.',question_for_clinician:'Would a laboratory blood count help assess the current concern?'}],limitations:'This is educational context, not a diagnosis. The photo estimate may be inaccurate.'};
const hb=()=>({kind:'hb',source_id:'session-1',captured_at:'2026-10-18T12:00:00Z',model:'frozen MLP v1',provider:'On-device',data:{readings:[{id:'a',hemoglobin_g_per_l:120.5,warnings:['Synthetic quality note']},{id:'b',hemoglobin_g_per_l:140.5,warnings:[]}],hemoglobin_g_per_l:999,scan_count:2,warnings:[]}});
function personal(s,name='Demo person'){const i=s.createIdentity({kind:'personal',name});s.complete(i,{profile:{name,age:34,sex:'male',conditions:'Reported anemia'},name});return {i:s.actor(i.id),p:s.workspace(i).profiles[0]};}
function organization(s,name='Demo worker'){const i=s.createIdentity({kind:'worker',name,email:'demo@example.test',job_role:'Nurse'});const w=s.complete(i,{organization:{name:'Demo care',care_setting:'Long-term care',timezone:'America/Toronto'}});return {i:s.actor(i.id),org:w.organizations[0]};}
test('records survive process reopen; duplicate saves recompute averages and preserve original context',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kera-records-'));try{let s=openRecords(join(dir,'records.sqlite'));const {i,p}=personal(s);const input=hb();input.profile_context={age:33,sex:'male',conditions:'Background used when request started'};const r=s.saveResult(i,p.id,input);assert.equal(r.data.hemoglobin_g_per_l,130.5);assert.equal(s.saveResult(i,p.id,hb()).id,r.id);s.saveProfile(i,p.id,{name:p.name,age:35,sex:'male',conditions:'Updated history'});assert.equal(s.results(i,p.id)[0].context.age,33);assert.equal(s.results(i,p.id)[0].context.conditions,'Background used when request started');s.close();s=openRecords(join(dir,'records.sqlite'));assert.equal(s.results(s.actor(i.id),p.id).length,1);s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('shared organization owns residents; single-use invitations do not elevate roles; deactivation retains records',()=>{
 const s=openRecords(':memory:');try{const {i,org}=organization(s);const p=s.saveProfile(i,null,{organization_id:org.id,name:'Resident 01',age:81,sex:'female'});s.saveResult(i,p.id,hb());const inv=s.invite(i,org.id);const worker=s.createIdentity({kind:'worker',name:'Colleague',email:'colleague@example.test',job_role:'Administrator'});s.complete(worker,{invite:inv.id});assert.equal(s.results(worker,p.id).length,1);assert.throws(()=>s.invite(worker,org.id),/Only an organization owner/);const stranger=s.createIdentity({kind:'worker',name:'Stranger',email:'s@example.test',job_role:'Nurse'});assert.throws(()=>s.complete(stranger,{invite:inv.id}),/already used/);assert.equal(s.actor(stranger.id).complete,false);assert.throws(()=>s.results(stranger,p.id),/not available/);const m=s.team(i,org.id).find(m=>m.identity_id===worker.id);s.deactivate(i,m.id);assert.throws(()=>s.results(worker,p.id),/not available/);assert.equal(s.results(i,p.id).length,1);const v=s.invite(i,org.id);s.revoke(i,v.id);assert.throws(()=>s.previewInvite(v.id),/expired/);}finally{s.close();}
});
test('allowlisted storage rejects pictures and unexpected payload fields',()=>{
 const s=openRecords(':memory:');try{const {i,p}=personal(s);const b=hb();b.data.photo='data:image/png;base64,AAAA';assert.throws(()=>s.saveResult(i,p.id,b));assert.throws(()=>s.saveProfile(i,p.id,{name:'data:image/png;base64,AAAA',age:20}));assert.throws(()=>s.saveDraft(i,{step:1,fields:{photo:'blob:secret'}}));assert.equal(s.results(i,p.id).length,0);}finally{s.close();}
});
test('versioned backups round-trip Hb, visual findings and insights; malformed/conflicting imports are atomic',()=>{
 const s=openRecords(':memory:'),target=openRecords(':memory:');try{const {i,p}=personal(s);const b=hb();b.data.insights=insight;s.saveResult(i,p.id,b);const changed=hb();changed.data.insights={...insight,summary:'Updated insight text'};s.saveResult(i,p.id,changed);assert.equal(s.results(i,p.id)[0].data.insights.summary,'Updated insight text');s.saveResult(i,p.id,{kind:'visual',source_id:'visual-1',captured_at:'2026-10-18T12:01:00Z',model:'mock',provider:'Synthetic test',data:{image_quality:EXAMPLES.specific.make().image_quality,observations:EXAMPLES.specific.make().observations,insights:insight}});const backup=s.backup(i);assert.ok(!/data:image|base64|blob:/.test(JSON.stringify(backup)));assert.equal(target.restore(backup).restored,4);assert.equal(target.results(target.actor(i.id),p.id).length,2);assert.equal(target.restore(backup).restored,0);const broken=structuredClone(backup);broken.results[0].profile_id='unknown';assert.throws(()=>target.restore(broken));assert.equal(target.results(target.actor(i.id),p.id).length,2);const conflict=structuredClone(backup);conflict.identities[0].name='Different';assert.throws(()=>target.restore(conflict),/conflicts/);assert.equal(target.actor(i.id).name,i.name);}finally{s.close();target.close();}
});
test('onboarding draft resumes, revoked invitations fail, and failed organization completion is rolled back',()=>{
 const s=openRecords(':memory:');try{const i=s.createIdentity({kind:'personal',name:'Draft'});s.saveDraft(i,{step:1,fields:{name:'Draft',age:25,sex:'other_or_not_provided'}});assert.equal(s.actor(i.id).draft.fields.sex,'other_or_not_provided');const w=s.createIdentity({kind:'worker',name:'Worker'});assert.throws(()=>s.complete(w,{organization:{name:'Org',care_setting:'Clinic',timezone:'Invalid'}}));assert.equal(s.actor(w.id).complete,false);assert.equal(s.workspace(w).organizations.length,0);}finally{s.close();}
});
test('clinical reference uses explicitly supplied sex and pregnancy, never gender or a fabricated average',()=>{
 assert.deepEqual(hemoglobinContext({age:22,sex:'male'},150).range,[138,172]);assert.deepEqual(hemoglobinContext({age:22,sex:'female',pregnancy:'not_pregnant'},130).range,[121,151]);for(const c of [{age:7,sex:'male'},{age:30,sex:'other_or_not_provided'},{age:30,sex:'other_or_not_provided'},{age:30,sex:'female',pregnancy:'pregnant'}])assert.equal(hemoglobinContext(c,150).range,null);assert.equal(cleanContext({age:30,sex:'male',history_unknown:true,conditions:'hidden'}).conditions,'');
});
test('contextual vision request carries only explicitly shared context; guest prompt/schema remain original',()=>{
 const photos=[{view:'top',data_url:'synthetic-only'}],plain=buildRequest(photos,'model');assert.equal(plain.messages[1].content.length,2);assert.ok(!plain.response_format.json_schema.schema.properties.context_insights);const c=cleanContext({age:70,sex:'female',conditions:'Reported anemia'}),b=buildRequest(photos,'model',false,c);assert.match(b.messages[1].content[0].text,/Reported anemia/);assert.ok(b.response_format.json_schema.schema.required.includes('context_insights'));const v={...EXAMPLES.specific.make(),context_insights:insight};const response={choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(v)}}]};assert.deepEqual(parseProviderResponse(response,false,c).context_insights,insight);const incomplete={choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({...v,context_insights:{}})}}]};assert.ok(parseProviderResponse(incomplete,false,c).context_warning);assert.ok(parseProviderResponse(incomplete,false,c).observations);
});
test('Hb background provider receives numeric result and context, no image or identity',async()=>{
 let request;const v=await analyzeHbContext(cleanContext({age:55,sex:'male',conditions:'Reported anemia'}),130,{apiKey:'test',model:'mock',fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(insight)}}]}));}});assert.deepEqual(v,insight);assert.equal(request.messages[1].content.includes('130'),true);assert.ok(!/image_url|data:image|profile_id|email/.test(JSON.stringify(request)));
});
test('records API requires same origin for writes and scopes records through replaceable identity resolver',async()=>{
 const server=createApp({dataPath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{let r=await fetch(base+'/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'personal',name:'Test'})});assert.equal(r.status,403);r=await fetch(base+'/api/accounts',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({kind:'personal',name:'Test'})});const i=await r.json();assert.ok(i.id);r=await fetch(base+'/api/account');assert.equal(r.status,401);r=await fetch(base+'/api/account',{headers:{'X-Kera-Identity':i.id}});assert.equal((await r.json()).identity.id,i.id);r=await fetch(base+'/api/accounts',{headers:{Origin:'https://hostile.test'}});assert.equal(r.status,403);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('concise reference summaries preserve inclusive limits and avoid a healthy verdict',()=>{
 const c={age:36,sex:'male',conditions:'Reported anemia'};
 for(const [value,state]of [[137.9,'below'],[138,'within'],[172,'within'],[172.1,'above']]){const summary=hemoglobinSummary(c,value);assert.equal(summary.state,state);assert.match(summary.detail,/138–172 g\/L/);assert.match(summary.background,/health background/);assert.doesNotMatch(summary.title,/healthy|diagnosis|normal health/i);}
 for(const context of [{age:12,sex:'male'},{age:36,sex:'female',pregnancy:'pregnant'},{age:36,sex:'other_or_not_provided'},{}])assert.equal(hemoglobinSummary(context,150).state,'unavailable');
});

test('Plain Demo uses an explicit broad guide; personal ranges respond to supplied reference details',()=>{
 const empty={history_unknown:true};
 for(const [value,state,label]of [[120.9,'below','Low'],[121,'within','Within range'],[172,'within','Within range'],[172.1,'above','High']]){
  const report=hemoglobinSummary(empty,value,{demo:true});assert.deepEqual(report.range,[121,172]);assert.equal(report.state,state);assert.equal(report.label,label);assert.match(report.detail,/Not personalized/);assert.equal(report.context.age,undefined);assert.equal(report.context.sex,'');
 }
 assert.equal(hemoglobinSummary({},140).state,'unavailable');
 assert.equal(hemoglobinSummary({age:36,sex:'male'},130).label,'Low');
 assert.equal(hemoglobinSummary({age:36,sex:'female',pregnancy:'not_pregnant'},130).label,'Within range');
 assert.equal(hemoglobinSummary({age:36,sex:'female',pregnancy:'not_pregnant'},160).label,'High');
 assert.equal(hemoglobinSummary({age:36,sex:'male'},160).label,'Within range');
 assert.match(hemoglobinSummary({age:8,sex:'male'},140).detail,/age-specific/);
 assert.match(hemoglobinSummary({age:36,sex:'female',pregnancy:'pregnant'},140).detail,/pregnancy-specific/);
 assert.deepEqual(hemoglobinSummary({age:36,sex:'male',conditions:'Reported anemia',medications:'Reported medication'},140).range,[138,172]);
});


test('Demo workspace has durable isolated history without invented demographics or duplicate profiles',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kera-demo-history-'));let s=openRecords(join(dir,'records.sqlite'));
 try{
  const other=personal(s);const demo=s.demoWorkspace(),again=s.demoWorkspace();assert.equal(demo.identity.id,again.identity.id);assert.equal(demo.profiles.length,1);assert.equal(demo.profiles[0].age,null);assert.equal(demo.profiles[0].sex,'');
  s.saveResult(demo.identity,demo.profiles[0].id,hb());assert.equal(s.results(demo.identity,demo.profiles[0].id).length,1);assert.equal(s.results(other.i,other.p.id).length,0);assert.throws(()=>s.results(other.i,demo.profiles[0].id),/not available/);
  s.close();s=openRecords(join(dir,'records.sqlite'));const reopened=s.demoWorkspace();assert.equal(s.results(reopened.identity,reopened.profiles[0].id).length,1);assert.equal(s.listIdentities().filter(i=>i.id===demo.identity.id).length,1);
  const target=openRecords(':memory:');try{target.restore(s.backup(reopened.identity));assert.equal(target.demoWorkspace().profiles[0].id,reopened.profiles[0].id);}finally{target.close();}
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
