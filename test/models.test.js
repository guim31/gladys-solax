// -----------------------------------------------------------------------------
// The model table against the real dongle answers published with the `solax`
// library (test/fixtures/solax, MIT): every sample is recognized as the right
// model, and every value the Gladys devices show equals the value the library
// decodes from the same sample (its `library_values`) — same registers, same
// scales, same signs. The few deliberate differences are tested on their own.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from './helpers/fakeDongle.js';
import { parseResponse } from '../src/solax/local.js';
import {
  MODELS,
  UnsupportedModelError,
  decodeReading,
  detectModel,
  findModel,
  signed16,
  signed32,
  statusFromCode,
  u32,
} from '../src/solax/models.js';

// Library decoder → the model of this table.
const EXPECTED_MODEL = {
  XHybrid: 'x_hybrid',
  X1Mini: 'x1_mini_g3',
  X1: 'x1_g3',
  X3: 'x3_g3',
  X1MiniV34: 'x1_boost',
  X1Boost: 'x1_boost',
  X3V34: 'x3_hybrid_g3',
  X1Smart: 'x1_smart',
  X3HybridG4: 'x3_hybrid_g4',
  QVOLTHYBG33P: 'x3_hybrid_g4',
  X1HybridGen4: 'x1_hybrid_g4',
  X3MicProG2: 'x3_mic_pro_g2',
  X1G4Series: 'x1_g4',
  X3Ultra: 'x3_ultra',
  X1LiteLV: 'x1_lite_lv',
};

const neg = (name) => (v) => -v[name];
const sum =
  (...names) =>
  (v) =>
    names.reduce((total, name) => total + v[name], 0);
const RUN_MODES = {
  Waiting: 'waiting',
  Wait: 'waiting',
  Checking: 'checking',
  Check: 'checking',
  Normal: 'normal',
  Fault: 'fault',
  'Permanent Fault': 'permanent_fault',
  Updating: 'updating',
  Update: 'updating',
  'EPS Check': 'eps_check',
  'EPS Mode': 'eps',
  'Self Test': 'self_test',
  Idle: 'idle',
  Standby: 'standby',
};
const runMode = (name) => (v) => RUN_MODES[v[name]];

// Reading path → library sensor name (or a function of the library values).
const LEGACY = {
  'pv.0': 'PV1 Power',
  'pv.1': 'PV2 Power',
  inverterTemperature: 'Inverter Temperature',
  yieldToday: "Today's Energy",
  yieldTotal: 'Total Energy',
  gridPower: neg('Exported Power'),
  gridExportTotal: 'Total Feed-in Energy',
  gridImportTotal: 'Total Consumption',
};
const BATTERY_LEGACY = {
  'battery.soc': 'Battery Remaining Capacity',
  'battery.power': 'Battery Power',
  'battery.temperature': 'Battery Temperature',
};
const MAPPINGS = {
  XHybrid: {
    ...LEGACY,
    ...BATTERY_LEGACY,
    acPower: 'Power Now',
    gridExportTotal: 'Grid Exported Energy',
    gridImportTotal: 'Grid Imported Energy',
  },
  X1: { ...LEGACY, acPower: 'AC Power' },
  X3: { ...LEGACY, acPower: 'AC Power' },
  X1Mini: { ...LEGACY, acPower: 'AC Power' },
  // Decoded with the X1 Boost table: the registers both tables agree on.
  X1MiniV34: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    acPower: 'AC Power',
    yieldToday: "Today's Energy",
    yieldTotal: 'Total Energy',
  },
  X1Boost: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    acPower: 'AC Output Power',
    inverterTemperature: 'Inverter Temperature',
    yieldToday: "Today's Generated Energy",
    yieldTotal: 'Total Generated Energy',
    gridPower: neg('Exported Power'),
    gridExportTotal: 'Total Export Energy',
    gridImportTotal: 'Total Import Energy',
  },
  X1Smart: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    acPower: 'AC Power',
    inverterTemperature: 'Inverter Temperature',
    yieldToday: "Today's Energy",
    gridPower: neg('Exported Power'),
  },
  X1G4Series: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    acPower: 'AC Output Power',
    yieldToday: "Today's Generated Energy",
    yieldTotal: 'Total Generated Energy',
    gridPower: neg('Exported Power'),
    gridExportTotal: 'Total Export Energy',
    gridImportTotal: 'Total Import Energy',
  },
  X1HybridGen4: {
    'pv.0': 'PV1 power',
    'pv.1': 'PV2 power',
    acPower: 'AC power',
    inverterTemperature: 'Inverter Temperature',
    yieldToday: 'On-grid daily yield',
    yieldTotal: 'On-grid total yield',
    gridPower: neg('Grid power'),
    gridExportTotal: 'Total feed-in energy',
    gridImportTotal: 'Total consumption',
    'battery.soc': 'Battery SoC',
    'battery.power': 'Battery power',
    'battery.temperature': 'Battery temperature',
  },
  X3V34: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    acPower: 'AC Power',
    yieldToday: "Today's Energy",
    yieldTotal: 'Total Energy',
    gridPower: neg('Exported Power'),
    gridExportTotal: 'Total Feed-in Energy',
    gridImportTotal: 'Total Consumption',
    ...BATTERY_LEGACY,
    'battery.soc': 'Battery Remaining Capacity',
    'battery.chargeTotal': 'Total Battery Charge Energy',
    'battery.dischargeTotal': 'Total Battery Discharge Energy',
  },
  X3HybridG4: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    acPower: sum('Grid 1 Power', 'Grid 2 Power', 'Grid 3 Power'),
    inverterTemperature: 'Radiator Temperature',
    yieldToday: 'Yield today',
    yieldTotal: 'Yield total',
    gridPower: neg('Grid Power'),
    gridExportTotal: 'Feed-in Energy total',
    gridImportTotal: 'Consumed Energy total',
    'battery.soc': 'Battery Remaining Capacity',
    'battery.power': 'Battery Power',
    'battery.temperature': 'Battery Temperature',
    'battery.chargeTotal': 'Battery Charge Energy total',
    'battery.dischargeTotal': 'Battery Discharge Energy total',
    status: runMode('Run mode text'),
  },
  QVOLTHYBG33P: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    yieldTotal: 'Total Energy',
    gridPower: neg('Exported Power'),
    gridExportTotal: 'Total Feed-in Energy',
    gridImportTotal: 'Total Consumption',
    'battery.soc': 'Battery Remaining Capacity',
    'battery.power': 'Battery Power',
    'battery.temperature': 'Battery Temperature',
    'battery.chargeTotal': 'Total Battery Charge Energy',
    'battery.dischargeTotal': 'Total Battery Discharge Energy',
  },
  X3Ultra: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    'pv.2': 'PV3 Power',
    acPower: sum('Grid 1 Power', 'Grid 2 Power', 'Grid 3 Power'),
    inverterTemperature: 'Radiator Temperature',
    yieldToday: 'Yield today',
    yieldTotal: 'Yield total',
    gridPower: neg('Grid Power'),
    gridExportTotal: 'Feed-in Energy total',
    gridImportTotal: 'Grid Consumed Energy total',
    'battery.soc': 'Battery Remaining Capacity',
    'battery.power': sum('Battery 1 Power', 'Battery 2 Power'),
    'battery.temperature': 'Battery 1 Temperature',
    'battery.chargeTotal': 'Battery Charge Energy total',
    'battery.dischargeTotal': 'Battery Discharge Energy total',
    status: runMode('Run mode text'),
  },
  X3MicProG2: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    'pv.2': 'PV3 Power',
    acPower: sum('Grid 1 Power', 'Grid 2 Power', 'Grid 3 Power'),
    yieldToday: 'Daily Yield',
    yieldTotal: 'Total Yield',
    gridPower: neg('Feed-in Power'),
    gridExportTotal: 'Total Feed-in Energy',
    gridImportTotal: 'Total Consumption',
    status: runMode('Run Mode'),
  },
  X1LiteLV: {
    'pv.0': 'PV1 Power',
    'pv.1': 'PV2 Power',
    'pv.2': 'PV3 Power',
    acPower: 'AC Power',
    inverterTemperature: 'Inverter Temperature',
    yieldToday: 'Daily Inverter Output',
    yieldTotal: 'Total Inverter Output',
    gridPower: neg('Grid Power'),
    gridImportTotal: 'Total Imported Energy',
    'battery.soc': 'Battery SoC',
    'battery.power': 'Total Battery power',
    'battery.temperature': 'Battery Temperature',
  },
};

const at = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const close = (a, b) => Math.abs(a - b) < 1e-6;

const inverterFixtures = Object.entries(FIXTURES).filter(
  ([, fixture]) => fixture.library_model !== 'X3EVC',
);

for (const [name, fixture] of inverterFixtures) {
  test(`${name}: recognized as ${EXPECTED_MODEL[fixture.library_model]}, values as the library decodes them`, () => {
    const endpoint = fixture.request.method === 'GET' ? 'legacy' : 'post';
    const response = parseResponse(JSON.stringify(fixture.response), endpoint);
    const model = detectModel(response);
    assert.equal(model.key, EXPECTED_MODEL[fixture.library_model]);

    const reading = decodeReading(model, response);
    const mapping = MAPPINGS[fixture.library_model];
    assert.ok(mapping, `no mapping for ${fixture.library_model}`);
    for (const [path, source] of Object.entries(mapping)) {
      const expected =
        typeof source === 'function'
          ? source(fixture.library_values)
          : fixture.library_values[source];
      assert.notEqual(expected, undefined, `${name}: library value for ${path} missing`);
      const actual = at(reading, path);
      if (typeof expected === 'string') {
        assert.equal(actual, expected, `${name}: ${path}`);
      } else {
        assert.ok(
          close(actual, expected),
          `${name}: ${path} is ${actual}, the library reads ${expected}`,
        );
      }
    }
    assert.equal(
      reading.pvPower,
      reading.pv.reduce((total, power) => total + power, 0),
    );
  });
}

test('the X1 Smart counters read their high word, where the library wraps at 6553.5 kWh', () => {
  const fixture = FIXTURES.x1_smart_fw_v3;
  const response = parseResponse(JSON.stringify(fixture.response));
  const reading = decodeReading(detectModel(response), response);
  const d = response.data;
  assert.equal(d[12], 2, 'this sample has a high word');
  assert.equal(reading.yieldTotal, u32(d[11], d[12]) / 10);
  assert.ok(reading.yieldTotal > fixture.library_values['Total Energy']);
  assert.equal(reading.gridExportTotal, u32(d[50], d[51]) / 100);
});

test('the G3 string types: a battery for the hybrids only', () => {
  const read = (name) => {
    const response = parseResponse(JSON.stringify(FIXTURES[name].response));
    return decodeReading(detectModel(response), response);
  };
  assert.ok(read('x1_hybrid_g3').battery, 'X1-Hybiyd-G3 has a battery');
  assert.ok(read('x3_hybrid_g3_2x_mppt').battery, 'X3-Hybiyd-G3 has a battery');
  assert.equal(read('x3_mic').battery, undefined, 'the X3-MIC is a grid inverter');
  assert.equal(read('x1_boost_air_mini').battery, undefined);
});

test('an unknown inverter type is refused with a clear message', () => {
  const response = parseResponse(
    JSON.stringify({
      sn: 'SNEW000001',
      ver: '3.010.01',
      type: 42,
      Data: [1, 2, 3, ...Array(97).fill(0)],
    }),
  );
  assert.throws(
    () => detectModel(response),
    (err) =>
      err instanceof UnsupportedModelError &&
      err.details.reason === 'unknown_type' &&
      err.details.type === 42 &&
      err.details.size === 100 &&
      /inverter type 42 is not known yet/.test(err.message),
  );
});

test('a known type with an unknown layout is refused, and says why', () => {
  const response = parseResponse(
    JSON.stringify({
      sn: 'SNEW000001',
      ver: '3.010.01',
      type: 16,
      Data: [1, ...Array(149).fill(0)],
    }),
  );
  assert.throws(
    () => detectModel(response),
    (err) => err.details.reason === 'size' && /answers 150 values/.test(err.message),
  );
});

test('the X3 EVC charging station is not an inverter', () => {
  const response = parseResponse(JSON.stringify(FIXTURES.x3_evc.response));
  assert.throws(
    () => detectModel(response),
    (err) => err.details.reason === 'not_inverter' && /charging station/.test(err.message),
  );
});

test('a model forced in the configuration is used when the array is long enough', () => {
  const response = parseResponse(JSON.stringify(FIXTURES.x1_boost.response));
  assert.equal(detectModel(response, 'x1_smart').key, 'x1_smart');
  assert.throws(() => detectModel(response, 'x3_ultra'), /too few for the model X3-Ultra/);
  assert.equal(detectModel(response, 'auto').key, 'x1_boost');
});

test('every decoder reads within the smallest array it accepts', () => {
  for (const model of MODELS) {
    const reading = decodeReading(model, {
      data: Array(model.size[0]).fill(1),
      type: 'X1-Hybrid',
    });
    for (const [key, value] of Object.entries(reading)) {
      if (key === 'pv') {
        assert.ok(
          value.every((v) => v !== null),
          `${model.key}: a PV string reads past the end`,
        );
      } else if (key === 'battery') {
        assert.ok(
          Object.values(value).every((v) => v !== null),
          `${model.key}: battery`,
        );
      } else if (key !== 'status') {
        assert.notEqual(value, null, `${model.key}: ${key} reads past the end`);
      }
    }
  }
});

test('the register helpers', () => {
  assert.equal(signed16(65535), -1);
  assert.equal(signed16(32767), 32767);
  assert.equal(signed32(u32(65384, 65535)), -152);
  assert.equal(u32(1, 2), 131073);
  assert.equal(statusFromCode(2), 'normal');
  assert.equal(statusFromCode(99), 'unknown');
  assert.equal(findModel('nope'), undefined);
});
