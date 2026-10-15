// -----------------------------------------------------------------------------
// Local client of the SolaX Pocket WiFi / LAN dongle.
//
// The dongle serves its realtime data over plain HTTP on port 80:
//   POST http://<ip>/  optType=ReadRealTimeData&pwd=<dongle registration number>
// The parameters go in the body or in the query string depending on the
// firmware, and the 2.034+ firmwares only answer the LAN when the request
// carries `X-Forwarded-For: 5.8.8.8` (the dongle's own access-point address).
// The first-generation X-Hybrid answers GET /api/realTimeData.htm instead.
// Which variant a dongle wants is found once (`detect`), then kept.
//
// Read only: the integration never sends anything but ReadRealTimeData.
// The password (the dongle's registration number) is never logged; error
// messages carry the host and the HTTP status only.
// -----------------------------------------------------------------------------

import { AUTO_MODEL, UnsupportedModelError, detectModel } from './models.js';

export const REQUEST_TIMEOUT_MS = 5000;
// Pause between two detection attempts: the dongles are small and the
// library this port follows staggers its probes the same way.
export const DETECTION_STAGGER_MS = 1000;
const XFF = { 'X-Forwarded-For': '5.8.8.8' };

// In the order they are tried. The keys are stored in /data: permanent.
export const VARIANTS = {
  body: { method: 'POST', params: 'body' },
  body_xff: { method: 'POST', params: 'body', headers: XFF },
  query_xff: { method: 'POST', params: 'query', headers: XFF },
  query: { method: 'POST', params: 'query' },
  legacy: { method: 'GET', path: '/api/realTimeData.htm' },
};

/** A dongle that answered, but not with realtime data. */
export class DongleError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'DongleError';
    this.status = status;
  }
}

/**
 * Normalize what the user typed: `192.0.2.10`, `192.0.2.10:8080`,
 * `http://192.0.2.10/`. Refuses paths, credentials and anything that is not
 * a host name or an address.
 * @returns {string | null} `host[:port]`, or null when invalid
 */
export function normalizeHost(input) {
  const text = String(input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(text) && !/^\[[0-9a-fA-F:]+\](:\d{1,5})?$/.test(text)) {
    return null;
  }
  const port = text.match(/:(\d+)$/)?.[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return null;
  }
  return text;
}

/** The request of one variant (exported for the probe and the tests). */
export function buildRequest(host, password, variantKey) {
  const variant = VARIANTS[variantKey];
  const params = `optType=ReadRealTimeData${password ? `&pwd=${encodeURIComponent(password)}` : ''}`;
  const headers = { ...(variant.headers ?? {}) };
  let url = `http://${host}${variant.path ?? '/'}`;
  let body;
  if (variant.params === 'body') {
    body = params;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (variant.params === 'query') {
    url += `?${params}`;
  }
  return { url, init: { method: variant.method, headers, body } };
}

/**
 * Parse a dongle answer: tolerant of the empty values some firmwares send
 * (`[1,,2]`) and of the key case (`Data`, `SN`).
 * @returns {{ serial: string|null, inverterSerial: string|null, firmware: string|null,
 *   type: unknown, data: number[], information: unknown[], endpoint: string, idle: boolean }}
 * @throws {DongleError}
 */
export function parseResponse(text, endpoint = 'post') {
  let json;
  try {
    json = JSON.parse(String(text).replaceAll(',,', ',0,').replaceAll(',,', ',0,'));
  } catch {
    throw new DongleError('the dongle did not answer realtime data (not JSON)');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new DongleError('the dongle did not answer realtime data');
  }
  const body = Object.fromEntries(Object.entries(json).map(([k, v]) => [k.toLowerCase(), v]));
  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new DongleError('the dongle answered without realtime data (wrong password?)');
  }
  const data = body.data.map(Number);
  if (data.some((value) => !Number.isFinite(value))) {
    throw new DongleError('the dongle answered non-numeric realtime data');
  }
  if (body.type === undefined || body.type === null) {
    throw new DongleError('the dongle answered without an inverter type');
  }
  const information = Array.isArray(body.information) ? body.information : [];
  return {
    serial: typeof body.sn === 'string' && body.sn.trim() ? body.sn.trim() : null,
    inverterSerial: inverterSerialOf(body.type, information),
    firmware: typeof (body.ver ?? body.version) === 'string' ? (body.ver ?? body.version) : null,
    type: body.type,
    data,
    information,
    ratedPowerKw: typeof information[0] === 'number' && information[0] > 0 ? information[0] : null,
    endpoint,
    // At night, a dongle still powered (by the battery, or the AC side) may
    // answer zeros only: not an error, the inverter is asleep.
    idle: data.every((value) => value === 0),
  };
}

// The inverter serial number sits in `Information`: at index 3 after the
// model name for the string types, at index 2 for the numeric ones.
function inverterSerialOf(type, information) {
  const candidate = typeof type === 'string' ? information[3] : information[2];
  return typeof candidate === 'string' && /^[A-Za-z0-9]{6,}$/.test(candidate.trim())
    ? candidate.trim()
    : null;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.staggerMs] pause between two detection attempts
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createLocalClient({
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  staggerMs = DETECTION_STAGGER_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  async function request(host, password, variantKey) {
    const { url, init } = buildRequest(host, password, variantKey);
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const reason =
        err?.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : 'unreachable';
      const error = new Error(`${host}: ${reason}`);
      error.unreachable = true;
      throw error;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new DongleError(`${host}: HTTP ${response.status}`, { status: response.status });
    }
    return parseResponse(text, VARIANTS[variantKey].method === 'GET' ? 'legacy' : 'post');
  }

  return {
    /**
     * Read the realtime data with a known variant.
     * @throws {Error & { unreachable?: boolean } | DongleError}
     */
    read: (host, password, variantKey) => request(host, password, variantKey),

    /**
     * Find the variant the dongle answers, and the model of the inverter.
     * @param {string} host
     * @param {string} password
     * @param {{ model?: string }} [options] a model forced in the configuration
     * @returns {Promise<{ variant: string, response: object, model: object }>}
     * @throws {UnsupportedModelError} the dongle answers for an unknown model
     * @throws {Error} nothing answered (the last error)
     */
    async detect(host, password, { model: forced = AUTO_MODEL } = {}) {
      let lastError = null;
      let first = true;
      for (const variantKey of Object.keys(VARIANTS)) {
        if (!first) {
          await sleep(staggerMs);
        }
        first = false;
        let response;
        try {
          response = await request(host, password, variantKey);
        } catch (err) {
          lastError = err;
          if (err.unreachable) {
            // Nothing listens there: the other variants would time out too.
            throw err;
          }
          continue;
        }
        // The dongle answered realtime data: the model is final, known or not.
        const model = detectModel(response, forced);
        return { variant: variantKey, response, model };
      }
      throw lastError ?? new DongleError(`${host}: no answer`);
    },
  };
}

export { UnsupportedModelError };
