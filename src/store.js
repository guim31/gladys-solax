// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container):
// the inverters seen so far — which dongle variant answers, the model, the
// features — and the last value of each cumulative counter. A restart at
// night, when the dongles sleep, still publishes the devices with all their
// features, and a counter never goes back. No secret is written here.
// Losing the file is harmless: the next answer of each inverter rebuilds it.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createIssueLog } from './issues.js';

const logger = createLogger({ name: 'solax-store' });
const FILE_NAME = 'solax-state.json';

export class Store {
  constructor(directory = process.env.SOLAX_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
    // A read-only or full /data fails every write: logged once.
    this.issues = createIssueLog(logger);
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot));
          await rename(temporary, this.path);
          this.issues.ok('write', `${this.path} written again`);
        } catch (err) {
          this.issues.fail('write', `Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}

/** A store in memory (tests). */
export class MemoryStore {
  constructor(data = {}) {
    this.data = structuredClone(data);
  }
  async load() {
    return structuredClone(this.data);
  }
  async save(data) {
    this.data = structuredClone(data);
  }
  flush() {
    return Promise.resolve();
  }
}
