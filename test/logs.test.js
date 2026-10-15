// -----------------------------------------------------------------------------
// Quiet logs: a normal reading cycle writes nothing at info; a failure that
// lasts is one warning, its end one info line; no password, token or full
// registration number ever reaches a log line, even in debug.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, deadHost, passwordOf } from './helpers/fakeDongle.js';
import { CLOUD_TOKEN } from './helpers/fakeCloud.js';
import { createAll, createWorld } from './helpers/world.js';
import { secretsOf } from '../src/config.js';

const G4 = FIXTURES.x3_hybrid_g4;

/** Capture what the SDK loggers write, at a given level. */
function captureLogs(t, level) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('a normal cycle writes nothing at info', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({
    dongles: [{ fixture: G4, password: passwordOf(G4) }],
    cloud: true,
  });
  t.after(() => world.stop());
  await createAll(world);
  assert.ok(
    lines.some((line) => line.includes('[INFO]')),
    'the start is logged',
  );
  lines.length = 0;
  for (let i = 0; i < 3; i += 1) {
    world.dongles[0].setRegisters({ 14: 100 * i, 15: 50 * i });
    await world.hub.cycle('local', { force: true });
    await world.hub.cycle('cloud', { force: true });
    await world.hub.updateConnectionStatus();
    await world.fake.widgetGet('solar_overview', { settings: {}, language: 'fr' });
  }
  assert.deepEqual(lines, []);
});

test('a failure that lasts: one warning, then one info line when it ends', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ dongles: [{ fixture: G4, password: passwordOf(G4) }] });
  t.after(() => world.stop());
  await createAll(world);
  lines.length = 0;
  const source = world.hub.config.local[0];
  const host = source.host;
  source.host = await deadHost();
  for (let i = 0; i < 4; i += 1) {
    await world.hub.cycle('local', { force: true });
  }
  assert.equal(lines.filter((line) => line.includes('[WARN]')).length, 1);
  source.host = host;
  await world.hub.cycle('local', { force: true });
  await world.hub.cycle('local', { force: true });
  const infos = lines.filter((line) => line.includes('[INFO]'));
  assert.equal(infos.length, 1);
  assert.match(infos[0], /answers again/);
});

test('no secret of the configuration in the logs, even in debug and on errors', async (t) => {
  const lines = captureLogs(t, 'debug');
  const password = passwordOf(G4);
  const world = await createWorld({
    dongles: [{ fixture: G4, password }],
    cloud: true,
  });
  t.after(() => world.stop());
  await createAll(world);
  const raw = world.fake.config;
  // Wrong password, wrong token, a dongle that does not answer.
  await world.fake.configUpdated({
    ...raw,
    passwords: 'WRONGPASS9',
    cloud_token: 'WRONG-TOKEN-0123456789',
    hosts: `${raw.hosts}, ${await deadHost()}`,
  });
  await world.fake.action('test_connection', {});
  await world.fake.configUpdated(raw);
  await world.fake.action('test_connection', {});

  const secrets = [
    ...secretsOf(raw),
    'WRONGPASS9',
    'WRONG-TOKEN-0123456789',
    CLOUD_TOKEN,
    password,
    'SCLOUD0001',
  ];
  assert.ok(lines.length > 10, 'debug logs were captured');
  for (const secret of secrets) {
    const leaks = lines.filter((line) => line.includes(secret));
    assert.deepEqual(leaks, [], `"${secret}" appears in the logs`);
  }
});
