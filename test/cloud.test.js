// -----------------------------------------------------------------------------
// The SolaX Cloud client: the reading of a realtime answer, the refusals
// (without the token in any message), the spacing of the calls and the daily
// budget. No network: a fake fetch.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_FIXTURE, CLOUD_TOKEN, createFakeCloud } from './helpers/fakeCloud.js';
import {
  CloudError,
  DAILY_BUDGET,
  cloudPeriodMs,
  createCloudClient,
  parseCloudResult,
  safeApiMessage,
} from '../src/solax/cloud.js';

test('a hybrid inverter: production, grid (import +), battery (charge +), state', () => {
  const { reading, inverterSerial, modelName, uploadedAt } = parseCloudResult(CLOUD_FIXTURE.result);
  assert.equal(inverterSerial, 'H34TESTCLOUD01');
  assert.equal(modelName, 'X3-Hybrid G4');
  assert.equal(uploadedAt, Date.parse('2026-10-15T11:40:12Z'));
  assert.deepEqual(reading.pv, [1830, 1290]);
  assert.equal(reading.pvPower, 3120);
  assert.equal(reading.yieldTotal, 8231.7);
  assert.equal(reading.gridPower, -830, 'feeding 830 W in is an export');
  assert.equal(reading.gridExportTotal, 2051.33);
  assert.equal(reading.gridImportTotal, 3410.92);
  assert.deepEqual(reading.battery, { soc: 86, power: 640 });
  assert.equal(reading.status, 'normal');
});

test('a grid inverter without strings nor battery', () => {
  const { reading } = parseCloudResult({
    acpower: 1500,
    yieldtoday: 3,
    yieldtotal: 900,
    feedinpower: null,
    soc: null,
    batPower: null,
    inverterStatus: '110',
  });
  assert.deepEqual(reading.pv, []);
  assert.equal(reading.pvPower, 1500, 'the AC power stands for the production');
  assert.equal(reading.battery, undefined);
  assert.equal(reading.gridPower, null);
  assert.equal(reading.status, 'standby');
});

test('a refused token: a CloudError that never shows the token', async () => {
  const cloud = createFakeCloud();
  const client = createCloudClient({ fetch: cloud.fetch, spacingMs: 0 });
  await assert.rejects(client.read('WRONGTOKEN123', 'SCLOUD0001'), (err) => {
    assert.ok(err instanceof CloudError);
    assert.equal(err.auth, true);
    assert.ok(!err.message.includes('WRONGTOKEN123'));
    return true;
  });
  await assert.rejects(client.read(CLOUD_TOKEN, 'SUNKNOWN01'), /did not access/);
  assert.equal(safeApiMessage(`bad token ${CLOUD_TOKEN}`, CLOUD_TOKEN), 'bad token ***');
  assert.equal(safeApiMessage('id 1234567890ABCDEFGH refused'), 'id *** refused');
});

test('SolaX Cloud down: unreachable', async () => {
  const cloud = createFakeCloud();
  cloud.down = true;
  const client = createCloudClient({ fetch: cloud.fetch, spacingMs: 0 });
  await assert.rejects(client.read(CLOUD_TOKEN, 'SCLOUD0001'), (err) => err.unreachable === true);
});

test('the calls are spaced: never more than 10 a minute, whatever the number of inverters', async () => {
  const cloud = createFakeCloud();
  let clock = 0;
  const waits = [];
  const client = createCloudClient({
    fetch: cloud.fetch,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await Promise.all(Array.from({ length: 12 }, () => client.read(CLOUD_TOKEN, 'SCLOUD0001')));
  assert.equal(cloud.calls.length, 12);
  assert.equal(waits.length, 11);
  assert.ok(waits.every((ms) => ms >= 6000));
  // 12 calls take more than a minute: 10 per minute at most.
  assert.ok(clock >= 60000);
});

test('the period stretches to stay under the daily budget', () => {
  const five = 5 * 60 * 1000;
  assert.equal(cloudPeriodMs(five, 1), five);
  assert.equal(cloudPeriodMs(five, 30), five, '30 inverters × 288 calls = 8 640');
  const stretched = cloudPeriodMs(five, 40);
  assert.ok(stretched > five);
  assert.ok((40 * 24 * 60 * 60 * 1000) / stretched <= DAILY_BUDGET);
});
