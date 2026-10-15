// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `solar_overview`.
//
// One inverter at a glance: production now and today, the grid exchange and
// the battery as live tiles (bound to the device features: they move the
// instant a state is published), the 24 h curve of production and grid from
// the history Gladys keeps, and a short list of what is happening (exporting
// or importing, charging or discharging, inverter state, last reading).
//
// Budget (8 components, 2 texts, 6 tiles, 1 focal, 1 status): a caption, up
// to five tiles, the chart and the status list — 8 at most. No button: the
// integration is read only.
// -----------------------------------------------------------------------------

import { WIDGET_CHART_INTERVALS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE, deviceIds, deviceName, statusLabel } from './devices.js';
import { TEXT, formatPower, t } from './i18n.js';
import { WIDGET_KEY } from './hub.js';

// Below this, a power is noise (standby consumption, meter rounding).
const IDLE_W = 30;
const FAULTS = ['fault', 'permanent_fault'];

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The inverter a widget shows: its setting, else the only one there is. */
export function resolveInverter(hub, settings) {
  const inverters = hub.inverters().filter((inv) => inv.capabilities);
  if (settings?.device) {
    return inverters.find((inv) => deviceIds(hub.gladys, inv.serial).device === settings.device);
  }
  return inverters.length === 1 ? inverters[0] : undefined;
}

function time(at, language) {
  try {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

/**
 * The content of the widget for one inverter.
 * @param {object} gladys for the external ids
 * @param {object} inverter from hub.inverters()
 * @param {string} language
 */
export function buildContent(gladys, inverter, language) {
  const ids = deviceIds(gladys, inverter.serial);
  const caps = inverter.capabilities;
  const reading = inverter.reading;
  const online = Boolean(inverter.online);
  const status = online ? reading?.status : 'offline';

  const caption = [deviceName(inverter)];
  if (status) {
    caption.push(statusLabel(status, language));
  }
  caption.push(inverter.source === 'cloud' ? t(TEXT.viaCloud, language) : t(TEXT.local, language));
  const components = [{ type: 'text', variant: 'caption', text: fit(caption.join(' · '), 80) }];

  if (!reading) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.noData, language) });
    return { ttl_seconds: 120, components };
  }

  const tile = (key, label) => ({
    type: 'value',
    label: t(label, language),
    device_feature: ids.feature(key),
  });
  components.push(tile(FEATURE.PV_POWER, TEXT.pv), tile(FEATURE.YIELD_TODAY, TEXT.today));
  if (caps.gridPower) {
    components.push(tile(FEATURE.GRID_POWER, TEXT.grid));
  }
  const battery = caps.battery ? reading.battery : null;
  if (caps.battery) {
    components.push({
      type: 'gauge',
      label: t(TEXT.battery, language),
      device_feature: ids.feature(FEATURE.BATTERY_SOC),
    });
    const discharging = (battery?.power ?? 0) < 0;
    components.push(
      tile(
        discharging ? FEATURE.BATTERY_DISCHARGE_POWER : FEATURE.BATTERY_CHARGE_POWER,
        discharging ? TEXT.discharging : TEXT.charging,
      ),
    );
  }

  const curves = [ids.feature(FEATURE.PV_POWER)];
  if (caps.gridPower) {
    curves.push(ids.feature(FEATURE.GRID_POWER));
  }
  components.push({
    type: 'chart',
    title: t(TEXT.chart, language),
    device_features: curves,
    interval: WIDGET_CHART_INTERVALS.LAST_DAY,
    chart_type: 'line',
  });

  const items = [];
  if (caps.gridPower && typeof reading.gridPower === 'number') {
    const grid = reading.gridPower;
    items.push({
      label: t(TEXT.grid, language),
      value:
        Math.abs(grid) < IDLE_W
          ? t(TEXT.balanced, language)
          : `${t(grid < 0 ? TEXT.exporting : TEXT.importing, language)} ${formatPower(grid, language)}`,
      color: grid <= -IDLE_W ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (battery && typeof battery.power === 'number') {
    const power = battery.power;
    items.push({
      label: t(TEXT.battery, language),
      value:
        Math.abs(power) < IDLE_W
          ? t(TEXT.resting, language)
          : `${t(power > 0 ? TEXT.charging : TEXT.discharging, language)} ${formatPower(power, language)}`,
      color: WIDGET_COLORS.INFO,
    });
  }
  if (status) {
    items.push({
      label: t(TEXT.inverter, language),
      value: fit(statusLabel(status, language), 40),
      color: FAULTS.includes(status)
        ? WIDGET_COLORS.DANGER
        : status === 'normal'
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.WARNING,
    });
  }
  if (inverter.at) {
    items.push({ label: t(TEXT.updated, language), value: time(inverter.at, language) });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  // The tiles and the chart are live; the status rows follow the readings.
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, { settings, language = 'en' } = {}) {
      const inverter = resolveInverter(hub, settings);
      if (!inverter) {
        return message(TEXT.pickInverter, language);
      }
      return buildContent(hub.gladys, inverter, language);
    },
  },
};
