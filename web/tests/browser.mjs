import { Browser, sleep } from '/home/olivier-aud/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
mkdirSync('web/reports/browser',{recursive:true});
const browser=await Browser.launch({extraArgs:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const checks=[];
function record(name){checks.push({name,passed:true});console.log('PASS',name);}
async function wait(page,condition){for(let i=0;i<60;i++){if(await page.eval(condition))return;await sleep(100);}throw new Error('Timeout: '+condition);}
async function click(page,selector){await page.eval(sel=>document.querySelector(sel).click(),selector);}
async function upload(page){const {root}=await page.send('DOM.getDocument');const {nodeId}=await page.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#file-input'});await page.send('DOM.setFileInputFiles',{nodeId,files:[resolve('data/raw/photo/1.jpg')]});await wait(page,"!document.getElementById('photo').hidden && document.getElementById('file-input').files.length===0 && !document.getElementById('upload-button').disabled");}
async function mark(page,kind,box){await page.eval(({kind,box})=>{document.querySelector(`[data-region="${kind}"]`).click();const [top,left,bottom,right]=box;for(const [field,value] of Object.entries({top,left,width:right-left,height:bottom-top}))document.getElementById('coord-'+field).value=value;document.getElementById('coordinate-form').requestSubmit();},{kind,box});}
try{
  const page=await browser.newPage({width:1440,height:1000});const requests=[];
  await page.send('Network.enable');browser.on(page.sessionId,'Network.requestWillBeSent',e=>requests.push({url:e.request.url,method:e.request.method,postData:e.request.postData}));
  await page.goto('http://127.0.0.1:4173');await click(page,'#tab-hb');await page.eval(()=>{const mode=document.getElementById('sticker-mode');mode.value='plain';mode.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('camera-adjustment').checked=false;document.getElementById('camera-adjustment').dispatchEvent(new Event('change',{bubbles:true}));});await wait(page,"document.getElementById('model-note').textContent.includes('Runs on your device')");
  assert.equal(await page.eval("document.getElementById('capture-button').disabled"),true);record('Initial app loads the real model; capture disabled until live');
  await page.screenshot({path:'web/reports/browser/desktop-initial.jpg'});
  await click(page,'#start-camera');await wait(page,"!document.getElementById('video').hidden && document.getElementById('video').videoWidth>0");
  assert.equal(await page.eval("document.getElementById('capture-button').disabled"),false);record('Browser media API starts a live simulated webcam feed');
  await click(page,'#capture-button');await wait(page,"!document.getElementById('annotate-panel').hidden");
  assert.equal(await page.eval("document.getElementById('video').srcObject"),null);record('Capture produces an image and releases camera tracks');
  // Exercise actual pointer gestures, not an injected annotation shortcut.
  const region=await page.eval(()=>{const c=document.getElementById('photo'),r=c.getBoundingClientRect();const scale=Math.min(r.width/c.width,r.height/c.height);return {x:r.x+(r.width-c.width*scale)/2,y:r.y+(r.height-c.height*scale)/2,w:c.width*scale,h:c.height*scale};});
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:region.x+region.w*.2,y:region.y+region.h*.2,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:region.x+region.w*.4,y:region.y+region.h*.4,button:'left',buttons:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:region.x+region.w*.4,y:region.y+region.h*.4,button:'left',clickCount:1});
  assert.equal(await page.eval("document.querySelector('[data-region=nail]').classList.contains('is-marked')"),true);record('Mouse drag marks a region and advances to the next');
  await upload(page);await mark(page,'nail',[123,429,183,483]);await mark(page,'skin',[148,556,200,614]);await mark(page,'white',[350,300,400,350]);
  assert.equal(await page.eval("document.getElementById('predict-button').disabled"),false);record('Upload and keyboard-accessible coordinates mark all three regions');
  await page.screenshot({path:'web/reports/browser/desktop-marked.jpg'});
  await click(page,'#continue-scan');await wait(page,"document.getElementById('photo').hidden && document.getElementById('session-count').textContent==='1 photo added'");
  assert.equal(await page.eval("document.getElementById('result-panel').hidden"),true);
  assert.equal(await page.eval("document.getElementById('prediction-value').textContent"),'—');
  assert.equal(await page.eval("document.querySelectorAll('[data-region].is-marked').length"),0);
  assert.equal(requests.filter(x=>x.method==='POST').length,0);record('Continue scanning adds the first photo, clears its regions and withholds the result');
  await upload(page);await mark(page,'nail',[123,429,183,483]);await mark(page,'skin',[148,556,200,614]);await mark(page,'white',[350,300,400,350]);
  await click(page,'#predict-button');await wait(page,"!document.getElementById('result-panel').hidden");
  const value=Number(await page.eval("document.getElementById('prediction-value').textContent"));assert.ok(Number.isFinite(value)&&value>0);
  assert.equal(await page.eval("document.getElementById('average-caption').textContent"),'Based on 2 readings.');
  const averageRequests=requests.filter(x=>x.method==='POST'&&new URL(x.url).pathname==='/api/scans/average');assert.equal(averageRequests.length,1);
  const {readings}=JSON.parse(averageRequests[0].postData);assert.equal(readings.length,2);assert.notEqual(readings[0].id,readings[1].id);
  assert.equal(value,Number(((readings[0].hemoglobin_g_per_l+readings[1].hemoglobin_g_per_l)/2).toFixed(1)));record('End scan now returns one average from both real frozen-MLP readings');
  await sleep(450);await page.screenshot({path:'web/reports/browser/desktop-result.jpg'});
  await click(page,'#new-scan');await upload(page);await mark(page,'nail',[123,429,183,483]);await mark(page,'skin',[148,556,200,614]);await mark(page,'white',[123,429,183,483]);await click(page,'#predict-button');await wait(page,"!document.getElementById('error').hidden");
  assert.ok(await page.eval("document.getElementById('error').textContent.includes('overlapping')"));assert.equal(await page.eval("document.getElementById('result-panel').hidden"),true);record('Starting a new scan resets the session; overlapping annotations block submission');
  await click(page,'#about-button');assert.equal(await page.eval("document.getElementById('model-dialog').open"),true);await click(page,'.close-dialog');record('Model notes open and dismiss');
  const posts=requests.filter(x=>x.method!=='GET');assert.equal(posts.length,1);
  for(const post of posts){
    assert.equal(post.method,'POST');assert.equal(post.url,'http://127.0.0.1:4173/api/scans/average');
    assert.ok(!/data:image|base64/i.test(post.postData));
    const body=JSON.parse(post.postData);assert.deepEqual(Object.keys(body),['readings']);
    for(const reading of body.readings){assert.deepEqual(Object.keys(reading).sort(),['hemoglobin_g_per_l','id','warnings']);assert.equal(typeof reading.id,'string');assert.equal(typeof reading.hemoglobin_g_per_l,'number');assert.ok(Number.isFinite(reading.hemoglobin_g_per_l));assert.ok(Array.isArray(reading.warnings)&&reading.warnings.every(warning=>typeof warning==='string'));}
  }
  record('Only numerical readings and quality warnings reach the local averaging endpoint; no images or external inference requests occur');
  assert.deepEqual(page.consoleErrors,[]);record('No browser JavaScript exceptions');
  for(const width of [768,390]){
    const mobile=await browser.newPage({width,height:1000,mobile:width<600,reducedMotion:true});await mobile.goto('http://127.0.0.1:4173');await click(mobile,'#tab-hb');await mobile.eval(()=>{const mode=document.getElementById('sticker-mode');mode.value='plain';mode.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('camera-adjustment').checked=false;document.getElementById('camera-adjustment').dispatchEvent(new Event('change',{bubbles:true}));});await wait(mobile,"document.getElementById('model-note').textContent.includes('Runs on your device')");
    assert.ok(await mobile.eval('document.documentElement.scrollWidth <= window.innerWidth'));await mobile.screenshot({path:`web/reports/browser/${width}-initial.jpg`,fullPage:true});
    if(width===390){await upload(mobile);await mark(mobile,'nail',[123,429,183,483]);await mark(mobile,'skin',[148,556,200,614]);await mark(mobile,'white',[350,300,400,350]);await click(mobile,'#predict-button');await wait(mobile,"!document.getElementById('result-panel').hidden");await sleep(450);await mobile.screenshot({path:'web/reports/browser/mobile-result.jpg',fullPage:true});}
    assert.deepEqual(mobile.consoleErrors,[]);record(`Responsive ${width}px layout without overflow or exceptions`);await mobile.close();
  }
  // Explicit permission denial uses a mock rejection to exercise the real UI handler.
  const denied=await browser.newPage();await denied.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))});"});
  await denied.goto('http://127.0.0.1:4173');await click(denied,'#start-camera');await wait(denied,"!document.getElementById('error').hidden");assert.ok(await denied.eval("document.getElementById('error').textContent.includes('permission was declined')"));record('Permission denial gives a usable upload fallback');
  writeFileSync('web/reports/browser-checks.json',JSON.stringify({checks,training_image_smoke_test_g_per_l:value,camera_testing:'Chrome simulated media device, not a physical webcam'},null,2));
}finally{await browser.close();}
