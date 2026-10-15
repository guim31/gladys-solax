// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { SolaxHub } from './hub.js';
import { TEXT } from './i18n.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

export const TEST_ACTION = 'test_connection';

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, local, cloud, timers, now, logger, periods
 */
export function registerHandlers(gladys, options = {}) {
  const logger = options.logger ?? createLogger({ name: 'solax-app' });
  const hub = new SolaxHub({
    gladys,
    store: options.store ?? new Store(),
    local: options.local,
    cloud: options.cloud,
    timers: options.timers ?? true,
    now: options.now,
    logger: options.logger,
    periods: options.periods,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // request arriving during the first reads is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-send what Gladys may have lost.
        await hub.resync();
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error(`Initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      logger.info('Search requested: reading every inverter');
      hub.lastDevicesJson = null;
      await hub.cycle('local', { force: true });
      await hub.cycle('cloud', { force: true });
      await hub.publishDevices();
    }),
  );

  gladys.onPoll(whenReady((device) => hub.pollFromCore(device)));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    TEST_ACTION,
    whenReady(async () => {
      logger.info('Connection test requested');
      return hub.testConnection();
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return { hub, ready, stop: () => hub.stop() };
}
