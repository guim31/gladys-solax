// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEST_ACTION } from '../src/app.js';
import { CLOUD_INTERVALS, DEFAULT_CONFIG, LANGUAGES, LOCAL_INTERVALS } from '../src/config.js';
import { STATUS_TRIGGER } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { AUTO_MODEL, MODEL_KEYS, STATUS_KEYS } from '../src/solax/models.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.contact_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, local transport, energy category', () => {
  assert.equal(manifest.name, 'SolaX Power');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-solax:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-solax/main/cover.png',
  );
  // SolaX Cloud is an option for the dongles that do not answer locally.
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['energy']);
  for (const lang of ['en', 'fr', 'de', 'es']) {
    assert.ok(manifest.description[lang].length <= 100);
  }
});

test('the only manifest action is the connection test, handled by the code', () => {
  assert.deepEqual(keysOf(manifest.actions), [TEST_ACTION]);
  // The action has no field: nothing the core would refuse (no default is
  // applied to action fields, a secret field cannot be filled).
  assert.equal(manifest.actions[0].fields, undefined);
});

test('the select options are the values the code accepts', () => {
  const options = (key) =>
    manifest.config_schema.find((field) => field.key === key).options.map((o) => o.value);
  assert.deepEqual(options('model'), [AUTO_MODEL, ...MODEL_KEYS]);
  assert.deepEqual(options('local_interval'), LOCAL_INTERVALS);
  assert.deepEqual(options('cloud_interval'), CLOUD_INTERVALS);
  assert.deepEqual(options('language'), LANGUAGES);
  const trigger = manifest.scene_triggers.find((entry) => entry.key === STATUS_TRIGGER);
  assert.deepEqual(
    trigger.fields.find((field) => field.key === 'status').options.map((o) => o.value),
    STATUS_KEYS,
  );
});

test('every value of DEFAULT_CONFIG is a field of the form, the secrets have no default', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual([...keys].sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.equal(field.default, undefined, `secret "${field.key}" must not have a default`);
  }
});

test('the scene action outputs are the keys the handler returns', async () => {
  const action = manifest.scene_actions.find((entry) => entry.key === 'get_solar_summary');
  const hub = {
    gladys: { externalIds: (type, id) => ({ device: `ext:t:${type}:${id}` }) },
    config: { language: 'en' },
    inverters: () => [
      {
        serial: 'S1',
        online: true,
        capabilities: { gridPower: true, battery: true },
        reading: { pvPower: 1, yieldToday: 2, gridPower: 3, battery: { soc: 4 } },
      },
    ],
  };
  const outputs = await SCENE_ACTIONS.get_solar_summary(hub, {
    fields: { device: 'ext:t:inverter:S1' },
  });
  assert.deepEqual(Object.keys(outputs).sort(), keysOf(action.outputs).sort());
  for (const output of action.outputs) {
    assert.equal(typeof outputs[output.key], output.type, output.key);
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The store vocabulary itself is checked by the store validator (unknown
  // keys are dropped with a warning there) — what this test pins is the
  // coupling rule: older cores reject any unknown manifest field, so a
  // manifest declaring `categories` must not claim compatibility below the
  // first release that accepts it.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.ok(declared.length > 0);
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in scene_actions`);
  }
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key]?.get, 'function', `widget "${key}" has no content handler`);
  }
  for (const key of Object.keys(WIDGETS)) {
    assert.ok(declared.includes(key), `widget "${key}" is not declared in widgets`);
  }
});

test('the scene trigger the code fires is declared, with the keys of its event', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  assert.deepEqual(keysOf(manifest.scene_triggers), [STATUS_TRIGGER]);
  const trigger = manifest.scene_triggers[0];
  assert.deepEqual(keysOf(trigger.fields), ['device', 'status']);
  assert.deepEqual(keysOf(trigger.variables), ['status', 'previous_status', 'status_label']);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices', 'the only core-defined source in V1 is "devices"');
    assert.equal(
      field.options,
      undefined,
      `field "${field.key}": declaring source and options together rejects the manifest`,
    );
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  // A store rule (the catalog card is short): a longer text rejects the
  // manifest.
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  // Like `label` and `description`: a plain string rejects the manifest.
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
