'use strict';

// JSON-file store for the reference server.
// Production deployments should drop in a KV/D1-backed implementation
// that implements the same surface (read/write + operations sub-array).
//
// module level state: rotating backups + .tmp atomic rename.

const fs = require('fs');
const path = require('path');

function create({ dataFile }) {
  const DATA_FILE = dataFile;

  function emptyStore() {
    return { tasks: [], operations: [] };
  }

  function ensureDataFile() {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(emptyStore(), null, 2));
    }
  }

  function backupPath(slot) {
    return DATA_FILE + '.bak' + (slot ? '.' + slot : '');
  }

  /** Keep up to 3 rotating backups: .bak, .bak.1, .bak.2 */
  function rotateStoreBackups() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const b2 = backupPath(2);
      const b1 = backupPath(1);
      const b0 = backupPath('');
      if (fs.existsSync(b2)) { try { fs.unlinkSync(b2); } catch (_) {} }
      if (fs.existsSync(b1)) { try { fs.renameSync(b1, b2); } catch (_) {} }
      if (fs.existsSync(b0)) { try { fs.renameSync(b0, b1); } catch (_) {} }
      fs.copyFileSync(DATA_FILE, b0);
    } catch (e) {
      console.warn('[inkqueue-server] backup rotate failed:', e.message);
    }
  }

  function tryLoadStoreFrom(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return emptyStore();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { tasks: parsed, operations: [] };
    if (!parsed || typeof parsed !== 'object') throw new Error('store root not object');
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (!Array.isArray(parsed.operations)) parsed.operations = [];
    return parsed;
  }

  function readStore() {
    ensureDataFile();
    try {
      return tryLoadStoreFrom(DATA_FILE);
    } catch (e) {
      console.warn('[inkqueue-server] primary store corrupt:', e.message);
      const candidates = [backupPath(''), backupPath(1), backupPath(2)];
      for (const c of candidates) {
        try {
          if (!fs.existsSync(c)) continue;
          const recovered = tryLoadStoreFrom(c);
          console.warn('[inkqueue-server] recovered store from', c);
          try {
            const tmp = DATA_FILE + '.heal';
            fs.writeFileSync(tmp, JSON.stringify(recovered, null, 2));
            fs.renameSync(tmp, DATA_FILE);
          } catch (w) {
            console.warn('[inkqueue-server] heal write failed:', w.message);
          }
          return recovered;
        } catch (be) {
          console.warn('[inkqueue-server] backup unusable', c, be.message);
        }
      }
      console.warn('[inkqueue-server] no usable backup; starting empty store');
      const fresh = emptyStore();
      try {
        if (fs.existsSync(DATA_FILE)) {
          fs.copyFileSync(DATA_FILE, DATA_FILE + '.corrupt.' + Date.now());
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
      } catch (_) {}
      return fresh;
    }
  }

  function writeStore(store) {
    ensureDataFile();
    rotateStoreBackups();
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    // Bump mtime to the next whole second so If-Modified-Since (which carries
    // 1s-resolution HTTP-date) can distinguish "changed in the same second"
    // from "not changed". Without this, two writes within the same second
    // both report mtimeSec === sinceSec and a real mutation could be hidden.
    const next = Math.floor(Date.now() / 1000) + 1;
    try {
      fs.utimesSync(DATA_FILE, next, next);
    } catch (_) { /* best-effort; stat will use rename mtime as fallback */ }
  }

  function operationStore(store) {
    if (!Array.isArray(store.operations)) store.operations = [];
    return store.operations;
  }

  return { emptyStore, ensureDataFile, backupPath, rotateStoreBackups,
    tryLoadStoreFrom, readStore, writeStore, operationStore,
    DATA_FILE };
}

module.exports = { create };
