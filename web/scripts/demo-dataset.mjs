/** Reproducible fictional care-home fixture. Never changes model inference. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openRecords, csvCell } from '../server/records.mjs';

export const DEMO_WORKER_ID='kera-demo-worker-2026-10-18';
export const JOHN_ID='kera-demo-resident-john';
export const JAD_PROFILE={id:'3cb15471-a2ba-4125-a04b-ff70977917b8',identity_id:null,organization_id:'kera-demo-maple-grove',created_at:'2026-10-18T09:42:07.724Z',name:'Jad',age:67,pregnancy:'',age_as_of:'2026-10-18',sex:'other_or_not_provided',conditions:'Dying',medications:'Everything',changes:'Eczema found in groin area',history_unknown:false,updated_at:'2026-10-18T09:42:07.724Z'};
const ORG='kera-demo-maple-grove',FACILITY='kera-demo-maple-grove-house';
const residents=[
  ['John',79,'male','Hypertension diagnosed in 2014; knee osteoarthritis; cataract surgery in 2021. No known anemia history.','Amlodipine; acetaminophen as needed.','Feels as usual today; appetite and usual walking routine unchanged.',150],
  ['Margaret Chen',86,'female','Type 2 diabetes since 2008; hypertension; reduced vision; uses a rollator.','Metformin; amlodipine; vitamin D.','Routine foot-care review this month; no new concerns reported.',133],
  ['Robert Williams',82,'male','Stage 3 chronic kidney disease; hypertension; mild hearing loss.','Losartan; vitamin D; prescribed emollient.','Care team is following an established laboratory monitoring plan.',124],
  ['Asha Patel',91,'female','Osteoporosis; healed wrist fracture in 2023; hand osteoarthritis.','Alendronate; calcium with vitamin D; acetaminophen as needed.','Attending gentle exercise group; no recent falls reported.',129],
  ['George Campbell',88,'male','Atrial fibrillation; hypertension; previous hip replacement.','Apixaban; metoprolol; vitamin D.','Occasional small forearm bruises recorded for routine staff review.',140],
  ['Evelyn Martin',84,'female','Hypothyroidism; dry skin; chronic constipation.','Levothyroxine; polyethylene glycol; fragrance-free moisturizer.','Intermittent dry hands; otherwise usual daily routine.',135],
  ['Fatima Hassan',76,'female','Rheumatoid arthritis; reduced grip strength; reflux.','Hydroxychloroquine; omeprazole; acetaminophen as needed.','Help with opening containers; joint symptoms reported as unchanged.',126],
  ['Arthur Brown',94,'male','Mild cognitive impairment; benign prostatic enlargement; bilateral hearing aids.','Tamsulosin; vitamin D.','Care staff and family support history-taking; eating usual meals.',143],
  ['Lucia Rossi',89,'female','Iron deficiency previously documented by her clinician; osteoarthritis.','Prescribed oral iron; vitamin D; acetaminophen as needed.','Existing clinician follow-up for iron history; no new symptoms reported.',116],
  ['David Singh',73,'male','Type 2 diabetes; peripheral neuropathy; hypertension.','Metformin; ramipril; prescribed neuropathic pain medicine.','Podiatry visit completed recently; staff assist with skin checks.',137],
  ['Grace Wilson',96,'female','Heart failure with preserved ejection fraction; osteoarthritis; reduced mobility.','Furosemide; bisoprolol; vitamin D.','Uses wheelchair for longer distances; usual staff-supported routine.',122],
  ['Joseph Nguyen',81,'male','Chronic obstructive pulmonary disease; former smoker; hypertension.','Tiotropium inhaler; salbutamol as needed; amlodipine.','No recent respiratory flare reported; attends seated exercise.',151],
  ['Dorothy Lewis',87,'female','History of eczema; hypertension; age-related hearing loss.','Amlodipine; prescribed topical emollient.','Dry skin comes and goes; staff document visible changes.',131],
  ['Peter Kowalski',78,'male','Parkinson disease; constipation; previous falls.','Carbidopa/levodopa; polyethylene glycol; vitamin D.','Supervised walking; one near-fall last month with no injury.',144],
  ['Mary Osei',85,'female','Stage 3 chronic kidney disease; hypertension; knee osteoarthritis.','Amlodipine; vitamin D; acetaminophen as needed.','Routine clinician review already scheduled for chronic conditions.',118],
  ['Samuel Green',90,'male','Previous stroke with mild left-sided weakness; hyperlipidemia.','Clopidogrel; atorvastatin; vitamin D.','Staff support transfers; participates in weekly physiotherapy.',139],
  ['Helen Dubois',83,'female','Macular degeneration; osteoporosis; intermittent insomnia.','Calcium with vitamin D; prescribed eye supplements.','Requires larger-print activity sheets; sleep varies by week.',137],
  ['Ahmed Ali',80,'male','Vitamin B12 deficiency previously documented; type 2 diabetes.','Clinician-administered B12; metformin; vitamin D.','Existing B12 follow-up plan; no new symptoms reported.',132],
  ['Rose Anderson',92,'female','Mild dementia; osteoarthritis; previous cataract surgery.','Donepezil; acetaminophen as needed; vitamin D.','Family and staff provide background; usual appetite this week.',128],
  ['William MacDonald',68,'male','Multiple sclerosis with limited mobility; hypertension.','Baclofen; amlodipine; prescribed emollient.','Staff assist with daily care; no new skin concerns reported.',147],
];
function random(seed){let x=seed>>>0;return()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};}

export function createJadResults(profile=JAD_PROFILE){
  const rand=random(670018),results=[],context=Object.fromEntries(['name','age','age_as_of','sex','pregnancy','conditions','medications','changes','history_unknown'].map(k=>[k,profile[k]]));
  for(let week=0;week<27;week++){
    const captured_at=new Date(Date.parse('2026-10-18T04:00:00.000Z')-(26-week)*7*86400000).toISOString(),prefix=`jad-fictional-${captured_at.slice(0,10)}`;
    const value=Math.round((77-week*.7+(rand()-.5)*6)*10)/10;
    const readings=[-1,0,1].map((offset,i)=>({id:prefix+'-scan-'+i,hemoglobin_g_per_l:Math.round((value+offset)*10)/10,warnings:['FICTIONAL DEMO: deliberately very low generated reading, not a real test.']}));
    const common={profile_id:profile.id,captured_at,context:{...context},created_by:DEMO_WORKER_ID,created_at:captured_at,note:'FICTIONAL DEMO ONLY. Deliberately poor generated results for a video. The profile text is user-supplied fictional context, not a verified medical record.',schema_version:1,provider:'Fictional demo generator; no photo or laboratory test'};
    const insights={summary:'Fictional scenario with a markedly low generated estimate and repeated concerning observations. Arrange clinical review and confirm concerns with a laboratory blood test in the scripted scenario.',considerations:[{reported_detail:'The supplied background is fictional and includes deliberately exaggerated placeholder text.',why_it_matters:'These placeholders do not establish actual conditions or medicines and cannot explain a test result.',question_for_clinician:'What verified background and confirmatory tests would be needed to review this scenario?'}],limitations:'All results are fabricated for demonstration. They are not findings about a real person, diagnoses or laboratory measurements.'};
    results.push({...common,id:prefix+'-hb',kind:'hb',source_id:prefix+'-hb',model:'SIMULATED poor Hb history v1',data:{hemoglobin_g_per_l:readings.reduce((s,r)=>s+r.hemoglobin_g_per_l,0)/3,scan_count:3,units:'g/L',warnings:readings[0].warnings,readings,insights}});
    const descriptions={skin_cancer:'An irregular dark patch with an uneven border is visible on the hand.',fungal_infection:'A thickened yellow nail edge with visible debris is present.',eczema:'Marked dryness, surface scaling and small cracks are visible around the nail folds.',psoriasis:'Multiple shallow nail pits and flaky surface patches are visible.'};
    const observations=Object.fromEntries(Object.entries(descriptions).map(([key,evidence])=>[key,{status:'possible_features',evidence,view:'top'}]));
    results.push({...common,id:prefix+'-visual',kind:'visual',source_id:prefix+'-visual',model:'SIMULATED concerning nail observations v1',data:{image_quality:{assessment:'adequate',reason:'Fine surface details are visible in this fictional example.'},observations,insights}});
  }
  return results;
}

export function createDemoDataset(){
  const rand=random(20261018),today='2026-10-18',stamp=today+'T04:00:00.000Z',created='2026-04-18T04:00:00.000Z';
  const backup={format:'kera-backup',version:1,exported_at:stamp,
    identities:[{id:DEMO_WORKER_ID,kind:'worker',name:'Alex Morgan (Demo care worker)',email:'alex.morgan@example.test',job_role:'Registered nurse',complete:true,draft:{},created_at:created}],
    organizations:[{id:ORG,name:'Maple Grove Senior Living (Fictional demo)',care_setting:'Long-term care',timezone:'America/Toronto',created_at:created}],
    facilities:[{id:FACILITY,organization_id:ORG,name:'Maple Grove House (Fictional)',created_at:created}],
    memberships:[{id:'kera-demo-owner',identity_id:DEMO_WORKER_ID,organization_id:ORG,role:'owner',active:true,created_at:created}],profiles:[],results:[]};
  const weeks=Array.from({length:26},(_,n)=>new Date(Date.parse(stamp)-(26-n)*7*86400000).toISOString());
  for(const [index,[name,age,sex,conditions,medications,changes,baseline]]of residents.entries()){
    const id=index===0?JOHN_ID:`kera-demo-resident-${String(index+1).padStart(2,'0')}`;
    const p={id,identity_id:null,organization_id:ORG,name,age,age_as_of:stamp,sex,pregnancy:'not_pregnant',conditions,medications,changes,history_unknown:false,created_at:created,updated_at:stamp};backup.profiles.push(p);
    const context=Object.fromEntries(['name','age','age_as_of','sex','pregnancy','conditions','medications','changes','history_unknown'].map(k=>[k,p[k]]));
    let hb=baseline;
    for(const [week,captured_at]of [...weeks,...(index===0?[]:[stamp])].entries()){
      const localDate=captured_at.slice(0,10),prefix=`${id}-${localDate}`;
      hb=Math.round(Math.min(baseline+5,Math.max(baseline-5,hb+(rand()-.5)*5))*10)/10;
      if(index===0)hb=Math.min(154,Math.max(145,hb));
      const snapshot={...context,changes:week===26?changes:['Usual activity and appetite reported at this weekly check-in.','Staff-assisted routine check-in; no new concerns reported.','Reports occasional joint stiffness during usual activities.','Routine weekly check-in; background reviewed with care staff.'][Math.floor(rand()*4)]};
      const base={profile_id:id,captured_at,context:snapshot,created_by:DEMO_WORKER_ID,created_at:captured_at,note:'FICTIONAL DEMO DATA. Randomly generated for a video; no real patient, photo, inference or laboratory test.',schema_version:1,provider:'Fictional demo generator; no patient photos'};
      const readings=[-1.2,.2,1].map((offset,n)=>({id:`${prefix}-scan-${n}`,hemoglobin_g_per_l:Math.round((hb+offset)*10)/10,warnings:['SIMULATED demo history. Not a blood-test or model result.']}));
      const mean=readings.reduce((sum,r)=>sum+r.hemoglobin_g_per_l,0)/3;
      backup.results.push({...base,id:prefix+'-hb',kind:'hb',source_id:prefix+'-hb',model:'SIMULATED weekly Hb history v1',data:{hemoglobin_g_per_l:mean,scan_count:3,units:'g/L',warnings:readings[0].warnings,readings,insights:{summary:index===0?'Fictional weekly estimate remains within John’s usual 145–154 g/L history.':`Fictional weekly estimate: ${mean.toFixed(1)} g/L. Review alongside the resident’s recorded background and previous check-ins.`,considerations:[{reported_detail:conditions,why_it_matters:'Recorded health background provides context; it does not establish the cause of an estimate.',question_for_clinician:'Does this trend warrant a laboratory blood count or a review at the next scheduled visit?'}],limitations:'Synthetic demonstration data, not a diagnosis or a laboratory result. Photos cannot confirm or rule out anemia.'}}});
      const limited=rand()<.12,observations={};
      for(const category of ['skin_cancer','fungal_infection','eczema','psoriasis']){
        const possible=rand()<(category==='eczema'?.24:category==='fungal_infection'?.18:.06);
        const evidence=category==='skin_cancer'?'A small uneven dark patch is visible near the edge of the hand.':category==='fungal_infection'?'A yellow-white area with a thickened free nail edge is visible.':category==='eczema'?'Dry rough skin with fine surface scaling is visible around the knuckles.':'Fine scaling and a few shallow surface pits are visible on one nail.';
        observations[category]={status:limited?'unclear':possible?'possible_features':'no_visible_features',evidence:limited?'Fine detail is obscured by glare and soft focus.':possible?evidence:'The visible area shows no specific changes for this check.',view:'top'};
      }
      backup.results.push({...base,id:prefix+'-visual',kind:'visual',source_id:prefix+'-visual',model:'SIMULATED weekly visual observations v1',data:{image_quality:{assessment:limited?'limited':'adequate',reason:limited?'Soft focus and glare obscure some fine detail.':'The hand and nail surfaces are visible with even light.'},observations,insights:{summary:'Fictional weekly visual review. Visible descriptions are generated examples and do not establish any condition.',considerations:[{reported_detail:week===26?changes:snapshot.changes,why_it_matters:'Staff can compare documented visible changes with earlier observations and the resident’s reported background.',question_for_clinician:'Should any persistent or changing visible finding be reviewed at the next visit?'}],limitations:'Synthetic observations only. No photo was assessed and these descriptions cannot confirm or rule out a condition.'}}});
    }
  }
  backup.profiles.push({...JAD_PROFILE});backup.results.push(...createJadResults());
  return backup;
}

export function writeDemoDataset(output,data=createDemoDataset()){
  const check=openRecords(':memory:');try{check.restore(data);}finally{check.close();}
  mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,'kera-demo-backup.json'),JSON.stringify(data,null,2)+'\n');
  writeFileSync(resolve(output,'residents.csv'),[['name','age','sex','conditions','medications','recent changes'],...data.profiles.map(p=>[p.name,p.age,p.sex,p.conditions,p.medications,p.changes])].map(row=>row.map(csvCell).join(',')).join('\r\n'));
  writeFileSync(resolve(output,'weekly-history.csv'),[['resident','date','kind','hemoglobin g/L','quality','observations','label'],...data.results.map(r=>[r.context.name,r.captured_at,r.kind,r.data.hemoglobin_g_per_l??'',r.data.image_quality?.assessment??'',r.kind==='visual'?JSON.stringify(r.data.observations):'','FICTIONAL DEMO'])].map(row=>row.map(csvCell).join(',')).join('\r\n'));
  writeFileSync(resolve(output,'john-pending-scenario.json'),JSON.stringify({fictional:true,resident_id:JOHN_ID,demo_date:'2026-10-18',status:'NOT SAVED TO HISTORY',usual_hb_g_per_l:[145,154],simulated_today_hb_g_per_l:112,reported_symptoms:'Feels as usual.',follow_up:'Request clinician review and a confirmatory blood test. A photo estimate cannot establish anemia.'},null,2)+'\n');
  return data;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=resolve(process.argv[2]||fileURLToPath(new URL('../demo-data/',import.meta.url))),data=writeDemoDataset(output);
  const flag=process.argv.indexOf('--install');
  if(flag>=0){
    const filename=resolve(process.argv[flag+1]||'web/.data/kera.sqlite');
    if(existsSync(filename)){
      // Retain a consistent SQLite snapshot before adding anything to an existing DB.
      const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(filename);
      try{const target=resolve(dirname(filename),`before-demo-${Date.now()}.sqlite`);db.prepare('VACUUM INTO ?').run(target);}finally{db.close();}
    }
    const store=openRecords(filename);try{console.log('Installed',store.restore(JSON.parse(readFileSync(resolve(output,'kera-demo-backup.json'),'utf8'))));}finally{store.close();}
  }
  console.log(`Saved ${data.profiles.length} fictional residents and ${data.results.length} results to ${output}. John has no October 18 record.`);
}
