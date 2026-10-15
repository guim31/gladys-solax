// -----------------------------------------------------------------------------
// The SolaX inverter models the Pocket WiFi / LAN dongle answers for, and how
// to read their realtime array.
//
// The dongle answers `optType=ReadRealTimeData` with
// `{ sn, ver, type, Data: [...], Information: [...] }`: `Data` is a flat array
// of 16-bit registers whose meaning depends on the inverter model (and on the
// dongle firmware), `type` tells the model. This table is a port of the
// decoders of the `solax` Python library (squishykid/solax, MIT, used by the
// Home Assistant integration): same indexes, same scales, checked against the
// library's own fixtures and expected values in test/models.test.js.
//
// Differences with the library, on purpose:
//   - detection is deterministic (type, then data length), where the library
//     tries every decoder and keeps whichever answers first: type 4 (X1 Boost
//     and X1 Mini on firmware 2.034/3.006) and type 14 (X3 Hybrid G4 and the
//     Qcells Q.VOLT HYB-G3-3P rebrand) match two decoders there. One decoder
//     per type here, the one that reads the most from the published samples;
//   - the cumulative counters read two registers (low word first) wherever the
//     next register is the high word, also on the X1 Smart (the library reads
//     one register there and wraps past 6553.5 kWh);
//   - the X3 EVC is a charging station, not an inverter: refused with its own
//     message;
//   - only what the Gladys devices show is decoded: PV power per string,
//     production, AC power, grid exchange, battery, temperatures, state.
//
// Sign conventions of the decoded reading (the Gladys ones):
//   gridPower    import from the grid > 0, export (feed-in) < 0 — SolaX
//                publishes the feed-in power, positive when exporting;
//   batteryPower charging > 0, discharging < 0 — as SolaX publishes it.
// -----------------------------------------------------------------------------

/** Two's complement of a 16-bit register. */
export const signed16 = (value) => (value > 0x7fff ? value - 0x10000 : value);
/** Two's complement of a 32-bit value. */
export const signed32 = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
/** Two 16-bit registers, least significant first. */
export const u32 = (low, high) => low + high * 0x10000;

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// The run modes of the inverters that report one (index 19 of the G4
// generation, 21 of the X3 MIC PRO G2), and of SolaX Cloud (`inverterStatus`,
// the same codes plus 100). Keys are stored in scenes: permanent.
export const STATUS_KEYS = [
  'waiting',
  'checking',
  'normal',
  'fault',
  'permanent_fault',
  'updating',
  'eps_check',
  'eps',
  'self_test',
  'idle',
  'standby',
  'pv_wake_up_battery',
  'generator_check',
  'generator_run',
];
export const UNKNOWN_STATUS = 'unknown';

/** Status key of a run mode code (0-13), `unknown` for anything else. */
export function statusFromCode(code) {
  return Number.isInteger(code) && code >= 0 && code < STATUS_KEYS.length
    ? STATUS_KEYS[code]
    : UNKNOWN_STATUS;
}

// --- Decoders ----------------------------------------------------------------
// Each returns the reading of one realtime array. A key a model does not know
// is absent; a key present is a feature of the Gladys device.

/** First-generation X-Hybrid (GET /api/realTimeData.htm, `AL_SE`). */
function decodeXHybrid(d) {
  return {
    pv: [d[11], d[12]],
    acPower: d[6],
    inverterTemperature: d[7],
    yieldToday: d[8],
    yieldTotal: d[9],
    gridPower: -d[10],
    gridExportTotal: d[41],
    gridImportTotal: d[42],
    battery: { soc: d[17], power: d[15], temperature: d[16] },
  };
}

/** X1 / X3 with a string `type` (dongle firmware 2.x): G3 hybrids, MIC, Fit. */
function decodeLegacyString(d, { battery }) {
  const reading = {
    pv: [d[11], d[12]],
    acPower: d[6],
    inverterTemperature: d[7],
    yieldToday: d[8],
    yieldTotal: d[9],
    gridPower: -d[10],
    gridExportTotal: d[41],
    gridImportTotal: d[42],
  };
  if (battery) {
    reading.battery = { soc: d[21], power: d[15], temperature: d[16] };
  }
  return reading;
}

/** X1 Mini / Boost / Air Mini with a string `type` (69 values). */
function decodeX1MiniLegacy(d) {
  return {
    pv: [d[11], d[12]],
    acPower: d[6],
    inverterTemperature: d[7],
    yieldToday: d[8],
    yieldTotal: d[9],
    gridPower: -d[10],
    gridExportTotal: d[41],
    gridImportTotal: d[42],
  };
}

/** X1 Boost / Mini / Air Mini, type 4 (dongle 2.034, 3.006). */
function decodeX1Boost(d) {
  return {
    pv: [d[7], d[8]],
    acPower: d[2],
    inverterTemperature: d[39],
    yieldToday: d[13] / 10,
    yieldTotal: u32(d[11], d[12]) / 10,
    gridPower: -signed16(d[48]),
    gridExportTotal: u32(d[50], d[51]) / 100,
    gridImportTotal: u32(d[52], d[53]) / 100,
  };
}

/** X1 Mini G4, X1 Boost G4, types 18 and 22. */
function decodeX1G4(d) {
  return {
    pv: [d[13], d[14]],
    acPower: d[3],
    yieldToday: d[21] / 10,
    yieldTotal: u32(d[19], d[20]) / 10,
    gridPower: -signed32(u32(d[72], d[73])),
    gridExportTotal: u32(d[74], d[75]) / 100,
    gridImportTotal: u32(d[76], d[77]) / 100,
  };
}

/** X1 Hybrid G4, type 15. */
function decodeX1HybridG4(d) {
  return {
    pv: [d[8], d[9]],
    acPower: signed16(d[2]),
    inverterTemperature: d[26],
    yieldToday: d[13] / 10,
    yieldTotal: u32(d[11], d[12]) / 10,
    gridPower: -signed16(d[32]),
    gridExportTotal: u32(d[34], d[35]) / 100,
    gridImportTotal: u32(d[36], d[37]) / 100,
    battery: { soc: d[18], power: signed16(d[16]), temperature: signed16(d[17]) },
  };
}

/** X3 Hybrid G3 on dongle 2.034, type 5. */
function decodeX3HybridG3(d) {
  return {
    pv: [d[13], d[14]],
    acPower: signed16(d[181]),
    yieldToday: d[21] / 10,
    yieldTotal: u32(d[19], d[20]) / 10,
    gridPower: -signed16(d[65]),
    gridExportTotal: u32(d[67], d[68]) / 100,
    gridImportTotal: u32(d[69], d[70]) / 100,
    battery: {
      soc: d[28],
      power: signed16(d[26]),
      temperature: signed16(d[27]),
      chargeTotal: u32(d[87], d[88]) / 10,
      dischargeTotal: u32(d[30], d[31]) / 10,
    },
  };
}

/** X3 Hybrid G4 and Qcells Q.VOLT HYB-G3-3P, type 14. */
function decodeX3HybridG4(d) {
  return {
    pv: [d[14], d[15]],
    acPower: signed16(d[6]) + signed16(d[7]) + signed16(d[8]),
    inverterTemperature: signed16(d[54]),
    yieldToday: d[70] / 10,
    yieldTotal: u32(d[68], d[69]) / 10,
    gridPower: -signed32(u32(d[34], d[35])),
    gridExportTotal: u32(d[86], d[87]) / 100,
    gridImportTotal: u32(d[88], d[89]) / 100,
    battery: {
      soc: d[103],
      power: signed16(d[41]),
      temperature: signed16(d[105]),
      chargeTotal: u32(d[76], d[77]) / 10,
      dischargeTotal: u32(d[74], d[75]) / 10,
    },
    status: statusFromCode(d[19]),
  };
}

/** X3 Ultra, type 25: three strings, two battery inputs. */
function decodeX3Ultra(d) {
  return {
    pv: [d[14], d[15], d[131]],
    acPower: signed16(d[6]) + signed16(d[7]) + signed16(d[8]),
    inverterTemperature: signed16(d[54]),
    yieldToday: d[70] / 10,
    yieldTotal: u32(d[58], d[59]) / 10,
    gridPower: -signed32(u32(d[34], d[35])),
    gridExportTotal: u32(d[86], d[87]) / 100,
    gridImportTotal: u32(d[88], d[89]) / 100,
    battery: {
      soc: d[158],
      power: signed16(d[41]) + signed16(d[134]),
      temperature: signed16(d[105]),
      chargeTotal: u32(d[76], d[77]) / 10,
      dischargeTotal: u32(d[74], d[75]) / 10,
    },
    status: statusFromCode(d[19]),
  };
}

/** X3 MIC PRO G2, type 16: three strings, no battery. */
function decodeX3MicProG2(d) {
  return {
    pv: [d[15], d[16], d[17]],
    acPower: signed16(d[6]) + signed16(d[7]) + signed16(d[8]),
    yieldToday: d[24] / 10,
    yieldTotal: u32(d[22], d[23]) / 10,
    gridPower: -signed32(u32(d[72], d[73])),
    gridExportTotal: u32(d[74], d[75]) / 100,
    gridImportTotal: u32(d[76], d[77]) / 100,
    status: statusFromCode(d[21]),
  };
}

/** X1 Smart, type 8. */
function decodeX1Smart(d) {
  return {
    pv: [d[7], d[8]],
    acPower: d[2],
    inverterTemperature: d[39],
    yieldToday: d[13] / 10,
    yieldTotal: u32(d[11], d[12]) / 10,
    gridPower: -signed16(d[48]),
    gridExportTotal: u32(d[50], d[51]) / 100,
    gridImportTotal: u32(d[52], d[53]) / 100,
  };
}

/** X1 Lite LV (low-voltage hybrid), type 103: no export counter. */
function decodeX1LiteLV(d) {
  return {
    pv: [d[11], d[12], d[13]],
    acPower: signed16(d[2]),
    inverterTemperature: d[68] / 10,
    yieldToday: d[21] / 10,
    yieldTotal: u32(d[17], d[18]) / 10,
    gridPower: -signed16(d[32]) / 10,
    gridImportTotal: u32(d[36], d[37]) / 10,
    battery: { soc: d[75] / 10, power: signed16(d[25]) / 10, temperature: d[79] },
  };
}

// --- The table ----------------------------------------------------------------
// `key` is stored in the configuration (forced model): permanent. `size` is
// the accepted length of the realtime array, `endpoint` how the dongle is
// asked. `name` is shown in Gladys (device name, widget caption).

export const MODELS = [
  {
    key: 'x_hybrid',
    name: 'X-Hybrid',
    endpoint: 'legacy',
    size: [58, 68],
    matches: (r) => r.endpoint === 'legacy',
    decode: decodeXHybrid,
  },
  {
    key: 'x1_mini_g3',
    name: 'X1-Mini',
    size: [69, 69],
    matches: (r) => typeof r.type === 'string' && r.type.startsWith('X1-'),
    decode: decodeX1MiniLegacy,
  },
  {
    key: 'x1_g3',
    name: 'X1',
    size: [102, 107],
    matches: (r) => typeof r.type === 'string' && r.type.startsWith('X1-'),
    decode: (d, r) => decodeLegacyString(d, { battery: isHybridName(r?.type) }),
  },
  {
    key: 'x3_g3',
    name: 'X3',
    size: [102, 107],
    matches: (r) => typeof r.type === 'string' && r.type.startsWith('X3-'),
    decode: (d, r) => decodeLegacyString(d, { battery: isHybridName(r?.type) }),
  },
  {
    key: 'x1_boost',
    name: 'X1-Boost / Mini',
    size: [69, 200],
    matches: (r) => r.type === 4,
    decode: decodeX1Boost,
  },
  {
    key: 'x3_hybrid_g3',
    name: 'X3-Hybrid G3',
    size: [200, 200],
    matches: (r) => r.type === 5,
    decode: decodeX3HybridG3,
  },
  {
    key: 'x1_smart',
    name: 'X1-Smart',
    size: [100, 200],
    matches: (r) => r.type === 8,
    decode: decodeX1Smart,
  },
  {
    key: 'x3_hybrid_g4',
    name: 'X3-Hybrid G4',
    size: [200, 300],
    matches: (r) => r.type === 14,
    decode: decodeX3HybridG4,
  },
  {
    key: 'x1_hybrid_g4',
    name: 'X1-Hybrid G4',
    size: [200, 300],
    matches: (r) => r.type === 15,
    decode: decodeX1HybridG4,
  },
  {
    key: 'x3_mic_pro_g2',
    name: 'X3-MIC PRO G2',
    size: [100, 100],
    matches: (r) => r.type === 16,
    decode: decodeX3MicProG2,
  },
  {
    key: 'x1_g4',
    name: 'X1-Boost / Mini G4',
    size: [100, 100],
    matches: (r) => r.type === 18 || r.type === 22,
    decode: decodeX1G4,
  },
  {
    key: 'x3_ultra',
    name: 'X3-Ultra',
    size: [300, 300],
    matches: (r) => r.type === 25,
    decode: decodeX3Ultra,
  },
  {
    key: 'x1_lite_lv',
    name: 'X1-Lite LV',
    size: [200, 300],
    matches: (r) => r.type === 103,
    decode: decodeX1LiteLV,
  },
];

export const MODEL_KEYS = MODELS.map((model) => model.key);
export const AUTO_MODEL = 'auto';

// Types the dongle reports for a device that is not an inverter.
const NOT_AN_INVERTER = { 1: 'X3-EVC charging station' };

/** The string types of the G3 hybrids ("X1-Hybiyd-G3", sic, on real dongles). */
function isHybridName(type) {
  return typeof type === 'string' && /hyb/i.test(type);
}

/** A model the response is not from, with what makes it unknown. */
export class UnsupportedModelError extends Error {
  /**
   * @param {string} message
   * @param {{ type: unknown, size: number, reason: 'not_inverter' | 'unknown_type' | 'size' }} details
   */
  constructor(message, details) {
    super(message);
    this.name = 'UnsupportedModelError';
    this.details = details;
  }
}

export const findModel = (key) => MODELS.find((model) => model.key === key);

/**
 * The model of a parsed dongle response.
 * @param {{ type: unknown, data: number[], endpoint: string }} response
 * @param {string} [forced] a model key the user chose, or 'auto'
 * @throws {UnsupportedModelError}
 */
export function detectModel(response, forced = AUTO_MODEL) {
  const size = response.data.length;
  if (forced && forced !== AUTO_MODEL) {
    const model = findModel(forced);
    if (model && size >= model.size[0]) {
      return model;
    }
    throw new UnsupportedModelError(
      `the dongle answers ${size} values, too few for the model ${model?.name ?? forced} chosen in the configuration`,
      { type: response.type, size, reason: 'size' },
    );
  }
  if (NOT_AN_INVERTER[response.type]) {
    throw new UnsupportedModelError(
      `this device is a ${NOT_AN_INVERTER[response.type]}, not an inverter`,
      { type: response.type, size, reason: 'not_inverter' },
    );
  }
  const candidates = MODELS.filter((model) => model.matches(response));
  const model = candidates.find((m) => size >= m.size[0] && size <= m.size[1]);
  if (model) {
    return model;
  }
  if (candidates.length > 0) {
    throw new UnsupportedModelError(
      `inverter type ${JSON.stringify(response.type)} answers ${size} values, a layout not known yet`,
      { type: response.type, size, reason: 'size' },
    );
  }
  throw new UnsupportedModelError(
    `inverter type ${JSON.stringify(response.type)} is not known yet`,
    { type: response.type, size, reason: 'unknown_type' },
  );
}

/**
 * Decode a realtime array with a model, rounded and cleaned: non-finite
 * values become null, the PV power total is added.
 * @returns {object} the reading (see the sign conventions at the top)
 */
export function decodeReading(model, response) {
  const raw = model.decode(response.data, response);
  const reading = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'pv') {
      reading.pv = value.map((power) => clean(power, 0));
    } else if (key === 'battery') {
      reading.battery = Object.fromEntries(
        Object.entries(value).map(([name, v]) => [name, clean(v, 2)]),
      );
    } else if (key === 'status') {
      reading.status = value;
    } else {
      reading[key] = clean(value, 2);
    }
  }
  reading.pvPower = reading.pv.reduce((sum, power) => sum + (power ?? 0), 0);
  return reading;
}

function clean(value, digits) {
  return typeof value === 'number' && Number.isFinite(value) ? round(value, digits) : null;
}
