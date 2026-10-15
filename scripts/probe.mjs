#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a SolaX dongle or of SolaX Cloud, with the real clients
// of the integration. Nothing is ever written to the inverter: the only
// request is ReadRealTimeData.
//
//   node scripts/probe.mjs <dongle address> [registration number]
//   SOLAX_TOKEN=... SOLAX_SERIAL=... node scripts/probe.mjs --cloud
//   node scripts/probe.mjs --cloud          (a fake token: shows the refusal)
//
// The output is meant to be pasted in an issue: serial numbers are cut to
// their last 4 characters, the password and the token are never printed. The
// realtime array itself (numbers) is printed, it is what a new model needs.
// -----------------------------------------------------------------------------

import { createCloudClient } from '../src/solax/cloud.js';
import { VARIANTS, createLocalClient, normalizeHost } from '../src/solax/local.js';
import { decodeReading } from '../src/solax/models.js';

const mask = (value) => (value ? `…${String(value).slice(-4)}` : '(none)');
const print = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

async function probeLocal(input, password = '') {
  const host = normalizeHost(input);
  if (!host) {
    console.error(`Not an address: ${input}`);
    process.exit(2);
  }
  print('Dongle', host);
  print('Password', password ? `given (${password.length} characters)` : 'none');
  const client = createLocalClient();
  try {
    const { variant, response, model } = await client.detect(host, password);
    print('Request variant', `${variant} (${JSON.stringify(VARIANTS[variant])})`);
    print('Inverter type', JSON.stringify(response.type));
    print('Model', `${model.name} (${model.key})`);
    print('Dongle firmware', response.firmware ?? '(none)');
    print('Dongle serial', mask(response.serial));
    print('Inverter serial', mask(response.inverterSerial));
    print('Rated power', response.ratedPowerKw ? `${response.ratedPowerKw} kW` : '(unknown)');
    print('Values', `${response.data.length}${response.idle ? ' (all zero: asleep)' : ''}`);
    console.log('\nDecoded reading:');
    console.log(JSON.stringify(decodeReading(model, response), null, 2));
    console.log('\nRealtime array (for a model report):');
    console.log(JSON.stringify(response.data));
  } catch (err) {
    print('Result', `${err.name}: ${err.message}`);
    if (err.details) {
      print('Type / values', `${JSON.stringify(err.details.type)} / ${err.details.size}`);
    }
    process.exitCode = 1;
  }
}

async function probeCloud() {
  const token = process.env.SOLAX_TOKEN || 'probe-fake-token-0000000';
  const serial = process.env.SOLAX_SERIAL || 'SPROBE0000';
  print(
    'SolaX Cloud',
    process.env.SOLAX_TOKEN ? 'token from SOLAX_TOKEN' : 'fake token (expect a refusal)',
  );
  print('Registration number', mask(serial));
  const client = createCloudClient();
  try {
    const result = await client.read(token, serial);
    print('Model', result.modelName ?? `type ${result.typeCode}`);
    print('Inverter serial', mask(result.inverterSerial));
    print('Uploaded', result.uploadedAt ? new Date(result.uploadedAt).toISOString() : '(unknown)');
    console.log('\nDecoded reading:');
    console.log(JSON.stringify(result.reading, null, 2));
  } catch (err) {
    print('Result', `${err.name}: ${err.message}${err.auth ? ' (authentication)' : ''}`);
    process.exitCode = process.env.SOLAX_TOKEN ? 1 : 0;
  }
}

const [first, second] = process.argv.slice(2);
if (!first || first === '--help') {
  console.log('Usage: node scripts/probe.mjs <dongle address> [registration number]');
  console.log('       SOLAX_TOKEN=... SOLAX_SERIAL=... node scripts/probe.mjs --cloud');
  process.exit(first ? 0 : 2);
}
await (first === '--cloud'
  ? probeCloud()
  : probeLocal(first, second ?? process.env.SOLAX_PASSWORD));
