// -----------------------------------------------------------------------------
// Configuration: defaults (mirroring the manifest `config_schema`) and
// normalization of what the Gladys form sends (strings, empty values).
// test/manifest.test.js keeps both sides in sync.
// -----------------------------------------------------------------------------

import { AUTO_MODEL, MODEL_KEYS } from './solax/models.js';
import { normalizeHost } from './solax/local.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two local reads. 30 s is what Home Assistant uses; the
// Pocket WiFi itself refreshes its data every few seconds.
export const LOCAL_INTERVALS = ['10', '15', '30', '60'];
// Minutes between two cloud reads: the dongle uploads every 5 minutes, and
// the API allows 10 000 calls a day per token.
export const CLOUD_INTERVALS = ['5', '10', '15', '30'];

export const DEFAULT_CONFIG = {
  hosts: '',
  passwords: '',
  model: AUTO_MODEL,
  local_interval: '30',
  cloud_token: '',
  cloud_serials: '',
  cloud_interval: '5',
  language: 'fr',
};

const list = (value) =>
  String(value ?? '')
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const pick = (value, allowed, fallback) => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return allowed.includes(text) ? text : fallback;
};

/**
 * @param {object} [raw] the config Gladys sends
 * @returns {{
 *   local: Array<{ id: string, host: string, password: string }>,
 *   invalidHosts: string[],
 *   cloud: Array<{ id: string, serial: string }>,
 *   cloudToken: string,
 *   model: string,
 *   localIntervalMs: number,
 *   cloudIntervalMs: number,
 *   language: string,
 * }}
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  const passwords = list(config.passwords);
  const local = [];
  const invalidHosts = [];
  list(config.hosts).forEach((input, index) => {
    const host = normalizeHost(input);
    if (!host) {
      invalidHosts.push(input);
      return;
    }
    if (local.some((entry) => entry.host === host)) {
      return;
    }
    // One password for every dongle, or one per address in the same order.
    const password = passwords.length === 1 ? passwords[0] : (passwords[index] ?? '');
    local.push({ id: `local:${host}`, host, password });
  });
  const cloudToken = String(config.cloud_token ?? '').trim();
  const cloud = cloudToken
    ? [...new Set(list(config.cloud_serials).map((serial) => serial.toUpperCase()))]
        .filter((serial) => /^[A-Z0-9]{6,20}$/.test(serial))
        .map((serial) => ({ id: `cloud:${serial}`, serial }))
    : [];
  return {
    local,
    invalidHosts,
    cloud,
    cloudToken,
    model: pick(config.model, [AUTO_MODEL, ...MODEL_KEYS], AUTO_MODEL),
    localIntervalMs: Number(pick(config.local_interval, LOCAL_INTERVALS, '30')) * 1000,
    cloudIntervalMs: Number(pick(config.cloud_interval, CLOUD_INTERVALS, '5')) * 60 * 1000,
    language: pick(config.language, LANGUAGES, DEFAULT_CONFIG.language),
  };
}

/** True when there is something to read. */
export const isConfigured = (config) => config.local.length > 0 || config.cloud.length > 0;

/** Every value of the raw config that must never reach a log. */
export function secretsOf(raw = {}) {
  return [...list(raw?.passwords), String(raw?.cloud_token ?? '').trim()].filter(
    (secret) => secret.length >= 4,
  );
}
