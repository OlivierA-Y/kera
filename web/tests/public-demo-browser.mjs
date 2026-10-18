/** Hosted static frontend, no records server, separate anonymous visitors. */
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../server.mjs';
import {hemoglobinSummary} from '../dist/health-context.js';
const {chromium}=await import(process.env.KERA_PLAYWRIGHT_MODULE||'playwright');
const server=createApp({dataPath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port,host='https://public-demo.test';
const reports=resolve('web/reports/accounts');await mkdir(reports,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.KERA_CHROME_EXECUTABLE?{executablePath:process.env.KERA_CHROME_EXECUTABLE}:{})});
const errors=[],apiCalls=[];
async function visitor(){
 const context=await browser.newContext();
 await context.route(host+'/**',async route=>{
  const url=new URL(route.request().url());
  if(['/api/scans/average','/api/vision/status'].includes(url.pathname)){
   const response=await fetch(base+url.pathname,{method:route.request().method(),headers:{Origin:base,'Content-Type':'application/json'},...(route.request().method()==='POST'?{body:route.request().postData()}: {})});
   await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});return;
  }
  if(url.pathname.startsWith('/api/')){apiCalls.push(url.pathname);await route.fulfill({status:503,contentType:'application/json',body:'{"error":{"message":"No records server in this public demo test"}}'});return;}
  const response=await fetch(base+url.pathname+url.search);
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {context,page};
}
try{
 const {page,context}=await visitor();
 for(const [width,height]of [[1280,720],[390,844],[320,568]]){
  await page.setViewportSize({width,height});await page.goto(host);await page.getByRole('button',{name:/Healthcare worker demo/}).waitFor();
  assert.equal(await page.locator('[data-audience=personal]').count(),1);
  assert.equal(await page.locator('[data-audience=worker]').count(),1);
  assert.equal(await page.locator('[data-audience=worker-demo]').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(reports,`public-demo-welcome-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:/Healthcare worker demo/}).click();await page.locator('.resident-row').last().waitFor();assert.equal(await page.locator('.resident-row').count(),21);
 await page.screenshot({path:resolve(reports,'public-demo-residents.png'),fullPage:true});
 const john=page.locator('.resident-row').filter({has:page.getByRole('heading',{name:'John',exact:true})});await john.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();
 assert.match(await page.locator('#account-app').innerText(),/52/);
 assert.ok(await page.getByText('Within range',{exact:true}).count()>0);
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.locator('.resident-row').last().waitFor();await john.getByRole('button',{name:'New check-in',exact:true}).click();await page.getByRole('button',{name:'Save simulated demo check-in'}).click();await page.getByRole('heading',{name:'112.0 g/L',exact:true}).waitFor();assert.match(await page.locator('#account-app').innerText(),/SIMULATED/);
 await page.reload();await page.locator('.resident-row').last().waitFor();await john.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();assert.match(await page.locator('#account-app').innerText(),/53/);
 await page.screenshot({path:resolve(reports,'public-demo-john-history.png'),fullPage:true});
 const second=await visitor();await second.page.goto(host+'/?demo=worker');await second.page.locator('.resident-row').last().waitFor();await second.page.locator('.resident-row').filter({has:second.page.getByRole('heading',{name:'John',exact:true})}).getByRole('button',{name:'History',exact:true}).click();await second.page.getByRole('region',{name:'Check-in history table'}).waitFor();assert.match(await second.page.locator('#account-app').innerText(),/52/);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download workspace backup',exact:true}).click();assert.equal((await download).suggestedFilename(),'kera-public-demo-backup.json');
 assert.equal(await page.getByRole('link',{name:'Download original demo dataset',exact:true}).getAttribute('href'),'/demo-data/kera-demo-backup.json');
 await page.getByText('Reset demo',{exact:true}).click();await page.getByRole('button',{name:'Reset this browser’s demo',exact:true}).click();await page.locator('.resident-row').last().waitFor();await john.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();assert.match(await page.locator('#account-app').innerText(),/52/);
 await page.goto(host);await page.locator('#demo-entry').click();await page.waitForURL('**/?demo=personal');await page.locator('body[data-account-screen=capture]').waitFor();
 assert.equal(await page.locator('.active-person').textContent(),'Demo profile: Demo');
 // Use actual frozen-model inference and the local averaging API, no paid provider.
 const completeHb=async()=>{
  await page.locator('#tab-hb').click();await page.locator('#sticker-mode').selectOption('plain');await page.locator('#file-input').setInputFiles(resolve('web/tests/fixtures/synthetic.jpg'));
  await page.waitForFunction(()=>document.getElementById('model-note').textContent.includes('Runs on your device')&&!document.getElementById('photo').hidden);
  await page.evaluate(()=>{const c=document.getElementById('photo'),w=Math.floor(c.width/4),h=Math.floor(c.height/2);for(const[i,kind]of ['nail','skin','white'].entries()){document.querySelector(`[data-region="${kind}"]`).click();for(const[k,v]of Object.entries({left:i*w,top:0,width:w,height:h}))document.getElementById('coord-'+k).value=v;document.getElementById('coordinate-form').requestSubmit();}});
  await page.locator('#predict-button').click();await page.locator('#result-panel').waitFor({state:'visible'});await page.locator('#record-save').getByText(/Saved to/).waitFor();return Number(await page.locator('#prediction-value').textContent());
 };
 const demoValue=await completeHb(),demoSummary=hemoglobinSummary({},demoValue,{demo:true});
 assert.equal(await page.locator('#hb-personal-context').getAttribute('data-range'),demoSummary.state);assert.match(await page.locator('#hb-personal-context').innerText(),/121–172 g\/L.*Not personalized/);
 await page.screenshot({path:resolve(reports,'public-demo-hb-reference.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();assert.ok(await page.getByText(demoSummary.label,{exact:true}).count()>0);await page.getByRole('button',{name:'Open result',exact:true}).first().click();assert.match(await page.locator('.saved-result .hb-reference').innerText(),/121–172/);
 await page.goto(host);await page.locator('[data-audience=personal]').click();await page.waitForURL('**/?individual=1');await page.locator('#account-name').fill('Hosted Individual QA');await page.locator('#account-age').fill('36');await page.locator('#account-sex').selectOption('male');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('#account-conditions').fill('Reported anemia');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kera-public-demo-v1-individual'))?.identities[0]?.draft?.fields?.conditions==='Reported anemia');
 await page.reload();await page.locator('#account-conditions').waitFor();assert.equal(await page.locator('#account-conditions').inputValue(),'Reported anemia');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Open my workspace',exact:true}).click();await page.getByRole('button',{name:'Start a check-in',exact:true}).click();
 const individualValue=await completeHb(),individualSummary=hemoglobinSummary({age:36,sex:'male'},individualValue);
 assert.equal(await page.locator('#hb-personal-context').getAttribute('data-range'),individualSummary.state);assert.match(await page.locator('#hb-personal-context').innerText(),/138–172 g\/L.*Age 36/);
 await page.screenshot({path:resolve(reports,'public-individual-hb-reference.png'),fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#result-panel').screenshot({path:resolve(reports,'public-individual-hb-reference-mobile.png'),animations:'disabled'});await page.setViewportSize({width:1440,height:900});
 await page.reload();await page.getByRole('heading',{name:'A closer look, over time.',exact:true}).waitFor();assert.ok(await page.getByText(individualSummary.label,{exact:true}).count()>0);await page.getByRole('button',{name:'View history',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();assert.ok(await page.getByText(individualSummary.label,{exact:true}).count()>0);
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Edit my profile',exact:true}).click();await page.locator('#account-sex').selectOption('female');await page.getByText('Hemoglobin reference details (optional)',{exact:true}).click();await page.locator('#account-pregnancy').selectOption('not_pregnant');await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.getByRole('button',{name:'View history',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();await page.getByRole('button',{name:'Open result',exact:true}).first().click();assert.match(await page.locator('.saved-result .hb-reference').innerText(),/Adult male reference/);
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Start a check-in',exact:true}).click();await completeHb();assert.match(await page.locator('#hb-personal-context').innerText(),/121–151 g\/L.*Adult female reference/);
 await page.getByRole('button',{name:'Settings',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Your profile, in this browser.',exact:true}).count(),1);
 assert.ok(!(await page.locator('#account-app').innerText()).includes('Fictional sample records'));
 await page.goto(host);await page.locator('[data-audience=worker]').click();await page.waitForURL('**/?worker=1');
 await page.locator('#account-name').fill('Hosted Worker QA');await page.locator('#account-email').fill('worker@example.com');await page.locator('#account-job_role').selectOption('Nurse');await page.getByRole('button',{name:'Continue',exact:true}).click();
 assert.equal(await page.locator('.join-organization').count(),0);await page.locator('#account-organization_name').fill('Hosted Care QA');await page.locator('#account-care_setting').selectOption('Clinic');await page.locator('#account-timezone').fill('America/Toronto');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kera-public-demo-v1-worker-workspace'))?.identities[0]?.draft?.fields?.organization_name==='Hosted Care QA');
 await page.reload();assert.equal(await page.locator('#account-organization_name').inputValue(),'Hosted Care QA');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Open my workspace',exact:true}).click();await page.getByText('No residents yet.',{exact:false}).waitFor();assert.equal(await page.locator('.resident-row').count(),0);
 await page.getByRole('button',{name:'Add resident',exact:true}).click();await page.locator('#account-name').fill('Worker Resident QA');await page.locator('#account-age').fill('64');await page.locator('#account-sex').selectOption('male');await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.locator('.resident-row').waitFor();await page.locator('.resident-row').getByRole('button',{name:'New check-in',exact:true}).click();
 await completeHb();assert.match(await page.locator('#hb-personal-context').innerText(),/138–172 g\/L/);
 await page.reload();await page.locator('.resident-row').waitFor();assert.equal(await page.locator('.resident-row').count(),1);await page.locator('.resident-row').getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();assert.equal(await page.getByRole('button',{name:'Open result',exact:true}).count(),1);
 await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByRole('heading',{name:'Hosted Worker QA',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create invitation',exact:true}).count(),0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Your care workspace, in this browser.',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Download original demo dataset',exact:true}).count(),0);
 const workerDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download workspace backup',exact:true}).click();assert.equal((await workerDownload).suggestedFilename(),'kera-care-workspace-backup.json');await page.screenshot({path:resolve(reports,'public-worker-settings.png'),fullPage:true});
 await page.goto(host+'/?demo=worker');await page.locator('.resident-row').last().waitFor();assert.equal(await page.locator('.resident-row').count(),21);
 await page.goto(host+'/?demo=personal');await page.locator('body[data-account-screen=capture]').waitFor();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('heading',{name:'Your demo workspace.',exact:true}).waitFor();
 assert.deepEqual(apiCalls,[]);assert.deepEqual(errors,[]);
 console.log('PASS Regular hosted worker onboarding, draft resume, own residents, real inference/history, isolated worker demo, backup and team limits; Hosted Individual restored, intake draft/reload, real frozen inference, profile history/editing, reference snapshots, broad Demo guide in live/history/detail, tailored Individual and resident references, visitor isolation and exports; no records API or paid provider required');
 await context.close();await second.context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
