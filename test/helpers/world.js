// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake dongles on 127.0.0.1, a
// fake SolaX Cloud, an in-memory /data, and the integration wired on top
// through registerHandlers — the same wiring as index.js.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../../src/app.js';
import { createCloudClient } from '../../src/solax/cloud.js';
import { createLocalClient } from '../../src/solax/local.js';
import { MemoryStore } from '../../src/store.js';
import { CLOUD_TOKEN, createFakeCloud } from './fakeCloud.js';
import { startDongle } from './fakeDongle.js';

// Keep the test output readable (LOG_LEVEL is read on every log call).
// LOG_LEVEL=debug npm test shows the integration logs.
process.env.LOG_LEVEL ??= 'silent';

/**
 * @param {object} [options]
 * @param {Array<object>} [options.dongles] options of startDongle, one per dongle
 * @param {object} [options.config] raw config, merged over the dongle addresses
 * @param {boolean} [options.cloud] configure the fake cloud inverter
 * @param {object} [options.store] a MemoryStore (a restart)
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.periods]
 * @param {Array<object>} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  dongles = [],
  config = {},
  cloud: withCloud = false,
  store = new MemoryStore(),
  connect = true,
  timers = false,
  periods,
  devices = [],
  logger,
  cloudOptions,
  cloudSpacingMs = 0,
} = {}) {
  const started = await Promise.all(dongles.map((options) => startDongle(options)));
  const cloud = createFakeCloud(cloudOptions);
  const rawConfig = {
    hosts: started.map((dongle) => dongle.host).join(','),
    passwords: dongles.map((options) => options.password ?? '').join(','),
    ...(withCloud
      ? { cloud_token: CLOUD_TOKEN, cloud_serials: Object.keys(cloud.inverters).join(',') }
      : {}),
    ...config,
  };
  const gladys = createFakeGladys({ config: rawConfig, devices });
  const app = registerHandlers(gladys, {
    store,
    local: createLocalClient({ staggerMs: 0, timeoutMs: 1000 }),
    cloud: createCloudClient({ fetch: cloud.fetch, spacingMs: cloudSpacingMs }),
    timers,
    periods,
    logger: logger ?? createLogger({ name: 'solax-test' }),
  });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    dongles: started,
    cloud,
    store,
    async stop() {
      await app.stop();
      await Promise.all(started.map((dongle) => dongle.close().catch(() => {})));
    },
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return world;
}

/** Create every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** The external id of an inverter feature. */
export const featureId = (gladys, serial, key) =>
  gladys.externalIds('inverter', serial).feature(key);
