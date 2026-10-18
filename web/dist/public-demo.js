/** Public fictional workspaces. Each visitor edits only their own browser copy. */
import { cleanContext, validateInsights } from './health-context.js';
import { normalizeReview } from './care-review.js';

const tables=['identities','organizations','facilities','memberships','profiles','results'];
const copy=value=>structuredClone(value);
const stamp=()=>new Date().toISOString();
const plain=(value,max=200)=>{
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b-\u001f\u007f]|data\s*:|base64|blob:/i.test(value))throw Error('Use plain text within the field limit. Photos cannot be saved.');
  return value.trim();
};

export function createPublicDemo({storage=globalThis.localStorage,load=async()=>{
  const response=await fetch('/demo-data/kera-demo-backup.json',{cache:'no-cache'});
  if(!response.ok)throw Error('The sample dataset could not load. Please retry.');
  return response.json();
},kind='worker'}={}){
  const key='kera-public-demo-v1-'+kind;
  let data=null;
  function check(value){
    if(value?.format!=='kera-backup'||value.version!==1||tables.some(t=>!Array.isArray(value[t])))throw Error('The saved demo could not be read. Reset the demo to reload the sample dataset.');
    if(value.identities.length!==1||value.identities[0].kind!==(kind==='worker'?'worker':'personal'))throw Error('This is not the expected demo workspace.');
    return value;
  }
  async function enter(){
    const saved=storage.getItem(key);
    if(saved){try{data=check(JSON.parse(saved));}catch{throw Error('The saved demo could not be read. Use Reset demo to reload its sample data.');}}
    else{
      const fixture=kind==='worker'?await load():{format:'kera-backup',version:1,exported_at:stamp(),identities:[{id:'kera-interactive-demo',kind:'personal',name:'Demo',email:'',job_role:'',complete:true,draft:{},created_at:stamp()}],organizations:[],facilities:[],memberships:[],profiles:[{id:'kera-interactive-demo-profile',identity_id:'kera-interactive-demo',organization_id:null,name:'Demo',age:null,age_as_of:stamp(),sex:'',pregnancy:'',conditions:'',medications:'',changes:'',history_unknown:true,created_at:stamp()}],results:[]};
      data=check(copy(fixture));
      // Fail before showing a persistent workspace if storage is unavailable/full.
      storage.setItem(key,JSON.stringify(data));
    }
    return request('account');
  }
  function reset(){storage.removeItem(key);data=null;}
  function change(fn){
    const before=copy(data);
    try{const result=fn();storage.setItem(key,JSON.stringify(data));return copy(result);}
    catch(e){data=before;throw e;}
  }
  const profile=id=>{const p=data.profiles.find(p=>p.id===id);if(!p)throw Error('This resident is not in the demo workspace.');return p;};
  function request(path,method='GET',body){
    if(!data)throw Error('Open the demo workspace first.');
    if(path==='account'&&method==='GET')return copy({identity:data.identities[0],organizations:data.organizations,facilities:data.facilities,memberships:data.memberships,profiles:data.profiles});
    if(path==='backup'&&method==='GET')return copy({...data,exported_at:stamp()});
    const parts=path.split('/');
    if(parts[0]==='profiles'&&parts[2]==='results'){
      const p=profile(parts[1]);
      if(method==='GET')return {results:copy(data.results.filter(r=>r.profile_id===p.id).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at)))};
      if(method==='POST')return change(()=>{
        const input=copy(body);
        if(!['hb','visual'].includes(input.kind)||!input.source_id||!Number.isFinite(Date.parse(input.captured_at)))throw Error('This result could not be saved.');
        let resultData;
        if(input.kind==='hb'){
          const readings=input.data?.readings;
          if(!Array.isArray(readings)||!readings.length||readings.length>100||new Set(readings.map(r=>r.id)).size!==readings.length)throw Error('Use valid, distinct hemoglobin readings.');
          let total=0,compensation=0;const warnings=new Set();
          for(const r of readings){
            if(!r.id||!Number.isFinite(r.hemoglobin_g_per_l)||r.hemoglobin_g_per_l<=0||r.hemoglobin_g_per_l>1000||!Array.isArray(r.warnings))throw Error('Use valid hemoglobin readings.');
            plain(r.id,128);for(const w of r.warnings)warnings.add(plain(w,256));
            const adjusted=r.hemoglobin_g_per_l-compensation,next=total+adjusted;compensation=(next-total)-adjusted;total=next;
          }
          resultData={readings:readings.map(r=>({id:r.id,hemoglobin_g_per_l:r.hemoglobin_g_per_l,warnings:r.warnings})),hemoglobin_g_per_l:total/readings.length,scan_count:readings.length,units:'g/L',warnings:[...warnings]};
        }else{
          normalizeReview({...input.data,model:input.model,provider:input.provider});
          resultData={image_quality:copy(input.data.image_quality),observations:copy(input.data.observations)};
        }
        if(input.data.insights)resultData.insights=validateInsights(input.data.insights);
        const previous=data.results.find(r=>r.profile_id===p.id&&r.source_id===input.source_id);
        if(previous){if(resultData.insights)previous.data.insights=resultData.insights;return previous;}
        const context={...Object.fromEntries(['name','age','age_as_of','sex','pregnancy','conditions','medications','changes','history_unknown'].map(k=>[k,p[k]])),...(input.profile_context?cleanContext(input.profile_context):{})};
        const result={id:crypto.randomUUID(),profile_id:p.id,kind:input.kind,source_id:plain(input.source_id,128),captured_at:new Date(input.captured_at).toISOString(),model:plain(input.model,200),provider:plain(input.provider,160),data:resultData,context,created_by:data.identities[0].id,created_at:stamp(),note:'',schema_version:1};
        data.results.push(result);return result;
      });
    }
    if(parts[0]==='profiles'&&((parts.length===1&&method==='POST')||(parts.length===2&&method==='PUT')))return change(()=>{
      const old=parts[1]?profile(parts[1]):null,health=cleanContext(body),name=plain(body.name);
      if(!name||health.age===undefined)throw Error('Enter a name and age.');
      const p={...(old||{id:crypto.randomUUID(),identity_id:null,organization_id:data.organizations[0]?.id,created_at:stamp()}),name,...health,age_as_of:stamp().slice(0,10),updated_at:stamp()};
      if(old)data.profiles[data.profiles.indexOf(old)]=p;else data.profiles.push(p);return p;
    });
    if(parts[0]==='results'&&parts.length===2&&['PATCH','DELETE'].includes(method))return change(()=>{
      const r=data.results.find(r=>r.id===parts[1]);if(!r)throw Error('Result not found.');
      if(method==='DELETE'){data.results=data.results.filter(row=>row!==r);return {deleted:true};}
      r.note=plain(body.note,8000);r.note_updated_at=stamp();r.note_updated_by=data.identities[0].id;return r;
    });
    if(parts[0]==='organizations'&&parts[2]==='team'&&method==='GET')return {members:copy(data.memberships.filter(m=>m.organization_id===parts[1]).map(m=>({...m,name:data.identities[0].name,job_role:data.identities[0].job_role})))};
    throw Error('This action is available in a local workspace. The public demo stays in this browser.');
  }
  return {enter,request,reset};
}
