// -----------------------------------------------------------------------------
// A fake SolaX Pocket WiFi dongle: a real HTTP server on 127.0.0.1 (no network)
// answering ReadRealTimeData with a recorded response (test/fixtures/solax),
// the way the firmware generations do:
//   - `variant`: where it wants the parameters — 'body' or 'query' (POST /),
//     'legacy' (GET /api/realTimeData.htm, the first X-Hybrid);
//   - `xff`: true when it only answers with `X-Forwarded-For: 5.8.8.8`
//     (firmware 2.034+), otherwise it answers a refusal page;
//   - `password`: the registration number it expects, if any;
//   - `asleep()`: stops listening (the inverter is off at night).
// It records every request, so tests can count the reads.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../fixtures/solax/', import.meta.url);

/** Every recorded dongle response, by file name without `.json`. */
export const FIXTURES = Object.fromEntries(
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(new URL(name, dir), 'utf8'))]),
);

/** The variant a fixture's dongle wants, from the request the library made. */
export function variantOf(fixture) {
  const request = fixture.request;
  if (request.method === 'GET') {
    return 'legacy';
  }
  return request.data ? 'body' : 'query';
}

const lower = (object) =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));

/** The registration number of a fixture's dongle (its `sn`). */
export const passwordOf = (fixture) => lower(fixture.response).sn;

/**
 * @param {object} options
 * @param {object} options.fixture an entry of FIXTURES
 * @param {string} [options.variant]
 * @param {boolean} [options.xff]
 * @param {string} [options.password] null: none expected
 * @param {string} [options.raw] answer this text instead of the fixture
 */
export async function startDongle({
  fixture,
  variant = variantOf(fixture),
  xff = Boolean(fixture.request.headers),
  password = null,
  raw,
} = {}) {
  const state = { fixture, response: fixture.response, raw, requests: [] };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://dongle');
      state.requests.push({ method: req.method, path: url.pathname, query: url.search, body });
      const send = (status, text) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(text);
      };
      let params = null;
      if (variant === 'legacy') {
        if (req.method === 'GET' && url.pathname === '/api/realTimeData.htm') {
          params = new URLSearchParams('optType=ReadRealTimeData');
        }
      } else if (req.method === 'POST' && url.pathname === '/') {
        params = new URLSearchParams(variant === 'body' ? body : url.search.slice(1));
      }
      if (!params || params.get('optType') !== 'ReadRealTimeData') {
        send(404, 'Not found');
        return;
      }
      if (xff && req.headers['x-forwarded-for'] !== '5.8.8.8') {
        send(200, 'This interface is accessed with restrictions');
        return;
      }
      // The first X-Hybrid has no password.
      if (password !== null && variant !== 'legacy' && params.get('pwd') !== password) {
        send(200, '{"code":-1,"msg":"password error"}');
        return;
      }
      send(200, state.raw ?? JSON.stringify(state.response));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    host: `127.0.0.1:${port}`,
    port,
    state,
    get requests() {
      return state.requests;
    },
    /** Answer another response from now on (a new reading). */
    answer(response) {
      state.response = response;
      state.raw = undefined;
    },
    /** Answer the fixture's realtime array with some registers changed. */
    setRegisters(changes) {
      const response = structuredClone(state.response);
      const key = Object.keys(response).find((k) => k.toLowerCase() === 'data');
      for (const [index, value] of Object.entries(changes)) {
        response[key][Number(index)] = value;
      }
      state.response = response;
    },
    /** Stop listening: connections are refused, like a dongle off at night. */
    async asleep() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
    close() {
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** A port nothing listens on (bound then released). */
export async function deadHost() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `127.0.0.1:${port}`;
}
