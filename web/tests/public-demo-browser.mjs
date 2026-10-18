/** Hosted static frontend, no records server, separate anonymous visitors. */
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../server.mjs';
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
  assert.equal(await page.locator('[data-audience=personal]').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(reports,`public-demo-welcome-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:/Healthcare worker demo/}).click();await page.locator('.resident-row').last().waitFor();assert.equal(await page.locator('.resident-row').count(),21);
 await page.screenshot({path:resolve(reports,'public-demo-residents.png'),fullPage:true});
 const john=page.locator('.resident-row').filter({has:page.getByRole('heading',{name:'John',exact:true})});await john.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('region',{name:'Check-in history table'}).waitFor();
 assert.match(await page.locator('#account-app').innerText(),/52/);
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
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('heading',{name:'Your demo workspace.',exact:true}).waitFor();
 assert.deepEqual(apiCalls,[]);assert.deepEqual(errors,[]);
 console.log('PASS Hosted anonymous entry at three sizes, full fixture, simulated check-in, reload, visitor isolation, backup, dataset download, reset and personal demo; no records API required');
 await context.close();await second.context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
