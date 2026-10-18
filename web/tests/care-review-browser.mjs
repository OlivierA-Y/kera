// Local synthetic-only UI checks. No production provider, credentials, or patient images.
// Uses a caller-supplied Playwright installation; production has no new dependency.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../server.mjs';

const { chromium } = await import(process.env.KERA_PLAYWRIGHT_MODULE || 'playwright');
const server = createApp({ apiKey: '' });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.KERA_CHROME_EXECUTABLE ? { executablePath: process.env.KERA_CHROME_EXECUTABLE } : {}) });
const requests = [], errors = [];
let checks = 0;
function pass(name) { checks++; console.log(`PASS ${name}`); }
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedDraft = value; } } });
  });
  const page = await context.newPage();
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/care-review.html');
  await page.locator('#care-handoff-note').waitFor();
  assert.equal(await page.locator('.care-finding').count(), 4);
  assert.equal(await page.locator('.care-context a').count(), 1);
  assert.match(await page.locator('body').innerText(), /Simulated preview/);
  pass('specific fixture displays four findings, one fixed citation and simulation notice');

  const note = page.locator('#care-handoff-note');
  await note.fill('Edited synthetic handoff. Verify before sharing.');
  await page.getByRole('button', { name: 'Copy draft' }).click();
  assert.equal(await page.evaluate(() => window.copiedDraft), 'Edited synthetic handoff. Verify before sharing.');
  assert.match(await page.locator('.care-copy-status').innerText(), /Draft copied/);
  pass('copy is explicit and includes the current edited text');

  await page.selectOption('#care-example', 'unclear');
  assert.ok(!(await note.inputValue()).includes('Edited synthetic'));
  assert.equal(await page.locator('.care-context').count(), 0);
  await page.selectOption('#care-example', 'unusable');
  assert.equal(await page.locator('.care-finding').count(), 0);
  assert.equal(await page.locator('.care-context').count(), 0);
  assert.match(await note.inputValue(), /Assessment is insufficient/);
  pass('example changes clear edits and unusable images suppress all condition stories');

  await page.evaluate(async () => {
    const { createCareReview } = await import('./care-review.js');
    const { EXAMPLES } = await import('./care-review-fixtures.js');
    window.testReview = createCareReview(document.getElementById('care-review-root'), {
      synthetic: true, clipboard: { writeText: async () => { throw new Error('denied'); } },
    });
    window.testReview.show(EXAMPLES.specific.make());
  });
  await page.getByRole('button', { name: 'Copy draft' }).click();
  assert.match(await page.locator('.care-copy-status').innerText(), /copy the draft manually/);
  assert.equal(await note.evaluate(el => document.activeElement === el && el.selectionEnd === el.value.length), true);
  pass('clipboard rejection keeps the editable note and selects it for manual copy');

  await page.evaluate(async () => {
    const { EXAMPLES } = await import('./care-review-fixtures.js');
    const value = EXAMPLES.specific.make();
    value.observations.fungal_infection.evidence = '<img src=x onerror="window.injected=true"> Buildup beneath the nail is visible.';
    window.testReview.show(value);
  });
  assert.equal(await page.locator('.care-finding img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.ok((await page.locator('.care-findings').innerText()).includes('<img'));
  pass('provider-like HTML remains text and never executes');

  await page.evaluate(() => window.testReview.show({ observations: {} }));
  assert.equal(await page.locator('textarea').count(), 0);
  assert.equal(await page.locator('.care-finding').count(), 0);
  assert.match(await page.getByRole('alert').innerText(), /incomplete or unsupported/);
  pass('malformed results clear any previous review and note');

  await page.getByRole('button', { name: 'Reload example' }).click();
  await page.getByRole('button', { name: 'Clear review' }).click();
  assert.equal(await page.locator('#care-review-root').innerText(), '');
  pass('clear removes the entire review and draft');

  await mkdir('web/reports/care-review', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const example of ['specific', 'unclear', 'unusable', 'pigmentation', 'skin', 'pitting']) {
      await page.selectOption('#care-example', example);
      await page.getByRole('button', { name: 'Reload example' }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${example} overflow`);
      assert.equal(await note.evaluate(el => el.getBoundingClientRect().right <= innerWidth), true);
    }
    await page.selectOption('#care-example', 'specific');
    await page.screenshot({ path: `web/reports/care-review/preview-${width}.png`, fullPage: true });
    pass(`${width}px: all six states fit and screenshot saved`);
  }
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+Home');
  await page.reload();
  await page.keyboard.press('Tab');
  assert.match(await page.locator(':focus').innerText(), /Skip to review/);
  await page.keyboard.press('Enter');
  await page.locator('#care-example').focus();
  assert.equal(await page.locator('#care-example').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await note.focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').innerText(), 'Copy draft');
  pass('skip link, visible keyboard focus and note-to-copy tab order');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.method === 'GET' && request.url.startsWith(base + '/')));
  assert.ok(requests.every(request => !request.url.includes('/api/')));
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  pass('no runtime errors, API calls, external requests or browser storage');
  console.log(`${checks} browser checks passed. Clipboard calls were intercepted; no OS clipboard was changed.`);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
