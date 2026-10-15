// -----------------------------------------------------------------------------
// The platform id of an inverter: what its Gladys external id is built from.
//
// The inverter serial number when the dongle (or SolaX Cloud) reports it.
// Otherwise, never the dongle's registration number itself: it is the local
// password of the dongle and the `sn` the SolaX Cloud token is used with, and
// an external id is shown in the interface and ends up in backups, logs and
// exports. A stable, non-reversible fingerprint of it takes its place, the
// same whether the inverter is read locally or through the cloud.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase();

/** `reg-` + the first 12 hex characters of sha256('solax:' + registration number). */
export function registrationId(registration) {
  const digest = createHash('sha256')
    .update(`solax:${normalize(registration)}`)
    .digest('hex');
  return `reg-${digest.slice(0, 12)}`;
}

/**
 * @param {string | null} inverterSerial the inverter serial number, if reported
 * @param {string | null} registration the dongle's registration number, if known
 * @param {string[]} [secrets] other values that must never become an id (passwords)
 * @returns {string | null}
 */
export function platformIdOf(inverterSerial, registration, secrets = []) {
  const serial = normalize(inverterSerial);
  const forbidden = new Set([registration, ...secrets].map(normalize).filter(Boolean));
  if (serial && !forbidden.has(serial)) {
    return String(inverterSerial).trim();
  }
  if (normalize(registration)) {
    return registrationId(registration);
  }
  return null;
}
