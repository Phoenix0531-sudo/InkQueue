'use strict';

// InkQueue reference server — thin entry point.
//
// Modules:
//   lib/time.js         — nowIso, nowIsoMinusSeconds
//   lib/store.js        — JSON file store + backups + .heal
//   lib/task.js         — normalize/validate/publicTask + HttpError
//   lib/operations.js   — applyComplete/applyPostpone/prune/remember
//   lib/agent.js        — events/signals/suggestion/webhook
//   lib/http.js         — sendJson/readBody/token gate
//   lib/usage-routes.js — optional CPA dashboard routes (cliproxy isolated)

const http = require('http');
const fs = require('fs');
const os = require('os');

const time = require('./lib/time');
const storeMod = require('./lib/store');
const taskMod = require('./lib/task');
const opsMod = require('./lib/operations');
const agentMod = require('./lib/agent');
const httpMod = require('./lib/http');
const usageRoutes = require('./lib/usage-routes');

const { nowIso, nowIsoMinusSeconds } = time;
const { HttpError, generatedId, normalizeTask, validateTaskInput, publicTask } = taskMod;

const DEFAULT_PORT = Number(process.env.INKQUEUE_PORT || 8787);
const DISCOVERY_PORT = Number(process.env.INKQUEUE_DISCOVERY_PORT || 48787);
const TOKEN = process.env.INKQUEUE_TOKEN || 'dev-token';
const TOKEN_PREV = process.env.INKQUEUE_TOKEN_PREV || '';
const DATA_FILE = process.env.INKQUEUE_DATA_FILE || require('path').join(__dirname, '..', 'data', 'tasks.json');
const CONFIG_FILE = process.env.INKQUEUE_CONFIG_FILE || require('path').join(__dirname, '..', 'data', 'config.json');
const MAX_WEBHOOK_ITEMS = 50;
const MAX_OPERATIONS_RETAINED = Number(process.env.INKQUEUE_MAX_OPERATIONS || 500);
const OPERATIONS_TTL_DAYS = Number(process.env.INKQUEUE_OPERATIONS_TTL_DAYS || 30);
const TLS_KEY_PATH = process.env.INKQUEUE_TLS_KEY || '';
const TLS_CERT_PATH = process.env.INKQUEUE_TLS_CERT || '';
const DISABLE_USAGE = process.env.INKQUEUE_DISABLE_USAGE === '1';

// ── store instance ──

const store = storeMod.create({ dataFile: DATA_FILE });
const { readStore, writeStore, ensureDataFile, rotateStoreBackups, operationStore } = store;
const { emptyStore } = store;

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch (_) {
    return {};
  }
}

// ── token helpers (bound to this server's TOKEN / TOKEN_PREV) ──

function tokenMatches(value) {
  return httpMod.tokenMatches(value, TOKEN, TOKEN_PREV);
}
function hasToken(req) {
  return httpMod.hasToken(req, TOKEN, TOKEN_PREV);
}
function hasTokenOrQuery(req, url) {
  return httpMod.hasTokenOrQuery(req, url, TOKEN, TOKEN_PREV);
}

// ── operations helpers (bound to this server's store) ──

function pruneOps(storeObj, opts) {
  return opsMod.pruneOperations(storeObj, {
    ttlDays: OPERATIONS_TTL_DAYS,
    maxRetained: MAX_OPERATIONS_RETAINED,
    ...opts
  }, operationStore);
}

function rememberOp(storeObj, opId, taskId, serverTime, opType, payload, taskTitle, deviceId) {
  opsMod.rememberOperation(storeObj, opId, taskId, serverTime, opType, payload, taskTitle, deviceId, operationStore);
}

function hasAppliedOp(storeObj, opId) {
  return opsMod.hasAppliedOperation(storeObj, opId, operationStore);
}

// ── webhook config ──

function agentWebhookUrl() {
  const config = readConfig();
  return config.agent_webhook_url || process.env.INKQUEUE_AGENT_WEBHOOK_URL || '';
}

function notifyAgentWebhook(event) {
  agentMod.notifyAgentWebhook(event, agentWebhookUrl());
}

function webhookEventId(input) {
  return agentMod.webhookEventId(input, generatedId);
}

// ── sendJson ──

function sendJson(res, status, body, headers) {
  httpMod.sendJson(res, status, body, headers);
}

// ── optional usage routes ──

let usageHandler = null;
if (!DISABLE_USAGE) {
  usageHandler = usageRoutes.attachUsageRoutes({
    readConfig, hasToken, hasTokenOrQuery,
    sendJson, nowIso
  });
}

// ── main request handler ──

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true }); return;
  }

  // Optional CPA usage / admin routes (cliproxy isolated here).
  if (usageHandler) {
    const handled = await usageHandler(req, res, url);
    if (handled) return;
  }

  if (!hasToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' }); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/tasks/snapshot') {
    // If-Modified-Since conditional: when the client passes an HTTP-date
    // (e.g. last `server_time` they saw, or the file mtime), and the on-disk
    // store has not been modified since, return 304 with empty body. This
    // is the e-ink power-saving path — Kindle polls every few minutes but
    // most ticks short-circuit with no JSON body to download or parse.
    const imsHeader = req.headers['if-modified-since'];
    if (imsHeader) {
      const sinceMs = Date.parse(imsHeader);
      if (!Number.isNaN(sinceMs)) {
        try {
          const stat = fs.statSync(DATA_FILE);
          const mtimeSec = Math.floor(stat.mtimeMs / 1000);
          const sinceSec = Math.floor(sinceMs / 1000);
          // <= (not <): when the client sends back the Last-Modified we just
          // handed it, mtimeSec === sinceSec means the store has NOT changed
          // since (the same second). writeStore() bumps mtime to the next
          // whole second on every mutation (see lib/store.js), so a real
          // change always makes mtimeSec > sinceSec.
          if (mtimeSec <= sinceSec) {
            res.writeHead(304, { 'Last-Modified': stat.mtime.toUTCString() });
            res.end();
            return;
          }
        } catch (_) {
          // stat failed (file missing?) — fall through to full snapshot.
        }
      }
    }
    const s = readStore();
    const headers = {};
    try {
      const stat = fs.statSync(DATA_FILE);
      headers['Last-Modified'] = stat.mtime.toUTCString();
    } catch (_) {}
    sendJson(res, 200, { server_time: nowIso(), tasks: s.tasks.map(publicTask) }, headers); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/events') {
    const s = readStore();
    const since = url.searchParams.get('since') || '';
    const deviceFilter = url.searchParams.get('device_id') || url.searchParams.get('device') || '';
    const limitParam = Number(url.searchParams.get('limit') || 0);
    let events = agentMod.listEvents(s, since, deviceFilter || null, operationStore);
    if (limitParam > 0 && events.length > limitParam) {
      events = events.slice(events.length - limitParam);
    }
    const latest = events.length ? events[events.length - 1].occurred_at : null;
    const signals = agentMod.deriveSignals(events);
    sendJson(res, 200, {
      server_time: nowIso(), events, signals,
      latest_event_at: latest, device_id: deviceFilter || null
    }); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/agent/context') {
    const s = readStore();
    const today = nowIso().slice(0, 10);
    const tasks = s.tasks.filter((t) => t.status !== 'archived');
    const open = tasks.filter((t) => t.status === 'todo');
    const done = tasks.filter((t) => t.status === 'done');
    let overdue = 0, todayCount = 0, weekCount = 0, laterCount = 0;
    for (const t of open) {
      if (!t.due_date) { laterCount++; continue; }
      if (t.due_date < today) overdue++;
      else if (t.due_date === today) todayCount++;
      else if (t.due_date <= agentMod.endOfWeek(today)) weekCount++;
      else laterCount++;
    }
    const sevenAgo = nowIsoMinusSeconds(7 * 86400);
    const recentDone = done.filter((t) => t.completed_at && t.completed_at >= sevenAgo).length;
    const dayAgo = nowIsoMinusSeconds(86400);
    const ops = operationStore(s);
    const recentOps = ops.filter((o) => o.applied_at >= dayAgo);
    const recentCompletes = recentOps.filter((o) => o.type === 'complete').length;
    const recentPostpones = recentOps.filter((o) => o.type === 'postpone').length;
    sendJson(res, 200, {
      server_time: nowIso(), today_date: today,
      open: { overdue, today: todayCount, this_week: weekCount, later: laterCount, total: open.length },
      done_total: done.length, completed_last_7d: recentDone,
      device_activity_24h: { completes: recentCompletes, postpones: recentPostpones },
      suggestion: { note: agentMod.buildAgentSuggestion(overdue, todayCount, weekCount, recentDone, recentPostpones) }
    }); return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks') {
    const input = await httpMod.readBody(req);
    validateTaskInput(input, true);
    const s = readStore();
    const task = normalizeTask(input, null);
    s.tasks.push(task);
    writeStore(s);
    sendJson(res, 201, { task: publicTask(task) }); return;
  }

  const patchMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const id = decodeURIComponent(patchMatch[1]);
    const input = await httpMod.readBody(req);
    validateTaskInput(input, false);
    const s = readStore();
    const index = s.tasks.findIndex((task) => task.id === id);
    if (index === -1) { sendJson(res, 404, { error: 'not found' }); return; }
    const allowed = {};
    const AGENT_TEXT = ['title', 'note', 'project', 'why', 'source_session', 'priority', 'source', 'force_today', 'today'];
    const LIFECYCLE = ['status', 'due_date', 'due_time', 'completed_at'];
    for (const key of AGENT_TEXT.concat(LIFECYCLE)) {
      if (Object.prototype.hasOwnProperty.call(input, key)) allowed[key] = input[key];
    }
    const before = s.tasks[index];
    const updated = normalizeTask(allowed, before);
    if (updated.status === 'done' && !updated.completed_at) updated.completed_at = nowIso();
    const textOnly = Object.keys(allowed).every((k) => AGENT_TEXT.includes(k));
    if (textOnly) {
      updated.status = before.status;
      updated.due_date = before.due_date;
      updated.due_time = before.due_time;
      updated.completed_at = before.completed_at;
    }
    s.tasks[index] = updated;
    writeStore(s);
    sendJson(res, 200, {
      task: publicTask(updated),
      conflict_policy: 'agent_text_device_lifecycle',
      merged: {
        agent_fields: AGENT_TEXT.filter((k) => Object.prototype.hasOwnProperty.call(allowed, k)),
        preserved_lifecycle: textOnly ? ['status', 'due_date', 'due_time', 'completed_at'] : []
      }
    }); return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks/operations') {
    const input = await httpMod.readBody(req);
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const deviceId = input && input.device_id ? String(input.device_id).slice(0, 64) : null;
    const accepted = [];
    const ignored = [];
    const ignoredDetails = [];
    const errors = [];
    const s = readStore();

    for (const op of operations) {
      const opId = op && op.id ? String(op.id) : generatedId('op_missing_id');
      const serverTime = nowIso();
      try {
        if (!op || typeof op !== 'object') throw new Error('operation must be an object');
        if (!op.task_id) throw new Error('operation requires task_id');
        if (hasAppliedOp(s, opId)) { accepted.push(opId); continue; }
        const task = s.tasks.find((item) => item.id === op.task_id);
        if (!task) {
          ignored.push(opId);
          ignoredDetails.push({ id: opId, reason: 'task_not_found', message: '任务不存在，已忽略' });
          continue;
        }
        if (task.status === 'archived') {
          ignored.push(opId);
          ignoredDetails.push({ id: opId, reason: 'task_archived', message: '任务已归档，已忽略' });
          continue;
        }
        if (op.type === 'complete') { opsMod.applyComplete(task, op, serverTime); }
        else if (op.type === 'postpone') { opsMod.applyPostpone(task, op, serverTime); }
        else { throw new Error(`unsupported operation type: ${op.type}`); }
        rememberOp(s, opId, String(op.task_id), serverTime,
            op.type, op.payload || null, task.title, deviceId);
        accepted.push(opId);
        notifyAgentWebhook({ event_id: opId, type: op.type, task_id: String(op.task_id),
            task_title: task.title, occurred_at: serverTime, payload: op.payload || null,
            device_id: deviceId });
      } catch (err) { errors.push({ id: opId, error: err.message }); }
    }

    const pruned = pruneOps(s);
    if (accepted.length || ignored.length || pruned > 0) writeStore(s);
    sendJson(res, 200, { server_time: nowIso(), accepted, ignored, ignored_details: ignoredDetails, errors, pruned }); return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/webhook/agent') {
    const input = await httpMod.readBody(req);
    const eventId = webhookEventId(input);
    const s = readStore();
    const evStore = operationStore(s);
    if (eventId && evStore.some((item) => item.webhook_event_id === eventId)) {
      sendJson(res, 200, { event_id: eventId, duplicate: true, created: [], updated: [] }); return;
    }
    const created = [];
    const updated = [];
    const tasks = agentMod.webhookTasks(input);
    if (!tasks.length || tasks.length > MAX_WEBHOOK_ITEMS) {
      throw new HttpError(400, `tasks must contain 1-${MAX_WEBHOOK_ITEMS} items`);
    }
    for (const item of tasks) {
      if (!item || typeof item !== 'object') throw new HttpError(400, 'task must be an object');
      const taskInput = { ...item, source: item.source || 'agent' };
      validateTaskInput(taskInput, !item.id);
      const index = item.id ? s.tasks.findIndex((task) => task.id === String(item.id)) : -1;
      if (index === -1) {
        const task = normalizeTask(taskInput, null);
        s.tasks.push(task);
        created.push(publicTask(task));
      } else {
        const allowed = {};
        for (const key of ['title', 'note', 'project', 'why', 'source_session', 'status', 'due_date', 'due_time', 'priority', 'source', 'force_today', 'today', 'completed_at']) {
          if (Object.prototype.hasOwnProperty.call(taskInput, key)) allowed[key] = taskInput[key];
        }
        const task = normalizeTask(allowed, s.tasks[index]);
        if (task.status === 'done' && !task.completed_at) task.completed_at = nowIso();
        s.tasks[index] = task;
        updated.push(publicTask(task));
      }
    }
    if (eventId) evStore.push({ webhook_event_id: eventId, applied_at: nowIso() });
    writeStore(s);
    sendJson(res, 200, { server_time: nowIso(), event_id: eventId, duplicate: false, created, updated }); return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function requestHandler(req, res) {
  handleRequest(req, res).catch((err) => {
    if (err instanceof HttpError) { sendJson(res, err.status, { error: err.message }); return; }
    console.error('[inkqueue-server]', err);
    sendJson(res, 500, { error: 'server error' });
  });
}

function createServer() {
  if (TLS_KEY_PATH && TLS_CERT_PATH) {
    try {
      const key = fs.readFileSync(TLS_KEY_PATH);
      const cert = fs.readFileSync(TLS_CERT_PATH);
      return require('https').createServer({ key, cert }, requestHandler);
    } catch (e) {
      console.warn('[inkqueue-server] TLS enabled but failed to load key/cert:', e.message);
      console.warn('[inkqueue-server] falling back to plain HTTP');
    }
  }
  return http.createServer(requestHandler);
}

function start(port, callback) {
  // start(0) → ephemeral port; start() → DEFAULT_PORT.
  if (port === undefined) port = DEFAULT_PORT;
  // Startup maintenance: prune expired/dead operations before serving traffic.
  try {
    const s = readStore();
    const pruned = pruneOps(s);
    if (pruned > 0) writeStore(s);
    console.log('[inkqueue-server] startup prune: removed ' + pruned + ' expired/dead operations');
  } catch (e) {
    console.warn('[inkqueue-server] startup prune failed:', e.message);
  }
  const server = createServer();
  server.listen(port, callback);
  return server;
}

function validateStartupConfig(configFile, logger) {
  configFile = configFile || CONFIG_FILE;
  logger = logger || console;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      logger.warn('Config: data/config.json not found, /v1/usage will return CPA-only defaults');
    } else {
      logger.warn('Config: config.json parse error:', e.message);
    }
    return;
  }
  if (!config || typeof config !== 'object') {
    logger.warn('Config: config.json is empty or invalid, /v1/usage will return CPA-only defaults');
  }
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

if (require.main === module) {
  validateStartupConfig();
  try {
    readStore();
    rotateStoreBackups();
  } catch (e) {
    console.warn('[inkqueue-server] startup store check failed:', e.message);
  }

  start(DEFAULT_PORT, () => {
    const scheme = (TLS_KEY_PATH && TLS_CERT_PATH) ? 'https' : 'http';
    console.log(`InkQueue reference server listening on ${scheme}://localhost:${DEFAULT_PORT}`);
    console.log(`Token header: X-InkQueue-Token: ${TOKEN}`);
    console.log(`Data file: ${DATA_FILE}`);
    console.log(`Usage routes: ${DISABLE_USAGE ? 'disabled' : 'enabled'}`);
    try {
      const bonjour = require('bonjour')();
      bonjour.publish({ name: 'InkQueue', type: 'inkqueue', port: DEFAULT_PORT });
      console.log(`mDNS: advertising as InkQueue._inkqueue._tcp on port ${DEFAULT_PORT}`);
    } catch (e) {
      console.log('mDNS: bonjour not available, skipping');
    }
    try {
      const dgram = require('dgram');
      const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udpServer.on('message', (msg, rinfo) => {
        const text = msg.toString();
        if (text === 'InkQueue:ping') {
          const serverIp = getLocalIP();
          udpServer.send(`InkQueue:pong:${serverIp}:${DEFAULT_PORT}`, rinfo.port, rinfo.address);
          console.log(`UDP discovery: replied to ${rinfo.address}`);
        }
      });
      udpServer.bind(DISCOVERY_PORT, () => {
        udpServer.setBroadcast(true);
        console.log(`UDP discovery: listening on port ${DISCOVERY_PORT}`);
      });
    } catch (e) {
      console.log('UDP discovery: failed to start', e.message);
    }
  });
}

// ── compatibility exports (tests depend on these) ──

module.exports = {
  createServer,
  start,
  readStore,
  writeStore,
  nowIso,
  fetchUsage: (options) => usageRoutes.fetchUsage(options, { readConfig, nowIso }),
  validateStartupConfig,
  cliproxy: DISABLE_USAGE ? null : require('./cliproxy'),
  listEvents: (storeObj, since, deviceFilter) => agentMod.listEvents(storeObj, since, deviceFilter, operationStore),
  deriveSignals: agentMod.deriveSignals,
  normalizeTask,
  applyComplete: opsMod.applyComplete,
  applyPostpone: opsMod.applyPostpone,
  publicTask,
  notifyAgentWebhook,
  agentWebhookUrl,
  pruneOperations: pruneOps,
  rememberOperation: rememberOp,
  hasAppliedOperation: hasAppliedOp,
  tokenMatches,
  TOKEN_PREV,
  rotateStoreBackups,
  operationStore,
  MAX_OPERATIONS_RETAINED,
  OPERATIONS_TTL_DAYS
};