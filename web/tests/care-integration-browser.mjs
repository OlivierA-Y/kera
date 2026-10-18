// Real app lifecycle with injected localhost provider and synthetic gray JPEG only.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { EXAMPLES } from '../dist/care-review-fixtures.js';

const { chromium } = await import(process.env.KERA_PLAYWRIGHT_MODULE || 'playwright');
let calls = 0, behavior = 'success';
const server = createApp({ apiKey: 'local-test-only', model: 'synthetic-model', maxRequests: 1000, provider: async (photos, { signal }) => {
  calls++;
  if (behavior === 'error') throw new Error('Synthetic provider failure');
  if (behavior === 'wait') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const { image_quality, observations } = EXAMPLES[behavior === 'unusable' ? 'unusable' : behavior === 'pigmentation' ? 'pigmentation' : 'specific'].make();
  return { image_quality, observations };
} });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.KERA_CHROME_EXECUTABLE ? { executablePath: process.env.KERA_CHROME_EXECUTABLE } : {}) });
let checks = 0;
const errors = [], requests = [];
function pass(name) { checks++; console.log('PASS ' + name); }
const fixture = resolve('web/tests/fixtures/synthetic.jpg');
try {
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value; } } }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  async function upload(id = 'file-input') {
    await page.locator('#' + id).setInputFiles(fixture);
    await page.waitForFunction(() => !document.getElementById('upload-button').disabled && document.getElementById('file-input').files.length === 0);
    if (id === 'side-input') await page.locator('#additional-photo').waitFor({ state: 'visible' });
  }
  async function open() {
    await page.locator('#open-vision').click();
    await page.waitForFunction(() => document.getElementById('vision-connection').textContent.includes('synthetic-model'));
  }
  async function send() {
    await open(); await page.locator('#vision-consent').check(); await page.locator('#send-vision').click();
  }
  async function result() { await page.locator('#care-handoff-note').waitFor({ state: 'attached' }); }
  async function cleared() {
    assert.equal(await page.locator('#care-handoff-note').count(), 0);
    assert.equal(await page.locator('#vision-results').isHidden(), true);
  }
  await page.goto(base); await page.locator('#tab-skin').click(); await upload();
  assert.equal(calls, 0); await open();
  assert.match(await page.locator('#vision-connection').innerText(), /OpenRouter.*synthetic-model/);
  assert.equal(await page.locator('#send-vision').isDisabled(), true);
  await page.locator('#close-vision').click(); assert.equal(calls, 0);
  pass('no upload before consent; effective provider/model visible before sending');

  await send(); await result();
  assert.equal(calls, 1);
  assert.equal(await page.locator('.care-finding').count(), 4);
  assert.equal(await page.locator('.care-context a').count(), 1);
  const note = page.locator('#care-handoff-note');
  assert.ok(!(await note.inputValue()).includes('SIMULATED EXAMPLE'));
  // Test fixture is injected by this harness, never shipped as production output.
  assert.match(await note.inputValue(), /OpenRouter.*synthetic-model/s);
  assert.equal(await note.isVisible(), false);
  await page.getByRole('button', { name: 'Prepare a care-team note' }).click();
  await note.fill('Edited handoff from synthetic integration test.');
  await page.getByRole('button', { name: 'Copy draft' }).click();
  assert.equal(await page.evaluate(() => window.copied), 'Edited handoff from synthetic integration test.');
  pass('actual app response feeds sourced review and editable/copyable note');

  await page.locator('#tab-hb').click(); await page.locator('#tab-skin').click(); await cleared();
  assert.equal(await page.locator('#photo').isVisible(), true);
  pass('switching modes clears completed review/draft and retains captured photo');

  await send(); await result(); await upload('side-input'); await cleared();
  await send(); await result(); await upload('side-input'); await page.locator('#remove-angle').click(); await cleared();
  pass('adding/replacing/removing an angle invalidates completed review/draft');

  await send(); await result(); await upload(); await cleared();
  await send(); await result(); await page.locator('#retake-button').click(); await cleared();
  pass('main photo replacement and retake remove the previous review/draft');
  await upload();

  await send(); await result(); await open(); await cleared();
  await page.locator('#close-vision').click();
  pass('starting review again clears edited text before another request');

  behavior = 'error'; await send();
  await page.locator('#vision-error').waitFor({ state: 'visible' }); await cleared();
  behavior = 'wait'; await send(); await page.locator('#cancel-vision').click();
  await page.locator('#vision-error').waitFor({ state: 'visible' }); await cleared();
  assert.match(await page.locator('#vision-error').innerText(), /already sent/);
  pass('errors and cancellation leave no findings or handoff draft');

  await send(); await page.locator('#tab-hb').click(); await page.locator('#tab-skin').click(); await cleared();
  await page.waitForFunction(() => !document.getElementById('open-vision').disabled);
  behavior = 'success'; await send(); await result();
  pass('pending request cannot repopulate results after a mode change');

  await page.route('**/api/vision/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ image_quality: {}, observations: {} }) }));
  await send(); await page.locator('#vision-error').waitFor({ state: 'visible' }); await cleared();
  await page.unroute('**/api/vision/analyze');
  pass('malformed server success fails closed without a stale note');

  behavior = 'unusable'; await send(); await result();
  assert.equal(await page.locator('.care-context').count(), 0);
  assert.match(await note.inputValue(), /Assessment is insufficient/);
  behavior = 'pigmentation'; await send(); await result();
  assert.match(await page.locator('#vision-results').innerText(), /prompt in-person assessment/);
  pass('unusable quality abstains; explicit band gets fixed source-backed follow-up');

  await mkdir('web/reports/care-integration', { recursive: true });
  for (const width of [1440, 768, 390]) {
    // Fresh pages avoid Chromium full-page compositing artifacts after viewport changes.
    const screen = await context.newPage();
    await screen.setViewportSize({ width, height: 1000 }); await screen.goto(base); await screen.locator('#tab-skin').click();
    await screen.locator('#file-input').setInputFiles(fixture);
    await screen.locator('#open-vision').click();
    await screen.waitForFunction(() => document.getElementById('vision-connection').textContent.includes('synthetic-model'));
    await screen.locator('#vision-consent').check(); await screen.locator('#send-vision').click();
    await screen.locator('#care-handoff-note').waitFor({ state: 'attached' });
    assert.equal(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await screen.locator('.care-overview').evaluate(el => el.getBoundingClientRect().right <= innerWidth), true);
    await screen.screenshot({ path: `web/reports/care-integration/results-${width}.png`, fullPage: true, animations: 'disabled' });
    await screen.close();
  }
  pass('integrated review/note fit 390/768/1440px alongside existing app');
  for (const width of [1440, 390]) {
    const capture = await context.newPage();
    await capture.setViewportSize({ width, height: 1000 }); await capture.goto(base); await capture.locator('#tab-skin').click();
    await capture.locator('#start-camera').waitFor();
    assert.equal(await capture.locator('.skin-review-steps li').count(), 3);
    await capture.locator('#review-categories > summary').click();
    assert.equal(await capture.locator('#review-categories li').count(), 4);
    assert.equal(await capture.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await capture.locator('#review-categories > summary').click();
    await capture.screenshot({ path: `web/reports/care-integration/capture-${width}.png`, fullPage: true, animations: 'disabled' });
    await capture.close();
  }
  pass('guided capture and optional category explanation fit desktop and phone');
  await page.locator('#tab-hb').click();
  await page.locator('#sticker-mode').selectOption('plain');
  await page.waitForFunction(() => document.getElementById('model-note').textContent.includes('Runs on your device'));
  assert.equal(await page.locator('#annotate-panel').isVisible(), true);
  assert.equal(await page.locator('#session-actions').isVisible(), false);
  await page.evaluate(() => {
    const photo = document.getElementById('photo'), width = photo.width, height = photo.height;
    const size = Math.min(Math.floor(width / 3), height);
    for (const [i, kind] of ['nail', 'skin', 'white'].entries()) {
      document.querySelector(`[data-region="${kind}"]`).click();
      for (const [field, value] of Object.entries({ left: i * size, top: 0, width: size, height: size })) document.getElementById('coord-' + field).value = value;
      document.getElementById('coordinate-form').requestSubmit();
    }
  });
  assert.equal(await page.locator('#session-actions').isVisible(), true);
  assert.equal(await page.locator('#continue-scan').isEnabled(), true);
  pass('teammate Hb session controls and frozen model still load');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(base + '/')));
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  pass('no runtime exceptions, external requests, or persistent browser storage');
  console.log(`${checks} integration checks passed; synthetic local provider only, no external provider or patient photos.`);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
