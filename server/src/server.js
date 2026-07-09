'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = Number(process.env.INKQUEUE_PORT || 8787);
const TOKEN = process.env.INKQUEUE_TOKEN || 'dev-token';
const DATA_FILE = process.env.INKQUEUE_DATA_FILE || path.join(__dirname, '..', 'data', 'tasks.json');
const VALID_STATUSES = new Set(['todo', 'done', 'archived']);
const VALID_PRIORITIES = new Set(['normal', 'high']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  const d = new Date();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hh = pad(Math.trunc(Math.abs(offsetMinutes) / 60));
  const mm = pad(Math.abs(offsetMinutes) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

function ensureDataFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  }
}

function readStore() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : { tasks: [] };
  if (Array.isArray(parsed)) return { tasks: parsed };
  if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
  return parsed;
}

function writeStore(store) {
  ensureDataFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tasks: store.tasks }, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function sendJson(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body, null, 2));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': encoded.length,
    'Cache-Control': 'no-store'
  });
  res.end(encoded);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let failed = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (failed) return;
      body += chunk;
      if (body.length > 1024 * 1024) {
        failed = true;
        reject(new HttpError(413, 'request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (failed) return;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new HttpError(400, 'invalid json'));
      }
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

function hasToken(req) {
  return req.headers['x-inkqueue-token'] === TOKEN;
}

function generatedId(prefix) {
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now().toString(36)}_${random}`;
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
    force_today: resolveForceToday(input, base)
  };
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
  if (input.status !== undefined && !VALID_STATUSES.has(String(input.status))) {
    throw new HttpError(400, 'invalid status');
  }
  if (input.priority !== undefined && !VALID_PRIORITIES.has(String(input.priority))) {
    throw new HttpError(400, 'invalid priority');
  }
  if (input.due_date !== undefined && input.due_date !== null && input.due_date !== '' && !isValidDate(String(input.due_date))) {
    throw new HttpError(400, 'invalid due_date');
  }
  if (input.due_time !== undefined && input.due_time !== null && input.due_time !== '' && !isValidTime(String(input.due_time))) {
    throw new HttpError(400, 'invalid due_time');
  }
}

function publicTask(task) {
  const out = { ...task };
  if (!out.force_today) delete out.force_today;
  return out;
}

function applyComplete(task, op, serverTime) {
  task.status = 'done';
  task.completed_at = nullableString(op.payload && op.payload.completed_at) || serverTime;
  task.updated_at = serverTime;
}

function applyPostpone(task, op, serverTime) {
  const payload = op.payload || {};
  if (!payload.due_date) throw new Error('postpone requires payload.due_date');
  if (!isValidDate(String(payload.due_date))) throw new Error('invalid due_date');
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time') && payload.due_time !== null && payload.due_time !== '' && !isValidTime(String(payload.due_time))) {
    throw new Error('invalid due_time');
  }
  task.due_date = String(payload.due_date);
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time')) {
    task.due_time = nullableString(payload.due_time);
  }
  task.updated_at = serverTime;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!hasToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/tasks/snapshot') {
    const store = readStore();
    sendJson(res, 200, { server_time: nowIso(), tasks: store.tasks.map(publicTask) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks') {
    const input = await readBody(req);
    validateTaskInput(input, true);
    const store = readStore();
    const task = normalizeTask(input, null);
    store.tasks.push(task);
    writeStore(store);
    sendJson(res, 201, { task: publicTask(task) });
    return;
  }

  const patchMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const id = decodeURIComponent(patchMatch[1]);
    const input = await readBody(req);
    validateTaskInput(input, false);
    const store = readStore();
    const index = store.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const allowed = {};
    for (const key of ['title', 'note', 'status', 'due_date', 'due_time', 'project', 'priority', 'source', 'force_today', 'today', 'completed_at']) {
      if (Object.prototype.hasOwnProperty.call(input, key)) allowed[key] = input[key];
    }
    const updated = normalizeTask(allowed, store.tasks[index]);
    if (updated.status === 'done' && !updated.completed_at) updated.completed_at = nowIso();
    store.tasks[index] = updated;
    writeStore(store);
    sendJson(res, 200, { task: publicTask(updated) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks/operations') {
    const input = await readBody(req);
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const accepted = [];
    const ignored = [];
    const errors = [];
    const store = readStore();

    for (const op of operations) {
      const opId = op && op.id ? String(op.id) : generatedId('op_missing_id');
      const serverTime = nowIso();
      try {
        if (!op || typeof op !== 'object') throw new Error('operation must be an object');
        if (!op.task_id) throw new Error('operation requires task_id');
        const task = store.tasks.find((item) => item.id === op.task_id);
        if (!task || task.status === 'archived') {
          ignored.push(opId);
          continue;
        }
        if (op.type === 'complete') {
          applyComplete(task, op, serverTime);
        } else if (op.type === 'postpone') {
          applyPostpone(task, op, serverTime);
        } else {
          throw new Error(`unsupported operation type: ${op.type}`);
        }
        accepted.push(opId);
      } catch (err) {
        errors.push({ id: opId, error: err.message });
      }
    }

    if (accepted.length || ignored.length) writeStore(store);
    sendJson(res, 200, { server_time: nowIso(), accepted, ignored, errors });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error('[inkqueue-server]', err);
      sendJson(res, 500, { error: 'server error' });
    });
  });
}

function start(port = DEFAULT_PORT, callback) {
  const server = createServer();
  server.listen(port, callback);
  return server;
}

if (require.main === module) {
  start(DEFAULT_PORT, () => {
    console.log(`InkQueue reference server listening on http://localhost:${DEFAULT_PORT}`);
    console.log(`Token header: X-InkQueue-Token: ${TOKEN}`);
    console.log(`Data file: ${DATA_FILE}`);
  });
}

module.exports = { createServer, start, readStore, writeStore, nowIso };
