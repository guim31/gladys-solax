// -----------------------------------------------------------------------------
// SolaX Cloud client (optional, for the dongles that do not answer locally).
//
//   GET https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do
//       ?tokenId=<API token>&sn=<dongle registration number>
// answers `{ success, exception, result: { inverterSN, sn, acpower, yieldtoday,
// yieldtotal, feedinpower, feedinenergy, consumeenergy, soc, batPower,
// powerdc1..4, inverterType, inverterStatus, uploadTime, utcDateTime... } }`.
//
// SolaX allows 10 calls per minute and 10 000 per day per token, and the
// dongle uploads every 5 minutes: the integration reads each inverter every
// 5 minutes at most (src/config.js), spaces its calls by CALL_SPACING_MS
// (under 10 per minute whatever the number of inverters), and stretches the
// period when the inverters would exceed DAILY_BUDGET calls a day.
//
// The token travels in the URL (the API offers nothing else): the URL is never
// logged, and the API's own error text is cut and stripped of anything that
// looks like the token before it reaches a log or a message.
// -----------------------------------------------------------------------------

import { statusFromCode, UNKNOWN_STATUS } from './models.js';

export const CLOUD_URL = 'https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do';
export const CALL_SPACING_MS = 6500;
export const DAILY_BUDGET = 9000;
export const REQUEST_TIMEOUT_MS = 15000;

// `inverterType` of SolaX Cloud (API documentation): the model shown in
// Gladys. Absent from the table: "SolaX inverter (type N)".
export const CLOUD_INVERTER_TYPES = {
  1: 'X1-LX',
  2: 'X-Hybrid',
  3: 'X1-Hybrid G3',
  4: 'X1-Boost / Mini',
  5: 'X3-Hybrid G3',
  6: 'X3-20K/30K',
  7: 'X3-MIC/PRO',
  8: 'X1-Smart',
  9: 'X1-AC',
  10: 'A1-Hybrid',
  11: 'A1-Fit',
  12: 'A1-Grid',
  13: 'J1-ESS',
  14: 'X3-Hybrid G4',
  15: 'X1-Hybrid G4',
  16: 'X3-MIC PRO G2',
  17: 'X1-SPT',
  18: 'X1-Boost / Mini G4',
  19: 'A1-HYB G2',
  20: 'A1-AC G2',
  21: 'A1-SMT G2',
  22: 'X1-Mini G4',
  25: 'X3-Ultra',
};

/** An error of the API itself (bad token, unknown serial, quota). */
export class CloudError extends Error {
  constructor(message, { auth = false } = {}) {
    super(message);
    this.name = 'CloudError';
    this.auth = auth;
  }
}

const num = (value) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** The API's error text, safe to show: short, without the token. */
export function safeApiMessage(text, token) {
  let message = String(text ?? '').slice(0, 120);
  if (token) {
    message = message.split(token).join('***');
  }
  return message.replace(/[A-Za-z0-9]{16,}/g, '***').trim() || 'unknown error';
}

/**
 * Turn a `result` into the reading shape of the local decoders, plus the
 * identity of the inverter.
 */
export function parseCloudResult(result) {
  const pv = [result.powerdc1, result.powerdc2, result.powerdc3, result.powerdc4].map(num);
  const strings = pv.filter((power) => power !== null);
  const soc = num(result.soc);
  const batteryPower = num(result.batPower);
  const statusCode = num(result.inverterStatus);
  const reading = {
    pv: strings,
    acPower: num(result.acpower),
    yieldToday: num(result.yieldtoday),
    yieldTotal: num(result.yieldtotal),
    gridPower: num(result.feedinpower) === null ? null : -num(result.feedinpower),
    gridExportTotal: num(result.feedinenergy),
    gridImportTotal: num(result.consumeenergy),
    status: statusCode === null ? UNKNOWN_STATUS : statusFromCode(statusCode - 100),
  };
  if (soc !== null && batteryPower !== null) {
    reading.battery = { soc, power: batteryPower };
  }
  // Without per-string values (a plain grid inverter), the AC output is the
  // closest the API gives to the PV production.
  reading.pvPower =
    strings.length > 0 ? strings.reduce((sum, power) => sum + power, 0) : (reading.acPower ?? 0);
  const typeCode = num(result.inverterType);
  return {
    reading,
    inverterSerial:
      typeof result.inverterSN === 'string' && result.inverterSN.trim()
        ? result.inverterSN.trim()
        : null,
    modelName: CLOUD_INVERTER_TYPES[typeCode] ?? null,
    typeCode,
    uploadedAt: parseUtc(result.utcDateTime),
  };
}

function parseUtc(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.url]
 * @param {number} [options.spacingMs] minimum pause between two calls
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createCloudClient({
  fetch: fetchImpl = globalThis.fetch,
  url = CLOUD_URL,
  spacingMs = CALL_SPACING_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  // Calls go one after the other, CALL_SPACING_MS apart: the quota is per
  // token, shared by every inverter of the account.
  let queue = Promise.resolve();
  let lastCallAt = -Infinity;

  async function call(token, serial) {
    const wait = lastCallAt + spacingMs - now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastCallAt = now();
    const query = new URLSearchParams({ tokenId: token, sn: serial });
    let response;
    try {
      response = await fetchImpl(`${url}?${query}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const error = new Error(
        err?.name === 'TimeoutError'
          ? 'SolaX Cloud did not answer in time'
          : 'SolaX Cloud is unreachable',
      );
      error.unreachable = true;
      throw error;
    }
    if (!response.ok) {
      throw new CloudError(`SolaX Cloud answered HTTP ${response.status}`, {
        auth: response.status === 401 || response.status === 403,
      });
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new CloudError('SolaX Cloud answered something that is not JSON');
    }
    if (json?.success !== true || !json.result || typeof json.result !== 'object') {
      const message = safeApiMessage(json?.exception, token);
      throw new CloudError(`SolaX Cloud refused the request: ${message}`, {
        auth: /token|auth|access|permission/i.test(message),
      });
    }
    return parseCloudResult(json.result);
  }

  return {
    /**
     * Realtime data of one inverter, by the registration number of its dongle.
     * @throws {CloudError | Error & { unreachable: true }}
     */
    read(token, serial) {
      const run = queue.then(() => call(token, serial));
      queue = run.catch(() => {});
      return run;
    },
  };
}

/**
 * The period that keeps `count` inverters under the daily budget.
 * @returns {number} milliseconds, at least `periodMs`
 */
export function cloudPeriodMs(periodMs, count) {
  const perDay = (24 * 60 * 60 * 1000) / periodMs;
  if (count * perDay <= DAILY_BUDGET) {
    return periodMs;
  }
  return Math.ceil((count * 24 * 60 * 60 * 1000) / DAILY_BUDGET / 60000) * 60000;
}
