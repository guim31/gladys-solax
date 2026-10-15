// -----------------------------------------------------------------------------
// A fake SolaX Cloud: a `fetch` answering getRealtimeInfo.do like the API
// does — the realtime result of a registration number for the right token,
// `success: false` otherwise. No network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const CLOUD_FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/solax-cloud/realtime-hybrid.json', import.meta.url), 'utf8'),
);

export const CLOUD_TOKEN = '20261015TESTTOKEN0000001';

/**
 * @param {object} [options]
 * @param {Record<string, object>} [options.inverters] registration number → result
 * @param {string} [options.token]
 */
export function createFakeCloud({
  inverters = { [CLOUD_FIXTURE.result.sn]: CLOUD_FIXTURE.result },
  token = CLOUD_TOKEN,
} = {}) {
  const calls = [];
  const cloud = {
    calls,
    inverters,
    down: false,
    async fetch(url) {
      const parsed = new URL(url);
      calls.push({ at: Date.now(), sn: parsed.searchParams.get('sn') });
      if (cloud.down) {
        throw new TypeError('fetch failed');
      }
      const json = (body) => ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      if (parsed.searchParams.get('tokenId') !== token) {
        return json({ success: false, exception: 'tokenId error', result: null, code: 1001 });
      }
      const result = inverters[parsed.searchParams.get('sn')];
      if (!result) {
        return json({
          success: false,
          exception: 'this sn did not access!',
          result: null,
          code: 1002,
        });
      }
      // Uploaded just now, unless the test pins the upload time.
      const fresh = result.pinned ? result : { ...result, utcDateTime: new Date().toISOString() };
      return json({ success: true, exception: 'Query success!', result: fresh, code: 0 });
    },
  };
  return cloud;
}
