// -----------------------------------------------------------------------------
// The `solar_overview` widget: valid for the SDK validator (the core's
// normalization and content budget), every bound feature exists on the
// device, and the empty states say what to do.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FIXTURES, passwordOf } from './helpers/fakeDongle.js';
import { createAll, createWorld } from './helpers/world.js';

const dongles = Object.values(FIXTURES)
  .filter((fixture) => fixture.library_model !== 'X3EVC')
  .map((fixture) => ({ fixture, password: passwordOf(fixture) }));

function boundFeatures(content) {
  return content.components.flatMap((component) => [
    ...(component.device_feature ? [component.device_feature] : []),
    ...(component.device_features ?? []),
  ]);
}

test('the widget of every model fits the budget and binds existing features', async (t) => {
  const world = await createWorld({ dongles, cloud: true });
  t.after(() => world.stop());
  await createAll(world);
  for (const device of world.fake.discoveredDevices) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await world.fake.widgetGet('solar_overview', {
        settings: { device: device.external_id },
        language,
      });
      assert.equal(ack.success, true);
      const content = ack.data.content;
      assert.deepEqual(validateWidgetContent(content), [], `${device.name} (${language})`);
      const ids = new Set(device.features.map((feature) => feature.external_id));
      for (const id of boundFeatures(content)) {
        assert.ok(ids.has(id), `${device.name}: the widget binds ${id}, not a feature`);
      }
      assert.ok(content.components.length <= 8);
    }
  }
});

test('a hybrid read through the cloud: tiles, curve, status rows', async (t) => {
  const world = await createWorld({ cloud: true, config: { language: 'fr' } });
  t.after(() => world.stop());
  const ack = await world.fake.widgetGet('solar_overview', { settings: {}, language: 'fr' });
  const content = ack.data.content;
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, ['text', 'value', 'value', 'value', 'gauge', 'value', 'chart', 'status']);
  assert.match(content.components[0].text, /SolaX X3-Hybrid G4 .* · Normal · via SolaX Cloud/);
  const rows = content.components.at(-1).items;
  assert.equal(rows[0].label, 'Réseau');
  assert.match(rows[0].value, /^Injection 830 W$/);
  assert.match(rows[1].value, /^Charge 640 W$/);
  assert.equal(rows[2].value, 'Normal');
});

test('the empty states: no inverter chosen, no reading yet', async (t) => {
  const world = await createWorld({ dongles: dongles.slice(0, 2), config: { language: 'de' } });
  t.after(() => world.stop());
  const pick = await world.fake.widgetGet('solar_overview', { settings: {}, language: 'de' });
  assert.match(pick.data.content.components[0].text, /Wähle in den Einstellungen/);
  const unknown = await world.fake.widgetGet('solar_overview', {
    settings: { device: 'ext:test-integration:inverter:NOPE' },
    language: 'es',
  });
  assert.match(unknown.data.content.components[0].text, /Elija un inversor SolaX/);
});
