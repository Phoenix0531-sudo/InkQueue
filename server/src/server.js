'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const tls = require('tls');
const cliproxy = require('./cliproxy');

const DEFAULT_PORT = Number(process.env.INKQUEUE_PORT || 8787);
const DISCOVERY_PORT = Number(process.env.INKQUEUE_DISCOVERY_PORT || 48787);
const TOKEN = process.env.INKQUEUE_TOKEN || 'dev-token';
const DATA_FILE = process.env.INKQUEUE_DATA_FILE || path.join(__dirname, '..', 'data', 'tasks.json');
const CONFIG_FILE = process.env.INKQUEUE_CONFIG_FILE || path.join(__dirname, '..', 'data', 'config.json');
const VALID_STATUSES = new Set(['todo', 'done', 'archived']);
const VALID_PRIORITIES = new Set(['normal', 'high']);
const MAX_WEBHOOK_ITEMS = 50;
/** Keep at most this many applied device operations (idempotency + events). */
const MAX_OPERATIONS_RETAINED = Number(process.env.INKQUEUE_MAX_OPERATIONS || 500);
/** Drop applied operations older than this many days (default 30). 0 = keep all ages until max count. */
const OPERATIONS_TTL_DAYS = Number(process.env.INKQUEUE_OPERATIONS_TTL_DAYS || 30);
/** Optional TLS: set both paths to serve HTTPS (production reverse-proxy still preferred). */
const TLS_KEY_PATH = process.env.INKQUEUE_TLS_KEY || '';
const TLS_CERT_PATH = process.env.INKQUEUE_TLS_CERT || '';

let usageCache = { data: null, timestamp: 0 };
const USAGE_CACHE_TTL = 8000;
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
  // Product timezone is always Asia/Shanghai (+08:00). Do not follow host TZ.
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : '00';
  };
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
}

// Compare ISO strings in product timezone (+08:00 cut-off vs +08:00 applied_at).
// For ages involving the present moment we must subtract in product time.
function nowIsoMinusSeconds(seconds) {
  const d = new Date(Date.now() - seconds * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d);
  const get = (type) => { const p = parts.find((x) => x.type === type); return p ? p.value : '00'; };
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
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
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function sumByTypeField(byType, field) {
  return Object.values(byType || {}).reduce((n, v) => n + Number((v && v[field]) || 0), 0);
}

function formatLatencyMs(ms) {
  const n = Number(ms || 0);
  if (!n || n < 0) return null;
  if (n < 1000) return n + '毫秒';
  return (Math.round(n / 100) / 10) + '秒';
}

function formatCompactNumber(n) {
  const v = Number(n || 0);
  if (v >= 10000) return Math.round(v / 1000) / 10 + '万';
  if (v >= 1000) return Math.round(v / 100) / 10 + '千';
  return String(v);
}

function summarizeApiKeyUsage(raw) {
  if (!raw) return null;
  // CPA may return {} when empty, an object map, or an array.
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    return {
      key_count: raw.length,
      // do not dump secrets; only coarse totals if present
      total_requests: raw.reduce((n, item) => n + Number(item.requests || item.count || item.total || 0), 0),
      total_tokens: raw.reduce((n, item) => n + Number(
        (item.tokens && (item.tokens.total_tokens || item.tokens.total)) || item.total_tokens || 0
      ), 0)
    };
  }
  if (typeof raw !== 'object') return null;
  const keys = Object.keys(raw);
  if (!keys.length) return null;
  let totalRequests = 0;
  let totalTokens = 0;
  for (const k of keys) {
    const v = raw[k] || {};
    totalRequests += Number(v.requests || v.count || v.total || 0);
    totalTokens += Number(
      (v.tokens && (v.tokens.total_tokens || v.tokens.total)) || v.total_tokens || 0
    );
  }
  return {
    key_count: keys.length,
    total_requests: totalRequests,
    total_tokens: totalTokens
  };
}

function summarizeUsageQueue(raw) {
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && Array.isArray(raw.queue)) items = raw.queue;
  else if (raw && Array.isArray(raw.items)) items = raw.items;
  else if (raw && Array.isArray(raw.data)) items = raw.data;
  if (!items.length) return null;

  // Keep only a compact recent window for Kindle.
  const recent = items.slice(0, 20);
  const fails = recent.filter((i) => i && (i.failed === true || i.fail && i.fail.status_code >= 400)).length;
  const latencies = recent.map((i) => Number(i && i.latency_ms || 0)).filter((n) => n > 0);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const last = recent[0] || {};
  return {
    count: items.length,
    recent: recent.length,
    fails,
    avg_latency_ms: avgLatency,
    last_model: last.model || last.alias || null,
    last_provider: last.provider || null,
    last_failed: Boolean(last.failed),
    last_latency_ms: Number(last.latency_ms || 0)
  };
}

function summarizeCodexUsage(list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return null;
  const alive = [];
  const dead = [];
  for (const it of items) {
    if (!it) continue;
    if (it.error || !it.data) dead.push(it);
    else alive.push(it);
  }
  // Pick the healthiest / lowest usage among alive for a short headline.
  // Label MUST come from API window length (limit_window_seconds), never hardcode "5小时".
  let best = null;
  for (const it of alive) {
    const primary = it.data && it.data.primary ? it.data.primary : null;
    const pct = Number(
      (primary && primary.usage_percent) ||
      (it.data && it.data.windows && it.data.windows.rolling && it.data.windows.rolling.usage_percent) ||
      0
    );
    const label = (primary && primary.label) || null;
    const limitSeconds = primary && primary.limit_window_seconds != null
      ? Number(primary.limit_window_seconds)
      : null;
    const resetAfter = primary && primary.reset_after_seconds != null
      ? Number(primary.reset_after_seconds)
      : null;
    if (!best || pct < best.usage_percent) {
      best = {
        email: it.email || it.id || 'codex',
        usage_percent: pct,
        label: label,
        limit_window_seconds: limitSeconds,
        reset_after_seconds: resetAfter,
        plan_type: it.data && it.data.plan_type ? it.data.plan_type : null,
        allowed: it.data && it.data.allowed != null ? it.data.allowed : null,
        limit_reached: it.data && it.data.limit_reached != null ? it.data.limit_reached : null
      };
    }
  }
  return {
    alive: alive.length,
    dead: dead.length,
    total: items.length,
    best,
    // compact per-account for Android (no tokens)
    accounts: items.map((it) => {
      const primary = it.data && it.data.primary ? it.data.primary : null;
      return {
        email: it.email || it.id || null,
        ok: !it.error && !!it.data,
        error: it.error || null,
        usage_percent: primary ? Number(primary.usage_percent || 0) : null,
        label: primary ? (primary.label || null) : null,
        limit_window_seconds: primary && primary.limit_window_seconds != null
          ? Number(primary.limit_window_seconds)
          : null,
        plan_type: it.data && it.data.plan_type ? it.data.plan_type : null
      };
    })
  };
}

function buildCliproxyProvider(snapshot) {
  const summary = (snapshot.pool && snapshot.pool.summary) || { total: 0, by_type: {}, capacity: {} };
  const health = snapshot.health || {};
  const capacity = summary.capacity || {};
  const byType = summary.by_type || {};
  const runtime = snapshot.runtime || null;
  const mgmt = snapshot.management_api || {};
  const codexHealth = snapshot.codex_health || {};
  const codexSummary = summarizeCodexUsage(snapshot.codex_usage || []);
  // Prefer pool capacity over fragile single-account 5h percent when accounts are abundant.
  const enough = Boolean(capacity.enough);
  // Prefer probe-reconciled usable Codex count when available.
  const codexEnabled = Number(
    (codexSummary && codexSummary.alive != null ? codexSummary.alive : null) ??
    capacity.codex_enabled ??
    (byType.codex && byType.codex.enabled) ??
    0
  );
  const codexDead = Number(
    (codexSummary && codexSummary.dead != null ? codexSummary.dead : null) ??
    capacity.codex_dead ??
    (byType.codex && byType.codex.probe_dead) ??
    0
  );
  const codexFileTotal = Number((byType.codex && byType.codex.total) || (codexSummary && codexSummary.total) || 0);
  const xaiEnabled = Number(capacity.xai_enabled || (byType.xai && byType.xai.enabled) || 0);
  const total = Number(summary.total || 0);
  const success = runtime ? Number(runtime.total_success || 0)
    : Number((byType.codex && byType.codex.success) || 0) + Number((byType.xai && byType.xai.success) || 0);
  const failed = runtime ? Number(runtime.total_failed || 0)
    : Number((byType.codex && byType.codex.failed) || 0) + Number((byType.xai && byType.xai.failed) || 0);
  const unavailable = Number((byType.codex && byType.codex.unavailable) || 0)
    + Number((byType.xai && byType.xai.unavailable) || 0);
  const disabled = sumByTypeField(byType, 'disabled');
  const tokenExpired = sumByTypeField(byType, 'token_expired');
  const modelCount = Number(health.model_count || 0);
  const latencyMs = Number(health.latency_ms || 0);
  const latencyLabel = formatLatencyMs(latencyMs);
  const apiKeyUsage = summarizeApiKeyUsage(mgmt.api_key_usage);
  const usageQueue = summarizeUsageQueue(mgmt.usage_queue);

  // Kindle 中文小仪表盘（白底黑字可读，少缩写）
  const statusText = health.ok ? '正常' : '异常';
  const stockText = enough ? '够用' : '偏少';
  const codexLine = codexDead > 0
    ? ('Codex 可用 ' + codexEnabled + (codexFileTotal ? ('/' + codexFileTotal) : '') + ' · 失效 ' + codexDead)
    : ('Codex 可用 ' + codexEnabled);
  const lines = [
    '状态：' + statusText + (latencyLabel ? ('  延迟 ' + latencyLabel) : ''),
    '账号池：' + total + ' 个  ' + stockText,
    '  ' + codexLine + ' · Grok ' + xaiEnabled,
    // Only show what the API actually returned (window label from limit_window_seconds).
    codexSummary && codexSummary.best
      ? ('  有效号额度 '
        + Math.round(codexSummary.best.usage_percent) + '%'
        + (codexSummary.best.label ? ('（' + codexSummary.best.label + '）') : '')
        + (codexSummary.best.limit_reached ? ' 已触顶' : ''))
      : null,
    '运行：累计 ' + formatCompactNumber(success) + ' 次成功'
      + '  ' + formatCompactNumber(failed) + ' 次失败'
      + (unavailable ? ('  异常账号 ' + unavailable) : ''),
    (disabled > 0 || tokenExpired > 0)
      ? ('账号：禁用 ' + disabled + '  过期 ' + tokenExpired
        + (modelCount > 0 ? ('  模型 ' + modelCount) : ''))
      : (modelCount > 0 ? ('模型：' + modelCount) : null),
    usageQueue
      ? ('最近：' + usageQueue.recent + ' 次'
        + '  失败 ' + usageQueue.fails
        + (usageQueue.avg_latency_ms ? ('  均 ' + formatLatencyMs(usageQueue.avg_latency_ms)) : ''))
      : null,
    usageQueue && usageQueue.last_model
      ? ('  最近模型 ' + String(usageQueue.last_model).slice(0, 22))
      : null,
    // Only show api-key-usage when CPA actually reports numbers (usually empty).
    apiKeyUsage
      ? ('密钥：' + apiKeyUsage.key_count + ' 个'
        + (apiKeyUsage.total_requests ? ('  请求 ' + formatCompactNumber(apiKeyUsage.total_requests)) : '')
        + (apiKeyUsage.total_tokens ? ('  用量 ' + formatCompactNumber(apiKeyUsage.total_tokens)) : ''))
      : null
  ].filter(Boolean);

  return {
    provider: 'cliproxyapi',
    error: health.ok ? null : (health.error || 'cliproxy_down'),
    source: snapshot.source || 'cliproxyapi-auth-dir',
    data: {
      plan: 'account-pool',
      display: 'pool',
      health,
      pool: {
        total,
        by_type: byType,
        capacity,
        // Keep accounts out of Kindle payload by default (admin/pool still has them).
        accounts: []
      },
      runtime: runtime || {
        total_success: success,
        total_failed: failed
      },
      enough,
      lines,
      // Compact fields for simple clients
      codex_enabled: codexEnabled,
      codex_dead: codexDead,
      codex_total: codexFileTotal,
      xai_enabled: xaiEnabled,
      total_accounts: total,
      success,
      failed,
      unavailable,
      disabled,
      token_expired: tokenExpired,
      model_count: modelCount,
      latency_ms: latencyMs,
      api_key_usage: apiKeyUsage,
      usage_queue: usageQueue,
      codex_quota: codexSummary,
      // Compatibility: no progress-bar semantics for CPA pool
      windows: {},
      codex_usage: snapshot.codex_usage || []
    }
  };
}

async function fetchUsage(options) {
  const now = Date.now();
  const opts = options || {};
  if (!opts.force && usageCache.data && (now - usageCache.timestamp) < USAGE_CACHE_TTL) {
    return usageCache.data;
  }
  const config = readConfig();
  // Always probe Codex health so dead (401) accounts are not counted as usable.
  // includeCodexUsage only controls whether full per-account quota is emphasized;
  // probe itself is on by default for accurate Codex usable count.
  const includeCodexUsage = opts.includeCodexUsage === true;
  const cpaSnap = await cliproxy.fetchCliproxySnapshot(config, {
    includeCodexUsage: true,
    probeCodex: true,
    maxCodex: 5
  });
  const cliproxyProvider = buildCliproxyProvider(cpaSnap);

  usageCache = {
    data: {
      server_time: nowIso(),
      providers: [cliproxyProvider],
      cliproxy: {
        health: cpaSnap.health,
        pool: cpaSnap.pool && {
          ok: cpaSnap.pool.ok,
          error: cpaSnap.pool.error,
          summary: cpaSnap.pool.summary
        },
        enough: cpaSnap.enough,
        management_api: cpaSnap.management_api,
        runtime: cpaSnap.runtime || null
      }
    },
    timestamp: now
  };
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
    project: input.project !== undefined ? nullableString(input.project) : nullableString(base.project),
    priority: input.priority || base.priority || 'normal',
    created_at: base.created_at || input.created_at || now,
    updated_at: now,
    completed_at: input.completed_at !== undefined ? nullableString(input.completed_at) : nullableString(base.completed_at),
    source: input.source || base.source || 'agent',
    // Commitment / audit (optional, agent-reported — never scraped from chat)
    why: input.why !== undefined ? nullableString(input.why) : nullableString(base.why),
    source_session: input.source_session !== undefined
      ? nullableString(input.source_session)
      : nullableString(base.source_session),
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
  if (out.why == null) delete out.why;
  if (out.source_session == null) delete out.source_session;
  if (out.project == null) delete out.project;
  return out;
}

function applyComplete(task, op, serverTime) {
  // Conflict v2 field ownership:
  //   device lifecycle → status / completed_at / updated_at only
  //   agent text       → title / note / why / source_session / project never touched here
  task.status = 'done';
  // The reference server owns mutation timestamps. Device timestamps are hints only.
  task.completed_at = serverTime;
  task.updated_at = serverTime;
}

function applyPostpone(task, op, serverTime) {
  // Conflict v2: device owns due_date / due_time only; never rewrite agent title/note/why.
  const payload = op.payload || {};
  if (!payload.due_date) throw new Error('postpone requires payload.due_date');
  if (!isValidDate(String(payload.due_date))) throw new Error('invalid due_date');
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time') && payload.due_time !== null && payload.due_time !== '' && !isValidTime(String(payload.due_time))) throw new Error('invalid due_time');
  // Capture previous due for events/signals (Agent-readable)
  if (!payload.from_due_date && task.due_date) payload.from_due_date = task.due_date;
  task.due_date = String(payload.due_date);
  if (Object.prototype.hasOwnProperty.call(payload, 'due_time')) task.due_time = nullableString(payload.due_time);
  task.updated_at = serverTime;
}

function operationStore(store) {
  if (!Array.isArray(store.operations)) store.operations = [];
  return store.operations;
}

function hasAppliedOperation(store, operationId) {
  return operationStore(store).some((item) => item.id === operationId);
}

/**
 * Prune applied operation log (idempotency ring + event stream source).
 * - drops entries missing id
 * - drops entries older than OPERATIONS_TTL_DAYS (if > 0)
 * - keeps newest MAX_OPERATIONS_RETAINED
 * Returns number of removed entries.
 */
function pruneOperations(store, nowMs = Date.now()) {
  const ops = operationStore(store);
  const before = ops.length;
  const ttlMs = OPERATIONS_TTL_DAYS > 0 ? OPERATIONS_TTL_DAYS * 24 * 60 * 60 * 1000 : 0;
  const kept = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !op.id) continue;
    // Legacy incomplete records (pre-type field) are dead weight for events/idempotency.
    if (!op.type) continue;
    const at = op.applied_at || op.occurred_at || null;
    if (ttlMs > 0 && at) {
      const t = Date.parse(at);
      if (Number.isFinite(t) && (nowMs - t) > ttlMs) continue;
    }
    kept.push(op);
  }
  kept.sort((a, b) => String(a.applied_at || '').localeCompare(String(b.applied_at || '')));
  const trimmed = kept.length > MAX_OPERATIONS_RETAINED
    ? kept.slice(kept.length - MAX_OPERATIONS_RETAINED)
    : kept;
  store.operations = trimmed;
  return before - trimmed.length;
}

function rememberOperation(store, operationId, taskId, serverTime, opType, payload, taskTitle, deviceId) {
  operationStore(store).push({
    id: operationId,
    task_id: taskId,
    task_title: taskTitle || null,
    type: opType || null,
    payload: payload || null,
    applied_at: serverTime,
    device_id: deviceId || null
  });
  // Prune is owned by the operations handler so response.pruned is accurate.
}

// Agent-facing event stream: externalised view of operations.
// Each event has stable id (= operation id) so an Agent can poll safely.
function eventFromOperation(op, task) {
  return {
    event_id: op.id,
    type: op.type,
    task_id: op.task_id,
    task_title: op.task_title || (task ? task.title : null),
    occurred_at: op.applied_at,
    payload: op.payload || null
  };
}

function listEvents(store, sinceIso) {
  const ops = operationStore(store).slice().sort((a, b) => a.applied_at.localeCompare(b.applied_at));
  const events = ops.map((op) => {
    const task = store.tasks.find((t) => t.id === op.task_id);
    return eventFromOperation(op, task);
  });
  if (!sinceIso) return events;
  return events.filter((e) => e.occurred_at > sinceIso);
}

/**
 * Derive agent-readable signals from raw device events.
 * Pure function: does not mutate store. Backward-compatible add-on for GET /v1/events.
 *
 * kinds:
 *   task_completed     — complete op
 *   postponed          — postpone op (with target / due shift)
 *   chronic_postpone   — same task postponed >=3 times in last 7d of the window
 */
function normalizePostponeTarget(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const t = payload.postpone_target;
  if (t === 'tomorrow' || t === 'weekend' || t === 'next_week' || t === 'today') return t;
  return t ? String(t) : null;
}

function daysBetweenYmd(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(a.slice(0, 10) + 'T00:00:00Z');
  const db = Date.parse(b.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

function deriveSignals(events, opts) {
  opts = opts || {};
  const window = Array.isArray(events) ? events : [];
  const chronicThreshold = opts.chronicThreshold || 3;
  // Running streak per task within the returned window (chronological).
  const running = Object.create(null);
  const signals = [];
  const chronicEmitted = Object.create(null);

  for (const e of window) {
    if (!e || !e.type) continue;
    if (e.type === 'complete') {
      signals.push({
        kind: 'task_completed',
        event_id: e.event_id || null,
        task_id: e.task_id || null,
        title: e.task_title || null,
        at: e.occurred_at || null,
        advice: '可提后续；勿重复 add 同意图'
      });
      continue;
    }
    if (e.type === 'postpone') {
      const payload = e.payload || {};
      const target = normalizePostponeTarget(payload);
      const toDue = payload.due_date || null;
      const fromDue = payload.from_due_date || payload.previous_due_date || null;
      const tid = e.task_id || null;
      const streak = tid ? (running[tid] = (running[tid] || 0) + 1) : 1;
      signals.push({
        kind: 'postponed',
        event_id: e.event_id || null,
        task_id: tid,
        title: e.task_title || null,
        at: e.occurred_at || null,
        target,
        from_due: fromDue,
        to_due: toDue,
        streak,
        advice:
          target === 'tomorrow'
            ? '今日可能过载；少加今天'
            : target === 'weekend' || target === 'next_week'
              ? '降低工作日权重，或拆分'
              : '已推迟；核对 due 是否合理'
      });
      if (tid && streak >= chronicThreshold && !chronicEmitted[tid]) {
        chronicEmitted[tid] = true;
        signals.push({
          kind: 'chronic_postpone',
          task_id: tid,
          title: e.task_title || null,
          postpone_count_window: streak,
          last_at: e.occurred_at || null,
          advice: '拆分/降级/问是否取消，禁止只改 due'
        });
      }
    }
  }
  return signals;
}

// Returns YYYY-MM-DD of this week's Sunday (Beijing week: Mon..Sun)
function endOfWeek(todayIso) {
  const d = new Date(`${todayIso}T00:00:00Z`);
  // getUTCDay: 0=Sun..6=Sat. We want Sun of this week (or today if Sun).
  let daysToSunday = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}

function buildAgentSuggestion(overdue, todayCount, weekCount, recentDone, recentPostpones) {
  if (overdue >= 5) return '过期任务偏多，建议先安排过期清理或批量推迟，再考虑新增任务';
  if (todayCount === 0) return '今日还没有任务，建议补 2-3 个今日任务';
  if (todayCount >= 8) return '今日任务偏多，墨水屏用户处理节奏有限，建议控制在 3-5 个';
  if (recentPostpones > recentDone && recentDone + recentPostpones > 0) {
    return '设备方最近推迟次数多于完成，可考虑核对任务日期合理性';
  }
  return '节奏正常，可继续按过去 7 天节奏安排本周任务';
}

// P8: Outbound webhook to Agent — fire-and-forget push of device events.
// Reads agent_webhook_url from data/config.json (or INKQUEUE_AGENT_WEBHOOK_URL env).
// Failures are logged but never block the response path.
function agentWebhookUrl() {
  if (process.env.INKQUEUE_AGENT_WEBHOOK_URL) return process.env.INKQUEUE_AGENT_WEBHOOK_URL;
  try {
    const cfg = readConfig();
    if (cfg && typeof cfg.agent_webhook_url === 'string') return cfg.agent_webhook_url;
  } catch (e) { /* ignore */ }
  return null;
}

function notifyAgentWebhook(event) {
  const url = agentWebhookUrl();
  if (!url) return;
  setImmediate(() => {
    try {
      let target;
      try { target = new URL(url); } catch (e) {
        console.warn('[webhook] invalid agent_webhook_url');
        return;
      }
      // Envelope v1: stable schema so Agent gateways can route without guessing.
      const envelope = {
        schema: 'inkqueue.device_event.v1',
        server_time: nowIso(),
        event: event,
        signal: event && event.type === 'complete'
          ? {
              kind: 'task_completed',
              task_id: event.task_id || null,
              title: event.task_title || null,
              at: event.occurred_at || null,
              advice: '可提后续；勿重复 add 同意图'
            }
          : event && event.type === 'postpone'
            ? {
                kind: 'postponed',
                task_id: event.task_id || null,
                title: event.task_title || null,
                at: event.occurred_at || null,
                target: (event.payload && event.payload.postpone_target) || null,
                to_due: (event.payload && event.payload.due_date) || null
              }
            : null
      };
      const body = JSON.stringify(envelope);
      const isHttps = target.protocol === 'https:';
      const lib = isHttps ? require('https') : http;
      const req = lib.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'InkQueue-Server/0.9'
        },
        timeout: 5000,
        rejectUnauthorized: false
      }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[webhook] ok', event && event.type, event && event.task_id, '->', res.statusCode);
        } else {
          console.warn('[webhook] non-2xx', res.statusCode, event && event.type);
        }
      });
      req.on('error', (err) => { console.warn('[webhook] error', err.message); });
      req.on('timeout', () => { req.destroy(); console.warn('[webhook] timeout'); });
      req.write(body);
      req.end();
    } catch (e) {
      console.warn('[webhook] failed', e && e.message);
    }
  });
}

function webhookTasks(input) {
  if (Array.isArray(input.tasks)) return input.tasks;
  if (input.task && typeof input.task === 'object') return [input.task];
  if (input.title !== undefined) return [input];
  return [];
}

function webhookEventId(input) {
  const value = input.event_id || input.idempotency_key || input.eventId;
  return value ? String(value) : null;
}

function tokenFromQuery(url) {
  return url.searchParams.get('token') || url.searchParams.get('inkqueue_token') || '';
}

function hasTokenOrQuery(req, url) {
  return hasToken(req) || tokenFromQuery(url) === TOKEN;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true }); return;
  }

  // Lightweight browser admin panel for CLIProxy pool/health (token via query for e-ink browsers).
  if (req.method === 'GET' && (url.pathname === '/admin/cliproxy' || url.pathname === '/admin')) {
    if (!hasTokenOrQuery(req, url)) {
      sendJson(res, 401, { error: 'unauthorized' }); return;
    }
    const config = readConfig();
    const includeCodexUsage = url.searchParams.get('codex_usage') === '1';
    const snapshot = await cliproxy.fetchCliproxySnapshot(config, {
      includeCodexUsage,
      maxCodex: 5
    });
    const html = cliproxy.buildAdminHtml(snapshot);
    const encoded = Buffer.from(html, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': encoded.length,
      'Cache-Control': 'no-store'
    });
    res.end(encoded);
    return;
  }

  if (!hasToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' }); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/usage') {
    const includeCodexUsage = url.searchParams.get('codex_usage') === '1';
    const force = url.searchParams.get('force') === '1' || includeCodexUsage;
    sendJson(res, 200, await fetchUsage({ includeCodexUsage, force })); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/cliproxy/health') {
    const config = readConfig();
    const health = await cliproxy.probeCliproxyHealth(config);
    const management = await cliproxy.fetchManagementSnapshot(config);
    sendJson(res, 200, {
      server_time: nowIso(),
      ok: health.ok,
      health,
      management_api: {
        enabled: management.enabled,
        ok: management.ok,
        reason: management.reason,
        auth_status: management.auth_status,
        usage_statistics_enabled: management.usage_statistics_enabled
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/cliproxy/pool') {
    const config = readConfig();
    const includeCodexUsage = url.searchParams.get('codex_usage') === '1';
    const snapshot = await cliproxy.fetchCliproxySnapshot(config, {
      includeCodexUsage,
      maxCodex: 5
    });
    sendJson(res, 200, snapshot);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/tasks/snapshot') {
    const store = readStore();
    sendJson(res, 200, { server_time: nowIso(), tasks: store.tasks.map(publicTask) }); return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/events') {
    const store = readStore();
    const since = url.searchParams.get('since') || '';
    const limitParam = Number(url.searchParams.get('limit') || 0);
    let events = listEvents(store, since);
    if (limitParam > 0 && events.length > limitParam) {
      events = events.slice(events.length - limitParam);
    }
    const latest = events.length ? events[events.length - 1].occurred_at : null;
    const signals = deriveSignals(events);
    sendJson(res, 200, { server_time: nowIso(), events, signals, latest_event_at: latest }); return;
  }

  // Agent scheduling context: helps an Agent decide how many tasks / what cadence to push.
  if (req.method === 'GET' && url.pathname === '/v1/agent/context') {
    const store = readStore();
    const today = nowIso().slice(0, 10);
    const tasks = store.tasks.filter((t) => t.status !== 'archived');
    const open = tasks.filter((t) => t.status === 'todo');
    const done = tasks.filter((t) => t.status === 'done');
    let overdue = 0, todayCount = 0, weekCount = 0, laterCount = 0;
    for (const t of open) {
      if (!t.due_date) { laterCount++; continue; }
      if (t.due_date < today) overdue++;
      else if (t.due_date === today) todayCount++;
      else if (t.due_date <= endOfWeek(today)) weekCount++;
      else laterCount++;
    }
    // Completed-in-last-7-days histogram (Agent rhythm signal)
    const sevenAgo = nowIsoMinusSeconds(7 * 86400);
    const recentDone = done.filter((t) => t.completed_at && t.completed_at >= sevenAgo).length;
    // Operations in last 24 hours (Agent activity signal)
    const dayAgo = nowIsoMinusSeconds(86400);
    const ops = operationStore(store);
    const recentOps = ops.filter((o) => o.applied_at >= dayAgo);
    const recentCompletes = recentOps.filter((o) => o.type === 'complete').length;
    const recentPostpones = recentOps.filter((o) => o.type === 'postpone').length;
    sendJson(res, 200, {
      server_time: nowIso(),
      today_date: today,
      open: { overdue, today: todayCount, this_week: weekCount, later: laterCount, total: open.length },
      done_total: done.length,
      completed_last_7d: recentDone,
      device_activity_24h: { completes: recentCompletes, postpones: recentPostpones },
      suggestion: {
        note: buildAgentSuggestion(overdue, todayCount, weekCount, recentDone, recentPostpones)
      }
    }); return;
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
    const AGENT_TEXT = ['title', 'note', 'project', 'why', 'source_session', 'priority', 'source', 'force_today', 'today'];
    const LIFECYCLE = ['status', 'due_date', 'due_time', 'completed_at'];
    for (const key of AGENT_TEXT.concat(LIFECYCLE)) {
      if (Object.prototype.hasOwnProperty.call(input, key)) allowed[key] = input[key];
    }
    const before = store.tasks[index];
    const updated = normalizeTask(allowed, before);
    if (updated.status === 'done' && !updated.completed_at) updated.completed_at = nowIso();
    // Conflict v2: agent text patch never silently rewrites device-applied status/due
    // unless the agent explicitly sent those lifecycle keys in this request.
    const textOnly = Object.keys(allowed).every((k) => AGENT_TEXT.includes(k));
    if (textOnly) {
      updated.status = before.status;
      updated.due_date = before.due_date;
      updated.due_time = before.due_time;
      updated.completed_at = before.completed_at;
    }
    store.tasks[index] = updated;
    writeStore(store);
    sendJson(res, 200, {
      task: publicTask(updated),
      conflict_policy: 'agent_text_device_lifecycle',
      merged: {
        agent_fields: AGENT_TEXT.filter((k) => Object.prototype.hasOwnProperty.call(allowed, k)),
        preserved_lifecycle: textOnly
          ? ['status', 'due_date', 'due_time', 'completed_at']
          : []
      }
    }); return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks/operations') {
    const input = await readBody(req);
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const deviceId = input && input.device_id ? String(input.device_id).slice(0, 64) : null;
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
        if (hasAppliedOperation(store, opId)) {
          accepted.push(opId);
          continue;
        }
        const task = store.tasks.find((item) => item.id === op.task_id);
        if (!task || task.status === 'archived') { ignored.push(opId); continue; }
        if (op.type === 'complete') { applyComplete(task, op, serverTime); }
        else if (op.type === 'postpone') { applyPostpone(task, op, serverTime); }
        else { throw new Error(`unsupported operation type: ${op.type}`); }
        rememberOperation(store, opId, String(op.task_id), serverTime,
            op.type, op.payload || null, task.title, deviceId);
        accepted.push(opId);
        // P8: fire-and-forget outbound webhook to Agent (if configured)
        notifyAgentWebhook({ event_id: opId, type: op.type, task_id: String(op.task_id),
            task_title: task.title, occurred_at: serverTime, payload: op.payload || null,
            device_id: deviceId });
      } catch (err) { errors.push({ id: opId, error: err.message }); }
    }

    // Always prune dead/expired ops even when body is empty (maintenance path).
    const pruned = pruneOperations(store);
    if (accepted.length || ignored.length || pruned > 0) writeStore(store);
    sendJson(res, 200, { server_time: nowIso(), accepted, ignored, errors, pruned }); return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/webhook/agent') {
    const input = await readBody(req);
    const eventId = webhookEventId(input);
    const store = readStore();
    const eventStore = operationStore(store);
    if (eventId && eventStore.some((item) => item.webhook_event_id === eventId)) {
      sendJson(res, 200, { event_id: eventId, duplicate: true, created: [], updated: [] }); return;
    }
    const created = [];
    const updated = [];
    const tasks = webhookTasks(input);
    if (!tasks.length || tasks.length > MAX_WEBHOOK_ITEMS) {
      throw new HttpError(400, `tasks must contain 1-${MAX_WEBHOOK_ITEMS} items`);
    }
    for (const item of tasks) {
      if (!item || typeof item !== 'object') throw new HttpError(400, 'task must be an object');
      const taskInput = { ...item, source: item.source || 'agent' };
      validateTaskInput(taskInput, !item.id);
      const index = item.id ? store.tasks.findIndex((task) => task.id === String(item.id)) : -1;
      if (index === -1) {
        const task = normalizeTask(taskInput, null);
        store.tasks.push(task);
        created.push(publicTask(task));
      } else {
        const allowed = {};
        for (const key of ['title', 'note', 'project', 'why', 'source_session', 'status', 'due_date', 'due_time', 'priority', 'source', 'force_today', 'today', 'completed_at']) {
          if (Object.prototype.hasOwnProperty.call(taskInput, key)) allowed[key] = taskInput[key];
        }
        const task = normalizeTask(allowed, store.tasks[index]);
        if (task.status === 'done' && !task.completed_at) task.completed_at = nowIso();
        store.tasks[index] = task;
        updated.push(publicTask(task));
      }
    }
    if (eventId) eventStore.push({ webhook_event_id: eventId, applied_at: nowIso() });
    writeStore(store);
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

function start(port = DEFAULT_PORT, callback) {
  const server = createServer();
  server.listen(port, callback);
  return server;
}

function validateStartupConfig(configFile = CONFIG_FILE, logger = console) {
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

if (require.main === module) {
  validateStartupConfig();

  start(DEFAULT_PORT, () => {
    const scheme = (TLS_KEY_PATH && TLS_CERT_PATH) ? 'https' : 'http';
    console.log(`InkQueue reference server listening on ${scheme}://localhost:${DEFAULT_PORT}`);
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

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

module.exports = {
  createServer,
  start,
  readStore,
  writeStore,
  nowIso,
  fetchUsage,
  validateStartupConfig,
  cliproxy,
  listEvents,
  deriveSignals,
  normalizeTask,
  applyComplete,
  applyPostpone,
  publicTask,
  notifyAgentWebhook,
  agentWebhookUrl,
  pruneOperations,
  rememberOperation,
  hasAppliedOperation,
  operationStore,
  MAX_OPERATIONS_RETAINED,
  OPERATIONS_TTL_DAYS
};
