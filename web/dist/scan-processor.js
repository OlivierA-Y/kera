function asError(error, fallback) {
  return error instanceof Error && error.message ? error : new Error(fallback);
}

/** Run photo inference off the main thread, with one worker shared by all jobs. */
export function createScanProcessor({ workerFactory, timeoutMs = 60000 } = {}) {
  let worker = null;
  let closed = false;
  const pending = new Map();

  function failWorker(target, error) {
    // A late event from a terminated worker must not fail jobs on its replacement.
    if (worker !== target) return;
    worker = null;
    target.terminate();
    const jobs = [...pending.values()];
    pending.clear();
    for (const job of jobs) { clearTimeout(job.timer); job.reject(error); }
  }

  function getWorker() {
    if (worker) return worker;
    if (!workerFactory && typeof globalThis.Worker !== 'function') {
      throw new Error('This browser cannot process scans in the background. Please use an up-to-date browser.');
    }
    const target = workerFactory
      ? workerFactory(new URL('./scan-worker.js', import.meta.url), { type: 'module', name: 'kera-scan-processor' })
      : new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module', name: 'kera-scan-processor' });
    worker = target;
    target.addEventListener('message', ({ data }) => {
      if (worker !== target) return;
      const job = pending.get(data?.id);
      if (!job) return;
      pending.delete(data.id);
      clearTimeout(job.timer);
      if (typeof data.error === 'string') {
        job.reject(new Error(data.error || 'This photo could not be processed. Please try again.'));
        return;
      }
      const result = data.result;
      if (!result || result.id !== data.id || !Number.isFinite(result.hemoglobin_g_per_l)
        || result.hemoglobin_g_per_l <= 0 || result.hemoglobin_g_per_l > 1000
        || !Array.isArray(result.warnings) || !result.warnings.every(warning => typeof warning === 'string')) {
        job.reject(new Error('This photo did not produce a usable estimate. Please take another photo.'));
        return;
      }
      job.resolve(result);
    });
    target.addEventListener('error', event => {
      event.preventDefault?.();
      failWorker(target, new Error('Background scan processing stopped. Please try scanning again.'));
    });
    target.addEventListener('messageerror', () => {
      failWorker(target, new Error('The scan result could not be read. Please try scanning again.'));
    });
    return target;
  }

  return {
    async process({ id, model, image, boxes }) {
      if (closed) throw new Error('Scan processing has closed. Please reload Kera Check.');
      if (!((typeof id === 'string' && id.length > 0) || (typeof id === 'number' && Number.isFinite(id)))) {
        throw new Error('The scan needs a valid identifier. Please try again.');
      }
      if (pending.has(id)) throw new Error('This photo is already being processed.');
      if (!image || !Number.isInteger(image.width) || image.width <= 0
        || !Number.isInteger(image.height) || image.height <= 0
        || !(image.data instanceof Uint8ClampedArray)
        || image.data.length !== image.width * image.height * 4) {
        throw new Error('The captured photo could not be read. Please take it again.');
      }
      let target;
      try {
        target = getWorker();
      } catch (error) {
        throw asError(error, 'Background scan processing could not start. Please reload Kera Check.');
      }
      // Transfer a fresh copy so the current photo stays available for marking,
      // retaking, and the page's optional visible-feature analysis.
      const buffer = new Uint8ClampedArray(image.data).buffer;
      return new Promise((resolve, reject) => {
        const timer=setTimeout(()=>failWorker(target,new Error('This photo took too long to process. Please take another photo.')),timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          target.postMessage({ id, model, image: { width: image.width, height: image.height, buffer }, boxes }, [buffer]);
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(asError(error, 'This photo could not be sent for processing. Please try again.'));
        }
      });
    },

    close() {
      if (closed) return;
      closed = true;
      if (worker) failWorker(worker, new Error('Scan processing was closed.'));
    },
  };
}
