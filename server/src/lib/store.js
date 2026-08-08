'use strict';

// StoreBackend factory.
//
// The server calls `require('./lib/store').create({ dataFile })` and gets back
// an object exposing readStore/writeStore/operationStore/emptyStore/
// ensureDataFile/backupPath/rotateStoreBackups/tryLoadStoreFrom/DATA_FILE —
// the same surface the rest of the codebase has always called.
//
// Internally it now picks a StoreBackend implementation. The default
// JsonFileBackend (lib/backends/json-file.js) reproduces the exact behavior
// shipped through v0.9.5: .tmp atomic rename + rotating .bak/.bak.1/.bak.2
// backups + corrupt-file self-heal + size warn keyed on
// INKQUEUE_MAX_STORE_BYTES + mtime bump for If-Modified-Since.
//
// To plug a production backend (Cloudflare D1, SQLite, KV) drop a class under
// lib/backends/ that implements StoreBackend (see backends/json-file.js for
// the contract) and select it via INKQUEUE_STORE_BACKEND. Stubs for D1 and
// SQLite are kept alongside for reference; neither is wired to live traffic.

const { JsonFileBackend } = require('./backends/json-file');

function selectBackend({ dataFile, backendHint }) {
  const hint = backendHint || process.env.INKQUEUE_STORE_BACKEND || 'json-file';
  switch (String(hint).toLowerCase()) {
    case 'json-file':
    case 'json':
    case '':
      return new JsonFileBackend(dataFile);
    // Future: 'd1' → require('./backends/d1'); 'sqlite' → require('./backends/sqlite');
    // Stubs in lib/backends/ document the contract but throw on use today.
    default:
      throw new Error('unknown INKQUEUE_STORE_BACKEND=' + hint +
        ' (supported: json-file)');
  }
}

/**
 * Create a store API bound to `dataFile`. Returns the same method surface
 * every prior version of store.js exported, so callers do not need to change.
 */
function create({ dataFile, backendHint }) {
  const backend = selectBackend({ dataFile, backendHint });
  return {
    emptyStore:        backend.emptyStore.bind(backend),
    ensureDataFile:   backend.ensureDataFile.bind(backend),
    backupPath:       backend.backupPath.bind(backend),
    rotateStoreBackups: backend.rotateStoreBackups.bind(backend),
    tryLoadStoreFrom: backend.tryLoadStoreFrom.bind(backend),
    readStore:        backend.readStore.bind(backend),
    writeStore:       backend.writeStore.bind(backend),
    operationStore:   backend.operationStore.bind(backend),
    DATA_FILE:        backend.DATA_FILE,
    _backend:         backend  // exposed for tests / introspection only
  };
}

module.exports = { create, selectBackend, JsonFileBackend };
