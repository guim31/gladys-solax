// -----------------------------------------------------------------------------
// The dongle's registration number is its local password and the `sn` the
// SolaX Cloud token is used with: it must never reach what Gladys stores or
// shows (devices, feature ids, states, statuses, widget, scene events), the
// logs, nor /data. When the inverter serial number is not reported, the
// device id is a fingerprint of the registration number, the same locally and
// through the cloud.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from './helpers/fakeDongle.js';
import { CLOUD_FIXTURE } from './helpers/fakeCloud.js';
import { createAll, createWorld } from './helpers/world.js';
import { secretsOf } from '../src/config.js';
import { platformIdOf, registrationId } from '../src/solax/identity.js';

const LOCAL_AND_CLOUD = 'SREGTEST01';
const CLOUD_ONLY = 'SREGTEST02';

/** An X1 Boost dongle that reports no inverter serial (Information[2] is its own sn). */
function dongleWithoutInverterSerial(registration) {
  const fixture = structuredClone(FIXTURES.x1_boost);
  fixture.response.sn = registration;
  fixture.response.Information[2] = registration;
  return { fixture, password: registration };
}

const cloudResult = (registration) => ({
  ...CLOUD_FIXTURE.result,
  sn: registration,
  inverterSN: null,
});

function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('the fingerprint: stable, non-reversible, case-insensitive', () => {
  const id = registrationId(LOCAL_AND_CLOUD);
  assert.match(id, /^reg-[0-9a-f]{12}$/);
  assert.equal(registrationId(` ${LOCAL_AND_CLOUD.toLowerCase()} `), id);
  assert.notEqual(registrationId(CLOUD_ONLY), id);
  assert.ok(!id.includes(LOCAL_AND_CLOUD));
  assert.equal(platformIdOf('H34ATEST00044', LOCAL_AND_CLOUD), 'H34ATEST00044');
  assert.equal(platformIdOf(LOCAL_AND_CLOUD, LOCAL_AND_CLOUD), id);
  assert.equal(
    platformIdOf('PASSWORD99', 'SOTHER0001', ['password99']),
    registrationId('SOTHER0001'),
  );
  assert.equal(platformIdOf(null, null), null);
});

test('no registration number in any device, state, status, widget, log or /data', async (t) => {
  const lines = captureLogs(t);
  const xhybrid = FIXTURES.xhybrid_de02; // no Information at all: only its sn
  const world = await createWorld({
    dongles: [dongleWithoutInverterSerial(LOCAL_AND_CLOUD), { fixture: xhybrid }],
    cloud: true,
    cloudOptions: {
      inverters: {
        [LOCAL_AND_CLOUD]: cloudResult(LOCAL_AND_CLOUD),
        [CLOUD_ONLY]: cloudResult(CLOUD_ONLY),
      },
    },
  });
  t.after(() => world.stop());
  await createAll(world);
  // A state change fires a scene event; the widget and the action are read.
  world.cloud.inverters[CLOUD_ONLY] = { ...cloudResult(CLOUD_ONLY), inverterStatus: '103' };
  await world.hub.cycle('cloud', { force: true });
  const widgets = [];
  for (const device of world.fake.discoveredDevices) {
    widgets.push(
      await world.fake.widgetGet('solar_overview', {
        settings: { device: device.external_id },
        language: 'en',
      }),
    );
    widgets.push(await world.fake.sceneAction('get_solar_summary', { device: device.external_id }));
  }
  const report = await world.fake.action('test_connection', {});
  await world.store.flush();

  // The same inverter locally and through the cloud: one device, by fingerprint.
  const ids = world.fake.discoveredDevices.map((device) => device.external_id).sort();
  assert.deepEqual(
    ids,
    [
      world.gladys.externalIds('inverter', registrationId(LOCAL_AND_CLOUD)).device,
      world.gladys.externalIds('inverter', registrationId(CLOUD_ONLY)).device,
      world.gladys.externalIds('inverter', registrationId('TEST00002')).device,
    ].sort(),
  );
  assert.ok(world.fake.sceneEvents.length > 0, 'a scene event was fired');

  const registrations = [LOCAL_AND_CLOUD, CLOUD_ONLY, 'TEST00002', ...secretsOf(world.fake.config)];
  const published = JSON.stringify({
    devices: world.fake.discoveredDevices,
    gladysDevices: world.fake.devices,
    states: world.fake.states,
    transports: world.fake.transports,
    statuses: world.fake.connectionStatuses,
    scenes: world.fake.sceneEvents,
    widgets,
    report,
  });
  const data = JSON.stringify(world.store.data);
  assert.ok(lines.length > 10, 'debug logs were captured');
  for (const secret of registrations) {
    assert.ok(!published.includes(secret), `"${secret}" is published to Gladys`);
    assert.ok(!data.includes(secret), `"${secret}" is written to /data`);
    const leaks = lines.filter((line) => line.includes(secret));
    assert.deepEqual(leaks, [], `"${secret}" appears in the logs`);
  }
});
