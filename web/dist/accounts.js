/**
 * THESIS: a personal check-in and a resident workspace share durable records.
 * OWN-WORLD: Kera monochrome, Outfit, a quiet split setup sheet and flat timelines.
 * STORY: choose a demo identity, set context once, then capture and revisit results.
 * FIRST VIEWPORT: branded left panel; clear audience choices and saved profiles right.
 * FORM: supplied split-onboarding reference; a single form column on phones.
 */
import { createCareReview, normalizeReview, reviewHeadline } from './care-review.js';
import { cleanContext, appendHemoglobinSummary, hemoglobinSummary } from './health-context.js';
import { createPublicDemo } from './public-demo.js';

const $=id=>document.getElementById(id);
const cookieKey='kera_demo_identity',personKey='kera_demo_person';
const readCookie=key=>{try{return decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith(key+'='))?.slice(key.length+1)||'');}catch{return '';}};
const remember=(key,value,persistent=true)=>{document.cookie=`${key}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${persistent?'; Max-Age=2592000':''}`;};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const dateLabel=(v,zone)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',...(zone?{timeZone:zone}:{})}).format(new Date(v));
const localDay=(value,zone)=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',...(zone?{timeZone:zone}:{})}).format(new Date(value));
const kinds={hb:'Hemoglobin levels',visual:'Nail Health Analysis'};
const demoIdentity='kera-interactive-demo';
const referenceOptions=result=>({demo:result.profile_id==='kera-interactive-demo-profile'});
const profileFields=['name','age','sex','pregnancy','conditions','medications','changes','history_unknown'];
export function createAccountExperience({resetCapture}) {
  const hosted=!['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  let publicDemo=null;
  let identityId=readCookie(cookieKey),guest=false,rememberProfile=true,workspace=null,person=null,screen='welcome',draftStep=0,fields={},flowKind='personal',editing=false,pendingSave=null,saveGeneration=0;
  let debounce=null,flowGeneration=0;
  const setupHeader=document.querySelector('.header');new ResizeObserver(()=>document.documentElement.style.setProperty('--setup-header-height',setupHeader.getBoundingClientRect().height+'px')).observe(setupHeader);
  const root=node('section',undefined,'account-app');root.id='account-app';document.querySelector('.header').after(root);
  const bar=node('nav',undefined,'account-bar');bar.setAttribute('aria-label','Your workspace');root.before(bar);
  const status=node('div',undefined,'record-save');status.id='record-save';status.setAttribute('role','status');root.before(status);status.hidden=true;
  const errorBox=node('p',undefined,'account-error');errorBox.setAttribute('role','alert');errorBox.hidden=true;
  const activeLabel=node('p',undefined,'active-person');setupHeader.append(activeLabel);activeLabel.hidden=true;
  const modeTabs=document.querySelector('.mode-tabs'),originalModeParent=modeTabs.parentElement;modeTabs.setAttribute('aria-orientation','horizontal');
  const menu= node('button','☰','workspace-menu');menu.type='button';menu.setAttribute('aria-label','Open navigation');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-controls','workspace-navigation');menu.hidden=true;setupHeader.prepend(menu);bar.id='workspace-navigation';
  const backdrop=node('button',undefined,'workspace-backdrop');backdrop.type='button';backdrop.setAttribute('aria-label','Close navigation');backdrop.hidden=true;bar.after(backdrop);
  const narrow=matchMedia('(max-width: 1000px)');let drawerOpen=false;
  function drawer(open){drawerOpen=open;document.body.classList.toggle('navigation-open',open);menu.setAttribute('aria-expanded',String(open));backdrop.hidden=!open;bar.inert=narrow.matches&&!open;bar.setAttribute('role',open&&narrow.matches?'dialog':'navigation');if(open&&narrow.matches)bar.setAttribute('aria-modal','true');else bar.removeAttribute('aria-modal');if(open)bar.querySelector('button')?.focus();else if(narrow.matches&&bar.contains(document.activeElement))menu.focus();}
  menu.addEventListener('click',()=>drawer(!drawerOpen));backdrop.addEventListener('click',()=>drawer(false));narrow.addEventListener('change',()=>drawer(false));
  document.addEventListener('keydown',e=>{if(!drawerOpen)return;if(e.key==='Escape'){e.preventDefault();drawer(false);}if(e.key==='Tab'){const focusable=[...bar.querySelectorAll('button:not([disabled]),a[href]')].filter(n=>n.getClientRects().length);const i=focusable.indexOf(document.activeElement);if(e.shiftKey&&i===0){e.preventDefault();focusable.at(-1).focus();}else if(!e.shiftKey&&i===focusable.length-1){e.preventDefault();focusable[0].focus();}}});
  modeTabs.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!workspace?.identity.complete||!person||screen==='capture')return;resetCapture();go('capture');},true);
  modeTabs.addEventListener('click',e=>{if(!e.target.closest('button')||!workspace?.identity.complete)return;if(!person){e.stopImmediatePropagation();void dashboard();drawer(false);return;}if(screen!=='capture'){resetCapture();go('capture');}drawer(false);},true);
  const iconPaths={'Health checker':'M12 4v16 M4 12h16 M3 3h18v18H3z',Dashboard:'M3 10 12 3l9 7v10H3z M9 20v-7h6v7',History:'M3 12a9 9 0 1 0 3-7 M3 3v6h6 M12 7v5l3 2',Team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8v6 M15 11h6',Settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0','Sign out':'M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4'};
  function navButton(label,fn,current){const b=action(label,async()=>{drawer(false);await fn();},true);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[label]);svg.append(path);b.prepend(svg);if(current)b.setAttribute('aria-current','page');return b;}

  const csrfHeaders=()=>({'Content-Type':'application/json',...(identityId?{'X-Kera-Identity':identityId}:{})});
  async function api(path,method='GET',data,actor=identityId){
    if(publicDemo)return publicDemo.request(path,method,data);
    const response=await fetch('/api/'+path,{method,headers:{...csrfHeaders(),...(actor?{'X-Kera-Identity':actor}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store'});
    const result=await response.json().catch(()=>null);if(!response.ok||!result)throw Error(result?.error?.message||'Kera could not load your records. Check the local server and retry.');return result;
  }
  function feedback(e){errorBox.textContent=typeof e==='string'?e:e.message;errorBox.hidden=false;root.prepend(errorBox);errorBox.scrollIntoView({block:'nearest'});}
  function action(label,fn,secondary=false){const b=node('button',label,'button '+(secondary?'secondary-button':'dark-button'));b.type='button';b.addEventListener('click',async()=>{b.disabled=true;errorBox.hidden=true;try{await fn();}catch(e){feedback(e);}finally{b.disabled=false;}});return b;}
  function content(){root.replaceChildren();errorBox.hidden=true;root.append(errorBox);}
  function go(next){
    if(next!=='capture')document.getElementById('john-demo-checkin')?.remove();
    if(screen==='capture'&&next!=='capture'){resetCapture();status.hidden=true;pendingSave=null;saveGeneration++;}
    screen=next;document.body.dataset.accountScreen=next;root.hidden=next==='capture';
    $('workspace').hidden=next!=='capture';$('review-page').hidden=true;
    if(location.hash==='#review')history.replaceState(null,'',location.pathname+location.search);
    document.querySelector('.skip-link').href=next==='capture'?'#workspace':'#account-app';
    document.querySelector('.skip-link').textContent=next==='capture'?'Skip to camera':'Skip to content';
    activeLabel.hidden=!workspace?.identity.complete;activeLabel.textContent=person?`${guest?'Demo profile':workspace?.identity.kind==='worker'?'Resident':'Personal profile'}: ${person.name}`:(workspace?.organizations?.[0]?.name||'Care workspace');
    renderBar();window.scrollTo({top:0,behavior:'instant'});
  }
  function renderBar(){
    const logged=Boolean(workspace?.identity.complete);document.body.classList.toggle('has-account',logged);bar.hidden=!logged;menu.hidden=!logged;originalModeParent.append(modeTabs);bar.replaceChildren();drawer(false);
    if(!logged){originalModeParent.append(modeTabs);return;}
    const brand=document.querySelector('.header .brand').cloneNode(true);brand.className='sidebar-brand';brand.removeAttribute('id');brand.setAttribute('aria-label','Kera dashboard');brand.addEventListener('click',e=>{e.preventDefault();drawer(false);void dashboard();});bar.append(brand);const close=node('button','×','sidebar-close');close.type='button';close.setAttribute('aria-label','Close navigation');close.addEventListener('click',()=>drawer(false));bar.append(close);
    bar.append(node('p',workspace.identity.kind==='worker'?'Care workspace':'Your workspace','sidebar-label'));
    const main=node('div',undefined,'sidebar-links');main.append(navButton('Dashboard',dashboard,screen==='dashboard'),navButton('History',()=>person?historyView():dashboard(),['history','detail','compare'].includes(screen)));if(workspace.identity.kind==='worker')main.append(navButton('Team',teamView,screen==='team'));bar.append(main);
    const checker=navButton('Health checker',async()=>{if(!person)return dashboard();if(screen!=='capture')await capture(person);},screen==='capture');bar.append(checker);
    const bottom=node('div',undefined,'sidebar-bottom');bottom.append(navButton('Settings',settings,screen==='settings'),navButton('Sign out',signOut,false));
    const identity=node('div',undefined,'sidebar-identity');identity.append(node('span',workspace.identity.name.slice(0,1).toUpperCase(),'sidebar-avatar'),node('div',workspace.identity.name));identity.lastChild.append(node('small',guest?'Demo profile':workspace.identity.kind==='worker'?(workspace.organizations[0]?.name||'Care team'):'Individual profile'));bottom.append(identity);bar.append(bottom);
  }
  async function refresh(){workspace=await api('account');person=workspace.profiles.find(p=>p.id===person?.id)||workspace.profiles.find(p=>p.id===readCookie(personKey))||workspace.profiles[0]||null;}
  async function choose(id){if(id===demoIdentity){demoMode();return;}guest=false;clearTimeout(debounce);flowGeneration++;resetCapture();identityId=id;remember(cookieKey,id,rememberProfile);await refresh();if(workspace.identity.complete)await dashboard();else{flowKind=workspace.identity.kind;fields={name:workspace.identity.name,email:workspace.identity.email,job_role:workspace.identity.job_role,...workspace.identity.draft?.fields};draftStep=workspace.identity.draft?.step||0;onboard();}}
  async function signOut(){if(guest||publicDemo){resetCapture();location.assign('/?signin=1');return;}clearTimeout(debounce);flowGeneration++;resetCapture();document.cookie=`${cookieKey}=; Path=/; Max-Age=0; SameSite=Lax`;document.cookie=`${personKey}=; Path=/; Max-Age=0; SameSite=Lax`;workspace=null;identityId='';person=null;pendingSave=null;saveGeneration++;status.hidden=true;await welcome();}
  function split(title,description){
    content();const layout=node('div',undefined,'setup-layout'),aside=node('aside',undefined,'setup-story');
    aside.append(node('p','Kera / A closer look.','setup-brand'),node('h2',workspace?.identity.kind==='worker'||flowKind==='worker'?'A clearer picture.\nAcross every check-in.':'Start with today.\nUnderstand changes over time.'),node('p','Your observations, thoughtfully kept together. No photos saved to your history.'));
    const mark=node('div',undefined,'setup-art');mark.setAttribute('aria-hidden','true');const illustration=node('img');illustration.src='/assets/onboarding-sculpture.png';illustration.alt='';illustration.width=1280;illustration.height=1280;illustration.decoding='async';mark.append(illustration);aside.append(mark,node('p','Experimental research tool.','story-foot'));
    const sheet=node('div',undefined,'setup-sheet');sheet.append(node('p',publicDemo?.kind==='individual'?'INDIVIDUAL':publicDemo?.kind==='worker-workspace'?'HEALTHCARE WORKER':hosted?'PUBLIC DEMO':'LOCAL DEMO','account-kicker'),node('h1',title),node('p',description,'account-lead'));layout.append(aside,sheet);root.append(layout);const titleNode=sheet.querySelector('h1');titleNode.tabIndex=-1;queueMicrotask(()=>titleNode.isConnected&&titleNode.focus({preventScroll:true}));return sheet;
  }
  async function welcome(){
    guest=false;go('welcome');const sheet=split('A closer look starts here.',hosted?'Set up your own profile or care workspace, or explore a demo.':'Choose Individual, Healthcare worker, or jump straight into the demo.');
    const choices=node('div',undefined,'audience-choices');
    for(const [kind,title,desc] of (hosted?[['personal','Individual','Set up your profile and track your own estimates and observations in this browser.'],['worker','Healthcare worker','Set up your organization and add your own residents.'],['worker-demo','Healthcare worker demo','Explore 21 fictional residents and six months of sample history. No sign-in.']]:[['personal','Individual','Track my own hemoglobin estimates and visual observations.'],['worker','Healthcare worker','Manage residents and review their observations over time.']])){
      const b=action('',()=>{if(hosted){location.assign(kind==='personal'?'/?individual=1':kind==='worker'?'/?worker=1':'/?demo=worker');return;}flowKind=kind;fields={};draftStep=0;workspace=null;onboard();},true);b.dataset.audience=kind;b.append(node('strong',title),node('span',desc),node('span',hosted&&kind==='worker-demo'?'Try now →':'Continue →','choice-arrow'));choices.append(b);
    }const demo=action('',()=>demoMode(),true);demo.id='demo-entry';demo.classList.add('demo-entry');demo.append(node('strong','Demo'),node('span','Try both analyses and keep your demo results in history. No onboarding.'),node('span','Try now →','choice-arrow'));choices.append(demo);
    if(!hosted){const saved=action('',openSavedProfiles,true);saved.id='saved-profiles-entry';saved.append(node('strong','Saved profiles'),node('span','Return to your workspace and saved observations.'),node('span','Continue →','choice-arrow'));saved.setAttribute('aria-label','Saved profiles');choices.append(saved);}sheet.append(choices);
    const restore=node('input');restore.type='file';restore.accept='.json,application/json';restore.id='welcome-restore';restore.hidden=true;restore.addEventListener('change',()=>void restoreFile(restore));const footer=node('div',undefined,'welcome-footer');const restoreAction=action('Restore backup',()=>restore.click(),true);restoreAction.className='restore-backup-link';
    const publicLink=node('a',hosted?'Download demo dataset':'Try healthcare worker demo');publicLink.href=hosted?'/demo-data/kera-demo-backup.json':'/?demo=worker';if(hosted)publicLink.download='kera-demo-backup.json';publicLink.className='restore-backup-link';publicLink.id='public-worker-demo';footer.append(publicLink);if(!hosted)footer.append(restore,restoreAction);
    sheet.append(node('p',hosted?'Profiles and history stay in this browser. Clearing browser data removes your changes. Healthcare worker sample records are fictional.':'Demo profile selection does not verify identity. Use demonstration data. Records are stored by this local Kera server.','account-note'),footer);
  }
  function openSavedProfiles(){history.pushState(null,'','#saved-profiles');return savedProfiles();}
  async function savedProfiles(){
    go('saved-profiles');const sheet=split('Saved profiles.','Choose a profile to return to its saved workspace and history.');
    sheet.append(action('← Back to sign in',()=>{history.replaceState(null,'',location.pathname+location.search);return welcome();},true));
    const label=node('label',undefined,'checkbox-field'),c=node('input');c.type='checkbox';c.id='remember-demo';c.checked=rememberProfile;c.addEventListener('change',()=>rememberProfile=c.checked);label.append(c,node('span','Remember my profile for 30 days on this browser'));sheet.append(label);
    const {identities}=await api('accounts');if(screen!=='saved-profiles')return;
    const list=node('div',undefined,'saved-identities');
    for(const i of identities){const b=action('',()=>{history.replaceState(null,'',location.pathname+location.search);return choose(i.id);},true);b.dataset.identity=i.id;b.append(node('strong',i.name),node('span',`${i.id===demoIdentity?'Demo':i.kind==='worker'?'Care team':'Personal'}${i.complete?'':' · Finish setup'}`));list.append(b);}
    if(!identities.length)list.append(node('p','No saved profiles yet. Go back to create one.','account-empty'));sheet.append(list);
  }
  addEventListener('popstate',()=>{if(!workspace?.identity.complete)void (location.hash==='#saved-profiles'?savedProfiles():welcome()).catch(feedback);});
  function field(form,name,label,{type='text',options,required=false,value=fields[name]??'',help}={}){
    const wrap=node('label',undefined,'account-field');wrap.append(node('span',label));let input;
    if(options){input=node('select');if(!value&&options.every(v=>typeof v==='string'&&v!=='')){const placeholder=node('option','Choose an option');placeholder.value='';input.append(placeholder);}for(const v of options){const o=node('option',typeof v==='string'?v:v.label);o.value=typeof v==='string'?v:v.value;input.append(o);}}
    else if(type==='textarea')input=node('textarea');else {input=node('input');input.type=type;}
    input.name=name;input.id='account-'+name;input.required=required;input.value=value;
    if(type==='number'){input.min=0;input.max=130;input.step=1;input.inputMode='numeric';}
    if(type==='textarea'){input.rows=3;input.maxLength=2000;}else input.maxLength=name==='email'?254:200;
    if(name==='name')input.autocomplete='name';if(name==='email')input.autocomplete='email';
    if(help){const h=node('small',help);h.id=input.id+'-help';input.setAttribute('aria-describedby',h.id);wrap.append(input,h);}else wrap.append(input);
    form.append(wrap);return input;
  }
  function intake(form,values=fields){
    field(form,'name',workspace?.identity.kind==='worker'&&editing?'Resident name or internal ID':'Name or display name',{required:true,value:values.name||''});
    const grid=node('div',undefined,'form-pair');form.append(grid);field(grid,'age','Age',{type:'number',required:true,value:values.age??'',help:'Saved with today’s date.'});sexField(grid,values.sex||'');
    referenceFields(form,values);
    const details=node('details',undefined,'intake-details');details.open=true;details.append(node('summary','Health background (optional)'),node('p','Include what you already know. This is context for reviewing results and does not adjust the hemoglobin estimate.','account-note'));
    for(const [key,label] of [['conditions','Existing conditions'],['medications','Medications'],['changes','Recent changes']])field(details,key,label,{type:'textarea',value:values[key]||''});
    const unknown=node('label',undefined,'checkbox-field'),check=node('input');check.type='checkbox';check.name='history_unknown';check.checked=values.history_unknown===true;unknown.append(check,node('span','History unknown / prefer not to provide it'));details.append(unknown);form.append(details);
  }
  function sexField(form,value){return field(form,'sex','Sex (optional)',{value,options:[{value:'',label:'Not provided'},{value:'female',label:'Female'},{value:'male',label:'Male'},{value:'other_or_not_provided',label:'Other / prefer not to answer'}],help:'Used for reference context. Never inferred from a photo.'});}
  function sexLabel(value){return ({male:'Male',female:'Female',other_or_not_provided:'Other / prefer not to answer'})[value]||'';}
  function referenceFields(form,values=fields){const d=node('details',undefined,'reference-details');d.append(node('summary','Hemoglobin reference details (optional)'));field(d,'pregnancy','Pregnancy context',{value:values.pregnancy||'',options:[{value:'',label:'Not provided / not applicable'},{value:'not_pregnant',label:'Not pregnant'},{value:'pregnant',label:'Pregnant'}]});form.append(d);}
  const values=form=>Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,k==='age'?(v===''?null:Number(v)):v]));
  function collect(form){return {...values(form),...(form.elements.history_unknown?{history_unknown:form.elements.history_unknown.checked}:{})};}
  async function persistDraft(){if(identityId&&workspace&&!workspace.identity.complete)await api('account/draft','PATCH',{step:draftStep,fields});}
  function onboard(){
    go('onboarding');editing=false;
    const worker=flowKind==='worker',titles=worker?['Tell us about your work.','Your care team workspace.','You’re ready to get started.']:['Let’s make this yours.','A little health background.','Ready for your first check-in.'];
    const sheet=split(titles[draftStep],worker?'Set up your workspace first. Add residents whenever you’re ready.':'A few details give your saved observations useful context.');
    if(['individual','worker-workspace'].includes(publicDemo?.kind))sheet.append(node('p','Your workspace and history are saved only in this browser. No account or password is created. Clearing browser data removes them.','account-note'));
    const progress=node('ol',undefined,'onboarding-progress');for(const [i,t] of (worker?['About you','Organization','Get started']:['About you','Background','Get started']).entries()){const li=node('li',t);li.dataset.state=i===draftStep?'current':i<draftStep?'done':'next';if(i===draftStep)li.setAttribute('aria-current','step');progress.append(li);}sheet.append(progress);
    const form=node('form');form.id='onboarding-form';sheet.append(form);
    if(draftStep===0){field(form,'name','Name or display name',{required:true});if(worker){field(form,'email','Work email',{type:'email',required:true,help:'Used as a workspace label. No email is sent or verified.'});field(form,'job_role','Job role',{required:true,options:['Nurse','Care assistant / PSW / CNA','Physician','Wellness / care coordinator','Administrator','Other']});}else {const pair=node('div',undefined,'form-pair');form.append(pair);field(pair,'age','Age',{type:'number',required:true});sexField(pair,fields.sex||'');}}
    if(draftStep===1){
      if(worker){
        const browserWorker=publicDemo?.kind==='worker-workspace';
        if(!browserWorker){const inviteFromURL=new URLSearchParams(location.search).get('invite');if(inviteFromURL&&!fields.invite)fields.invite=inviteFromURL;
        const join=node('details',undefined,'join-organization');join.open=Boolean(fields.invite);join.append(node('summary','Have an invitation? Join an organization'));field(join,'invite','Invitation code',{help:'Paste the code from your organization owner.'});form.append(join);}
        const org=node('fieldset');org.id='organization-fields';org.append(node('legend','Create an organization'));
        field(org,'organization_name','Organization name',{required:!fields.invite});field(org,'care_setting','Care setting',{required:!fields.invite,options:['Long-term care','Assisted / senior living','Clinic','Home / community care','Other']});field(org,'facility_name','Facility name (optional)',{help:'Uses the organization name if left blank.'});field(org,'timezone','Time zone',{required:!fields.invite,value:fields.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone});form.append(org);
        if(!browserWorker){const preview=node('p',undefined,'account-note');form.append(preview);const inviteInput=form.elements.invite;
        const toggle=()=>{org.disabled=Boolean(inviteInput.value.trim());org.hidden=org.disabled;};toggle();inviteInput.addEventListener('input',toggle);inviteInput.addEventListener('change',async()=>{toggle();if(inviteInput.value.trim())try{const v=await api('invitation/'+encodeURIComponent(inviteInput.value.trim()));preview.textContent=`Join ${v.organization.name} · ${v.facility?.name||''}. Access: care worker.`;}catch(e){preview.textContent=e.message;}});}else form.append(node('p','This care workspace stays in this browser. Shared team invitations require the local Kera server.','account-note'));
      }else{
        referenceFields(form);
        for(const [key,label]of [['conditions','Existing conditions (optional)'],['medications','Medications (optional)'],['changes','Recent changes (optional)']])field(form,key,label,{type:'textarea'});
        const unknown=node('label',undefined,'checkbox-field'),c=node('input');c.type='checkbox';c.name='history_unknown';c.checked=fields.history_unknown===true;unknown.append(c,node('span','History unknown / prefer not to provide it'));form.append(unknown,node('p','Your background is context, not a diagnosis or an adjustment to the model. You can change these details later.','account-note'));
      }
    }
    if(draftStep===2){form.append(node('h2',worker?'A place for each resident.':'Your history begins with one check-in.'),node('p',worker?(publicDemo?.kind==='worker-workspace'?'Add residents from your dashboard. Each has their own background, check-ins and saved results in this browser.':'Add residents from your dashboard. Each has their own background, check-ins and saved results. Invite colleagues when you’re ready.'):'Take a photo for an experimental hemoglobin estimate or Nail Health Analysis. Completed results will appear in your history.'),node('p','Kera saves the numbers and observations. Photos are temporary and are not included in history.','account-note'));}
    const foot=node('div',undefined,'setup-actions');const back=action('Back',async()=>{fields={...fields,...collect(form)};if(draftStep){draftStep--;await persistDraft();onboard();}else await welcome();},true);foot.append(back);
    if(draftStep===1&&!worker)foot.append(action('Skip background',async()=>{fields={...fields,conditions:'',medications:'',changes:'',history_unknown:true};draftStep=2;await persistDraft();onboard();},true));
    const submit=node('button',draftStep===2?'Open my workspace':'Continue','button dark-button');submit.type='submit';foot.append(submit);form.append(foot);
    form.addEventListener('input',()=>{fields={...fields,...collect(form)};clearTimeout(debounce);const generation=flowGeneration;debounce=setTimeout(()=>{if(generation===flowGeneration)void persistDraft().catch(feedback);},350);});
    form.addEventListener('submit',async event=>{
      event.preventDefault();submit.disabled=true;clearTimeout(debounce);errorBox.hidden=true;
      try{
        fields={...fields,...collect(form)};
        if(!identityId||!workspace){const i=await api('accounts','POST',{kind:flowKind,name:fields.name,email:fields.email||'',job_role:fields.job_role||''});identityId=i.id;remember(cookieKey,i.id,rememberProfile);workspace={identity:i};}
        if(draftStep<2){draftStep++;await persistDraft();onboard();}
        else{
          const payload={name:fields.name,email:fields.email||'',job_role:fields.job_role||''};
          if(worker){if(fields.invite)payload.invite=fields.invite;else payload.organization={name:fields.organization_name,care_setting:fields.care_setting,facility_name:fields.facility_name||'',timezone:fields.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone};}
          else payload.profile=Object.fromEntries(profileFields.map(k=>[k,fields[k]??(k==='history_unknown'?false:'')]));
          workspace=await api('account/complete','POST',payload);person=workspace.profiles[0]||null;await dashboard();
        }
      }catch(e){feedback(e);}finally{submit.disabled=false;}
    });
  }
  function heading(title,description){content();const h=node('div',undefined,'account-page-heading');h.append(node('p',guest?'DEMO':workspace?.identity.kind==='worker'?'CARE TEAM':'PERSONAL','account-kicker'),node('h1',title),node('p',description,'account-lead'));root.append(h);const titleNode=h.querySelector('h1');titleNode.tabIndex=-1;queueMicrotask(()=>titleNode.isConnected&&titleNode.focus({preventScroll:true}));return h;}
  async function dashboard(){
    go('dashboard');await refresh();const worker=workspace.identity.kind==='worker';heading(worker?'Your residents.':guest?'Your demo workspace.':'A closer look, over time.',worker?'Each resident has their own background, check-ins and history.':'Start a check-in or revisit your saved observations.');
    if(publicDemo)root.append(node('p',publicDemo.kind==='worker-workspace'?'Your care workspace and resident history stay in this browser. Back up or reset your workspace in Settings. No photos are saved.':publicDemo.kind==='individual'?'Your profile and history stay in this browser. Back up or reset your profile in Settings. No photos are saved.':'Public demo · Fictional sample data. Your changes stay in this browser. Download or reset your copy in Settings.','account-note'));
    if(worker){
      const tools=node('div',undefined,'page-tools'),search=node('input');search.type='search';search.placeholder='Search residents';search.setAttribute('aria-label','Search residents');tools.append(search,action('Add resident',()=>profileForm(),false));root.append(tools);
      const list=node('div',undefined,'resident-list');root.append(list);
      const render=()=>{list.replaceChildren();const profiles=workspace.profiles.filter(p=>p.name.toLowerCase().includes(search.value.toLowerCase()));if(!profiles.length)list.append(node('div',search.value?'No residents match this search.':'No residents yet. Add your first resident to start their history.','account-empty'));for(const p of profiles){const row=node('article',undefined,'resident-row'),info=node('div');info.append(node('h2',p.name),node('p',`${p.age===null?'Age unknown':p.age+' years'}${p.sex?' · '+sexLabel(p.sex):''}`));const actions=node('div',undefined,'row-actions');actions.append(action('New check-in',()=>capture(p)),action('History',async()=>{await selectPerson(p);await historyView();},true),action('Edit profile',()=>profileForm(p),true));row.append(info,actions);list.append(row);}};search.addEventListener('input',render);render();
    }else if(person){
      const band=node('section',undefined,'personal-start');band.append(node('h2',`Hello, ${person.name}.`),node('p','A nail photo for an experimental Hb estimate, or a closer look at visible skin and nail changes.'));
      const actions=node('div',undefined,'row-actions');actions.append(action('Start a check-in',()=>capture(person)),action('View history',historyView,true),...(guest?[]:[action('Edit my profile',()=>profileForm(person),true)]));band.append(actions);root.append(band);
      const recent=(await api(`profiles/${person.id}/results`)).results.slice(0,3);root.append(node('h2','Recent check-ins','section-heading'));if(!recent.length)root.append(node('p','Your first completed check-in will appear here. Photos are never saved to history.','account-empty'));else for(const r of recent)root.append(resultRow(r,false));
    }
  }
  async function selectPerson(p){if(person?.id!==p.id){resetCapture();saveGeneration++;pendingSave=null;status.hidden=true;}person=p;if(!guest)remember(personKey,p.id,rememberProfile);}
  async function capture(p){
    await selectPerson(p);resetCapture();go('capture');$('workspace').hidden=false;
    document.getElementById('john-demo-checkin')?.remove();
    if(workspace.identity.id==='kera-demo-worker-2026-10-18'&&p.id==='kera-demo-resident-john'){
      const banner=node('section',undefined,'john-demo-checkin');banner.id='john-demo-checkin';
      banner.append(node('strong','Fictional demo: John’s weekly check-in'),node('p','John says he feels as usual. Capture a real photo below, or use the labeled simulated scenario: 112 g/L versus his usual 145–154 g/L.'));
      banner.append(action('Save simulated demo check-in',async()=>{
        const r=await api(`profiles/${p.id}/results`,'POST',{kind:'hb',source_id:'john-simulated-demo-'+localDay(new Date(),workspace.organizations[0]?.timezone),captured_at:new Date().toISOString(),model:'SIMULATED demo scenario v1',provider:'Fictional demo fixture, no inference',data:{readings:[{id:'john-simulated-reading',hemoglobin_g_per_l:112,warnings:['SIMULATED demo value. Not a measured or inferred result.']}],insights:{summary:'Simulated scenario: John feels as usual, but this estimate is below his previous 145–154 g/L readings. Ask a clinician to review the change and arrange a confirmatory blood test.',considerations:[{reported_detail:'John reports feeling as usual today.',why_it_matters:'Feeling as usual does not explain or confirm the lower simulated estimate.',question_for_clinician:'Would a complete blood count help check this change?'}],limitations:'Fictional demonstration only. A photo estimate cannot confirm anemia or replace a laboratory blood test.'}}});
        const saved=await api('results/'+r.id,'PATCH',{note:'FICTIONAL DEMO. John reports feeling as usual. Simulated lower estimate; care team to request clinical review and a confirmatory blood test.'});
        banner.remove();detail(saved);
      },true));$('workspace').prepend(banner);
    }
  }
  function profileForm(p=null){
    go('profile');editing=true;heading(p?'Edit profile.':'Add a resident.',p?'Changes apply to future check-ins. Earlier results keep their original background.':'This intake belongs to the resident, separate from your worker onboarding.');
    const form=node('form',undefined,'profile-form');form.id='profile-form';intake(form,p||{});root.append(form);const actions=node('div',undefined,'setup-actions');actions.append(action('Cancel',dashboard,true));const submit=node('button','Save profile','button dark-button');submit.type='submit';actions.append(submit);form.append(actions);
    form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{const data=collect(form);if(!p)data.organization_id=workspace.organizations[0]?.id;await api(p?'profiles/'+p.id:'profiles',p?'PUT':'POST',data);await dashboard();}catch(e){feedback(e);}finally{submit.disabled=false;}});
  }
  function resultRow(r,selectable=true){
    const article=node('article',undefined,'history-row');if(selectable){const choose=node('input');choose.type='checkbox';choose.value=r.id;choose.name='compare';choose.setAttribute('aria-label',`Compare ${kinds[r.kind]} from ${dateLabel(r.captured_at)}`);article.append(choose);}
    const info=node('div',undefined,'history-main');info.append(node('span',kinds[r.kind],'history-kind'),node('h3',r.kind==='hb'?`${r.data.hemoglobin_g_per_l.toFixed(1)} g/L`:reviewHeadline(normalizeReview({...r.data,model:r.model,provider:r.provider}))),node('p',`${dateLabel(r.captured_at,workspace.organizations[0]?.timezone)} · ${r.kind==='hb'?r.data.scan_count+' reading(s)':r.data.image_quality.assessment+' photo detail'}`));if(r.kind==='hb'){const summary=hemoglobinSummary(r.context,r.data.hemoglobin_g_per_l,referenceOptions(r));const label=node('span',summary.label,'history-badge');label.dataset.range=summary.state;label.title=summary.detail;info.append(label);}article.append(info,action('Open result',()=>detail(r),true));return article;
  }
  function chart(results){
    const readings=results.filter(r=>r.kind==='hb').slice().reverse();if(!readings.length)return;
    const section=node('section',undefined,'history-chart');section.append(node('h2','Estimated hemoglobin over time'),node('p','Experimental photo estimates. Differences may reflect lighting, capture or model changes, rather than changes in health.','account-note'));
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 210');svg.setAttribute('role','img');svg.setAttribute('aria-label',readings.map(r=>`${dateLabel(r.captured_at)}: ${r.data.hemoglobin_g_per_l.toFixed(1)} g/L`).join('; '));
    const vals=readings.map(r=>r.data.hemoglobin_g_per_l),min=Math.min(...vals)-10,max=Math.max(...vals)+10;
    const first=Date.parse(readings[0].captured_at),last=Date.parse(readings.at(-1).captured_at);
    const points=readings.map((r,i)=>[first===last?(readings.length===1?360:55+i/(readings.length-1)*630):55+(Date.parse(r.captured_at)-first)/(last-first)*630,160-(r.data.hemoglobin_g_per_l-min)/(max-min)*125]);
    const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;};
    for(const v of [min,(min+max)/2,max]){const y=160-(v-min)/(max-min)*125;add('line',{x1:55,x2:690,y1:y,y2:y,stroke:'#dedede'});add('text',{x:0,y:y+5,fill:'#555', 'font-size':13},v.toFixed(0)+' g/L');}
    if(points.length>1)add('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#242424','stroke-width':2});
    for(const [i,p]of points.entries()){const c=add('circle',{cx:p[0],cy:p[1],r:5,fill:'#242424'});const t=document.createElementNS(ns,'title');t.textContent=`${dateLabel(readings[i].captured_at)}: ${vals[i].toFixed(1)} g/L`;c.append(t);}
    const firstLabel=localDay(readings[0].captured_at,workspace.organizations[0]?.timezone),lastLabel=localDay(readings.at(-1).captured_at,workspace.organizations[0]?.timezone);add('text',{x:55,y:195,fill:'#555','font-size':13},firstLabel);if(firstLabel!==lastLabel)add('text',{x:685,y:195,fill:'#555','font-size':13,'text-anchor':'end'},lastLabel);
    section.append(svg);root.append(section);
  }
  function download(name,value,type='application/json') {const url=URL.createObjectURL(new Blob([value],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function historyView(){
    go('history');if(!person)return dashboard();heading(`${person.name}’s history.`,'Every check-in, in one place. Review, compare or export your saved results. Photos are never saved.');
    const rows=(await api(`profiles/${person.id}/results`)).results;let filtered=rows,page=0;const selected=new Set(),pageSize=10;
    const tools=node('form',undefined,'history-tools');const search=field(tools,'search','Search history',{type:'search',value:''});search.placeholder='Search results or notes';const from=field(tools,'from','From',{type:'date',value:''}),to=field(tools,'to','To',{type:'date',value:''});const kind=field(tools,'kind','Result type',{options:[{value:'',label:'All results'},{value:'hb',label:'Hemoglobin levels'},{value:'visual',label:'Nail Health Analysis'}],value:''});root.append(tools);
    const toolbar=node('div',undefined,'history-toolbar'),count=node('p',undefined,'history-count');count.setAttribute('role','status');const actions=node('div',undefined,'row-actions');const csv=v=>'"'+String(/^\s*[=+\-@]|^[\t\r]/.test(String(v))?'\''+v:v).replaceAll('"','""')+'"';
    actions.append(action('Export JSON',()=>download('kera-results.json',JSON.stringify({format:'kera-results',version:1,profile:person,results:filtered},null,2)),true),action('Export CSV',()=>download('kera-results.csv',[['date','type','Hb (g/L)','quality','model','observations','note'],...filtered.map(r=>[r.captured_at,kinds[r.kind],r.kind==='hb'?r.data.hemoglobin_g_per_l:'',r.kind==='visual'?r.data.image_quality.assessment:r.data.warnings.join('; '),r.model,r.kind==='visual'?Object.entries(r.data.observations).map(([k,v])=>`${k}: ${v.status}: ${v.evidence}`).join('; '):'',r.note])].map(row=>row.map(csv).join(',')).join('\r\n'),'text/csv;charset=utf-8'),true));
    const compare=action('Compare two results',()=>{const chosen=rows.filter(r=>selected.has(r.id));if(chosen.length!==2||chosen[0].kind!==chosen[1].kind)throw Error('Select two results of the same type to compare.');compareView(chosen);},true);actions.append(compare);toolbar.append(count,actions);root.append(toolbar);
    const list=node('div',undefined,'history-table-scroll');list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','Check-in history table');root.append(list);
    const pagination=node('div',undefined,'history-pagination');root.append(pagination);
    const trends=node('details',undefined,'history-trends');trends.append(node('summary','Explore hemoglobin trends'));const chartSlot=node('div');trends.append(chartSlot);root.append(trends);
    function render(){
      filtered=rows.filter(r=>(!from.value||localDay(r.captured_at,workspace.organizations[0]?.timezone)>=from.value)&&(!to.value||localDay(r.captured_at,workspace.organizations[0]?.timezone)<=to.value)&&(!kind.value||r.kind===kind.value)&&(!search.value||[kinds[r.kind],r.note,r.kind==='hb'?r.data.hemoglobin_g_per_l:reviewHeadline(normalizeReview({...r.data,model:r.model,provider:r.provider}))].join(' ').toLowerCase().includes(search.value.toLowerCase())));
      const visibleIds=new Set(filtered.map(r=>r.id));for(const id of selected)if(!visibleIds.has(id))selected.delete(id);page=Math.min(page,Math.max(0,Math.ceil(filtered.length/pageSize)-1));
      list.replaceChildren();pagination.replaceChildren();chartSlot.replaceChildren();count.textContent=`${filtered.length} check-in${filtered.length===1?'':'s'}${selected.size?' · '+selected.size+' selected':''}`;
      if(from.value&&to.value&&from.value>to.value){list.append(node('p','Choose an end date on or after the start date.','account-empty'));return;}
      if(!filtered.length)list.append(node('p',rows.length?'No check-ins match these filters.':'No saved check-ins yet. Start a check-in to begin this history.','account-empty'));
      else{
        const table=node('table',undefined,'history-table'),caption=node('caption',`${person.name}’s saved check-ins`);caption.className='visually-hidden';table.append(caption);const head=node('thead'),header=node('tr');for(const label of ['Compare','Check-in','Date & time','Result','Context','']){const th=node('th',label);th.scope='col';if(label==='')th.setAttribute('aria-label','Open result');header.append(th);}head.append(header);table.append(head);const tbody=node('tbody');table.append(tbody);
        for(const r of filtered.slice(page*pageSize,(page+1)*pageSize)){
          const row=node('tr',undefined,'history-row'),selection=node('td'),check=node('input');check.type='checkbox';check.name='compare';check.value=r.id;check.checked=selected.has(r.id);check.setAttribute('aria-label',`Compare ${kinds[r.kind]} from ${dateLabel(r.captured_at)}`);check.addEventListener('change',()=>{check.checked?selected.add(r.id):selected.delete(r.id);count.textContent=`${filtered.length} check-in${filtered.length===1?'':'s'}${selected.size?' · '+selected.size+' selected':''}`;});selection.append(check);row.append(selection);
          const type=node('td');type.append(node('strong',kinds[r.kind]),node('small',r.kind==='hb'?`${r.data.scan_count} reading(s)`:'Nail Health Analysis observations'));row.append(type,node('td',dateLabel(r.captured_at,workspace.organizations[0]?.timezone),'history-date'));
          const result=node('td');result.append(node('strong',r.kind==='hb'?`${r.data.hemoglobin_g_per_l.toFixed(1)} g/L`:reviewHeadline(normalizeReview({...r.data,model:r.model,provider:r.provider}))));if(r.note)result.append(node('small','Note added'));row.append(result);
          const context=node('td');if(r.kind==='hb'){const summary=hemoglobinSummary(r.context,r.data.hemoglobin_g_per_l,referenceOptions(r));const badge=node('span',summary.label,'history-badge');badge.dataset.range=summary.state;badge.title=summary.detail;context.append(badge,node('small',summary.range?`${summary.range[0]}–${summary.range[1]} g/L`:summary.detail,'history-reference-detail'));}else context.append(node('span',r.data.image_quality.assessment+' photo detail','history-badge'));row.append(context);const open=node('td');open.append(action('Open result',()=>detail(r),true));row.append(open);tbody.append(row);
        }list.append(table);
        const previous=action('← Previous',()=>{page--;render();},true),next=action('Next →',()=>{page++;render();},true);previous.disabled=page===0;next.disabled=(page+1)*pageSize>=filtered.length;pagination.append(previous,node('span',`Page ${page+1} of ${Math.ceil(filtered.length/pageSize)}`),next);
      }
      const before=[...root.children];chart(filtered);const c=[...root.children].find(n=>!before.includes(n));if(c)chartSlot.append(c);trends.hidden=!c;
    }
    tools.addEventListener('submit',e=>e.preventDefault());tools.addEventListener('input',()=>{page=0;render();});tools.addEventListener('change',()=>{page=0;render();});render();
  }
  function resultBody(r,target){
    const simulated=r.model.startsWith('SIMULATED');
    if(simulated)target.append(node('strong','Fictional demo data. No photo was analyzed.'));
    target.append(node('p',dateLabel(r.captured_at)),node('p',`${r.provider} · ${r.model}`,'account-note'));
    if(r.kind==='visual'){const view=node('div');target.append(view);createCareReview(view,{handoffId:'saved-handoff-'+r.id}).show({...r.data,model:r.model,provider:r.provider});}
    else{target.append(node('h2',r.data.hemoglobin_g_per_l.toFixed(1)+' g/L','saved-hb'));const reference=node('div');appendHemoglobinSummary(reference,r.context,r.data.hemoglobin_g_per_l,referenceOptions(r));target.append(reference);target.append(node('p',`${r.data.scan_count} reading(s) · experimental hemoglobin estimate`),node('p',simulated?'This value was generated for demonstration. It is not a model output or a blood-test result.':'The model’s held-out mean absolute error was 15.96 g/L. This is a group statistic, not an individual confidence interval. Low Hb may be overestimated. Confirm concerns with a clinician.','account-note'));const ul=node('ul');for(const w of r.data.warnings)ul.append(node('li',w));target.append(ul);const readings=node('details');readings.append(node('summary','Individual estimates'));const table=node('table'),head=node('tr');head.append(node('th','Reading'),node('th','g/L'));table.append(head);r.data.readings.forEach((v,i)=>{const row=node('tr');row.append(node('td',String(i+1)),node('td',v.hemoglobin_g_per_l.toFixed(1)));table.append(row);});readings.append(table);target.append(readings);}
    if(r.data.insights){const insights=node('details');insights.open=r.model==='SIMULATED demo scenario v1';insights.append(node('summary','Health background insights'),node('p',r.data.insights.summary));for(const c of r.data.insights.considerations||[])insights.append(node('h3',c.reported_detail),node('p',c.why_it_matters),node('p',c.question_for_clinician));insights.append(node('p',r.data.insights.limitations,'account-note'));target.append(insights);}
    const context=node('details');context.append(node('summary','Background at this check-in'));for(const[k,v]of Object.entries(r.context))if(v!==''&&v!==null)context.append(node('p',`${k.replaceAll('_',' ')}: ${v}`));target.append(context);
  }
  function detail(r){
    go('detail');heading(kinds[r.kind]+'.',person.name);root.append(action('← Back to history',historyView,true));const body=node('section',undefined,'saved-result');root.append(body);resultBody(r,body);
    const form=node('form',undefined,'note-form');const note=field(form,'note','Your notes',{type:'textarea',value:r.note});note.maxLength=8000;const save=node('button','Save notes','button dark-button');save.type='submit';form.append(save);form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await api('results/'+r.id,'PATCH',{note:note.value});save.textContent='Notes saved';}catch(e){feedback(e);}finally{save.disabled=false;}});root.append(form);
    const deletion=node('details',undefined,'delete-result');deletion.append(node('summary','Delete this result'));deletion.append(node('p','This permanently removes this result and its notes. Other check-ins remain.'));deletion.append(action('Permanently delete result',async()=>{await api('results/'+r.id,'DELETE');await historyView();},true));root.append(deletion);
  }
  function compareView(rows){go('compare');heading('Two check-ins, side by side.',`${person.name} · Changes in AI observations are not proof of changes in health.`);root.append(action('← Back to history',historyView,true));if(rows[0].kind==='hb')root.append(node('p',`Difference between selected estimates: ${Math.abs(rows[0].data.hemoglobin_g_per_l-rows[1].data.hemoglobin_g_per_l).toFixed(1)} g/L. Capture and model variation may contribute.`));const grid=node('div',undefined,'comparison-grid');for(const r of rows){const section=node('section',undefined,'saved-result');resultBody(r,section);grid.append(section);}root.append(grid);}
  async function teamView(){
    go('team');const org=workspace.organizations[0];heading('Your care team.',org?`${org.name} · ${publicDemo?.kind==='worker-workspace'?'Care workspace in this browser.':publicDemo?'Fictional demo in this browser.':'Demo membership within this local Kera database.'}`:'This worker no longer has an active organization membership. Ask the owner for help.');if(!org)return;
    const isOwner=!publicDemo&&workspace.memberships.some(m=>m.organization_id===org.id&&m.role==='owner');const members=(await api(`organizations/${org.id}/team`)).members;
    for(const m of members){const row=node('article',undefined,'resident-row');row.append(node('h2',m.name),node('p',`${m.job_role||'Care worker'} · ${m.role}${m.active?'':' · Inactive'}`));if(isOwner&&m.role!=='owner'&&m.active)row.append(action('Deactivate access',async()=>{await api('memberships/'+m.id,'DELETE');await teamView();},true));root.append(row);}
    if(publicDemo)root.append(node('p',publicDemo.kind==='worker-workspace'?'Your organization and resident records stay in this browser. Shared team access requires the local Kera server.':'This fictional care team belongs to your browser demo. Share the public demo link so others can explore their own copy.','account-note'));
    if(isOwner){root.append(action('Create invitation',async()=>{await api(`organizations/${org.id}/invitations`,'POST',{});await teamView();}));const invitations=(await api(`organizations/${org.id}/invitations`)).invitations;for(const inv of invitations.filter(v=>!v.used_by&&!v.revoked&&Date.parse(v.expires_at)>Date.now())){const row=node('div',undefined,'invitation-row');row.append(node('p',`Care worker invitation · expires ${dateLabel(inv.expires_at)}`));const input=node('input');input.value=location.origin+location.pathname+'?invite='+inv.id;input.readOnly=true;input.setAttribute('aria-label','Invitation link');input.addEventListener('focus',()=>input.select());row.append(input,action('Copy link',async()=>{await navigator.clipboard.writeText(input.value);},true),action('Revoke',async()=>{await api('invitations/'+inv.id,'DELETE');await teamView();},true));root.append(row);}}
  }
  async function restoreFile(input){
    const file=input.files[0];if(!file)return;if(file.size>8_000_000){feedback('Choose a Kera backup smaller than 8 MB.');return;}
    try{const b=JSON.parse(await file.text());const result=await api('restore','POST',b);await welcome();feedback(`Restored ${result.restored} records. Select the saved profile to continue.`);}catch(e){feedback(e instanceof SyntaxError?'This file is not valid JSON. Choose a Kera backup.':e);}finally{input.value='';}
  }
  function settings(){
    if(publicDemo){
      const individual=publicDemo.kind==='individual',worker=publicDemo.kind==='worker-workspace',own=individual||worker;
      go('settings');heading(worker?'Your care workspace, in this browser.':individual?'Your profile, in this browser.':'Your demo, in this browser.',own?'Your workspace and history are saved only in this browser. Clearing browser storage removes them. Export a backup to keep a separate copy.':'Fictional sample records and your changes are stored on this browser only. Clearing browser storage removes your changes.');
      root.append(action('Download workspace backup',async()=>download(worker?'kera-care-workspace-backup.json':individual?'kera-individual-backup.json':'kera-public-demo-backup.json',JSON.stringify(await api('backup'),null,2))));
      if(publicDemo.kind==='worker')for(const [file,label]of [['kera-demo-backup.json','Download original demo dataset'],['residents.csv','Download sample residents CSV'],['weekly-history.csv','Download sample history CSV']]){const a=node('a',label,'button secondary-button');a.href='/demo-data/'+file;a.download=file;root.append(a);}
      const reset=node('details');reset.append(node('summary',worker?'Reset workspace':individual?'Reset profile':'Reset demo'),node('p',own?'Remove your workspace, history and notes from this browser and start setup again. Export a backup first if you want to keep them.':'Remove your changes in this browser and reload the original fictional dataset.'));
      reset.append(action(worker?'Reset this browser’s workspace':individual?'Reset this browser’s profile':'Reset this browser’s demo',()=>{publicDemo.reset();location.reload();},true));root.append(reset);return;
    }
    go('settings');heading('Your data, kept together.','The cookie remembers your selection. Your profiles and results are stored separately by this local Kera server.');root.append(node('p','Clearing cookies or browser storage signs you out without deleting records. Return to the profile chooser to reconnect. A lost database file needs a backup.','settings-copy'));
    const owner=workspace.identity.kind==='personal'||workspace.memberships.some(m=>m.role==='owner');if(owner)root.append(action('Download workspace backup',async()=>download('kera-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(await api('backup'),null,2))));else root.append(node('p','Ask your organization owner for a complete workspace backup.'));
    const restore=node('input');restore.type='file';restore.accept='.json,application/json';restore.id='settings-restore';restore.hidden=true;restore.addEventListener('change',()=>void restoreFile(restore));root.append(restore,action('Restore backup',()=>restore.click(),true),node('p','Backups include profile backgrounds, results and notes, without photos. Conflicting records are rejected; current data is never silently replaced.','account-note'),node('h2','Demo identity','section-heading'),node('p','No password or email verification is used. Selecting a profile does not prove identity. This local demo is for demonstration data. Real login and hosted storage can be added later.','settings-copy'));
  }
  function demoMode(){resetCapture();location.assign(hosted?'/?demo=personal':'/demo/?entry=1');}
  async function openPublicDemo(kind){
    resetCapture();identityId='';workspace=null;person=null;guest=kind==='personal';publicDemo=createPublicDemo({kind});
    try{workspace=await publicDemo.enter();identityId=workspace.identity.id;person=workspace.profiles[0]||null;if(['individual','worker-workspace'].includes(kind)&&!workspace.identity.complete){flowKind=kind==='worker-workspace'?'worker':'personal';fields={...workspace.identity.draft?.fields};draftStep=workspace.identity.draft?.step||0;onboard();}else if(guest)go('capture');else await dashboard();}
    catch(e){go('welcome');heading('The workspace could not load.',e.message);root.append(action('Retry',()=>openPublicDemo(kind)),action('Reset workspace',()=>{publicDemo.reset();return openPublicDemo(kind);},true));}
  }
  function captureContext(){return person&&workspace?{identityId,profileId:person.id,profileName:person.name,health:cleanContext(person),shareHealthContext:!guest}:null;}
  async function saveCompleted(context,result){
    if(!context)return;
    result={...result,profile_context:context.health};
    const generation=saveGeneration;pendingSave={context,result};(result.kind==='hb'?$('result-panel'):$('review-page')).append(status);status.hidden=false;status.replaceChildren(node('span',`Saving to ${context.profileName}’s history…`));
    try{
      await api(`profiles/${context.profileId}/results`,'POST',result,context.identityId);
      if(generation!==saveGeneration)return;pendingSave=null;status.replaceChildren(node('span',`Saved to ${context.profileName}’s history. No photos saved.`),action('View history',historyView,true));
    }catch(e){if(generation!==saveGeneration)return;status.replaceChildren(node('span','Result is ready, but history could not be saved. '+e.message),action('Retry saving',()=>pendingSave?saveCompleted(pendingSave.context,pendingSave.result):undefined,true));}
  }
  async function start(){
    try{
      if(new URLSearchParams(location.search).get('individual')==='1'){await openPublicDemo('individual');return;}
      if(new URLSearchParams(location.search).get('worker')==='1'){await openPublicDemo('worker-workspace');return;}
      const publicKind=new URLSearchParams(location.search).get('demo');if(['worker','personal'].includes(publicKind)){await openPublicDemo(publicKind);return;}
      if(hosted){identityId='';await welcome();return;}
      if(location.pathname.startsWith('/demo/')){guest=true;identityId='';workspace=await api('demo-workspace','POST',{});identityId=workspace.identity.id;person=workspace.profiles[0];go('capture');return;}
      if(new URLSearchParams(location.search).has('signin')){identityId='';history.replaceState(null,'',location.pathname);await welcome();return;}
      const entryURL=new URL(location.href);if(entryURL.searchParams.has('demo')){entryURL.searchParams.delete('demo');history.replaceState(null,'',entryURL.pathname+entryURL.search+entryURL.hash);}
      if(identityId){await choose(identityId);}else if(location.hash==='#saved-profiles')await savedProfiles();else await welcome();
      if(new URLSearchParams(location.search).get('invite')){
        if(workspace?.identity.complete){await welcome();feedback('Sign out and create a Care team demo profile to accept this invitation.');}
        else if(!workspace){flowKind='worker';fields={invite:new URLSearchParams(location.search).get('invite')};draftStep=0;onboard();}
      }
    }catch(e){identityId='';workspace=null;await welcome().catch(()=>{go('welcome');heading('Your records could not load.','Start the local Kera server, then retry.');root.append(action('Retry',start));});feedback(e);}
    finally{document.body.classList.remove('accounts-loading');}
  }
  void start();return {captureContext,saveCompleted,home:dashboard};
}
