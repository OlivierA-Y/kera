/** Cross-audience reference and photo-deletion regression with synthetic pixels. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { openRecords } from '../server/records.mjs';
import { EXAMPLES } from '../dist/care-review-fixtures.js';
const {chromium}=await import(process.env.KERA_PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(join(tmpdir(),'kera-reference-controls-')),dataPath=join(directory,'records.sqlite'),reports=resolve('web/reports/accounts');await mkdir(reports,{recursive:true});
const store=openRecords(dataPath),personal=store.createIdentity({kind:'personal',name:'Reference Individual'}),worker=store.createIdentity({kind:'worker',name:'Reference Worker',email:'worker@example.test',job_role:'Nurse'});
store.complete(personal,{profile:{name:'Reference Individual',age:50,sex:'male'}});
const w=store.complete(worker,{organization:{name:'Fictional reference home',care_setting:'Long-term care',facility_name:'Fictional home',timezone:'America/Toronto'}});
store.saveProfile(store.actor(worker.id),null,{name:'Reference Resident',age:80,sex:'male',organization_id:w.organizations[0].id});store.close();
const provider=async()=>{const r=EXAMPLES.specific.make();return {image_quality:r.image_quality,observations:r.observations};};
const server=createApp({dataPath,apiKey:'test-only',model:'synthetic-test',provider,demoProvider:provider,maxRequests:1000});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.KERA_CHROME_EXECUTABLE?{executablePath:process.env.KERA_CHROME_EXECUTABLE}:{})});
try{
 for(const audience of ['personal','worker','demo']){
  const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(audience==='demo'){await context.addCookies([{name:'kera_demo_identity',value:personal.id,url:base}]);await page.goto(base+'/demo/?entry=1');assert.match(await page.locator('.active-person').innerText(),/Demo profile: Demo/);} else{
   await page.goto(base);await page.getByRole('button',{name:'Saved profiles',exact:true}).click();await page.locator(`[data-identity="${audience==='worker'?worker.id:personal.id}"]`).click();await page.getByRole('button',{name:audience==='worker'?'New check-in':'Start a check-in',exact:true}).click();
  }
  await page.locator('#sticker-mode').waitFor();assert.equal(await page.locator('.account-bar').getByRole('button',{name:'Health checker',exact:true}).count(),1);assert.equal(await page.locator('.account-bar [role=tab]').count(),0);assert.equal(await page.locator('.header .mode-tabs').getAttribute('aria-orientation'),'horizontal');assert.equal(await page.locator('#tab-hb').innerText(),'Hemoglobin levels');assert.equal(await page.locator('#tab-hb').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#sticker-mode').inputValue(),'mlh');assert.equal(await page.locator('#tab-skin').innerText(),'Nail Health Analysis');
  assert.deepEqual(await page.locator('#sticker-mode option').evaluateAll(o=>o.map(n=>n.value)),['mlh','plain']);
  await page.waitForFunction(()=>document.getElementById('model-note').textContent.includes('Runs on your device'));
  const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=120;const ctx=c.getContext('2d');[[145,95,80],[160,115,100],[210,210,210],[180,65,40],[55,65,155],[190,165,40]].forEach((rgb,i)=>{ctx.fillStyle=`rgb(${rgb.join(',')})`;ctx.fillRect(i*100,0,100,120);});return c.toDataURL('image/png').split(',')[1];});
  const upload={name:'synthetic-sticker.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')};
  const mark=async kinds=>{
   await page.locator('#file-input').setInputFiles(upload);await page.locator('#photo').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('sticker-detect').disabled);
   await page.evaluate(kinds=>{for(const [i,kind]of ['nail','skin','white','mlhM','mlhL','mlhH'].entries()){if(!kinds.includes(kind))continue;document.querySelector(`[data-region="${kind}"]`).click();for(const[k,v]of Object.entries({left:i*100,top:0,width:90,height:100}))document.getElementById('coord-'+k).value=v;document.getElementById('coordinate-form').requestSubmit();}},kinds);
  };
  assert.deepEqual(await page.locator('#sticker-mode option').allTextContents(),['Color reference','Plain white reference only']);
  assert.equal(await page.locator('#sticker-save,#sticker-export,#sticker-import').count(),0);
  // Exercise the bundled color reference directly, with no webcam setup.
  await mark(['nail','skin','white','mlhM','mlhL','mlhH']);await page.locator('#touch-editor-button').click();await page.locator('#touch-editor').waitFor({state:'visible'});assert.equal(await page.locator('[data-touch-region]:visible').count(),6);await page.locator('#touch-close').click();
  await page.locator('#predict-button').click();await page.locator('#result-panel').waitFor({state:'visible'});assert.match(await page.locator('#quality-warnings').innerText(),/Experimental color-reference correction/);assert.match(await page.locator('#result-caption').textContent(),/Color-reference/);
  if(audience!=='demo')await page.locator('#record-save').getByText(/Saved to/).waitFor();else await page.locator('#record-save').getByText(/Saved to Demo/).waitFor();
  await page.screenshot({path:join(reports,`reference-${audience}-mlh.png`),fullPage:true,animations:'disabled'});
  // White-only remains usable and does not inherit colored regions.
  await page.locator('#new-scan').click();await page.locator('#sticker-mode').selectOption('plain');await mark(['nail','skin','white']);assert.equal(await page.locator('.region-buttons [data-region]:visible').count(),3);
  await page.locator('#predict-button').click();await page.locator('#result-panel').waitFor({state:'visible'});assert.match(await page.locator('#result-caption').textContent(),/White-reference/);assert.ok(!(await page.locator('#quality-warnings').innerText()).includes('Experimental color-reference'));
  // Cancellation leaves the exact current picture and its neighbors untouched.
  const count=await page.locator('.scan-history-list li').count();const remove=page.getByRole('button',{name:'Delete current photo',exact:true});assert.equal(await remove.evaluate(el=>el.parentElement.className),'photo-selection-actions');
  page.once('dialog',dialog=>{assert.match(dialog.message(),/current picture/);return dialog.dismiss();});await remove.click();assert.equal(await page.locator('.scan-history-list li').count(),count);
  page.once('dialog',dialog=>dialog.accept());await remove.click();await page.waitForFunction(count=>document.querySelectorAll('.scan-history-list li').length===count-1,count);
  // Deletion also works from the analysis-results page, with its own confirmation.
  await page.locator('#tab-skin').click();assert.equal(await page.locator('#visual-title').innerText(),'Nail Health Analysis');await page.locator('#file-input').setInputFiles(upload);await page.locator('#open-vision').click();await page.waitForFunction(()=>!document.getElementById('vision-consent').disabled);await page.locator('#vision-consent').check();await page.locator('#send-vision').click();await page.locator('#review-page').waitFor({state:'visible'});assert.match(await page.locator('.review-page-title').innerText(),/Nail Health Analysis/);
  await page.locator('.review-photo-disclosure summary').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(reports,`photo-delete-${audience}-phone.png`),fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const before=await page.locator('.scan-history-list li').count();page.once('dialog',dialog=>dialog.dismiss());await remove.click();assert.equal(await page.locator('.scan-history-list li').count(),before);page.once('dialog',dialog=>dialog.accept());await remove.click();await page.waitForFunction(n=>document.querySelectorAll('.scan-history-list li').length===n-1,before);
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${audience}: Color reference first, exactly two choices and no webcam setup, corrected and white-only inference, Nail Health Analysis, cancel/confirm deletion in both views`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
