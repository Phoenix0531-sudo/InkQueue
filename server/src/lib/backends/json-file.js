'use strict';

// StoreBackend implementations.
//
// The server never reads `tasks.json` directly — it goes through a
// StoreBackend. The default JsonFileBackend persists to a local JSON file
// with .tmp atomic rename + rotating .bak/.bak.1/.bak.2 backups + corrupt
// self-heal + size warn. It is the production surface used by the reference
// server today.
//
// Future production deployments (Cloudflare Worker + D1/KV, or a SQLite-backed
// render) should drop a backend here that implements the same interface:
//
//   interface StoreBackend {
//     readStore():            { tasks: Array, operations: Array }
//     writeStore(store):      void
//     operationStore(store):  Array   // returns the operations sub-array
//     emptyStore():           { tasks: [], operations: [] }
//     ensureDataFile():       void    // create-an-empty hint (no-op for KV)
//   }
//
// The factory `create({ dataFile })` in store.js picks JsonFileBackend by
// default and re-exports its bound methods, so the rest of the codebase
// (server.js, tests) keeps calling `store.create({ dataFile })` exactly as
// before. When a new backend lands (env-driven) it slots in here without
// touching any caller.

const fs = require('fs');
const path = require('path');

class JsonFileBackend {
  /**
   * @param {string} dataFile absolute path to the JSON store file.
   */
  constructor(dataFile) {
    this.DATA_FILE = dataFile;
    this.MAX_STORE_BYTES =
      Number(process.env.INKQUEUE_MAX_STORE_BYTES) || (5 * 1024 * 1024);
  }

  emptyStore() {
    return { tasks: [], operations: [], notices: [] };
  }

  ensureDataFile() {
    fs.mkdirSync(path.dirname(this.DATA_FILE), { recursive: true });
    if (!fs.existsSync(this.DATA_FILE)) {
      fs.writeFileSync(this.DATA_FILE, JSON.stringify(this.emptyStore(), null, 2));
    }
  }

  backupPath(slot) {
    return this.DATA_FILE + '.bak' + (slot ? '.' + slot : '');
  }

  /** Keep up to 3 rotating backups: .bak, .bak.1, .bak.2 */
  rotateStoreBackups() {
    try {
      if (!fs.existsSync(this.DATA_FILE)) return;
      const b2 = this.backupPath(2);
      const b1 = this.backupPath(1);
      const b0 = this.backupPath('');
      if (fs.existsSync(b2)) { try { fs.unlinkSync(b2); } catch (_) {} }
      if (fs.existsSync(b1)) { try { fs.renameSync(b1, b2); } catch (_) {} }
      if (fs.existsSync(b0)) { try { fs.renameSync(b0, b1); } catch (_) {} }
      fs.copyFileSync(this.DATA_FILE, b0);
    } catch (e) {
      console.warn('[inkqueue-server] backup rotate failed:', e.message);
    }
  }

  tryLoadStoreFrom(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return this.emptyStore();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { tasks: parsed, operations: [], notices: [] };
    if (!parsed || typeof parsed !== 'object') throw new Error('store root not object');
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (!Array.isArray(parsed.operations)) parsed.operations = [];
    if (!Array.isArray(parsed.notices)) parsed.notices = [];
    return parsed;
  }

  warnIfStoreOversized(filePath, store) {
    if (!this.MAX_STORE_BYTES) return;
    try {
      const stat = fs.statSync(filePath);
      const bytes = stat.size;
      if (bytes > this.MAX_STORE_BYTES) {
        const taskCount = Array.isArray(store && store.tasks) ? store.tasks.length : -1;
        const opCount = Array.isArray(store && store.operations) ? store.operations.length : -1;
        console.warn(
          '[inkqueue-server] store exceeds INKQUEUE_MAX_STORE_BYTES=' + this.MAX_STORE_BYTES +
          ' (actual=' + bytes + 'B, tasks=' + taskCount + ', operations=' + opCount + '). ' +
          'Consider pruning archived tasks or compacting operations log.'
        );
      }
    } catch (_) { /* best-effort; missing file already handled by caller */ }
  }

  readStore() {
    this.ensureDataFile();
    try {
      const s = this.tryLoadStoreFrom(this.DATA_FILE);
      this.warnIfStoreOversized(this.DATA_FILE, s);
      return s;
    } catch (e) {
      console.warn('[inkqueue-server] primary store corrupt:', e.message);
      const candidates = [this.backupPath(''), this.backupPath(1), this.backupPath(2)];
      for (const c of candidates) {
        try {
          if (!fs.existsSync(c)) continue;
          const recovered = this.tryLoadStoreFrom(c);
          console.warn('[inkqueue-server] recovered store from', c);
          try {
            const tmp = this.DATA_FILE + '.heal';
            fs.writeFileSync(tmp, JSON.stringify(recovered, null, 2));
            fs.renameSync(tmp, this.DATA_FILE);
          } catch (w) {
            console.warn('[inkqueue-server] heal write failed:', w.message);
          }
          return recovered;
        } catch (be) {
          console.warn('[inkqueue-server] backup unusable', c, be.message);
        }
      }
      console.warn('[inkqueue-server] no usable backup; starting empty store');
      const fresh = this.emptyStore();
      try {
        if (fs.existsSync(this.DATA_FILE)) {
          fs.copyFileSync(this.DATA_FILE, this.DATA_FILE + '.corrupt.' + Date.now());
        }
        fs.writeFileSync(this.DATA_FILE, JSON.stringify(fresh, null, 2));
      } catch (_) {}
      this.warnIfStoreOversized(this.DATA_FILE, fresh);
      return fresh;
    }
  }

  writeStore(store) {
    this.ensureDataFile();
    this.rotateStoreBackups();
    const tmp = this.DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, this.DATA_FILE);
    // Bump mtime to the next whole second so If-Modified-Since (which carries
    // 1s-resolution HTTP-date) can distinguish "changed in the same second"
    // from "not changed". Without this, two writes within the same second
    // both report mtimeSec === sinceSec and a real mutation could be hidden.
    const next = Math.floor(Date.now() / 1000) + 1;
    try {
      fs.utimesSync(this.DATA_FILE, next, next);
    } catch (_) { /* best-effort; stat will use rename mtime as fallback */ }
  }

  operationStore(store) {
    if (!Array.isArray(store.operations)) store.operations = [];
    return store.operations;
  }
}

module.exports = { JsonFileBackend };
