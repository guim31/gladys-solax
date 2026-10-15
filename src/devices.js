// -----------------------------------------------------------------------------
// One Gladys device per inverter, and the states of a reading.
//
// External ids: `inverter:<serial>`, the inverter serial number, or a
// `reg-…` fingerprint of the dongle's registration number when the inverter's
// is not reported — never the registration number itself, which is the
// dongle's password (src/solax/identity.js). The same
// id whether the inverter is read locally or through SolaX Cloud: moving from
// one to the other keeps the device, its history and its scenes.
//
// The features follow what the model reads (src/solax/models.js), fixed when
// the inverter is first seen and kept in /data (src/store.js): a feature never
// disappears because a reading at night came back empty.
//
// Energy: the total production is an `energy-production-sensor/index`, the
// cumulative counter the Gladys 5.2 energy pipeline works from; the grid
// counters are `grid-sensor` indexes, never `energy-sensor` ones, so the
// inverter's meter is not counted a second time next to the household meter.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES, STATUS_LABELS } from './i18n.js';

export const DEVICE_TYPE = 'inverter';

// Feature keys: part of the external ids, permanent.
export const FEATURE = {
  PV_POWER: 'pv_power',
  PV_STRING: (n) => `pv${n}_power`,
  YIELD_TODAY: 'yield_today',
  YIELD_TOTAL: 'yield_total',
  AC_POWER: 'ac_power',
  GRID_POWER: 'grid_power',
  GRID_IMPORT_TOTAL: 'grid_import_total',
  GRID_EXPORT_TOTAL: 'grid_export_total',
  BATTERY_SOC: 'battery_soc',
  BATTERY_CHARGE_POWER: 'battery_charge_power',
  BATTERY_DISCHARGE_POWER: 'battery_discharge_power',
  BATTERY_TEMPERATURE: 'battery_temperature',
  BATTERY_CHARGE_TOTAL: 'battery_charge_total',
  BATTERY_DISCHARGE_TOTAL: 'battery_discharge_total',
  INVERTER_TEMPERATURE: 'inverter_temperature',
  STATUS: 'status',
  ONLINE: 'online',
};

// Cumulative counters: never published lower than the last value (a dongle
// rebooting answers zeros for a moment, and the energy pipeline would read a
// drop as a negative production).
export const INDEX_FEATURES = [
  FEATURE.YIELD_TOTAL,
  FEATURE.GRID_IMPORT_TOTAL,
  FEATURE.GRID_EXPORT_TOTAL,
  FEATURE.BATTERY_CHARGE_TOTAL,
  FEATURE.BATTERY_DISCHARGE_TOTAL,
];

const INDEX_MAX = 100000000;
const DEFAULT_MAX_POWER = 30000;

/**
 * What the device shows, from a first reading: kept in /data.
 * @param {object} reading a decoded reading
 */
export function capabilitiesOf(reading) {
  const has = (key) => reading[key] !== undefined;
  const battery = reading.battery ?? null;
  return {
    strings: reading.pv.length,
    acPower: has('acPower'),
    gridPower: has('gridPower'),
    gridImport: has('gridImportTotal'),
    gridExport: has('gridExportTotal'),
    inverterTemperature: has('inverterTemperature'),
    status: has('status'),
    battery: battery !== null,
    batteryTemperature: battery?.temperature !== undefined,
    batteryTotals: battery?.chargeTotal !== undefined && battery?.dischargeTotal !== undefined,
  };
}

/** Merge capabilities: what was shown once stays (a feature never vanishes). */
export function mergeCapabilities(previous, next) {
  if (!previous) {
    return next;
  }
  return Object.fromEntries(
    Object.keys({ ...previous, ...next }).map((key) => [
      key,
      key === 'strings'
        ? Math.max(previous.strings ?? 0, next.strings ?? 0)
        : Boolean(previous[key] || next[key]),
    ]),
  );
}

/** Bounds of the power features, from the rated power when the dongle tells it. */
export function maxPowerOf(inverter) {
  const rated = inverter.ratedPowerKw;
  if (typeof rated === 'number' && rated > 0) {
    // PV arrays are often oversized up to twice the AC rating.
    return Math.max(10000, Math.ceil(rated * 2) * 1000);
  }
  return DEFAULT_MAX_POWER;
}

export const deviceIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPE, serial);

/** The device name: model and the end of the serial number. */
export function deviceName(inverter) {
  return `SolaX ${inverter.modelName} ${inverter.serial.slice(-4)}`;
}

/**
 * The feature specs of an inverter, in display order.
 * @returns {Array<object>} `{ key, ...feature fields without external_id }`
 */
export function featureSpecs(inverter, language) {
  const names = NAMES[language] ?? NAMES.en;
  const caps = inverter.capabilities;
  const max = maxPowerOf(inverter);
  const sensor = (key, category, type, unit, min, maxValue, extra = {}) => ({
    key,
    name: names[key],
    category,
    type,
    unit,
    min,
    max: maxValue,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...extra,
  });
  const specs = [
    sensor(
      FEATURE.PV_POWER,
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.POWER,
      U.WATT,
      0,
      max,
    ),
  ];
  if (caps.strings > 1) {
    for (let n = 1; n <= caps.strings; n += 1) {
      specs.push({
        ...sensor(
          FEATURE.PV_STRING(n),
          C.ENERGY_PRODUCTION_SENSOR,
          T.ENERGY_PRODUCTION_SENSOR.POWER,
          U.WATT,
          0,
          max,
        ),
        name: names.pv_string_power(n),
      });
    }
  }
  specs.push(
    sensor(
      FEATURE.YIELD_TODAY,
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
      U.KILOWATT_HOUR,
      0,
      1000,
    ),
    sensor(
      FEATURE.YIELD_TOTAL,
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.INDEX,
      U.KILOWATT_HOUR,
      0,
      INDEX_MAX,
    ),
  );
  if (caps.acPower) {
    // Signed on the hybrids: negative while the battery charges from the grid.
    specs.push(sensor(FEATURE.AC_POWER, C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT, -max, max));
  }
  if (caps.gridPower) {
    specs.push(sensor(FEATURE.GRID_POWER, C.GRID_SENSOR, T.GRID_SENSOR.POWER, U.WATT, -max, max));
  }
  if (caps.gridImport) {
    specs.push(
      sensor(
        FEATURE.GRID_IMPORT_TOTAL,
        C.GRID_SENSOR,
        T.GRID_SENSOR.INPUT_INDEX,
        U.KILOWATT_HOUR,
        0,
        INDEX_MAX,
      ),
    );
  }
  if (caps.gridExport) {
    specs.push(
      sensor(
        FEATURE.GRID_EXPORT_TOTAL,
        C.GRID_SENSOR,
        T.GRID_SENSOR.OUTPUT_INDEX,
        U.KILOWATT_HOUR,
        0,
        INDEX_MAX,
      ),
    );
  }
  if (caps.battery) {
    specs.push(
      sensor(
        FEATURE.BATTERY_SOC,
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.BATTERY_LEVEL,
        U.PERCENT,
        0,
        100,
      ),
      sensor(
        FEATURE.BATTERY_CHARGE_POWER,
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.CHARGE_POWER,
        U.WATT,
        0,
        max,
      ),
      sensor(
        FEATURE.BATTERY_DISCHARGE_POWER,
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.DISCHARGE_POWER,
        U.WATT,
        0,
        max,
      ),
    );
    if (caps.batteryTemperature) {
      specs.push(
        sensor(
          FEATURE.BATTERY_TEMPERATURE,
          C.DEVICE_TEMPERATURE_SENSOR,
          T.SENSOR.DECIMAL,
          U.CELSIUS,
          -40,
          100,
        ),
      );
    }
    if (caps.batteryTotals) {
      specs.push(
        sensor(
          FEATURE.BATTERY_CHARGE_TOTAL,
          C.BATTERY_STORAGE,
          T.BATTERY_STORAGE.CHARGE_INDEX,
          U.KILOWATT_HOUR,
          0,
          INDEX_MAX,
        ),
        sensor(
          FEATURE.BATTERY_DISCHARGE_TOTAL,
          C.BATTERY_STORAGE,
          T.BATTERY_STORAGE.DISCHARGE_INDEX,
          U.KILOWATT_HOUR,
          0,
          INDEX_MAX,
        ),
      );
    }
  }
  if (caps.inverterTemperature) {
    specs.push(
      sensor(
        FEATURE.INVERTER_TEMPERATURE,
        C.DEVICE_TEMPERATURE_SENSOR,
        T.SENSOR.DECIMAL,
        U.CELSIUS,
        -40,
        120,
      ),
    );
  }
  if (caps.status) {
    // A text: min/max are NOT NULL in the core, 0/0 like Zigbee2MQTT.
    const status = sensor(FEATURE.STATUS, C.TEXT, T.TEXT.TEXT, undefined, 0, 0);
    delete status.unit;
    specs.push(status);
  }
  const online = sensor(FEATURE.ONLINE, C.INPUT, T.INPUT.BINARY, undefined, 0, 1);
  delete online.unit;
  specs.push(online);
  return specs;
}

/**
 * The Gladys device of an inverter.
 * @param {object} gladys
 * @param {object} inverter `{ serial, modelName, capabilities, source, ratedPowerKw }`
 * @param {string} language
 */
export function buildDevice(gladys, inverter, language) {
  const ids = deviceIds(gladys, inverter.serial);
  return {
    name: deviceName(inverter),
    external_id: ids.device,
    // The container reads the inverters on its own timer (src/poller.js); the
    // core's poll, once a minute, is a fallback it skips while the timer runs.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'MODEL', value: inverter.modelName },
      { name: 'SOURCE', value: inverter.source },
    ],
    features: featureSpecs(inverter, language).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of a reading: only the features of the device, only finite
 * values; the cumulative counters only when positive and not lower than the
 * last one published (`lastIndex`).
 * @param {object} gladys
 * @param {object} inverter
 * @param {object | null} reading null when the inverter does not answer
 * @param {object} options
 * @param {boolean} options.online
 * @param {string} options.language
 * @param {(key: string) => number | undefined} [options.lastIndex]
 */
export function statesOf(
  gladys,
  inverter,
  reading,
  { online, language, lastIndex = () => undefined },
) {
  const ids = deviceIds(gladys, inverter.serial);
  const keys = new Set(featureSpecs(inverter, language).map((spec) => spec.key));
  const states = [];
  const push = (key, value) => {
    if (!keys.has(key) || typeof value !== 'number' || !Number.isFinite(value)) {
      return;
    }
    if (INDEX_FEATURES.includes(key)) {
      const last = lastIndex(key);
      if (value <= 0 || (last !== undefined && value < last)) {
        return;
      }
    }
    states.push({ device_feature_external_id: ids.feature(key), state: value });
  };

  push(FEATURE.ONLINE, online ? 1 : 0);
  if (!reading) {
    return states;
  }
  push(FEATURE.PV_POWER, reading.pvPower);
  reading.pv.forEach((power, index) => push(FEATURE.PV_STRING(index + 1), power));
  push(FEATURE.YIELD_TODAY, reading.yieldToday);
  push(FEATURE.YIELD_TOTAL, reading.yieldTotal);
  push(FEATURE.AC_POWER, reading.acPower);
  push(FEATURE.GRID_POWER, reading.gridPower);
  push(FEATURE.GRID_IMPORT_TOTAL, reading.gridImportTotal);
  push(FEATURE.GRID_EXPORT_TOTAL, reading.gridExportTotal);
  const battery = reading.battery;
  if (battery) {
    push(FEATURE.BATTERY_SOC, battery.soc);
    if (typeof battery.power === 'number') {
      push(FEATURE.BATTERY_CHARGE_POWER, Math.max(battery.power, 0));
      push(FEATURE.BATTERY_DISCHARGE_POWER, Math.max(-battery.power, 0));
    }
    push(FEATURE.BATTERY_TEMPERATURE, battery.temperature);
    push(FEATURE.BATTERY_CHARGE_TOTAL, battery.chargeTotal);
    push(FEATURE.BATTERY_DISCHARGE_TOTAL, battery.dischargeTotal);
  }
  push(FEATURE.INVERTER_TEMPERATURE, reading.inverterTemperature);
  if (keys.has(FEATURE.STATUS) && reading.status) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.STATUS),
      text: statusLabel(reading.status, language),
    });
  }
  return states;
}

/** The label of an inverter state in a language. */
export function statusLabel(status, language) {
  const labels = STATUS_LABELS[language] ?? STATUS_LABELS.en;
  return labels[status] ?? labels.unknown;
}
