import { cleanContext, validateInsights } from '../dist/health-context.js';
/** Durable domain records. Demo identity resolution is deliberately replaceable. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VisionError, validateObservation } from './vision.mjs';
import { averageReadings } from './averaging.mjs';

const fail = (message, status=400) => { throw new VisionError(status, 'records_error', message); };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
function keys(x, allowed) { if (!object(x) || Object.keys(x).some(k=>!allowed.includes(k))) fail('The record contains unsupported fields.'); }
function text(x, max=200, optional=false) {
  if (optional && (x === undefined || x === '')) return '';
  if (typeof x !== 'string' || !x.trim() || x.length>max || /[\u0000-\u0008\u000b-\u001f\u007f]|data\s*:|base64|blob:/i.test(x)) fail('Use plain text within the field length limit. Images cannot be saved.');
  return x.trim();
}
const date = x => { if (typeof x !== 'string' || !Number.isFinite(Date.parse(x))) fail('Use a valid date.'); return new Date(x).toISOString(); };
const now = () => new Date().toISOString();
const id = () => randomUUID();
const parse = row => row ? JSON.parse(row.payload) : null;
export const csvCell = value => '"'+String(/^\s*[=+\-@]|^[\t\r]/.test(String(value))?'\''+value:value).replaceAll('"','""')+'"';

function demographics(b) {
  keys(b,['name','age','sex','pregnancy','conditions','medications','changes','history_unknown']);
  const age=b.age === '' || b.age === null || b.age === undefined ? null : b.age;
  if (age !== null && (!Number.isInteger(age) || age<0 || age>130)) fail('Age must be a whole number between 0 and 130.');
  cleanContext(b);
  return {name:text(b.name),age,pregnancy:b.pregnancy||'',age_as_of:now().slice(0,10),sex:text(b.sex,100,true),conditions:text(b.conditions,2000,true),medications:text(b.medications,2000,true),changes:text(b.changes,2000,true),history_unknown:b.history_unknown===true};
}
function validateResult(b) {
  keys(b,['kind','source_id','captured_at','model','provider','data','profile_context']);
  if (!['hb','visual'].includes(b.kind)) fail('Choose a supported result type.');
  const out={kind:b.kind,source_id:text(b.source_id,128),captured_at:date(b.captured_at),model:text(b.model,200),provider:text(b.provider,160),data:null};
  if (b.kind==='hb') {
    keys(b.data,['readings','hemoglobin_g_per_l','scan_count','warnings','units','insights']);
    const avg=averageReadings({readings:b.data.readings});
    // Compute the average again instead of trusting a client summary.
    out.data={...avg,units:'g/L',readings:b.data.readings.map(r=>({id:r.id,hemoglobin_g_per_l:r.hemoglobin_g_per_l,warnings:r.warnings.map(w=>text(w,256))}))};
  } else {
    keys(b.data,['image_quality','observations','insights']);
    const checked=validateObservation({image_quality:b.data.image_quality,observations:b.data.observations},true);
    out.data=JSON.parse(JSON.stringify(checked));
  }
  if(b.profile_context){keys(b.profile_context,['age','sex','pregnancy','conditions','medications','changes','history_unknown']);out.profile_context=cleanContext(b.profile_context);}
  if(b.data.insights)out.data.insights=validateInsights(b.data.insights);
  // Recheck every string, including provider evidence and source IDs.
  const walk=x=>{if(typeof x==='string')text(x,8000,true);else if(Array.isArray(x))x.forEach(walk);else if(object(x))Object.values(x).forEach(walk);};walk(out);
  return out;
}

export function openRecords(filename) {
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_versions VALUES(1);
    CREATE TABLE IF NOT EXISTS identities(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS facilities(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships(id TEXT PRIMARY KEY,identity_id TEXT NOT NULL REFERENCES identities(id),organization_id TEXT NOT NULL REFERENCES organizations(id),payload TEXT NOT NULL,UNIQUE(identity_id,organization_id));
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,identity_id TEXT REFERENCES identities(id),organization_id TEXT REFERENCES organizations(id),payload TEXT NOT NULL,CHECK((identity_id IS NULL)!=(organization_id IS NULL)));
    CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,source_id TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(profile_id,source_id));
    CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS profile_org ON profiles(organization_id);
    CREATE INDEX IF NOT EXISTS result_profile ON results(profile_id);`);
  if(db.prepare('SELECT MAX(version) AS version FROM schema_versions').get().version!==1){db.close();fail('This database version requires a newer Kera app.',409);}
  const all=(table,where='',...params)=>db.prepare(`SELECT * FROM ${table} ${where}`).all(...params).map(parse);
  const get=(table,key)=>parse(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key));
  function put(table,value,columns={}) {
    const data={id:value.id,...columns,payload:JSON.stringify(value)};
    db.prepare(`INSERT INTO ${table}(${Object.keys(data).join(',')}) VALUES(${Object.keys(data).map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(...Object.values(data));return value;
  }
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
  function actor(identityId){const a=get('identities',identityId);if(!a)fail('Select your demo profile to continue.',401);return a;}
  function membership(a, orgId){return all('memberships','WHERE identity_id=? AND organization_id=?',a.id,orgId).find(m=>m.active);}
  function owner(a,orgId){const m=membership(a,orgId);if(!m||m.role!=='owner')fail('Only an organization owner can manage the team.',403);return m;}
  function profile(a,key){const p=get('profiles',key);if(!p||!(p.identity_id===a.id || (p.organization_id && membership(a,p.organization_id))))fail('This profile is not available in your workspace.',404);return p;}
  function workspace(a){
    const memberships=all('memberships','WHERE identity_id=?',a.id).filter(m=>m.active);
    const organizations=memberships.map(m=>get('organizations',m.organization_id));
    const profiles=all('profiles').filter(p=>p.identity_id===a.id||memberships.some(m=>m.organization_id===p.organization_id));
    return {identity:a,memberships,organizations,facilities:all('facilities').filter(f=>memberships.some(m=>m.organization_id===f.organization_id)),profiles};
  }
  function listIdentities(){return all('identities').map(({id,name,kind,complete})=>({id,name,kind,complete}));}
  function createIdentity(b){
    keys(b,['kind','name','email','job_role']);if(!['personal','worker'].includes(b.kind))fail('Choose Personal or Care team.');
    const email=text(b.email,254,true);if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid email address. It is not verified in this demo.');
    return put('identities',{id:id(),kind:b.kind,name:text(b.name),email,job_role:text(b.job_role,120,true),complete:false,draft:{},created_at:now()});
  }
  function saveDraft(a,b){
    keys(b,['step','fields']);if(!Number.isInteger(b.step)||b.step<0||b.step>3)fail('Invalid onboarding step.');
    keys(b.fields,['name','email','job_role','age','sex','pregnancy','conditions','medications','changes','history_unknown','organization_name','care_setting','facility_name','timezone','invite']);
    for(const v of Object.values(b.fields)){if(typeof v==='string')text(v,2000,true);else if(v!==null&&typeof v!=='boolean'&&!(typeof v==='number'&&Number.isFinite(v)))fail('Invalid onboarding value.');}
    return put('identities',{...a,draft:{step:b.step,fields:b.fields}});
  }
  function complete(a,b){
    keys(b,['profile','organization','invite','name','email','job_role']);
    if(a.complete)return workspace(a);
    return transaction(()=>{
      const updated={...a,name:text(b.name||a.name),email:text(b.email===undefined?a.email:b.email,254,true),job_role:text(b.job_role===undefined?a.job_role:b.job_role,120,true),complete:true,draft:{}};
      if(updated.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updated.email))fail('Enter a valid email address.');
      if(a.kind==='personal') {
        const d=demographics(b.profile);if(d.age===null)fail('Enter your age to finish setup.');
        const p={id:id(),identity_id:a.id,organization_id:null,...d,created_at:now()};put('profiles',p,{identity_id:a.id,organization_id:null});
      } else {
        if(!updated.email||!updated.job_role)fail('Enter your work email and job role.');
        if(b.invite){
          const invitation=get('invitations',text(b.invite,128));
          if(!invitation||invitation.used_by||invitation.revoked||Date.parse(invitation.expires_at)<=Date.now())fail('This invitation has expired or was already used. Ask the owner for another.');
          const m={id:id(),identity_id:a.id,organization_id:invitation.organization_id,role:'worker',active:true,created_at:now()};put('memberships',m,{identity_id:a.id,organization_id:m.organization_id});put('invitations',{...invitation,used_by:a.id},{organization_id:invitation.organization_id});
        } else {
          keys(b.organization,['name','care_setting','facility_name','timezone']);
          const zone=text(b.organization.timezone,100);try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{fail('Choose a valid time zone, such as America/Toronto.');}
          const org={id:id(),name:text(b.organization.name),care_setting:text(b.organization.care_setting,120),timezone:zone,created_at:now()};put('organizations',org);
          const f={id:id(),organization_id:org.id,name:text(b.organization.facility_name||org.name),created_at:now()};put('facilities',f,{organization_id:org.id});
          const m={id:id(),identity_id:a.id,organization_id:org.id,role:'owner',active:true,created_at:now()};put('memberships',m,{identity_id:a.id,organization_id:org.id});
        }
      }
      put('identities',updated);return workspace(updated);
    });
  }
  function saveProfile(a,key,b){
    const old=key?profile(a,key):null;
    keys(b,['name','age','sex','pregnancy','conditions','medications','changes','history_unknown','organization_id']);
    const {organization_id,...fields}=b;const d=demographics(fields);if(d.age===null)fail('Enter an age for this profile.');
    if(!old && (!organization_id||!membership(a,organization_id)))fail('Choose your organization to add a resident.',403);
    const p={...(old||{id:id(),identity_id:null,organization_id,created_at:now()}),...d,updated_at:now()};
    put('profiles',p,{identity_id:p.identity_id,organization_id:p.organization_id});return p;
  }
  function saveResult(a,key,b){
    const p=profile(a,key),validated=validateResult(b);
    const previous=all('results','WHERE profile_id=? AND source_id=?',key,validated.source_id)[0];if(previous){if(validated.data.insights)return put('results',{...previous,data:{...previous.data,insights:validated.data.insights}},{profile_id:key,source_id:previous.source_id});return previous;}
    const r={id:id(),profile_id:key,...validated,context:{name:p.name,age:p.age,age_as_of:p.age_as_of,sex:p.sex||'',pregnancy:p.pregnancy||'',conditions:p.conditions,medications:p.medications,changes:p.changes,history_unknown:p.history_unknown},created_by:a.id,created_at:now(),note:'',schema_version:1};
    if(validated.profile_context){const {profile_context,...rest}=r;return put('results',{...rest,context:{...r.context,...profile_context}}, {profile_id:key,source_id:r.source_id});}
    return put('results',r,{profile_id:key,source_id:r.source_id});
  }
  function results(a,key){profile(a,key);return all('results','WHERE profile_id=? ORDER BY json_extract(payload,\'$.captured_at\') DESC',key);}
  function updateResult(a,key,b){
    keys(b,['note']);const r=get('results',key);if(!r)fail('Result not found.',404);profile(a,r.profile_id);
    return put('results',{...r,note:text(b.note,8000,true),note_updated_at:now(),note_updated_by:a.id},{profile_id:r.profile_id,source_id:r.source_id});
  }
  function deleteResult(a,key){const r=get('results',key);if(!r)fail('Result not found.',404);profile(a,r.profile_id);db.prepare('DELETE FROM results WHERE id=?').run(key);return {deleted:true};}
  function team(a,orgId){const m=membership(a,orgId);if(!m)fail('Organization not found.',404);return all('memberships','WHERE organization_id=?',orgId).map(member=>({...member,name:get('identities',member.identity_id)?.name||'Former member',job_role:get('identities',member.identity_id)?.job_role||''}));}
  function invite(a,orgId){owner(a,orgId);const v={id:id(),organization_id:orgId,role:'worker',created_at:now(),expires_at:new Date(Date.now()+7*86400000).toISOString(),used_by:null,revoked:false};return put('invitations',v,{organization_id:orgId});}
  function invitations(a,orgId){owner(a,orgId);return all('invitations','WHERE organization_id=?',orgId);}
  function revoke(a,key){const v=get('invitations',key);if(!v)fail('Invitation not found.',404);owner(a,v.organization_id);return put('invitations',{...v,revoked:true},{organization_id:v.organization_id});}
  function deactivate(a,key){const m=get('memberships',key);if(!m)fail('Team member not found.',404);owner(a,m.organization_id);if(m.role==='owner')fail('The owner cannot be deactivated.');return put('memberships',{...m,active:false},{identity_id:m.identity_id,organization_id:m.organization_id});}
  function backup(a){
    const w=workspace(a),orgIds=w.memberships.filter(m=>m.role==='owner').map(m=>m.organization_id);
    if(a.kind==='worker'&&!orgIds.length)fail('Ask the organization owner to create a workspace backup.',403);
    const members=all('memberships').filter(m=>orgIds.includes(m.organization_id));
    const identityIds=new Set([a.id,...members.map(m=>m.identity_id)]);
    const profiles=w.profiles.filter(p=>p.identity_id===a.id||orgIds.includes(p.organization_id));
    const profileIds=new Set(profiles.map(p=>p.id));
    return {format:'kera-backup',version:1,exported_at:now(),identities:all('identities').filter(i=>identityIds.has(i.id)),organizations:w.organizations.filter(o=>orgIds.includes(o.id)),facilities:w.facilities.filter(f=>orgIds.includes(f.organization_id)),memberships:members,profiles,results:all('results').filter(r=>profileIds.has(r.profile_id))};
  }
  function restore(b){
    keys(b,['format','version','exported_at','identities','organizations','facilities','memberships','profiles','results']);
    if(b.format!=='kera-backup'||b.version!==1)fail('This is not a supported Kera backup.');date(b.exported_at);
    const tables=['identities','organizations','facilities','memberships','profiles','results'];
    const allowed={identities:['id','kind','name','email','job_role','complete','draft','created_at'],organizations:['id','name','care_setting','timezone','created_at'],facilities:['id','organization_id','name','created_at'],memberships:['id','identity_id','organization_id','role','active','created_at'],profiles:['id','identity_id','organization_id','name','age','age_as_of','sex','pregnancy','conditions','medications','changes','history_unknown','created_at','updated_at'],results:['id','profile_id','kind','source_id','captured_at','model','provider','data','context','created_by','created_at','note','schema_version','note_updated_at','note_updated_by']};
    for(const t of tables){if(!Array.isArray(b[t])||b[t].length>10000)fail('Backup record lists are invalid or too large.');const seen=new Set();for(const v of b[t]){keys(v,allowed[t]);text(v.id,128);if(seen.has(v.id))fail('The backup contains duplicate IDs.');seen.add(v.id);}}
    const identities=new Map(b.identities.map(i=>[i.id,i])),orgs=new Set(b.organizations.map(o=>o.id)),profiles=new Map(b.profiles.map(p=>[p.id,p]));
    const checkStrings=(x,depth=0)=>{if(depth>15)fail('Backup nesting is too deep.');if(typeof x==='string'){if(x)text(x,10000);}else if(Array.isArray(x))x.forEach(v=>checkStrings(v,depth+1));else if(object(x))Object.values(x).forEach(v=>checkStrings(v,depth+1));else if(x!==null&&typeof x!=='boolean'&&!(typeof x==='number'&&Number.isFinite(x)))fail('Invalid backup value.');};checkStrings(b);
    for(const i of b.identities){if(!['personal','worker'].includes(i.kind)||typeof i.complete!=='boolean')fail('Invalid identity in backup.');text(i.name);saveDraftValidation(i.draft);}
    for(const o of b.organizations){text(o.name);text(o.care_setting);try{new Intl.DateTimeFormat('en',{timeZone:o.timezone});}catch{fail('Invalid backup time zone.');}}
    for(const f of b.facilities){if(!orgs.has(f.organization_id))fail('Backup facility has no organization.');text(f.name);}
    const memberKeys=new Set();for(const m of b.memberships){const k=m.identity_id+':'+m.organization_id;if(!identities.has(m.identity_id)||!orgs.has(m.organization_id)||!['owner','worker'].includes(m.role)||typeof m.active!=='boolean'||memberKeys.has(k)||identities.get(m.identity_id).kind!=='worker')fail('Invalid backup membership.');memberKeys.add(k);}
    for(const o of b.organizations)if(!b.memberships.some(m=>m.organization_id===o.id&&m.role==='owner'&&m.active))fail('Backup organization needs an active owner.');
    for(const p of b.profiles){if(Boolean(p.identity_id)===Boolean(p.organization_id)||p.identity_id&&(!identities.has(p.identity_id)||identities.get(p.identity_id).kind!=='personal')||p.organization_id&&!orgs.has(p.organization_id))fail('Backup profile ownership is invalid.');demographics(Object.fromEntries(['name','age','sex','pregnancy','conditions','medications','changes','history_unknown'].map(k=>[k,p[k]])));date(p.age_as_of);}
    const sources=new Set();for(const r of b.results){if(!profiles.has(r.profile_id)||!identities.has(r.created_by)||r.schema_version!==1)fail('Backup result has an invalid owner or version.');validateResult(Object.fromEntries(['kind','source_id','captured_at','model','provider','data'].map(k=>[k,r[k]])));keys(r.context,['name','age','age_as_of','sex','pregnancy','conditions','medications','changes','history_unknown']);text(r.note,8000,true);const k=r.profile_id+':'+r.source_id;if(sources.has(k))fail('Duplicate backup result source.');sources.add(k);}
    return transaction(()=>{
      let count=0;
      for(const t of tables)for(const v of b[t]){
        const old=get(t,v.id);if(old){if(JSON.stringify(old)!==JSON.stringify(v))fail('This backup conflicts with existing records. Restore into a fresh data directory.',409);continue;}
        const cols={};for(const k of ({identities:[],organizations:[],facilities:['organization_id'],memberships:['identity_id','organization_id'],profiles:['identity_id','organization_id'],results:['profile_id','source_id']}[t]))cols[k]=v[k];
        put(t,v,cols);count++;
      }
      return {restored:count};
    });
  }
  function saveDraftValidation(draft){keys(draft,['step','fields']);if(Object.keys(draft).length){if(!Number.isInteger(draft.step)||draft.step<0||draft.step>3)fail('Invalid backup onboarding step.');keys(draft.fields,['name','email','job_role','age','sex','pregnancy','conditions','medications','changes','history_unknown','organization_name','care_setting','facility_name','timezone','invite']);}}
  function previewInvite(token){const v=get('invitations',token);if(!v||v.revoked||v.used_by||Date.parse(v.expires_at)<=Date.now())fail('This invitation has expired or was already used.',404);return {organization:get('organizations',v.organization_id),facility:all('facilities','WHERE organization_id=?',v.organization_id)[0],role:'worker'};}
  return {close:()=>db.close(),actor,workspace,listIdentities,createIdentity,saveDraft,complete,saveProfile,saveResult,results,updateResult,deleteResult,team,invite,invitations,revoke,deactivate,backup,restore,previewInvite};
}

/** The only place to replace demo selection with a verified session in future. */
export function resolveDemoIdentity(req, store) {
  const identityId=req.headers['x-kera-identity'];
  if(typeof identityId!=='string')fail('Select your demo profile to continue.',401);
  return store.actor(identityId);
}
export function recordsAPI(store,req,url,body) {
  const p=url.pathname,method=req.method;
  if(p==='/api/accounts'&&method==='GET')return {identities:store.listIdentities()};
  if(p==='/api/accounts'&&method==='POST')return store.createIdentity(body);
  if(p==='/api/restore'&&method==='POST')return store.restore(body);
  if(p.startsWith('/api/invitation/')&&method==='GET')return store.previewInvite(p.split('/').at(-1));
  const a=resolveDemoIdentity(req,store);
  if(p==='/api/account'&&method==='GET')return store.workspace(a);
  if(p==='/api/account/draft'&&method==='PATCH')return store.saveDraft(a,body);
  if(p==='/api/account/complete'&&method==='POST')return store.complete(a,body);
  if(p==='/api/profiles'&&method==='POST')return store.saveProfile(a,null,body);
  if(/^\/api\/profiles\/[^/]+$/.test(p)&&method==='PUT')return store.saveProfile(a,p.split('/')[3],body);
  if(/^\/api\/profiles\/[^/]+\/results$/.test(p)){if(method==='GET')return {results:store.results(a,p.split('/')[3])};if(method==='POST')return store.saveResult(a,p.split('/')[3],body);}
  if(/^\/api\/results\/[^/]+$/.test(p)){if(method==='PATCH')return store.updateResult(a,p.split('/')[3],body);if(method==='DELETE')return store.deleteResult(a,p.split('/')[3]);}
  if(/^\/api\/organizations\/[^/]+\/team$/.test(p)&&method==='GET')return {members:store.team(a,p.split('/')[3])};
  if(/^\/api\/organizations\/[^/]+\/invitations$/.test(p)){if(method==='POST')return store.invite(a,p.split('/')[3]);if(method==='GET')return {invitations:store.invitations(a,p.split('/')[3])};}
  if(/^\/api\/invitations\/[^/]+$/.test(p)&&method==='DELETE')return store.revoke(a,p.split('/')[3]);
  if(/^\/api\/memberships\/[^/]+$/.test(p)&&method==='DELETE')return store.deactivate(a,p.split('/')[3]);
  if(p==='/api/backup'&&method==='GET')return store.backup(a);
  fail('This records endpoint or method is not supported.',404);
}
