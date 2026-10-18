// UI integration tests use an injected local provider. No image reaches OpenRouter.
import { Browser, sleep } from '/home/olivier-aud/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { createApp } from '../server.mjs';
import { FINDINGS } from '../server/vision.mjs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
let calls=0,mode='success',lastPhotos;
const server=createApp({apiKey:'local-test-only',allowDataCollection:true,provider:async(photos,{signal})=>{
 calls++;lastPhotos=photos;
 if(mode==='wait')await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
 if(mode==='error')throw new Error('test failure');
 return {image_quality:{assessment:'limited',reason:'Synthetic fixture; not a clinical assessment.'},observations:Object.fromEntries(Object.keys(FINDINGS).map(key=>[key,{status:mode==='review'&&key==='skin_cancer'?'possible_features':'unclear',evidence:mode==='review'&&key==='skin_cancer'?'A dark nail band with uneven edges is visible.':'Synthetic test fixture with no clinical interpretation.',view:'top'}]))};
}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await Browser.launch();
async function wait(p,condition){for(let i=0;i<80;i++){if(await p.eval(condition))return;await sleep(100);}throw new Error('Timeout: '+condition);}
async function click(p,id){await p.eval(id=>document.getElementById(id).click(),id);}
async function upload(p,id='file-input'){
 const {root}=await p.send('DOM.getDocument');const {nodeId}=await p.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#'+id});
 await p.send('DOM.setFileInputFiles',{nodeId,files:[resolve('web/tests/fixtures/synthetic.jpg')]});
 await wait(p,id==='file-input'?"!document.getElementById('photo').hidden && !document.getElementById('upload-button').disabled && document.getElementById('file-input').files.length===0":"!document.getElementById('side-preview').hidden");
}
async function open(p){await click(p,'open-vision');await wait(p,"document.getElementById('vision-connection').textContent.includes('Nothing is sent')");}
async function consent(p){await click(p,'vision-consent');await click(p,'send-vision');}
try{
 const p=await browser.newPage({width:1440,height:1000});await p.goto(base);assert.equal(await p.eval("document.getElementById('tab-skin').getAttribute('aria-selected')"),'true');await upload(p);await click(p,'tab-hb');assert.equal(await p.eval("document.getElementById('visual-analysis').hidden"),true);assert.equal(await p.eval("document.getElementById('annotate-panel').hidden"),false);await click(p,'tab-skin');assert.equal(await p.eval("document.getElementById('hb-workflow').hidden"),true);await open(p);
 assert.equal(await p.eval("document.getElementById('vision-data-policy').hidden"),false);
 assert.equal(calls,0);assert.equal(await p.eval("document.getElementById('send-vision').disabled"),true);
 await click(p,'close-vision');assert.equal(calls,0);console.log('PASS no remote analysis before explicit consent');
 await open(p);await consent(p);await wait(p,"!document.getElementById('vision-results').hidden");assert.equal(calls,1);assert.equal(lastPhotos.length,1);
 assert.equal(await p.eval("document.querySelectorAll('.care-finding').length"),4);
 assert.ok(await p.eval("document.getElementById('vision-results').textContent.includes('cannot diagnose or rule out disease')"));console.log('PASS four review categories with clinical follow-up and no negative disease verdict');
 mkdirSync('web/reports/browser',{recursive:true});await p.screenshot({path:'web/reports/browser/visual-results.jpg',fullPage:true});
 await upload(p,'side-input');assert.equal(await p.eval("document.getElementById('additional-photo').hidden"),false);await open(p);assert.equal(await p.eval("document.getElementById('vision-consent').checked"),false);await consent(p);await wait(p,"!document.getElementById('vision-results').hidden");assert.equal(lastPhotos.length,2);console.log('PASS optional side view requires consent');
 mode='review';await open(p);await consent(p);await wait(p,"!document.getElementById('vision-results').hidden");assert.ok(await p.eval("document.getElementById('vision-results').textContent.includes('prompt in-person assessment')"));console.log('PASS warning pattern receives clinical follow-up without a diagnosis');
 mode='error';await open(p);await consent(p);await wait(p,"!document.getElementById('vision-error').hidden");assert.equal(await p.eval("document.getElementById('vision-results').hidden"),true);console.log('PASS failures clear old findings');
 mode='wait';await open(p);await consent(p);await wait(p,"!document.getElementById('vision-busy').hidden");await click(p,'cancel-vision');await wait(p,"!document.getElementById('vision-error').hidden");assert.equal(await p.eval("document.getElementById('open-vision').disabled"),false);console.log('PASS cancellation restores controls');
 await open(p);await consent(p);await wait(p,"!document.getElementById('vision-busy').hidden");await upload(p);assert.equal(await p.eval("document.getElementById('open-vision').disabled"),false);assert.equal(await p.eval("document.getElementById('vision-error').hidden"),true);console.log('PASS replacement photo cancels pending request and resets state');
 await open(p);await consent(p);await wait(p,"!document.getElementById('vision-busy').hidden");await click(p,'tab-hb');await click(p,'tab-skin');assert.equal(await p.eval("document.getElementById('vision-busy').hidden"),true);assert.equal(await p.eval("document.getElementById('open-vision').disabled"),false);console.log('PASS switching modes cancels pending analysis');
 await click(p,'guide-button');assert.equal(await p.eval("document.getElementById('guide-skin').hidden"),false);await p.eval("document.querySelector('[data-close-region-help]').click()");console.log('PASS mode tabs preserve photo and show the relevant guide');
 mode='success';await open(p);await consent(p);await wait(p,"!document.getElementById('vision-results').hidden");
 for(const width of [390,768]){
  const m=await browser.newPage({width,height:width<600?844:1000,mobile:width===390,reducedMotion:true});await m.goto(base);await upload(m);
  if(width<600){
   assert.equal(await m.eval(()=>{const r=document.getElementById('open-vision').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
   await m.eval("document.querySelector('.review-categories li:last-child').scrollIntoView({block:'center'})");
   assert.equal(await m.eval(()=>document.querySelector('.review-categories li:last-child').getBoundingClientRect().bottom<=document.querySelector('.review-action').getBoundingClientRect().top),true);
   await m.eval('scrollTo(0,0)');await m.screenshot({path:'web/reports/browser/mobile-skin-preview.jpg'});
  }
  await open(m);await upload(m,'side-input');
  assert.equal(await m.eval('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.equal(await m.eval("document.getElementById('vision-dialog').scrollWidth<=document.getElementById('vision-dialog').clientWidth"),true);
  await m.screenshot({path:`web/reports/browser/visual-consent-${width}.jpg`,fullPage:true});await consent(m);await wait(m,"!document.getElementById('vision-results').hidden");
  assert.equal(await m.eval('document.documentElement.scrollWidth<=innerWidth'),true);await m.screenshot({path:`web/reports/browser/visual-results-${width}.jpg`,fullPage:true});await m.close();
 }
 console.log('PASS mobile and tablet consent/results layouts without overflow');
 // Network errors from intentional 500/cancel scenarios are expected; runtime errors are not.
 assert.ok(p.consoleErrors.every(e=>String(e.text||e).includes('resource')||String(e.text||e).includes('500')));console.log('PASS no unexpected browser exceptions');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
