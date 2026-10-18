import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createScanProcessor } from '../dist/scan-processor.js';
import { extractFeatures, predict } from '../dist/ml.js';

const model = JSON.parse(readFileSync(new URL('../dist/assets/model.json', import.meta.url)));
const boxes = { nail: [0, 0, 10, 10], skin: [10, 10, 20, 20], white: [20, 20, 30, 30] };
function photo() {
  const data = new Uint8ClampedArray(40 * 30 * 4);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
    const rgb = y < 10 && x < 10 ? [100, 25, 10] : y >= 10 && y < 20 && x >= 10 && x < 20 ? [40, 60, 20] : [200, 100, 50];
    data.set([...rgb, 255], (y * 40 + x) * 4);
  }
  return { width: 40, height: 30, data };
}

// Exercise the browser worker module in a real separate thread, adapting only
// the platform message events. The model and extraction code are unchanged.
function nodeWorkerFactory(url) {
  const worker = new NodeWorker(`
    const { parentPort } = require('node:worker_threads');
    global.self = {
      addEventListener(type, listener) { parentPort.on(type, data => listener({ data })); },
      postMessage(data) { parentPort.postMessage(data); }
    };
    import(${JSON.stringify(url.href)});
  `, { eval: true });
  return {
    addEventListener(type, listener) {
      worker.on(type, value => listener(type === 'message' ? { data: value } : { error: value }));
    },
    postMessage(data, transfer) { worker.postMessage(data, transfer); },
    terminate() { void worker.terminate(); },
  };
}

class ControlledWorker {
  listeners = new Map();
  messages = [];
  terminated = false;
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  postMessage(message, transfer) { this.messages.push(structuredClone(message, { transfer })); }
  terminate() { this.terminated = true; }
  emit(type, data) { this.listeners.get(type)?.(type === 'message' ? { data } : {}); }
  succeed(id, value = 123.456789) {
    this.emit('message', { id, result: { id, hemoglobin_g_per_l: value, warnings: [] } });
  }
}

test('A stalled worker times out every pending photo and can restart', async t => {
  const workers=[];
  const processor=createScanProcessor({timeoutMs:20,workerFactory:()=>{const worker=new ControlledWorker();workers.push(worker);return worker;}});
  t.after(()=>processor.close());
  const first=processor.process({id:'stalled',model,image:photo(),boxes});
  const second=processor.process({id:'queued',model,image:photo(),boxes});
  await Promise.all([assert.rejects(first,/too long/),assert.rejects(second,/too long/)]);
  assert.equal(workers[0].terminated,true);
  const next=processor.process({id:'retry',model,image:photo(),boxes});
  workers[1].succeed('retry');
  assert.equal((await next).id,'retry');
});

test('Real worker returns full-precision inference and warnings without transferring the displayed photo', async t => {
  const processor = createScanProcessor({ workerFactory: nodeWorkerFactory });
  t.after(() => processor.close());
  const image = photo();
  const original = image.data.slice();
  const expected = extractFeatures(image, boxes);
  const result = await processor.process({ id: 'first', model, image, boxes });
  assert.equal(result.hemoglobin_g_per_l, predict(model, expected.features));
  assert.deepEqual(result.warnings.slice(0, expected.warnings.length), expected.warnings);
  assert.deepEqual(image.data, original);
  assert.deepEqual(Object.keys(result).sort(), ['hemoglobin_g_per_l', 'id', 'warnings']);
  if (result.hemoglobin_g_per_l < 44 || result.hemoglobin_g_per_l > 169) {
    assert.ok(result.warnings.some(warning => warning.includes('44–169')));
  }
});

test('A failed photo is rejected cleanly while subsequent photos can still run', async t => {
  const processor = createScanProcessor({ workerFactory: nodeWorkerFactory });
  t.after(() => processor.close());
  await assert.rejects(processor.process({ id: 1, model, image: photo(), boxes: { ...boxes, skin: boxes.nail } }), /non-overlapping/);
  const result = await processor.process({ id: 2, model, image: photo(), boxes });
  assert.equal(result.id, 2);
  assert.ok(Number.isFinite(result.hemoglobin_g_per_l));
});

test('Concurrent photos share one lazy worker and match results by scan id', async t => {
  const workers = [];
  const processor = createScanProcessor({ workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; } });
  t.after(() => processor.close());
  assert.equal(workers.length, 0);
  const first = processor.process({ id: 1, model, image: photo(), boxes });
  const second = processor.process({ id: 2, model, image: photo(), boxes });
  await assert.rejects(processor.process({ id: 1, model, image: photo(), boxes }), /already being processed/);
  assert.equal(workers.length, 1);
  workers[0].succeed(2, 132.425);
  workers[0].succeed(1, 102.378);
  assert.equal((await first).hemoglobin_g_per_l, 102.378);
  assert.equal((await second).hemoglobin_g_per_l, 132.425);
});

for (const failure of ['error', 'messageerror']) {
  test(`Worker ${failure} rejects every pending scan and permits a fresh worker`, async t => {
    const workers = [];
    const processor = createScanProcessor({ workerFactory: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; } });
    t.after(() => processor.close());
    const first = processor.process({ id: 1, model, image: photo(), boxes });
    const second = processor.process({ id: 2, model, image: photo(), boxes });
    const settled = Promise.allSettled([first, second]);
    workers[0].emit(failure);
    assert.ok((await settled).every(result => result.status === 'rejected' && result.reason instanceof Error));
    assert.equal(workers[0].terminated, true);
    const third = processor.process({ id: 3, model, image: photo(), boxes });
    assert.equal(workers.length, 2);
    // A stale worker event must not affect the replacement's pending scan.
    workers[0].emit(failure);
    workers[1].succeed(3);
    assert.equal((await third).id, 3);
  });
}

test('Closing terminates the worker, rejects pending photos, and prevents later submissions', async () => {
  const worker = new ControlledWorker();
  const processor = createScanProcessor({ workerFactory: () => worker });
  const pending = processor.process({ id: 1, model, image: photo(), boxes });
  const rejection = assert.rejects(pending, /closed/);
  processor.close();
  processor.close();
  await rejection;
  assert.equal(worker.terminated, true);
  await assert.rejects(processor.process({ id: 2, model, image: photo(), boxes }), /closed/);
});

test('Invalid worker estimates cannot enter the scan average', async t => {
  const worker = new ControlledWorker();
  const processor = createScanProcessor({ workerFactory: () => worker });
  t.after(() => processor.close());
  for (const [id, estimate] of [[1, NaN], [2, 0], [3, 1001]]) {
    const pending = processor.process({ id, model, image: photo(), boxes });
    const rejection = assert.rejects(pending, /usable estimate/);
    worker.succeed(id, estimate);
    await rejection;
  }
});
