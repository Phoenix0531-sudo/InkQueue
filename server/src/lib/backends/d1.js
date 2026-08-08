'use strict';

// D1Backend — Cloudflare D1 / SQLite-compatible store backend stub.
//
// Contract (must implement to be wired via INKQUEUE_STORE_BACKEND=d1):
//
//   emptyStore()                       → { tasks: [], operations: [] }
//   ensureDataFile()                   → void  (no-op for D1; D1 is remote)
//   readStore()                        → { tasks: Array, operations: Array }
//   writeStore(store)                  → void
//   operationStore(store)              → Array  (live ops sub-array)
//   backupPath(slot)                   → string (no-op; D1 does snapshots)
//   rotateStoreBackups()               → void   (no-op for D1)
//   tryLoadStoreFrom(filePath)         → store  (no-op; D1 reads via SQL)
//   DATA_FILE                          → string (sentinel; unused)
//
// The D1 schema is intentionally close to ./schema.sql (kept in the same dir
// once we wire it). Sketch (NOT shipped — kept here so when we go production we
// have the schema in front of us):
//
//   CREATE TABLE IF NOT EXISTS tasks (
//     id           TEXT PRIMARY KEY,
//     title        TEXT NOT NULL,
//     note         TEXT,
//     status       TEXT NOT NULL,
//     due_date     TEXT,
//     due_time     TEXT,
//     project      TEXT,
//     priority     TEXT,
//     created_at   TEXT,
//     updated_at   TEXT,
//     completed_at TEXT,
//     source       TEXT,
//     raw_json     TEXT
//   );
//
//   CREATE TABLE IF NOT EXISTS operations (
//     id TEXT PRIMARY KEY,
//     type TEXT NOT NULL,
//     task_id TEXT NOT NULL,
//     payload TEXT NOT NULL,
//     created_at TEXT NOT NULL,
//     applied_at TEXT,
//     device_id TEXT,
//     retry_count INTEGER DEFAULT 0,
//     last_error TEXT
//   );
//
// Today this stub throws on every call so no production traffic accidentally
// hits a half-built backend. It exists for documentation + future work.

class D1Backend {
  constructor(dataFile, /* optional */ bindings) {
    this.DATA_FILE = dataFile || '<d1-binding>';
    this._bindings = bindings || null;  // env.D1 if wired from a Worker
  }
  _notImpl(method) {
    throw new Error('D1Backend.' + method + '() not implemented — ' +
      'see server/src/lib/backends/d1.js for the contract. ' +
      'Switch back via INKQUEUE_STORE_BACKEND=json-file.');
  }
  emptyStore() { return { tasks: [], operations: [], notices: [] }; }
  ensureDataFile() { /* no-op for D1 */ }
  readStore()        { this._notImpl('readStore'); }
  writeStore()       { this._notImpl('writeStore'); }
  operationStore(s)  {
    if (!Array.isArray(s.operations)) s.operations = [];
    return s.operations;
  }
  backupPath()        { return ''; }
  rotateStoreBackups(){ /* no-op for D1 */ }
}

module.exports = { D1Backend };
