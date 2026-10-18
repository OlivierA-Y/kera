/** Fictional data, isolated SQLite, and labeled simulation. No camera or provider. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { openRecords } from '../server/records.mjs';
import { createDemoDataset, DEMO_WORKER_ID, JOHN_ID } from '../scripts/demo-dataset.mjs';
const {chromium}=await import(process.env.KERA_PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(join(tmpdir(),'kera-demo-fixture-')),dataPath=join(directory,'records.sqlite');
const store=openRecords(dataPath);store.restore(createDemoDataset());
for(let i=0;i<35;i++)store.createIdentity({kind:'personal',name:'Extra saved profile '+i});
store.close();
const reports=resolve('web/reports/accounts');await mkdir(reports,{recursive:true});
const server=createApp({dataPath});server.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.KERA_CHROME_EXECUTABLE?{executablePath:process.env.KERA_CHROME_EXECUTABLE}:{})});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [width,height]of [[1280,720],[1366,768],[1920,1080],[768,900],[390,844],[320,568],[844,390]]){
    await page.setViewportSize({width,height});await page.goto(base);await page.locator('#demo-entry').waitFor();await page.evaluate(()=>document.fonts.ready);
    const bounds=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.setup-sheet button')].map(b=>({text:b.textContent,bottom:b.getBoundingClientRect().bottom}))}));
    assert.ok(bounds.scroll<=height+1,`${width}×${height} scrolls: ${JSON.stringify(bounds)}`);assert.ok(bounds.scrollWidth<=width);assert.ok(bounds.buttons.every(b=>b.bottom<=height+1),JSON.stringify({width,height,...bounds}));
    assert.equal(await page.locator('[data-identity]').count(),0);assert.equal(await page.getByRole('button',{name:'Saved profiles',exact:true}).count(),1);
    await page.screenshot({path:join(reports,`signin-final-${width}x${height}.png`),fullPage:true});
  }
  console.log('PASS Sign in fits seven desktop, tablet, phone and landscape viewports with 36 saved profiles');
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Saved profiles',exact:true}).click();await page.locator('[data-identity]').last().waitFor();assert.equal(await page.locator('[data-identity]').count(),36);
  await page.screenshot({path:join(reports,'saved-profiles-final.png'),fullPage:true});
  await page.getByRole('button',{name:'← Back to sign in',exact:true}).click();await page.locator('#demo-entry').waitFor();
  await page.getByRole('button',{name:'Saved profiles',exact:true}).click();await page.reload();await page.locator('[data-identity]').last().waitFor();
  await page.goBack();await page.locator('#demo-entry').waitFor();
  await page.getByRole('button',{name:'Saved profiles',exact:true}).click();await page.locator(`[data-identity="${DEMO_WORKER_ID}"]`).click();await page.locator('.resident-row').last().waitFor();assert.equal(await page.locator('.resident-row').count(),21);
  await page.screenshot({path:join(reports,'demo-residents-final.png'),fullPage:true});
  const john=page.locator('.resident-row').filter({has:page.getByRole('heading',{name:'John',exact:true})});await john.getByRole('button',{name:'History',exact:true}).click();
  await page.locator('.history-row').first().waitFor();assert.match(await page.locator('.history-count').innerText(),/52/);
  await page.locator('#account-kind').selectOption('hb');await page.locator('.history-trends summary').click();await page.locator('.history-chart').waitFor();await page.screenshot({path:join(reports,'john-history-before-demo.png'),fullPage:true});
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await john.getByRole('button',{name:'New check-in',exact:true}).click();
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.locator('.resident-row').filter({hasText:'Margaret Chen'}).getByRole('button',{name:'New check-in',exact:true}).click();assert.equal(await page.locator('#john-demo-checkin').count(),0);
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await john.getByRole('button',{name:'New check-in',exact:true}).click();
  await page.getByRole('button',{name:'Save simulated demo check-in',exact:true}).click();await page.locator('.saved-hb').waitFor();assert.equal(await page.locator('.saved-hb').innerText(),'112.0 g/L');
  assert.match(await page.locator('.saved-result').innerText(),/John feels as usual/);assert.match(await page.locator('.saved-result').innerText(),/confirmatory blood test/);assert.match(await page.locator('.saved-result').innerText(),/Fictional demo data/);assert.match(await page.locator('.saved-result').innerText(),/Below the common reference range/);
  assert.match(await page.locator('[name=note]').inputValue(),/John reports feeling as usual/);
  await page.screenshot({path:join(reports,'john-simulated-lower-result.png'),fullPage:true});
  await page.getByRole('button',{name:'← Back to history',exact:true}).click();await page.locator('.history-row').first().waitFor();assert.match(await page.locator('.history-count').innerText(),/53/);
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await john.getByRole('button',{name:'New check-in',exact:true}).click();await page.getByRole('button',{name:'Save simulated demo check-in',exact:true}).click();await page.locator('.saved-hb').waitFor();
  await page.reload();await page.locator('.resident-row').last().waitFor();await john.getByRole('button',{name:'History',exact:true}).click();await page.locator('.history-row').first().waitFor();assert.match(await page.locator('.history-count').innerText(),/53/);
  assert.deepEqual(errors,[]);console.log('PASS Saved profiles navigation/back/reload, 21 residents, normal John history and an explicit persistent low simulation without duplicates');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
