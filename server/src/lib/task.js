'use strict';

// Task shape, normalisation and validation.
// Field ownership rules live with the operations module (applyComplete/postpone)
// — this module is shape-only and never mutates existing task id.

const crypto = require('crypto');
const { nowIso } = require('./time');

const VALID_STATUSES = new Set(['todo', 'done', 'archived']);
const VALID_PRIORITIES = new Set(['normal', 'high']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function generatedId(prefix) {
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function nullableString(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function resolveForceToday(input, base) {
  if (Object.prototype.hasOwnProperty.call(input, 'force_today')) return Boolean(input.force_today);
  if (Object.prototype.hasOwnProperty.call(input, 'today')) return Boolean(input.today);
  return Boolean(base.force_today || base.today || false);
}

function normalizeTask(input, existing) {
  const now = nowIso();
  const base = existing || {};
  return {
    id: base.id || input.id || generatedId('task'),
    title: String(input.title || base.title || '').trim(),
    note: input.note !== undefined ? nullableString(input.note) : nullableString(base.note),
    status: input.status || base.status || 'todo',
    due_date: input.due_date !== undefined ? nullableString(input.due_date) : nullableString(base.due_date),
    due_time: input.due_time !== undefined ? nullableString(input.due_time) : nullableString(base.due_time),
    project: input.project !== undefined ? nullableString(input.project) : nullableString(base.project),
    priority: input.priority || base.priority || 'normal',
    created_at: base.created_at || input.created_at || now,
    updated_at: now,
    completed_at: input.completed_at !== undefined ? nullableString(input.completed_at) : nullableString(base.completed_at),
    source: input.source || base.source || 'agent',
    why: input.why !== undefined ? nullableString(input.why) : nullableString(base.why),
    source_session: input.source_session !== undefined
      ? nullableString(input.source_session)
      : nullableString(base.source_session),
    force_today: resolveForceToday(input, base)
  };
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateTaskInput(input, requireTitle) {
  if (requireTitle || Object.prototype.hasOwnProperty.call(input, 'title')) {
    if (!input.title || !String(input.title).trim()) throw new HttpError(400, 'title required');
  }
  if (input.status !== undefined && !VALID_STATUSES.has(String(input.status))) throw new HttpError(400, 'invalid status');
  if (input.priority !== undefined && !VALID_PRIORITIES.has(String(input.priority))) throw new HttpError(400, 'invalid priority');
  if (input.due_date !== undefined && input.due_date !== null && input.due_date !== '' && !isValidDate(String(input.due_date))) throw new HttpError(400, 'invalid due_date');
  if (input.due_time !== undefined && input.due_time !== null && input.due_time !== '' && !isValidTime(String(input.due_time))) throw new HttpError(400, 'invalid due_time');
}

function publicTask(task) {
  const out = { ...task };
  if (!out.force_today) delete out.force_today;
  if (out.why == null) delete out.why;
  if (out.source_session == null) delete out.source_session;
  if (out.project == null) delete out.project;
  return out;
}

module.exports = {
  HttpError,
  VALID_STATUSES,
  VALID_PRIORITIES,
  generatedId, nullableString, resolveForceToday,
  normalizeTask, isValidDate, isValidTime, validateTaskInput, publicTask
};
