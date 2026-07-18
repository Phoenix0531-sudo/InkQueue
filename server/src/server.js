'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const tls = require('tls');

const DEFAULT_PORT = Number(process.env.INKQUEUE_PORT || 8787);
const DISCOVERY_PORT = Number(process.env.INKQUEUE_DISCOVERY_PORT || 48787);
const TOKEN = process.env.INKQUEUE_TOKEN || 'dev-token';
const DATA_FILE = process.env.INKQUEUE_DATA_FILE || path.join(__dirname, '..', 'data', 'tasks.json');
const CONFIG_FILE = process.env.INKQUEUE_CONFIG_FILE || path.join(__dirname, '..', 'data', 'config.json');
const VALID_STATUSES = new Set(['todo', 'done', 'archived']);
const VALID_PRIORITIES = new Set(['normal', 'high']);

const GO_FALLBACK = {
  plan: 'go',
  windows: {
    rolling: { usage_percent: 0, resets_in_seconds: 18000, label: '5-hour', max_cost: 12 },
    weekly: { usage_percent: 0, resets_in_seconds: 604800, label: 'weekly', max_cost: 30 },
    monthly: { usage_percent: 0, resets_in_seconds: 2592000, label: 'monthly', max_cost: 60 }
  }
};

const GO_LIMITS = { rolling: 12, weekly: 30, monthly: 60 }; // dollars

function findOpenCodeDB() {
  const homedir = os.homedir();
  const candidates = [
    path.join(homedir, '.local', 'share', 'opencode', 'opencode.db'),
    path.join(process.env.APPDATA || '', 'opencode', 'opencode.db'),
    path.join(process.env.LOCALAPPDATA || '', 'opencode', 'opencode.db'),
  ];
  // Also try under USERPROFILE/.local/share/opencode/
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, '.local', 'share', 'opencode', 'opencode.db'));
  }
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* not found */ }
  }
  return null;
}

function readOpenCodeUsageFromLocalDB() {
  const dbPath = findOpenCodeDB();
  if (!dbPath) return null;
  try {
    const DB = require('better-sqlite3');
    const db = new DB(dbPath, { readonly: true, fileMustExist: true });
    const now = Date.now(); // time_created is in milliseconds in this DB
    const windows = {
      rolling: { start: now - 5 * 3600 * 1000, max: GO_LIMITS.rolling, label: '5-hour' },
      weekly: { start: now - 7 * 24 * 3600 * 1000, max: GO_LIMITS.weekly, label: 'weekly' },
      monthly: { start: now - 30 * 24 * 3600 * 1000, max: GO_LIMITS.monthly, label: 'monthly' }
    };
    const result = { plan: 'go', windows: {}, source: 'local_db' };
    let hasData = false;
    for (const [key, w] of Object.entries(windows)) {
      const row = db.prepare("SELECT COALESCE(SUM(cost),0) as total FROM session WHERE cost > 0 AND time_created > ?").get(w.start);
      const used = row ? row.total : 0;
      const pct = w.max > 0 ? Math.min(Math.round(used / w.max * 100), 100) : 0;
      result.windows[key] = { usage_percent: pct, resets_in_seconds: 3600, label: w.label, max_cost: w.max, used_cost: Math.round(used * 100) / 100 };
      if (used > 0) hasData = true;
    }
    // Also compute total all-time cost for reference
    const totalRow = db.prepare("SELECT COALESCE(SUM(cost),0) as total FROM session WHERE cost > 0").get();
    if (totalRow && totalRow.total > 0) {
      result.total_cost = Math.round(totalRow.total * 100) / 100;
      result.last_session = new Date(db.prepare("SELECT MAX(time_created) as t FROM session WHERE cost > 0").get().t).toISOString();
    }
    db.close();
    if (hasData || result.total_cost > 0) return result;
    return null; // no data yet, let fallback handle it
  } catch (e) {
    console.log('OpenCode DB read error:', e.message);
    return null;
  }
}

// Read usage data from CC Switch's database (covers codex, claude, opencode)
function readFromCCSwitchDB() {
  const dbPaths = [
    path.join(os.homedir(), '.cc-switch', 'cc-switch.db'),
    path.join(process.env.APPDATA || '', 'cc-switch', 'cc-switch.db'),
  ];
  let dbPath = null;
  for (const p of dbPaths) { try { if (fs.statSync(p).isFile()) { dbPath = p; break; } } catch(e) {} }
  if (!dbPath) return null;
  try {
    const DB = require('better-sqlite3');
    const db = new DB(dbPath, { readonly: true, timeout: 2000 });
    const now = new Date();
    const dayStart = (d) => d.toISOString().slice(0, 10);
    const windowDays = {
      rolling: { label: '5-hour', days: 0 }, // 5h = same day
      weekly: { label: 'weekly', days: 7 },
      monthly: { label: 'monthly', days: 30 }
    };
  const result = { source: 'ccswitch', providers: {} };
  for (const [key, w] of Object.entries(windowDays)) {
    const startDate = key === 'rolling' ? dayStart(now) : dayStart(new Date(now - w.days * 86400000));
    const rows = db.prepare("SELECT app_type, SUM(CAST(total_cost_usd AS REAL)) as cost, SUM(input_tokens+output_tokens) as tokens FROM usage_daily_rollups WHERE date >= ? GROUP BY app_type").all(startDate);
    for (const row of rows) {
      if (!row.cost || parseFloat(row.cost) === 0) continue;
      if (!result.providers[row.app_type]) result.providers[row.app_type] = {};
      result.providers[row.app_type][key] = { cost: Math.round(parseFloat(row.cost) * 100) / 100, tokens: row.tokens };
    }
  }
  db.close();
  return Object.keys(result.providers).length > 0 ? result : null;
} catch (e) {
  return null;
}
}

let usageCache = { data: null, timestamp: 0 };
const USAGE_CACHE_TTL = 30000;
// Proxy: HTTP CONNECT tunnel with retry (handles Clash node flakiness)
function proxiedFetch(url, options = {}, retries = 2) {
  return new Promise((resolve, reject) => {
    const config = readConfig();
    const proxy = config.proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '';
    if (!proxy) { fetch(url, options).then(resolve).catch(reject); return; }
    const attempt = (remaining) => {
      tryHttpConnect(proxy, url, options).then(resolve).catch((err) => {
        if (remaining > 0) setTimeout(() => attempt(remaining - 1), 500);
        else reject(err);
      });
    };
    attempt(retries);
  });
}

    function tryHttpConnect(proxy, url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proxyUrl = new URL(proxy);
    const isHttps = urlObj.protocol === 'https:';
    // CONNECT to proxy via HTTP
    const req = http.request({
      hostname: proxyUrl.hostname, port: proxyUrl.port,
      method: 'CONNECT',
      path: urlObj.hostname + (urlObj.port || (isHttps ? 443 : 80)),
      timeout: 10000,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error('proxy CONNECT refused')); return; }

      // Helper to send request through a socket (plain or TLS-wrapped)
      const doSend = (sock) => {
        const method = options.method || 'GET';
        const path = urlObj.pathname + urlObj.search;
        const headers = options.headers || {};
        let reqLine = method + ' ' + path + ' HTTP/1.1\r\n' + 'Host: ' + urlObj.hostname + '\r\n';
        for (const [k, v] of Object.entries(headers)) reqLine += k + ': ' + v + '\r\n';
        if (options.body) reqLine += 'Content-Length: ' + Buffer.byteLength(options.body) + '\r\n';
        reqLine += 'Connection: close\r\n';
        reqLine += '\r\n';
        if (options.body) reqLine += options.body;
        sock.write(reqLine);
        let raw = '';
        sock.on('data', (c) => { raw += c; });
        sock.on('end', () => {
          const idx = raw.indexOf('\r\n\r\n');
          if (idx === -1) { reject(new Error('bad proxy response')); return; }
          const headerBlock = raw.substring(0, idx);
          const bodyData = raw.substring(idx + 4);
          const m = headerBlock.match(/HTTP\/\d\.\d (\d+)/);
          const status = m ? parseInt(m[1]) : 0;
          resolve({ status, ok: status >= 200 && status < 300, json: () => JSON.parse(bodyData), text: () => bodyData });
        });
        sock.on('error', reject);
      };

      if (isHttps) {
        const tlsSocket = tls.connect({ socket, host: urlObj.hostname, servername: urlObj.hostname, rejectUnauthorized: false });
        tlsSocket.once('secureConnect', () => doSend(tlsSocket));
        tlsSocket.on('error', reject);
      } else {
        doSend(socket);
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('proxy timeout')); });
    req.end();
  });
}

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

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { opencode_api_key: '' };
  }
}

async function fetchOpenCodeUsage() {
  // Priority 1: Local SQLite database (most accurate)
  const localData = readOpenCodeUsageFromLocalDB();
  if (localData) return { provider: 'opencode-go', error: null, data: localData };

  // Priority 2: Try web API (if deployed)
  const config = readConfig();
  if (config.opencode_api_key) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://opencode.ai/api/v1/usage/plan', {
        headers: { 'Authorization': 'Bearer ' + config.opencode_api_key },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) return { provider: 'opencode-go', error: null, data: await res.json() };
    } catch (e) { /* fall through to fallback */ }
  }

  // Priority 3: Fallback with plan limits
  return { provider: 'opencode-go', error: null, data: GO_FALLBACK };
}

async function refreshCodexToken(auth) {
  const tokens = auth.tokens || (auth.accounts && auth.accounts[0] && auth.accounts[0].token);
  if (!tokens || !tokens.refresh_token) return null;
  try {
    const url = 'https://auth0.openai.com/oauth/token';
    const body = JSON.stringify({ grant_type: 'refresh_token',
      client_id: 'p2gNDZ5pN4P6TMg7bT6Xg8T8T8T8T8T8T8T8T8',
      refresh_token: tokens.refresh_token });
    const res = await proxiedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token;
  } catch (e) {
    return null;
  }
}

async function fetchCodexUsage() {
  const config = readConfig();
  const authPath = config.codex_auth_path ? path.resolve(os.homedir(), config.codex_auth_path.replace(/^~\/?/, '')) : path.join(os.homedir(), '.codex', 'auth.json');
  let auth = null;
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    auth = JSON.parse(raw);
  } catch (e) {
    return { provider: 'chatgpt-plus', error: 'not logged in', data: null };
  }

  let accessToken = null;
  if (auth.tokens && auth.tokens.access_token) {
    accessToken = auth.tokens.access_token;
  } else if (auth.accounts && auth.accounts.length > 0 && auth.accounts[0].token) {
    accessToken = auth.accounts[0].token.access_token;
  } else if (auth.access_token) {
    accessToken = auth.access_token;
  }
  if (!accessToken) {
    return { provider: 'chatgpt-plus', error: 'no access token', data: null };
  }

  try {
    const res = await proxiedFetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    });
    if (res.status === 401 || res.status === 403) {
      // Try refreshing the token
      const newToken = await refreshCodexToken(auth);
      if (newToken) {
        const retry = await proxiedFetch('https://chatgpt.com/backend-api/wham/usage', {
          headers: { 'Authorization': 'Bearer ' + newToken },
        });
        if (retry.ok) return parseCodexResponse(await retry.json());
      }
      return { provider: 'chatgpt-plus', error: 'token expired, run: codex', data: null };
    }
    if (!res.ok) {
      return { provider: 'chatgpt-plus', error: 'API ' + res.status, data: null };
    }
    const json = await res.json();
    return parseCodexResponse(json);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('connect') || msg.includes('socket') || msg.includes('ECONNREFUSED')) {
      return { provider: 'chatgpt-plus', error: 'proxy: ' + msg.slice(0, 80), data: null };
    }
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return { provider: 'chatgpt-plus', error: 'proxy timeout', data: null };
    }
    return { provider: 'chatgpt-plus', error: msg.slice(0, 100), data: null };
  }
}

function parseCodexResponse(json) {
  const primary = json.rate_limit && json.rate_limit.primary_window ? {
    usage_percent: json.rate_limit.primary_window.percent,
    resets_in_seconds: json.rate_limit.primary_window.resets_in_seconds,
    label: '5-hour'
  } : null;
  const secondary = json.rate_limit && json.rate_limit.secondary_window ? {
    usage_percent: json.rate_limit.secondary_window.percent,
    resets_in_seconds: json.rate_limit.secondary_window.resets_in_seconds,
    label: 'weekly'
  } : null;
  return { provider: 'chatgpt-plus', error: null, data: { primary, secondary } };
}

async function fetchUsage() {
  const now = Date.now();
  if (usageCache.data && (now - usageCache.timestamp) < USAGE_CACHE_TTL) {
    return usageCache.data;
  }
  const [go, codex] = await Promise.all([fetchOpenCodeUsage(), fetchCodexUsage()]);

  // Merge CC Switch data (most accurate cost tracking)
  const ccData = readFromCCSwitchDB();
  if (ccData) {
    for (const [appType, windows] of Object.entries(ccData.providers)) {
      if (appType === 'opencode' || appType === 'codex' || appType === 'claude') {
        const provider = appType === 'opencode' ? go : codex;
        provider.source = (provider.source || '') + '+ccswitch';
        provider.data = provider.data || { plan: appType, windows: {} };
        for (const [win, data] of Object.entries(windows)) {
          if (!provider.data.windows[win]) provider.data.windows[win] = { label: win, resets_in_seconds: 3600 };
          provider.data.windows[win].cc_cost = data.cost;
          provider.data.windows[win].cc_tokens = data.tokens;
        }
      }
    }
  }

  // Merge reported usage into opencode-go data
  const config = readConfig();
  const reports = config.usage_reports || [];
  const openCodeReports = reports.filter(r => r.provider === 'opencode-go');
  if (openCodeReports.length > 0) {
    go.source = (go.source || 'fallback') + '+reports';
    go.data = go.data || { plan: 'go', windows: {} };
    // Sum reports
    const reportWindows = {
      rolling: { start: now - 5 * 3600 * 1000, total: 0, label: '5-hour' },
      weekly: { start: now - 7 * 24 * 3600 * 1000, total: 0, label: 'weekly' },
      monthly: { start: now - 30 * 24 * 3600 * 1000, total: 0, label: 'monthly' }
    };
    let totalReportCost = 0;
    for (const r of openCodeReports) {
      const reportedAt = new Date(r.reported_at).getTime();
      totalReportCost += (r.cost || 0);
      for (const [, w] of Object.entries(reportWindows)) {
        if (reportedAt >= w.start) w.total += (r.cost || 0);
      }
    }
    for (const [key, w] of Object.entries(reportWindows)) {
      if (!go.data.windows[key]) go.data.windows[key] = { label: w.label, max_cost: 60, resets_in_seconds: 3600 };
      const maxCost = go.data.windows[key].max_cost || 60;
      go.data.windows[key].usage_percent = Math.min(Math.round(w.total / maxCost * 100), 100);
      go.data.windows[key].reported_cost = Math.round(w.total * 100) / 100;
    }
    go.data.total_reported_cost = Math.round(totalReportCost * 100) / 100;
  }

  usageCache = { data: { server_time: nowIso(), providers: [go, codex] }, timestamp: now };
  return usageCache.data;
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
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(new HttpError(400, 'invalid json')); }
    });
    req.on('error', (err) => { if (!failed) reject(err); });
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
  if (input.status !== undefined && !VALID_STATUSES.has(String(input.status))) throw new HttpError(400, 'invalid status');
  if (input.priority !== undefined && !VALID_PRIORITIES.has(String(input.priority))) throw new HttpError(400, 'invalid priority');
  if (input.due_date !== undefined && input.due_date !== null && input.due_date !== '' && !isValidDate(String(input.due_date))) throw new HttpError(400, 'invalid due_date');
  if (input.due_time !== undefined && input.due_time !== null && input.due_time !== '' && !isValidTime(String(input.due_time))) throw new HttpError(400, 'invalid due_time');
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
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time') && payload.due_time !== null && payload.due_time !== '' && !isValidTime(String(payload.due_time))) throw new Error('invalid due_time');
  task.due_date = String(payload.due_date);
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time')) task.due_time = nullableString(payload.due_time);
  task.updated_at = serverTime;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true }); return;
  }

  if (!hasToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' }); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/usage') {
    sendJson(res, 200, await fetchUsage()); return;
  }

  // Agent usage reporting endpoint
  if (req.method === 'POST' && url.pathname === '/v1/usage/report') {
    const input = await readBody(req);
    const cfg = readConfig();
    const reports = cfg.usage_reports || [];
    reports.push({
      provider: input.provider || 'opencode-go',
      cost: input.cost || 0,
      tokens_input: input.tokens_input || 0,
      tokens_output: input.tokens_output || 0,
      model: input.model || 'unknown',
      reported_at: nowIso(),
      note: input.note || ''
    });
    if (reports.length > 1000) reports.splice(0, reports.length - 1000);
    cfg.usage_reports = reports;
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch(e) {}
    sendJson(res, 200, { ok: true, total_reports: reports.length });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/tasks/snapshot') {
    const store = readStore();
    sendJson(res, 200, { server_time: nowIso(), tasks: store.tasks.map(publicTask) }); return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks') {
    const input = await readBody(req);
    validateTaskInput(input, true);
    const store = readStore();
    const task = normalizeTask(input, null);
    store.tasks.push(task);
    writeStore(store);
    sendJson(res, 201, { task: publicTask(task) }); return;
  }

  const patchMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const id = decodeURIComponent(patchMatch[1]);
    const input = await readBody(req);
    validateTaskInput(input, false);
    const store = readStore();
    const index = store.tasks.findIndex((task) => task.id === id);
    if (index === -1) { sendJson(res, 404, { error: 'not found' }); return; }
    const allowed = {};
    for (const key of ['title', 'note', 'status', 'due_date', 'due_time', 'priority', 'source', 'force_today', 'today', 'completed_at']) {
      if (Object.prototype.hasOwnProperty.call(input, key)) allowed[key] = input[key];
    }
    const updated = normalizeTask(allowed, store.tasks[index]);
    if (updated.status === 'done' && !updated.completed_at) updated.completed_at = nowIso();
    store.tasks[index] = updated;
    writeStore(store);
    sendJson(res, 200, { task: publicTask(updated) }); return;
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
        if (!task || task.status === 'archived') { ignored.push(opId); continue; }
        if (op.type === 'complete') { applyComplete(task, op, serverTime); }
        else if (op.type === 'postpone') { applyPostpone(task, op, serverTime); }
        else { throw new Error(`unsupported operation type: ${op.type}`); }
        accepted.push(opId);
      } catch (err) { errors.push({ id: opId, error: err.message }); }
    }

    if (accepted.length || ignored.length) writeStore(store);
    sendJson(res, 200, { server_time: nowIso(), accepted, ignored, errors }); return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (err instanceof HttpError) { sendJson(res, err.status, { error: err.message }); return; }
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
  // Validate config.json on startup
  try {
    JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('Config: no config.json found, /v1/usage will return fallback data');
    } else {
      console.warn('Config: config.json parse error:', e.message);
    }
  }

  start(DEFAULT_PORT, () => {
    console.log(`InkQueue reference server listening on http://localhost:${DEFAULT_PORT}`);
    console.log(`Token header: X-InkQueue-Token: ${TOKEN}`);
    console.log(`Data file: ${DATA_FILE}`);
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
          const serverIp = rinfo.address === '::1' || rinfo.address === '127.0.0.1' ? '127.0.0.1' : getLocalIP();
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

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

module.exports = { createServer, start, readStore, writeStore, nowIso, fetchUsage };
