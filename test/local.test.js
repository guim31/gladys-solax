// -----------------------------------------------------------------------------
// The local client against fake dongles (real HTTP on 127.0.0.1): it finds the
// request variant each firmware generation wants, sends the password, refuses
// what is not realtime data, and tells an unreachable dongle apart.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, deadHost, passwordOf, startDongle } from './helpers/fakeDongle.js';
import {
  DongleError,
  buildRequest,
  createLocalClient,
  normalizeHost,
  parseResponse,
} from '../src/solax/local.js';

const client = createLocalClient({ staggerMs: 0, timeoutMs: 1000 });

test('a 2.034 dongle: parameters in the body, X-Forwarded-For required, password checked', async (t) => {
  const fixture = FIXTURES.x1_boost;
  const dongle = await startDongle({
    fixture,
    variant: 'body',
    xff: true,
    password: passwordOf(fixture),
  });
  t.after(() => dongle.close());
  const found = await client.detect(dongle.host, passwordOf(fixture));
  assert.equal(found.variant, 'body_xff');
  assert.equal(found.model.key, 'x1_boost');
  assert.equal(found.response.inverterSerial, 'TEST00016');
  assert.equal(found.response.ratedPowerKw, 5);
  // Then read with the variant found, in one request.
  const before = dongle.requests.length;
  const again = await client.read(dongle.host, passwordOf(fixture), found.variant);
  assert.equal(again.data.length, 200);
  assert.equal(dongle.requests.length, before + 1);
  assert.match(dongle.requests.at(-1).body, /^optType=ReadRealTimeData&pwd=/);
});

test('a dongle reading the query string', async (t) => {
  const fixture = FIXTURES.x1_mini_g4;
  const dongle = await startDongle({ fixture, variant: 'query', xff: true });
  t.after(() => dongle.close());
  const found = await client.detect(dongle.host, '');
  assert.equal(found.variant, 'query_xff');
  assert.equal(found.model.key, 'x1_g4');
  assert.equal(dongle.requests.at(-1).query, '?optType=ReadRealTimeData');
});

test('the first X-Hybrid: GET /api/realTimeData.htm', async (t) => {
  const fixture = FIXTURES.xhybrid_de02;
  const dongle = await startDongle({ fixture });
  t.after(() => dongle.close());
  const found = await client.detect(dongle.host, '');
  assert.equal(found.variant, 'legacy');
  assert.equal(found.model.key, 'x_hybrid');
  assert.equal(found.response.serial, 'TEST00002');
});

test('a wrong password: the dongle answers, but no realtime data', async (t) => {
  const fixture = FIXTURES.x3_hybrid_g4;
  const dongle = await startDongle({ fixture, password: passwordOf(fixture) });
  t.after(() => dongle.close());
  await assert.rejects(client.detect(dongle.host, 'WRONG00000'), DongleError);
  await assert.rejects(client.read(dongle.host, 'WRONG00000', 'body'), DongleError);
});

test('an unknown model is final: the other variants are not tried', async (t) => {
  const dongle = await startDongle({
    fixture: FIXTURES.x1_boost,
    variant: 'body',
    xff: false,
    raw: JSON.stringify({ sn: 'SNEW000001', ver: '3.1', type: 77, Data: [1, 2, 3] }),
  });
  t.after(() => dongle.close());
  await assert.rejects(client.detect(dongle.host, ''), { name: 'UnsupportedModelError' });
  assert.equal(dongle.requests.length, 1);
});

test('nothing listening: unreachable, without trying every variant', async () => {
  const host = await deadHost();
  await assert.rejects(client.detect(host, 'S123456789'), (err) => {
    assert.equal(err.unreachable, true);
    assert.ok(!err.message.includes('S123456789'), 'the password is not in the message');
    return true;
  });
});

test('the empty values of some firmwares, the key case, the idle dongle', () => {
  const parsed = parseResponse(
    '{"SN":"SA1234567","ver":"2.034.06","type":4,"Data":[1,,2,,,3],"Information":[3.0,4,"XB1234567890"]}',
  );
  assert.deepEqual(parsed.data, [1, 0, 2, 0, 0, 3]);
  assert.equal(parsed.serial, 'SA1234567');
  assert.equal(parsed.inverterSerial, 'XB1234567890');
  assert.equal(parsed.idle, false);
  assert.equal(parseResponse('{"sn":"S1","ver":"1","type":4,"Data":[0,0]}').idle, true);
  assert.throws(() => parseResponse('<html>'), DongleError);
  assert.throws(() => parseResponse('{"code":-1}'), DongleError);
  assert.throws(() => parseResponse('{"sn":"S1","Data":[1]}'), /without an inverter type/);
});

test('the addresses a user may type', () => {
  assert.equal(normalizeHost(' 192.0.2.10 '), '192.0.2.10');
  assert.equal(normalizeHost('http://192.0.2.10/'), '192.0.2.10');
  assert.equal(normalizeHost('192.0.2.10:8080'), '192.0.2.10:8080');
  assert.equal(normalizeHost('pocket-wifi.local'), 'pocket-wifi.local');
  assert.equal(normalizeHost('user:pass@192.0.2.10'), null);
  assert.equal(normalizeHost('192.0.2.10/path'), null);
  assert.equal(normalizeHost('192.0.2.10:99999'), null);
  assert.equal(normalizeHost(''), null);
});

test('the requests of each variant', () => {
  const body = buildRequest('192.0.2.10', 'SA12345678', 'body_xff');
  assert.equal(body.url, 'http://192.0.2.10/');
  assert.equal(body.init.method, 'POST');
  assert.equal(body.init.body, 'optType=ReadRealTimeData&pwd=SA12345678');
  assert.equal(body.init.headers['X-Forwarded-For'], '5.8.8.8');
  const query = buildRequest('192.0.2.10', '', 'query');
  assert.equal(query.url, 'http://192.0.2.10/?optType=ReadRealTimeData');
  assert.equal(query.init.body, undefined);
  assert.equal(
    buildRequest('192.0.2.10', '', 'legacy').url,
    'http://192.0.2.10/api/realTimeData.htm',
  );
});
