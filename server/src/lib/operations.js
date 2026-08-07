'use strict';

// Device operations engine.
//
// Field ownership (v2):
//   device lifecycle op  → status / completed_at / updated_at, or due_date / due_time
//   agent text patch     → title / note / why / source_session / project / priority
// A device op never rewrites agent text fields; an agent text patch never
// silently rewrites device-applied lifecycle.
//
// `pruneOperations` is owned by the operations handler so response.pruned
// is accurate — `rememberOperation` does NOT internally prune.

const { isValidDate, isValidTime, nullableString } = require('./task');

function applyComplete(task, op, serverTime) {
  task.status = 'done';
  // Server owns mutation timestamps. Device timestamps are hints only.
  task.completed_at = serverTime;
  task.updated_at = serverTime;
}

function applyPostpone(task, op, serverTime) {
  const payload = op.payload || {};
  if (!payload.due_date) throw new Error('postpone requires payload.due_date');
  if (!isValidDate(String(payload.due_date))) throw new Error('invalid due_date');
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time')
      && payload.due_time !== null && payload.due_time !== ''
      && !isValidTime(String(payload.due_time))) {
    throw new Error('invalid due_time');
  }
  // Capture previous due for events/signals (Agent-readable)
  if (!payload.from_due_date && task.due_date) payload.from_due_date = task.due_date;
  task.due_date = String(payload.due_date);
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time')) {
    task.due_time = nullableString(payload.due_time);
  }
  task.updated_at = serverTime;
}

function hasAppliedOperation(store, operationId, operationStore) {
  return operationStore(store).some((item) => item.id === operationId);
}

/**
 * Prune applied operation log (idempotency ring + event stream source).
 * - drops entries missing id
 * - drops legacy records without `type` (incomplete, dead weight)
 * - drops entries older than ttlDays (if > 0)
 * - keeps newest maxRetained
 * Returns number of removed entries. Caller is responsible for writeStore.
 */
function pruneOperations(store, options, operationStore) {
  // Backward-compat: second arg can be a number (nowMs) from old callers.
  if (typeof options === 'number') options = { nowMs: options };
  const opts = options || {};
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const ttlDays = Number(opts.ttlDays != null ? opts.ttlDays : 30);
  const maxRetained = Number(opts.maxRetained != null ? opts.maxRetained : 500);

  const ops = operationStore(store);
  const before = ops.length;
  const ttlMs = ttlDays > 0 ? ttlDays * 24 * 60 * 60 * 1000 : 0;
  const kept = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !op.id) continue;
    if (!op.type) continue;
    const at = op.applied_at || op.occurred_at || null;
    if (ttlMs > 0 && at) {
      const t = Date.parse(at);
      if (Number.isFinite(t) && (nowMs - t) > ttlMs) continue;
    }
    kept.push(op);
  }
  kept.sort((a, b) => String(a.applied_at || '').localeCompare(String(b.applied_at || '')));
  const trimmed = kept.length > maxRetained
    ? kept.slice(kept.length - maxRetained)
    : kept;
  store.operations = trimmed;
  return before - trimmed.length;
}

function rememberOperation(store, operationId, taskId, serverTime, opType, payload, taskTitle, deviceId, operationStore) {
  operationStore(store).push({
    id: operationId,
    task_id: taskId,
    task_title: taskTitle || null,
    type: opType || null,
    payload: payload || null,
    applied_at: serverTime,
    device_id: deviceId || null
  });
}

module.exports = {
  applyComplete, applyPostpone,
  hasAppliedOperation, pruneOperations, rememberOperation
};
