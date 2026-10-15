// -----------------------------------------------------------------------------
// What the configuration form sends, normalized: addresses, passwords in the
// order of the addresses, cloud serials, intervals, language.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, secretsOf } from '../src/config.js';
import { Store } from '../src/store.js';

test('the defaults: nothing configured, French, 30 s locally, 5 min in the cloud', () => {
  const config = normalizeConfig();
  assert.equal(isConfigured(config), false);
  assert.equal(config.language, 'fr');
  assert.equal(config.localIntervalMs, 30000);
  assert.equal(config.cloudIntervalMs, 300000);
  assert.equal(config.model, 'auto');
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('addresses and passwords: one password per address, or one for all', () => {
  const each = normalizeConfig({
    hosts: '192.0.2.10, 192.0.2.11;192.0.2.12',
    passwords: 'SA00000001,SA00000002',
  });
  assert.deepEqual(
    each.local.map(({ host, password }) => [host, password]),
    [
      ['192.0.2.10', 'SA00000001'],
      ['192.0.2.11', 'SA00000002'],
      ['192.0.2.12', ''],
    ],
  );
  const one = normalizeConfig({ hosts: '192.0.2.10 192.0.2.11', passwords: 'SA00000001' });
  assert.deepEqual(
    one.local.map((entry) => entry.password),
    ['SA00000001', 'SA00000001'],
  );
  const invalid = normalizeConfig({ hosts: '192.0.2.10, user:pw@192.0.2.9, 192.0.2.10' });
  assert.equal(invalid.local.length, 1, 'a duplicate is read once');
  assert.deepEqual(invalid.invalidHosts, ['user:pw@192.0.2.9']);
});

test('the cloud: only with a token, serials upper-cased and checked', () => {
  assert.deepEqual(normalizeConfig({ cloud_serials: 'SABC123456' }).cloud, []);
  const config = normalizeConfig({
    cloud_token: ' token ',
    cloud_serials: 'sabc123456, SABC123456, x',
  });
  assert.equal(config.cloudToken, 'token');
  assert.deepEqual(
    config.cloud.map((entry) => entry.serial),
    ['SABC123456'],
  );
  assert.equal(isConfigured(config), true);
});

test('unknown values fall back to the defaults', () => {
  const config = normalizeConfig({
    local_interval: '1',
    cloud_interval: 1,
    language: 'it',
    model: 'x9',
  });
  assert.equal(config.localIntervalMs, 30000);
  assert.equal(config.cloudIntervalMs, 300000);
  assert.equal(config.language, 'fr');
  assert.equal(config.model, 'auto');
  assert.equal(normalizeConfig({ cloud_interval: '15' }).cloudIntervalMs, 900000);
});

test('the secrets of a configuration', () => {
  assert.deepEqual(secretsOf({ passwords: 'SA00000001, SA00000002', cloud_token: 'tok-123' }), [
    'SA00000001',
    'SA00000002',
    'tok-123',
  ]);
});

test('the store writes atomically under its directory, and reads it back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gladys-solax-'));
  const store = new Store(directory);
  assert.deepEqual(await store.load(), {});
  store.save({ version: 1, sources: { a: 1 } });
  store.save({ version: 1, sources: { a: 2 } });
  await store.flush();
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'solax-state.json'), 'utf8')), {
    version: 1,
    sources: { a: 2 },
  });
  assert.deepEqual(await new Store(directory).load(), { version: 1, sources: { a: 2 } });
});
