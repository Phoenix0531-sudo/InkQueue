'use strict';

// SqliteBackend — SQLite-backed store backend stub.
//
// Same contract as JsonFileBackend (see backends/json-file.js for the surface
// a backend must implement). Kept for future production paths (a self-hosted
// Node server with better-sqlite3 beats JSON for >5k tasks). Like d1.js this
// stub throws on the live methods; it exists to document the contract and to
// keep the backend registry readable.
//
// Sketch wiring (NOT shipped):
//
//   const Database = require('better-sqlite3');
//   const db = new Database(this.DB_PATH);
//   db.exec(`
//     CREATE TABLE IF NOT EXISTS tasks ( id TEXT PRIMARY KEY, ... );
//     CREATE TABLE IF NOT EXISTS operations ( id TEXT PRIMARY KEY, ... );
//   `);
//   readStore() {
//     return {
//       tasks:      db.prepare('SELECT * FROM tasks').all().map(rowToTask),
//       operations: db.prepare('SELECT * FROM operations').all().map(rowToOp)
//     };
//   }
//   writeStore(store) {
//     const tx = db.transaction(() => {
//       db.prepare('DELETE FROM tasks').run();
//       db.prepare('DELETE FROM operations').run();
//       for (const t of store.tasks) insertTask(db, t);
//       for (const o of store.operations) insertOp(db, o);
//     });
//     tx();
//   }
//
// Today this stub throws on every live call. Switch back via
// INKQUEUE_STORE_BACKEND=json-file.

class SqliteBackend {
  constructor(dataFile) {
    this.DATA_FILE = dataFile || '<sqlite-path>';
    this.DB_PATH = dataFile ? dataFile + '.sqlite' : null;
  }
  _notImpl(method) {
    throw new Error('SqliteBackend.' + method + '() not implemented — ' +
      'see server/src/lib/backends/sqlite.js for the contract. ' +
      'Switch back via INKQUEUE_STORE_BACKEND=json-file.');
  }
  emptyStore() { return { tasks: [], operations: [], notices: [] }; }
  ensureDataFile() { /* no-op until wired */ }
  readStore()               { this._notImpl('readStore'); }
  writeStore()              { this._notImpl('writeStore'); }
  operationStore(s)         {
    if (!Array.isArray(s.operations)) s.operations = [];
    return s.operations;
  }
}

module.exports = { SqliteBackend };
