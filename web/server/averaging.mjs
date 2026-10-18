import { VisionError } from './vision.mjs';

export const MAX_SCAN_READINGS = 100;
export const MAX_AVERAGE_BODY = 64 * 1024;
const MAX_HEMOGLOBIN = 1000;
const invalid = message => new VisionError(400, 'invalid_readings', message);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, keys) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

/** Combine only numerical estimates. This function stores nothing and never receives photos. */
export function averageReadings(body) {
  if (!isRecord(body) || !hasOnlyKeys(body, ['readings']) || !Array.isArray(body.readings) || body.readings.length < 1 || body.readings.length > MAX_SCAN_READINGS) {
    throw invalid(`Send between 1 and ${MAX_SCAN_READINGS} scan readings.`);
  }

  const ids = new Set();
  const warnings = new Set();
  let total = 0;
  let compensation = 0;
  for (const reading of body.readings) {
    if (!isRecord(reading) || !hasOnlyKeys(reading, ['id', 'hemoglobin_g_per_l', 'warnings'])) {
      throw invalid('Each scan needs an id, a hemoglobin estimate and a list of warnings.');
    }
    if (typeof reading.id !== 'string' || reading.id.length < 1 || reading.id.length > 128 || reading.id.trim() !== reading.id || ids.has(reading.id)) {
      throw invalid('Each scan needs a unique, non-empty id.');
    }
    const estimate = reading.hemoglobin_g_per_l;
    if (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate <= 0 || estimate > MAX_HEMOGLOBIN) {
      throw invalid(`Each hemoglobin estimate must be a number above 0 and at most ${MAX_HEMOGLOBIN} g/L.`);
    }
    if (!Array.isArray(reading.warnings) || reading.warnings.length > 20 || reading.warnings.some(warning => typeof warning !== 'string' || warning.trim().length === 0 || warning.length > 256)) {
      throw invalid('Each scan needs a list of up to 20 short text warnings.');
    }

    ids.add(reading.id);
    for (const warning of reading.warnings) warnings.add(warning);
    // Compensated summation keeps fractional estimates until the final display step.
    const adjusted = estimate - compensation;
    const next = total + adjusted;
    compensation = (next - total) - adjusted;
    total = next;
  }
  return { hemoglobin_g_per_l: total / body.readings.length, scan_count: body.readings.length, warnings: [...warnings] };
}
