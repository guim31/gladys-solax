// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: one fake dongle per real answer published with the `solax`
// library (X-Hybrid, X1 and X3 of every generation, Boost, Mini, Smart,
// Hybrid G3/G4, MIC PRO G2, Ultra, Lite LV, Q.VOLT) plus a SolaX Cloud
// inverter — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURES, passwordOf } from './helpers/fakeDongle.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const inverterFixtures = Object.values(FIXTURES).filter((f) => f.library_model !== 'X3EVC');
const dongles = inverterFixtures.map((fixture) => ({ fixture, password: passwordOf(fixture) }));

for (const language of ['fr', 'en', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language} names)`, async (t) => {
    const world = await createWorld({ dongles, cloud: true, config: { language } });
    t.after(() => world.stop());
    const devices = world.fake.discoveredDevices;
    assert.equal(devices.length, inverterFixtures.length + 1, 'one device per inverter');

    const deviceIds = new Set();
    for (const device of devices) {
      const where = device.name;
      assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
      deviceIds.add(device.external_id);

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        if (feature.min < 0 && feature.unit === 'watt') {
          // A signed power on a gauge needs symmetric bounds.
          assert.equal(feature.min, -feature.max, `${at}: signed bounds must be symmetric`);
        }
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(feature.read_only, true, `${at}: the integration is read only`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
