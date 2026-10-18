/** Small shared context contract. No names, email, identity IDs or photos. */
export const CONTEXT_KEYS=['age','sex','pregnancy','conditions','medications','changes','history_unknown'];
export const INSIGHT_SCHEMA={type:'object',additionalProperties:false,properties:{summary:{type:'string'},considerations:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{reported_detail:{type:'string'},why_it_matters:{type:'string'},question_for_clinician:{type:'string'}},required:['reported_detail','why_it_matters','question_for_clinician']}},limitations:{type:'string'}},required:['summary','considerations','limitations']};
const record=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function cleanContext(value){
  if(!record(value))throw Error('Profile context could not be read.');
  const out={};if(value.age!==undefined&&value.age!==null){if(!Number.isInteger(value.age)||value.age<0||value.age>130)throw Error('Invalid context age.');out.age=value.age;}
  for(const k of ['sex','pregnancy','conditions','medications','changes']){
    const v=value[k]??'';if(typeof v!=='string'||v.length>(['sex','pregnancy'].includes(k)?100:2000)||/[\u0000-\u0008\u000b-\u001f\u007f]|data\s*:|base64|blob:/i.test(v))throw Error('Use plain text for profile context.');out[k]=v.trim();
  }
  if(!['','male','female','other_or_not_provided'].includes(out.sex)||!['','pregnant','not_pregnant'].includes(out.pregnancy))throw Error('Invalid clinical reference details.');
  out.history_unknown=value.history_unknown===true;
  if(out.history_unknown){out.conditions='';out.medications='';out.changes='';}
  return out;
}
export function validateInsights(v){
  const exact=(o,ks)=>record(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
  const prose=x=>typeof x==='string'&&x.trim()&&x.length<=1400&&!/[\u0000-\u0008\u000b-\u001f\u007f]|data\s*:|base64|blob:|https?:\/\/|\b(?:you (?:have|definitely|certainly)|confirmed diagnosis|cancer.free|disease.free|start taking|stop taking|increase (?:your|the) dose|decrease (?:your|the) dose)\b/i.test(x);
  if(!exact(v,['summary','considerations','limitations'])||!prose(v.summary)||!prose(v.limitations)||!Array.isArray(v.considerations)||v.considerations.length>3||v.considerations.some(c=>!exact(c,['reported_detail','why_it_matters','question_for_clinician'])||!Object.values(c).every(prose)))throw Error('Context insights could not be validated. The original analysis is still available.');
  return JSON.parse(JSON.stringify(v));
}
export const MEDLINEPLUS='https://medlineplus.gov/ency/article/003645.htm';
export const HB_TEST_SOURCE='https://medlineplus.gov/lab-tests/hemoglobin-test/';
export function hemoglobinContext(value,hb,{demo=false}={}){
  const c=cleanContext(value);if(!Number.isFinite(hb)||hb<=0||hb>1000)throw Error('Invalid Hb estimate.');
  // Demo deliberately uses the outer bounds of the two sourced adult intervals.
  // It is a broad illustrative guide, never a personalized or universal interval.
  const range=demo?[121,172]:c.age>=18&&c.sex==='male'&&c.pregnancy!=='pregnant'?[138,172]:c.age>=18&&c.sex==='female'&&c.pregnancy==='not_pregnant'?[121,151]:null;
  return {context:c,range,demo,comparison:range?`Your photo estimate is ${hb<range[0]?'below':hb>range[1]?'above':'within'} ${demo?'the broad adult demo guide':'this common adult laboratory reference range'} (${range[0]}–${range[1]} g/L). This is an educational comparison, not a blood-test result or a health classification.`:'A personal reference interval cannot be selected from the supplied details. Age, sex, pregnancy and the laboratory matter. Ask your clinician which blood-test reference interval applies.',reference:demo?'Demo guide: 121–172 g/L combines the outer limits of the common adult female and male intervals. It is intentionally broad because Demo has no personal background. It does not apply to every adult, children or pregnancy.':'Common adult laboratory intervals: male 138–172 g/L; nonpregnant female 121–151 g/L. These are reference intervals, not averages or validated targets for Kera photo estimates. Pregnancy and children require different interpretation.',limitation:'This estimate is experimental and can be wrong even when it falls within a laboratory interval. A photo cannot confirm or rule out anemia or establish that you are healthy. Conditions and medicines provide interpretation context; they do not change the model output or automatically change these reference limits.'};
}
export function contextLines(context){const c=cleanContext(context);return Object.entries(c).filter(([k,v])=>v!==''&&v!==null&&k!=='history_unknown').map(([k,v])=>`${k.replaceAll('_',' ')}: ${v}`).concat(c.history_unknown?['Health history not provided.']:[]).join('\n');}
export function hemoglobinSummary(context,hb,options={}){
  const report=hemoglobinContext(context,hb,options),c=report.context;
  const state=!report.range?'unavailable':hb<report.range[0]?'below':hb>report.range[1]?'above':'within';
  const label=({below:'Low',above:'High',within:'Within range',unavailable:'Reference needed'})[state];
  const title=state==='unavailable'?'Personal reference needed':state==='within'?`Within ${report.demo?'demo guide':'reference'} range`:`${label} · ${state==='below'?'Below':'Above'} ${report.demo?'demo guide':'reference'} range`;
  const detail=report.range?`${report.range[0]}–${report.range[1]} g/L · ${report.demo?'Broad adult demo guide · Not personalized':`Adult ${c.sex==='male'?'male':'female'} reference · Age ${c.age}`}`:c.age!==undefined&&c.age<18?`Age ${c.age} · An age-specific reference is needed for children and teenagers.`:c.pregnancy==='pregnant'?'Pregnancy reported · A pregnancy-specific reference and gestational stage are needed.':c.age===undefined?'Add your age and reference details to select a personal interval.':!['male','female'].includes(c.sex)?`Age ${c.age} · No sex-specific interval is selected without the applicable reference details.`:'Add pregnancy context to select the applicable adult reference interval.';
  const background=c.conditions||c.medications||c.changes?'Your health background may affect interpretation. Explore your background below.':c.history_unknown?'Health history was not provided.':'';
  return {...report,state,label,title,detail,background};
}
export function appendHemoglobinSummary(root,context,hb,options={}){
  const report=hemoglobinSummary(context,hb,options),doc=root.ownerDocument;
  root.classList.add('hb-reference');root.dataset.range=report.state;
  for(const [tag,text,cls]of [['p',report.title,'hb-range-status'],['p',report.detail,'hb-range-detail'],['p',stateCaution(report.state),'hb-range-caution']]){const n=doc.createElement(tag);n.textContent=text;n.className=cls;root.append(n);}
  if(report.demo){const details=doc.createElement('details'),summary=doc.createElement('summary'),explanation=doc.createElement('p'),source=doc.createElement('a');summary.textContent='How the demo guide works';explanation.textContent=report.reference;source.textContent='Adult laboratory reference source ↗';source.href=MEDLINEPLUS;source.target='_blank';source.rel='noopener noreferrer';details.append(summary,explanation,source);root.append(details);}
  return report;
}
function stateCaution(state){return state==='within'?'Within range does not prove good health. This is a photo estimate; low hemoglobin can be overestimated. Confirm concerns with a clinician and a blood test.':state==='unavailable'?'No healthy or unhealthy classification is assigned without an applicable reference. This photo estimate can be wrong; ask a clinician about a blood test.':'Photo estimate only. Discuss a low or high estimate with a clinician and confirm with a blood test. Low hemoglobin can be overestimated.';}
export function renderHealthContext(root,context,hb,onInsights){
  root.replaceChildren();root.hidden=false;const report=appendHemoglobinSummary(root,context,hb),doc=root.ownerDocument;
  const add=(parent,tag,text,cls)=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
  if(report.background)add(root,'p',report.background,'hb-range-detail');
  const details=add(root,'details','', 'hb-context-details');add(details,'summary','Reference & health background');
  add(details,'p',report.reference,'small-note');add(details,'p',report.limitation,'small-note');const a=add(details,'a','About Hb laboratory references ↗');a.href=MEDLINEPLUS;a.target='_blank';a.rel='noopener noreferrer';
  add(details,'h3','Explore your background');add(details,'pre',contextLines(context));add(details,'p','Generate insights sends the estimate and background shown above through OpenRouter to its selected model provider. No photos, name or email are sent. Provider data policies apply.','small-note');
  const button=add(details,'button','Generate insights','button dark-button');button.type='button';const output=add(details,'div','');output.setAttribute('role','status');
  const brief=add(root,'p','','hb-background-brief');brief.hidden=true;
  button.addEventListener('click',async()=>{button.disabled=true;output.textContent='Preparing background insights…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);try{const response=await fetch('./api/context/hb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,profile_context:report.context,hemoglobin_g_per_l:hb}),signal:controller.signal});const body=await response.json();if(!response.ok)throw Error(body.error?.message||'Insights are unavailable.');const v=validateInsights(body.insights);if(!root.isConnected||!root.contains(output))return;output.replaceChildren();brief.textContent=v.summary.length<=280?v.summary:'Your background insights are ready. Open the details above to review them.';brief.hidden=false;for(const c of v.considerations){add(output,'h4',c.reported_detail);add(output,'p',c.why_it_matters);add(output,'p',c.question_for_clinician);}add(output,'p',v.limitations,'small-note');await onInsights(v);button.textContent='Generate insights again';}catch(e){if(root.contains(output))output.textContent=e.name==='AbortError'?'Insights timed out. Your estimate is unchanged. Try again.':e.message;}finally{clearTimeout(timer);button.disabled=false;}});
}
