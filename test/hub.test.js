// -----------------------------------------------------------------------------
// The integration end to end: fake Gladys (SDK), fake dongles over real HTTP
// on 127.0.0.1, fake SolaX Cloud. What a user sees: devices, states, the
// refresh without the core's poll, the night, a restart, the counters, the
// scene trigger, the scene action, the connection test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { FIXTURES, deadHost, passwordOf, startDongle } from './helpers/fakeDongle.js';
import { CLOUD_FIXTURE } from './helpers/fakeCloud.js';
import { createAll, createWorld, featureId } from './helpers/world.js';
import { HEARTBEAT_MS, STATUS_TRIGGER } from '../src/hub.js';
import { MemoryStore } from '../src/store.js';
import { u32 } from '../src/solax/models.js';

const G4 = FIXTURES.x3_hybrid_g4;
const G4_SERIAL = 'H34ATEST00044';
const g4Dongle = (extra = {}) => ({ fixture: G4, password: passwordOf(G4), ...extra });

async function until(check, { timeout = 3000, label = 'condition' } = {}) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await sleep(10);
  }
}

test('the states refresh on the container timer, without the core ever polling', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()], timers: true, periods: { local: 60 } });
  t.after(() => world.stop());
  await createAll(world);
  const pv = featureId(world.gladys, G4_SERIAL, 'pv_power');
  assert.equal(world.fake.lastState(pv), 103);

  // The sun comes out: the dongle answers new values; nobody calls onPoll.
  world.dongles[0].setRegisters({ 14: 2500, 15: 1800 });
  await until(() => world.fake.lastState(pv) === 4300, { label: 'the new PV power' });
  assert.equal(world.fake.lastState(featureId(world.gladys, G4_SERIAL, 'pv1_power')), 2500);
  const polls = world.fake.wsMessages.filter((m) => m.type === 'device.poll');
  assert.equal(polls.length, 0);
});

test("the core's poll is a fallback: skipped right after the timer read", async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()] });
  t.after(() => world.stop());
  await createAll(world);
  const before = world.dongles[0].requests.length;
  const [device] = world.fake.discoveredDevices;
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.equal(world.dongles[0].requests.length, before, 'no extra request to the dongle');
  // Past the period, the fallback reads.
  world.hub.lastPolledAt.set(world.hub.inverters()[0].sourceId, Date.now() - 60000);
  await world.fake.poll(device);
  assert.equal(world.dongles[0].requests.length, before + 1);
});

test('a device added in Gladys gets every state at once, then a widget refresh', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()] });
  t.after(() => world.stop());
  // Read before the device exists in Gladys: nothing published for it yet.
  assert.equal(world.fake.states.length, 0);
  const [device] = world.fake.discoveredDevices;
  const requests = world.dongles[0].requests.length;
  await world.fake.deviceCreated(device);
  const published = new Set(world.fake.states.map((s) => s.device_feature_external_id));
  for (const feature of device.features) {
    if (feature.external_id.endsWith(':grid_export_total')) {
      continue; // zero on this sample: a counter is never published at 0
    }
    assert.ok(published.has(feature.external_id), `${feature.name} not published`);
  }
  assert.equal(world.dongles[0].requests.length, requests, 'from the last reading, no new read');
  assert.ok(world.fake.widgetRefreshes.includes('solar_overview'));
  assert.equal(world.fake.lastState(featureId(world.gladys, G4_SERIAL, 'status')), 'Normal');
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('states are published through the deduplication, with a heartbeat of 12 h at most', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()], connect: false });
  t.after(() => world.stop());
  const calls = [];
  const original = world.gladys.publishChangedStates.bind(world.gladys);
  t.mock.method(world.gladys, 'publishChangedStates', (states, options) => {
    calls.push(options);
    return original(states, options);
  });
  await world.gladys.connect();
  await world.app.ready;
  await createAll(world);
  const count = world.fake.states.length;
  await world.hub.cycle('local', { force: true });
  assert.equal(world.fake.states.length, count, 'an unchanged reading publishes nothing');
  assert.ok(calls.length > 0);
  assert.ok(calls.every((options) => options.heartbeat === HEARTBEAT_MS));
  assert.ok(HEARTBEAT_MS <= 12 * 60 * 60 * 1000);
});

test('at night the dongle sleeps: offline, unreachable, then back in the morning', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()] });
  t.after(() => world.stop());
  await createAll(world);
  const online = featureId(world.gladys, G4_SERIAL, 'online');
  assert.equal(world.fake.lastState(online), 1);

  const host = world.dongles[0].host;
  await world.dongles[0].asleep();
  await world.hub.cycle('local', { force: true });
  assert.equal(world.fake.lastState(online), 0);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  // Still connected: an inverter asleep is not a broken integration.
  assert.equal(world.fake.connectionStatus.connected, true);

  // Morning: the dongle answers again on the same address.
  const port = Number(host.split(':')[1]);
  const morning = await startDongle(g4Dongle());
  t.after(() => morning.close());
  world.hub.config.local[0].host = morning.host;
  world.hub.config.local[0].id = `local:${host}`;
  assert.ok(port > 0);
  await world.hub.cycle('local', { force: true });
  assert.equal(world.fake.lastState(online), 1);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('a cumulative counter never goes back (a dongle rebooting answers zeros)', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()] });
  t.after(() => world.stop());
  await createAll(world);
  const total = featureId(world.gladys, G4_SERIAL, 'yield_total');
  const before = world.fake.lastState(total);
  assert.ok(before > 0);
  world.dongles[0].setRegisters({ 68: 0, 69: 0, 70: 0 });
  await world.hub.cycle('local', { force: true });
  assert.equal(world.fake.lastState(total), before);
  world.dongles[0].setRegisters({ 68: 1000, 69: 0 });
  await world.hub.cycle('local', { force: true });
  assert.equal(world.fake.lastState(total), u32(1000, 0) / 10);
});

test('a restart at night: the devices come back from /data with all their features', async (t) => {
  const store = new MemoryStore();
  const first = await createWorld({ dongles: [g4Dongle()], store });
  const device = first.fake.discoveredDevices[0];
  const host = first.dongles[0].host;
  await first.stop();
  await store.flush();

  const second = await createWorld({
    store,
    config: { hosts: host, passwords: passwordOf(G4) },
    devices: [device],
  });
  t.after(() => second.stop());
  assert.deepEqual(second.fake.discoveredDevices, [device]);
  assert.equal(second.fake.lastState(featureId(second.gladys, G4_SERIAL, 'online')), 0);
  assert.equal(second.fake.transports.at(-1).transport, 'unreachable');
});

test('an inverter read locally and through SolaX Cloud: one device, read locally', async (t) => {
  const cloudResult = { ...CLOUD_FIXTURE.result, inverterSN: G4_SERIAL };
  const world = await createWorld({
    dongles: [g4Dongle()],
    cloud: true,
    cloudOptions: { inverters: { SCLOUD0001: cloudResult } },
  });
  t.after(() => world.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  await createAll(world);
  const pv = featureId(world.gladys, G4_SERIAL, 'pv_power');
  await world.hub.cycle('cloud', { force: true });
  assert.equal(world.fake.lastState(pv), 103, 'the local value, not the cloud one');
});

test('SolaX Cloud: a device, stale data means offline', async (t) => {
  const world = await createWorld({ cloud: true });
  t.after(() => world.stop());
  await createAll(world);
  const serial = CLOUD_FIXTURE.result.inverterSN;
  assert.equal(world.fake.lastState(featureId(world.gladys, serial, 'grid_power')), -830);
  assert.equal(world.fake.transports.at(-1).transport, 'cloud');
  // An upload hours old: the last one before the dongle went quiet.
  world.cloud.inverters.SCLOUD0001 = {
    ...CLOUD_FIXTURE.result,
    utcDateTime: '2000-01-01T00:00:00Z',
    pinned: true,
  };
  await world.hub.cycle('cloud', { force: true });
  assert.equal(world.fake.lastState(featureId(world.gladys, serial, 'online')), 0);
});

test('the state changes: one scene event per transition, with the labels', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()] });
  t.after(() => world.stop());
  await createAll(world);
  assert.equal(world.fake.sceneEvents.length, 0, 'the first reading is not a transition');
  world.dongles[0].setRegisters({ 19: 3 });
  await world.hub.cycle('local', { force: true });
  await world.hub.cycle('local', { force: true });
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: STATUS_TRIGGER,
      data: {
        device: world.gladys.externalIds('inverter', G4_SERIAL).device,
        status: 'fault',
        previous_status: 'normal',
        status_label: 'Défaut',
      },
    },
  ]);
  assert.equal(world.fake.lastState(featureId(world.gladys, G4_SERIAL, 'status')), 'Défaut');
});

test('the scene action: the last reading and a sentence, without reading the dongle', async (t) => {
  const world = await createWorld({ cloud: true, config: { language: 'en' } });
  t.after(() => world.stop());
  const device = world.gladys.externalIds('inverter', CLOUD_FIXTURE.result.inverterSN).device;
  const calls = world.cloud.calls.length;
  const ack = await world.fake.sceneAction('get_solar_summary', { device });
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs ?? ack.data, {
    summary: 'Solar: 3.1 kW now, 12.4 kWh today. Grid: exporting 830 W. Battery: 86 %.',
    online: true,
    pv_power: 3120,
    yield_today: 12.4,
    grid_power: -830,
    battery_level: 86,
  });
  assert.equal(world.cloud.calls.length, calls);
  const unknown = await world.fake.sceneAction('get_solar_summary', { device: 'ext:x:y' });
  assert.equal(unknown.success, false);
});

test('an unknown model: a clear refusal in the connection test, the integration says so', async (t) => {
  const dongle = {
    fixture: G4,
    raw: JSON.stringify({ sn: 'SNEW000001', ver: '3.1', type: 77, Data: [1, 2, 3] }),
  };
  const world = await createWorld({ dongles: [dongle], config: { language: 'en' } });
  t.after(() => world.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /model not recognized.*type 77, 3/);
  assert.match(ack.data.message.fr, /modèle non reconnu/);
  assert.match(ack.data.message.de, /Modell nicht erkannt/);
  assert.match(ack.data.message.es, /modelo no reconocido/);
});

test('the connection test: per inverter, what answers and what does not', async (t) => {
  const host = await deadHost();
  const world = await createWorld({
    dongles: [g4Dongle()],
    config: { language: 'en' },
  });
  t.after(() => world.stop());
  world.hub.config.local.push({ id: `local:${host}`, host, password: '' });
  world.hub.config.invalidHosts.push('not an address');
  const ack = await world.fake.action('test_connection', {});
  const message = ack.data.message.en;
  assert.match(message, /X3-Hybrid G4 …0044 answers/);
  assert.match(message, new RegExp(`${host}: no answer`));
  assert.match(message, /Ignored addresses: not an address/);
});

test('not configured: the Configuration screen says what to enter', async (t) => {
  const world = await createWorld({ config: { hosts: '', passwords: '' } });
  t.after(() => world.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /adresse IP d'une clé SolaX/);
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Nothing to test/);
});

test('a new configuration: another dongle, its device published', async (t) => {
  const world = await createWorld({ dongles: [g4Dongle()] });
  t.after(() => world.stop());
  const other = await startDongle({ fixture: FIXTURES.x1_mini_g4 });
  t.after(() => other.close());
  await world.fake.configUpdated({
    hosts: `${world.dongles[0].host}, ${other.host}`,
    passwords: passwordOf(G4),
  });
  // One password for two dongles: both get it; the X1 Mini G4 here checks none.
  assert.equal(world.fake.discoveredDevices.length, 2);
});
