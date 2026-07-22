'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const tls = require('tls');
const cliproxy = require('./cliproxy');

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

function validateStartupConfig(configFile = CONFIG_FILE, logger = console) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      logger.warn('Config: no config.json found, /v1/usage will return fallback data');
    } else {
      logger.warn('Config: config.json parse error:', e.message);
    }
    return;
  }

  if (!config || typeof config !== 'object' || !config.opencode_api_key) {
    logger.warn('Config: opencode_api_key is missing, /v1/usage will return fallback data');
  }
}

if (require.main === module) {
  validateStartupConfig();

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

module.exports = {
  createServer,
  start,
  readStore,
  writeStore,
  nowIso,
  fetchUsage,
  validateStartupConfig,
  cliproxy
};
