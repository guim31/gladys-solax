// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `get_solar_summary`: the last reading of an inverter as scene variables, and
// a ready-made sentence in the language of the configuration — for "every
// evening at 21:00, send me today's production", without a single call to
// the dongle or to SolaX Cloud (the cloud quota stays for the polling).
// A scene action does not receive the user's language: the sentence follows
// the `language` field of the configuration.
//
// The trigger `inverter_status_changed` is fired by the hub (src/hub.js) on
// each change of the inverter state (normal, fault, backup...): a text state
// Gladys cannot trigger a scene on by itself.
// -----------------------------------------------------------------------------

import { deviceIds } from './devices.js';
import { TEXT, formatEnergy, formatPower } from './i18n.js';

export const SUMMARY_ACTION = 'get_solar_summary';

/** The sentence of a reading, in a language. */
export function summaryText(inverter, language) {
  const reading = inverter.reading;
  const parts = {
    pv: formatPower(reading.pvPower ?? 0, language),
    today: formatEnergy(reading.yieldToday ?? 0, language),
  };
  if (inverter.capabilities.gridPower && typeof reading.gridPower === 'number') {
    const grid = reading.gridPower;
    parts.grid =
      Math.abs(grid) < 30
        ? TEXT.balanced[language]
        : `${(grid < 0 ? TEXT.exporting : TEXT.importing)[language].toLowerCase()} ${formatPower(grid, language)}`;
  }
  if (inverter.capabilities.battery && typeof reading.battery?.soc === 'number') {
    parts.battery = `${Math.round(reading.battery.soc)} %`;
  }
  return TEXT.summary[language](parts);
}

export const SCENE_ACTIONS = {
  async [SUMMARY_ACTION](hub, { fields }) {
    const inverter = hub
      .inverters()
      .find((inv) => deviceIds(hub.gladys, inv.serial).device === fields?.device);
    if (!inverter) {
      throw new Error('Unknown SolaX inverter: choose one of the integration devices');
    }
    if (!inverter.reading) {
      throw new Error(TEXT.noReading.en);
    }
    const language = hub.config.language;
    const reading = inverter.reading;
    return {
      summary: summaryText(inverter, language),
      online: Boolean(inverter.online),
      pv_power: reading.pvPower ?? 0,
      yield_today: reading.yieldToday ?? 0,
      grid_power: typeof reading.gridPower === 'number' ? reading.gridPower : 0,
      battery_level: typeof reading.battery?.soc === 'number' ? reading.battery.soc : 0,
    };
  },
};
