// -----------------------------------------------------------------------------
// The SolaX hub: reads every configured inverter (local dongles, SolaX Cloud),
// publishes their devices and states, and serves the widget, the scene action
// and the "Test the connection" action from what it read.
//
// Refreshing: the container polls by itself, on its own timers — one for the
// local dongles (10 to 60 s), one for SolaX Cloud (5 minutes or more, within
// the API quota). The core's onPoll (once a minute, `should_poll: true`) is a
// fallback only: the core does not reliably poll external devices
// (GladysAssistant/Gladys#3198, still in 5.2.1), and a device keeps the
// polling fields it was created with. A source polled less than 90 % of its
// period ago is skipped, so the core never adds calls while the timer runs.
//
// What is polled: the sources not detected yet (to find their model and
// publish their device), and the inverters the user added to Gladys — the
// core drops the states of a device it does not know.
//
// Logs: the lifecycle at info (start, an inverter found, lost and back, one
// line per user action), everything per cycle at debug. A failure that lasts
// is one warning, its end one info line (src/issues.js). Never a password, a
// token, nor a full serial number (the dongle's serial is its password).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOf,
  deviceIds,
  mergeCapabilities,
  statesOf,
  statusLabel,
} from './devices.js';
import { TEXT, perLanguage } from './i18n.js';
import { createIssueLog } from './issues.js';
import { CloudError, cloudPeriodMs, createCloudClient } from './solax/cloud.js';
import { DongleError, createLocalClient } from './solax/local.js';
import { AUTO_MODEL, UnsupportedModelError, decodeReading, findModel } from './solax/models.js';

export const WIDGET_KEY = 'solar_overview';
export const STATUS_TRIGGER = 'inverter_status_changed';
// A value that does not change is published again at least this often, so
// Gladys never shows "no recent value" (48 h) on a stable counter.
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
// A cloud reading older than this is the last one before the dongle went
// quiet: the inverter is offline.
export const CLOUD_STALE_MS = 20 * 60 * 1000;
// Consecutive refusals of a known variant before the dongle is probed again
// (a firmware update changes what it answers).
const REDETECT_AFTER = 3;
const STORE_VERSION = 1;

/** The last characters of a serial, enough to tell inverters apart in a log. */
export const tail = (serial) => `…${String(serial).slice(-4)}`;

/** A source as the logs name it: the address of a dongle, never a full serial. */
const sourceLabel = (source) =>
  source.kind === 'local' ? `Dongle ${source.host}` : `SolaX Cloud inverter ${tail(source.serial)}`;

export class SolaxHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store src/store.js
   * @param {object} [options.local] src/solax/local.js client
   * @param {object} [options.cloud] src/solax/cloud.js client
   * @param {boolean} [options.timers] run the polling timers (tests turn them off)
   * @param {() => number} [options.now]
   * @param {object} [options.logger]
   * @param {{ local?: number, cloud?: number }} [options.periods] polling periods (tests)
   */
  constructor({
    gladys,
    store,
    local,
    cloud,
    timers = true,
    now = () => Date.now(),
    logger,
    periods,
  }) {
    this.periods = periods ?? {};
    this.gladys = gladys;
    this.store = store;
    this.local = local ?? createLocalClient();
    this.cloud = cloud ?? createCloudClient();
    this.timersEnabled = timers;
    this.now = now;
    this.logger = logger ?? createLogger({ name: 'solax' });
    this.issues = createIssueLog(this.logger);
    this.config = null;
    /** What is known of each source, persisted: sourceId → record. */
    this.records = new Map();
    /** The last value of each cumulative counter: serial → { key: value }. */
    this.indexes = {};
    /** What the last read gave: sourceId → { reading, online, at, failures }. */
    this.runtime = new Map();
    this.lastPolledAt = new Map();
    this.inFlight = new Map();
    this.timers = { local: null, cloud: null };
    this.lastDevicesJson = null;
    this.lastTransports = new Map();
    this.lastConnection = null;
    this.stopped = false;
  }

  // --- Lifecycle --------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    if (saved.version === STORE_VERSION) {
      for (const [id, record] of Object.entries(saved.sources ?? {})) {
        this.records.set(id, record);
      }
      this.indexes = saved.indexes ?? {};
    }
    await this.reconfigure(config, { initial: true });
  }

  async reconfigure(config, { initial = false } = {}) {
    const previousModel = this.config?.model;
    this.config = config;
    if (!initial && previousModel !== config.model) {
      // Another model forced: probe the dongles again.
      for (const record of this.records.values()) {
        if (record.kind === 'local') {
          delete record.variant;
        }
      }
    }
    for (const host of config.invalidHosts) {
      this.logger.warn(`Ignored address "${host}": not an IP address or a host name`);
    }
    const summary = `${config.local.length} local dongle(s), ${config.cloud.length} SolaX Cloud inverter(s)`;
    this.logger.info(initial ? `Configuration: ${summary}` : `New configuration: ${summary}`);
    this.lastDevicesJson = null;
    await this.publishDevices();
    this.stopped = false;
    this.lastPolledAt.clear();
    await this.cycle('local', { force: true });
    await this.cycle('cloud', { force: true });
    this.schedule('local');
    this.schedule('cloud');
    await this.updateConnectionStatus();
  }

  /** A reconnection: Gladys may have restarted and lost the published states. */
  async resync() {
    this.lastDevicesJson = null;
    this.lastTransports.clear();
    this.lastConnection = null;
    this.gladys.forgetPublishedStates?.();
    await this.publishDevices();
    await this.republishAll();
    await this.updateConnectionStatus();
  }

  stop() {
    this.stopped = true;
    for (const kind of Object.keys(this.timers)) {
      clearTimeout(this.timers[kind]);
      this.timers[kind] = null;
    }
    return this.store.flush();
  }

  // --- Sources ----------------------------------------------------------------

  /** The configured sources of one kind. */
  sources(kind) {
    if (!this.config) {
      return [];
    }
    return kind === 'local'
      ? this.config.local.map((s) => ({ ...s, kind: 'local' }))
      : this.config.cloud.map((s) => ({ ...s, kind: 'cloud' }));
  }

  periodMs(kind) {
    if (this.periods[kind]) {
      return this.periods[kind];
    }
    return kind === 'local'
      ? this.config.localIntervalMs
      : cloudPeriodMs(this.config.cloudIntervalMs, this.config.cloud.length);
  }

  /**
   * The inverters to publish: the configured sources already detected, one per
   * serial — an inverter read both locally and through the cloud is read
   * locally only.
   */
  inverters() {
    const bySerial = new Map();
    for (const kind of ['local', 'cloud']) {
      for (const source of this.sources(kind)) {
        const record = this.records.get(source.id);
        if (!record?.serial || bySerial.has(record.serial)) {
          continue;
        }
        const runtime = this.runtime.get(source.id) ?? {};
        bySerial.set(record.serial, { ...record, sourceId: source.id, source: kind, ...runtime });
      }
    }
    return [...bySerial.values()];
  }

  /** True when another (local) source already serves this serial. */
  shadowed(source, serial) {
    return this.inverters().some((inv) => inv.serial === serial && inv.sourceId !== source.id);
  }

  findInverterByExternalId(externalId) {
    return this.inverters().find((inv) => deviceIds(this.gladys, inv.serial).device === externalId);
  }

  isCreated(serial) {
    const id = deviceIds(this.gladys, serial).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  // --- Polling ----------------------------------------------------------------

  schedule(kind) {
    clearTimeout(this.timers[kind]);
    this.timers[kind] = null;
    if (!this.timersEnabled || this.stopped || this.sources(kind).length === 0) {
      return;
    }
    this.timers[kind] = setTimeout(async () => {
      this.timers[kind] = null;
      try {
        await this.cycle(kind);
        await this.updateConnectionStatus();
      } catch (err) {
        this.logger.error(`Polling cycle failed (${err.message})`);
      } finally {
        this.schedule(kind);
      }
    }, this.periodMs(kind));
    this.timers[kind].unref?.();
  }

  /** One cycle of one kind: errors are logged, never thrown. */
  async cycle(kind, { force = false } = {}) {
    if (this.gladys.connected === false) {
      this.logger.debug('Gladys unreachable: poll skipped');
      return;
    }
    const due = this.sources(kind).filter((source) => {
      const record = this.records.get(source.id);
      return !record?.serial || !record.modelName || this.isCreated(record.serial) || force;
    });
    // The cloud client spaces its own calls; the dongles are read together.
    await Promise.all(due.map((source) => this.pollSource(source, { force }).catch(() => {})));
  }

  /** The core's onPoll (fallback): skipped while the timer is on time. */
  async pollFromCore(device) {
    const inverter = this.findInverterByExternalId(device.external_id);
    if (!inverter) {
      this.logger.debug(`onPoll ignored for ${device.external_id}: not configured`);
      return;
    }
    const source = this.sources(inverter.source).find((s) => s.id === inverter.sourceId);
    await this.pollSource(source, { minGap: 0.9 });
  }

  /**
   * Read one source and publish what it gives, unless it was read less than
   * `minGap` periods ago. A read in progress is shared.
   */
  async pollSource(source, { force = false, minGap = 0.5 } = {}) {
    const running = this.inFlight.get(source.id);
    if (running) {
      return running;
    }
    const last = this.lastPolledAt.get(source.id);
    if (!force && last !== undefined && this.now() - last < this.periodMs(source.kind) * minGap) {
      this.logger.debug(`${sourceLabel(source)}: read ${this.now() - last} ms ago, skipped`);
      return undefined;
    }
    this.lastPolledAt.set(source.id, this.now());
    const run = (source.kind === 'local' ? this.readLocal(source) : this.readCloud(source)).finally(
      () => this.inFlight.delete(source.id),
    );
    this.inFlight.set(source.id, run);
    return run;
  }

  async readLocal(source) {
    const label = sourceLabel(source);
    let record = this.records.get(source.id);
    let response;
    let model;
    try {
      if (record?.variant && record.modelKey) {
        try {
          response = await this.local.read(source.host, source.password, record.variant);
          model = findModel(record.modelKey);
        } catch (err) {
          if (err.unreachable) {
            throw err;
          }
          const runtime = this.runtime.get(source.id) ?? {};
          runtime.refusals = (runtime.refusals ?? 0) + 1;
          this.runtime.set(source.id, runtime);
          if (runtime.refusals < REDETECT_AFTER) {
            throw err;
          }
          delete record.variant;
        }
      }
      if (!response) {
        const detected = await this.local.detect(source.host, source.password, {
          model: this.config.model,
        });
        response = detected.response;
        model = detected.model;
        record = this.remember(source, {
          variant: detected.variant,
          modelKey: model.key,
          modelName: model.name,
          serial:
            response.inverterSerial ?? response.serial ?? source.host.replace(/[^A-Za-z0-9]/g, ''),
          ratedPowerKw: response.ratedPowerKw,
          firmware: response.firmware,
        });
      }
      if (this.config.model !== AUTO_MODEL && model.key !== this.config.model) {
        // Forced in the configuration after the detection.
        model = findModel(this.config.model);
      }
      const reading = decodeReading(model, response);
      const runtime = this.runtime.get(source.id) ?? {};
      runtime.refusals = 0;
      this.runtime.set(source.id, runtime);
      this.issues.ok(source.id, `${label}: answers again`);
      await this.accept(source, record, reading, { online: true });
    } catch (err) {
      await this.reject(source, label, err);
      throw err;
    }
  }

  async readCloud(source) {
    const label = sourceLabel(source);
    try {
      const result = await this.cloud.read(this.config.cloudToken, source.serial);
      const serial = result.inverterSerial ?? source.serial;
      const known = this.records.get(source.id);
      const record = this.remember(source, {
        serial,
        modelKey: known?.modelKey ?? null,
        modelName: result.modelName ?? known?.modelName ?? 'Inverter',
        ratedPowerKw: known?.ratedPowerKw ?? null,
      });
      this.issues.ok(source.id, `${label}: answers again`);
      if (this.shadowed(source, serial)) {
        this.logger.debug(`${label}: read locally, cloud reading ignored`);
        return;
      }
      const stale = result.uploadedAt !== null && this.now() - result.uploadedAt > CLOUD_STALE_MS;
      await this.accept(source, record, stale ? null : result.reading, { online: !stale });
    } catch (err) {
      await this.reject(source, label, err);
      throw err;
    }
  }

  /** Store what a source told about its inverter; log a new one. */
  remember(source, fields) {
    const previous = this.records.get(source.id);
    const record = { ...previous, ...fields, kind: source.kind };
    const changed = JSON.stringify(previous) !== JSON.stringify(record);
    this.records.set(source.id, record);
    if (!previous?.serial || previous.serial !== record.serial) {
      this.logger.info(
        `Found SolaX ${record.modelName} ${tail(record.serial)} (${source.kind === 'local' ? source.host : 'SolaX Cloud'})`,
      );
    }
    if (changed) {
      this.saveStore();
    }
    return record;
  }

  /** A successful read: features, states, transport, scene event. */
  async accept(source, record, reading, { online }) {
    const runtime = this.runtime.get(source.id) ?? {};
    if (reading) {
      const capabilities = mergeCapabilities(record.capabilities, capabilitiesOf(reading));
      if (JSON.stringify(capabilities) !== JSON.stringify(record.capabilities)) {
        record.capabilities = capabilities;
        this.saveStore();
      }
    }
    const previousStatus = runtime.reading?.status;
    const hadReading = Boolean(runtime.reading);
    if (reading) {
      runtime.reading = reading;
      runtime.at = this.now();
    }
    runtime.online = online;
    this.runtime.set(source.id, runtime);
    if (!record.capabilities) {
      // Known, never read with data (a stale cloud answer): nothing to show yet.
      return;
    }
    await this.publishDevices();
    const inverter = { ...record, sourceId: source.id, source: source.kind };
    if (this.isCreated(record.serial)) {
      await this.publishStates(inverter, online ? runtime.reading : null, online);
      await this.publishTransport(inverter, online ? source.kind : 'unreachable');
      if (reading?.status && previousStatus && previousStatus !== reading.status) {
        await this.fireStatusChange(inverter, previousStatus, reading.status);
      }
    }
    if (reading && (!hadReading || previousStatus !== reading.status)) {
      this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
    }
  }

  /** A failed read: log once, mark the inverter offline. */
  async reject(source, label, err) {
    if (err instanceof UnsupportedModelError) {
      this.issues.fail(source.id, `${label}: unsupported model (${err.message})`);
    } else if (err instanceof CloudError || err instanceof DongleError) {
      this.issues.fail(source.id, `${label}: ${err.message}`);
    } else {
      this.issues.fail(source.id, `${label}: ${err.message}`);
    }
    const runtime = this.runtime.get(source.id) ?? {};
    runtime.online = false;
    runtime.error = err;
    this.runtime.set(source.id, runtime);
    const record = this.records.get(source.id);
    if (
      record?.capabilities &&
      this.isCreated(record.serial) &&
      !this.shadowed(source, record.serial)
    ) {
      const inverter = { ...record, sourceId: source.id, source: source.kind };
      await this.publishStates(inverter, null, false).catch(() => {});
      await this.publishTransport(inverter, 'unreachable').catch(() => {});
    }
  }

  // --- Publication ------------------------------------------------------------

  async publishDevices() {
    const devices = this.inverters()
      .filter((inv) => inv.capabilities)
      .map((inv) => buildDevice(this.gladys, inv, this.config.language));
    const json = JSON.stringify(devices);
    if (json === this.lastDevicesJson) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.lastDevicesJson = json;
  }

  async publishStates(inverter, reading, online) {
    const indexes = (this.indexes[inverter.serial] ??= {});
    const states = statesOf(this.gladys, inverter, reading, {
      online,
      language: this.config.language,
      lastIndex: (key) => indexes[key],
    });
    if (states.length === 0) {
      return;
    }
    await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    const ids = deviceIds(this.gladys, inverter.serial);
    let changed = false;
    for (const key of Object.keys(FEATURE)) {
      const featureKey = FEATURE[key];
      if (typeof featureKey !== 'string') {
        continue;
      }
      const state = states.find((s) => s.device_feature_external_id === ids.feature(featureKey));
      if (state && featureKey.endsWith('_total') && indexes[featureKey] !== state.state) {
        indexes[featureKey] = state.state;
        changed = true;
      }
    }
    if (changed) {
      this.saveStore();
    }
    this.logger.debug(
      `SolaX ${inverter.modelName} ${tail(inverter.serial)}: ${states.length} state(s) handed to the SDK`,
    );
  }

  async publishTransport(inverter, transport) {
    const id = deviceIds(this.gladys, inverter.serial).device;
    const value =
      transport === 'local'
        ? DEVICE_TRANSPORTS.LOCAL
        : transport === 'cloud'
          ? DEVICE_TRANSPORTS.CLOUD
          : DEVICE_TRANSPORTS.UNREACHABLE;
    if (this.lastTransports.get(id) === value) {
      return;
    }
    await this.gladys.publishTransports([{ external_id: id, transport: value }]);
    this.lastTransports.set(id, value);
  }

  async fireStatusChange(inverter, previous, status) {
    const language = this.config.language;
    this.logger.info(
      `SolaX ${inverter.modelName} ${tail(inverter.serial)}: state ${previous} -> ${status}`,
    );
    await this.gladys
      .publishSceneEvent(STATUS_TRIGGER, {
        device: deviceIds(this.gladys, inverter.serial).device,
        status,
        previous_status: previous,
        status_label: statusLabel(status, language),
      })
      .catch((err) => this.logger.warn(`Scene event not accepted: ${err.message}`));
  }

  /** Every state again, from the last readings (no device is read). */
  async republishAll() {
    for (const inverter of this.inverters()) {
      if (inverter.capabilities && this.isCreated(inverter.serial)) {
        await this.publishStates(
          inverter,
          inverter.online ? inverter.reading : null,
          Boolean(inverter.online),
        );
        this.lastTransports.delete(deviceIds(this.gladys, inverter.serial).device);
        await this.publishTransport(inverter, inverter.online ? inverter.source : 'unreachable');
      }
    }
  }

  /**
   * The user added (or updated) a device: the SDK forgot what it had
   * published for it, and Gladys dropped the states sent before. Send them
   * all again from the last reading, or read the inverter now.
   */
  async onDeviceCreated(device) {
    const inverter = this.findInverterByExternalId(device.external_id);
    if (!inverter) {
      return;
    }
    this.lastTransports.delete(device.external_id);
    if (inverter.reading || inverter.online === false) {
      await this.publishStates(
        inverter,
        inverter.online ? inverter.reading : null,
        Boolean(inverter.online),
      );
      await this.publishTransport(inverter, inverter.online ? inverter.source : 'unreachable');
    } else {
      const source = this.sources(inverter.source).find((s) => s.id === inverter.sourceId);
      await this.pollSource(source, { force: true }).catch(() => {});
    }
    this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
  }

  async updateConnectionStatus() {
    let status;
    if (!isConfigured(this.config)) {
      status = { connected: false, message: TEXT.notConfigured };
    } else if (this.inverters().some((inv) => inv.capabilities)) {
      // Inverters known: one asleep at night is not a broken integration
      // (its device says "offline", its transport badge "unreachable").
      status = { connected: true };
    } else {
      const all = [...this.sources('local'), ...this.sources('cloud')];
      const tried = all.every((source) => this.runtime.has(source.id));
      status = tried ? { connected: false, message: TEXT.noneAnswers } : { connected: true };
    }
    const json = JSON.stringify(status);
    if (json === this.lastConnection) {
      return;
    }
    await this.gladys.setConnectionStatus(status.connected, status.message);
    this.lastConnection = json;
  }

  saveStore() {
    const sources = Object.fromEntries(this.records);
    this.store.save({ version: STORE_VERSION, sources, indexes: this.indexes });
  }

  // --- The "Test the connection" action ---------------------------------------

  /** Read every source now and say, per inverter, what answered. */
  async testConnection() {
    const all = [...this.sources('local'), ...this.sources('cloud')];
    if (all.length === 0) {
      return TEXT.nothingToTest;
    }
    const lines = [];
    for (const source of all) {
      const before = this.records.get(source.id);
      if (source.kind === 'local' && before) {
        // A real test: probe the variants again, the dongle may have changed.
        delete before.variant;
      }
      let error = null;
      try {
        await this.pollSource(source, { force: true });
      } catch (err) {
        error = err;
      }
      lines.push(this.reportLine(source, error));
    }
    const invalid = this.config.invalidHosts;
    await this.updateConnectionStatus();
    return perLanguage((language) => {
      const parts = lines.map((line) => line(language));
      if (invalid.length > 0) {
        parts.push(`${TEXT.invalidHosts[language]} ${invalid.slice(0, 3).join(', ')}`);
      }
      return parts.join(' · ').slice(0, 1000);
    });
  }

  reportLine(source, error) {
    const name = source.kind === 'local' ? source.host : `SolaX Cloud ${tail(source.serial)}`;
    const record = this.records.get(source.id);
    return (language) => {
      if (!error) {
        return `${name}: ${record.modelName} ${tail(record.serial)} ${TEXT.ok[language]}`;
      }
      if (error instanceof UnsupportedModelError) {
        const text = error.details.reason === 'not_inverter' ? TEXT.notInverter : TEXT.unsupported;
        return `${name}: ${text[language]} (type ${JSON.stringify(error.details.type)}, ${error.details.size})`;
      }
      if (error instanceof CloudError) {
        return `${name}: ${TEXT.cloudRefused[language]}`;
      }
      if (error instanceof DongleError) {
        return `${name}: ${TEXT.refused[language]}`;
      }
      return `${name}: ${TEXT.unreachable[language]}`;
    };
  }
}
