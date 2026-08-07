'use strict';

// Optional CPA (CLIProxyAPI) usage / admin routes.
//
// This module is the ONLY place that requires('./cliproxy').
// The core task server never imports cliproxy directly — usage routes
// are attached via attachUsageRoutes() only when CPA features are
// desired (default: on, unless INKQUEUE_DISABLE_USAGE=1).
//
// All state is module-scoped: usageCache, USAGE_CACHE_TTL.

const http = require('http');
const tls = require('tls');
const cliproxy = require('../cliproxy');

const USAGE_CACHE_TTL = 8000;
let usageCache = { data: null, timestamp: 0 };

// ── proxy helpers (HTTP CONNECT tunnel for Clash node flakiness) ──

function tryHttpConnect(proxy, url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proxyUrl = new URL(proxy);
    const isHttps = urlObj.protocol === 'https:';
    const req = http.request({
      hostname: proxyUrl.hostname, port: proxyUrl.port,
      method: 'CONNECT',
      path: urlObj.hostname + (urlObj.port || (isHttps ? 443 : 80)),
      timeout: 10000,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error('proxy CONNECT refused')); return; }
      const doSend = (sock) => {
        const method = options.method || 'GET';
        const path = urlObj.pathname + urlObj.search;
        const headers = options.headers || {};
        let reqLine = method + ' ' + path + ' HTTP/1.1\r\n' + 'Host: ' + urlObj.hostname + '\r\n';
        for (const [k, v] of Object.entries(headers)) reqLine += k + ': ' + v + '\r\n';
        if (options.body) reqLine += 'Content-Length: ' + Buffer.byteLength(options.body) + '\r\n';
        reqLine += 'Connection: close\r\n\r\n';
        if (options.body) reqLine += options.body;
        sock.write(reqLine);
        let raw = '';
        sock.on('data', (c) => { raw += c; });
        sock.on('end', () => {
          const idx = raw.indexOf('\r\n\r\n');
          if (idx === -1) { reject(new Error('bad proxy response')); return; }
          const headerBlock = raw.substring(0, idx);
          const bodyData = raw.substring(idx + 4);
          const m = headerBlock.match(/HTTP\/\d\.(\d) (\d+)/);
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

function proxiedFetch(url, options, retries, readConfig) {
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

// ── formatting helpers ──

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
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    return {
      key_count: raw.length,
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
  return { key_count: keys.length, total_requests: totalRequests, total_tokens: totalTokens };
}

function summarizeUsageQueue(raw) {
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && Array.isArray(raw.queue)) items = raw.queue;
  else if (raw && Array.isArray(raw.items)) items = raw.items;
  else if (raw && Array.isArray(raw.data)) items = raw.data;
  if (!items.length) return null;
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
  let best = null;
  for (const it of alive) {
    const primary = it.data && it.data.primary ? it.data.primary : null;
    const pct = Number(
      (primary && primary.usage_percent) ||
      (it.data && it.data.windows && it.data.windows.rolling && it.data.windows.rolling.usage_percent) ||
      0
    );
    const label = (primary && primary.label) || null;
    const limitSeconds = (primary && primary.limit_window_seconds) || null;
    const resetAfter = (primary && primary.reset_after_seconds) || null;
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
  const enough = Boolean(capacity.enough);
  const codexEnabled = Number(
    (codexSummary && codexSummary.alive != null ? codexSummary.alive : null) ??
    capacity.codex_enabled ?? (byType.codex && byType.codex.enabled) ?? 0
  );
  const codexDead = Number(
    (codexSummary && codexSummary.dead != null ? codexSummary.dead : null) ??
    capacity.codex_dead ?? (byType.codex && byType.codex.probe_dead) ?? 0
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

  const statusText = health.ok ? '正常' : '异常';
  const stockText = enough ? '够用' : '偏少';
  const codexLine = codexDead > 0
    ? ('Codex 可用 ' + codexEnabled + (codexFileTotal ? ('/' + codexFileTotal) : '') + ' · 失效 ' + codexDead)
    : ('Codex 可用 ' + codexEnabled);
  const lines = [
    '状态：' + statusText + (latencyLabel ? ('  延迟 ' + latencyLabel) : ''),
    '账号池：' + total + ' 个  ' + stockText,
    '  ' + codexLine + ' · Grok ' + xaiEnabled,
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
        + '  均延迟 ' + usageQueue.avg_latency_ms + 'ms')
      : null,
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
        accounts: []
      },
      runtime: runtime || {
        total_success: success,
        total_failed: failed
      },
      enough,
      lines,
      codex_enabled: codexEnabled,
      codex_dead: codexDead,
      codex_total: codexFileTotal,
      xai_enabled: xaiEnabled,
      total_accounts: total,
      success: success,
      failed,
      unavailable,
      disabled,
      token_expired: tokenExpired,
      model_count: modelCount,
      latency_ms: latencyMs,
      api_key_usage: apiKeyUsage,
      usage_queue: usageQueue,
      codex_quota: codexSummary,
      windows: {},
      codex_usage: snapshot.codex_usage || []
    }
  };
}

async function fetchUsage(options, deps) {
  const now = Date.now();
  const opts = options || {};
  if (!opts.force && usageCache.data && (now - usageCache.timestamp) < USAGE_CACHE_TTL) {
    return usageCache.data;
  }
  const config = deps.readConfig();
  const includeCodexUsage = opts.includeCodexUsage === true;
  const cpaSnap = await cliproxy.fetchCliproxySnapshot(config, {
    includeCodexUsage: true,
    probeCodex: true,
    maxCodex: 5
  });
  const cliproxyProvider = buildCliproxyProvider(cpaSnap);

  usageCache = {
    data: {
      server_time: deps.nowIso(),
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

// ── route attachment ──
//
// deps: { readConfig, nowIso, sendJson, hasToken, hasTokenOrQuery }
// Returns an async function (req, res, url) => boolean —
//   true if the request was handled by usage routes, false otherwise.

function attachUsageRoutes(deps) {
  const { readConfig, nowIso, sendJson, hasToken, hasTokenOrQuery } = deps;

  async function handle(req, res, url) {
    // Admin HTML panel (token via query for e-ink browsers)
    if (req.method === 'GET' && (url.pathname === '/admin/cliproxy' || url.pathname === '/admin')) {
      if (!hasTokenOrQuery(req, url)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return true;
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
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/v1/usage') {
      if (!hasToken(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return true;
      }
      const includeCodexUsage = url.searchParams.get('codex_usage') === '1';
      const force = url.searchParams.get('force') === '1' || includeCodexUsage;
      sendJson(res, 200, await fetchUsage({ includeCodexUsage, force }, { readConfig, nowIso }));
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/v1/cliproxy/health') {
      if (!hasToken(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return true;
      }
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
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/v1/cliproxy/pool') {
      if (!hasToken(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return true;
      }
      const config = readConfig();
      const includeCodexUsage = url.searchParams.get('codex_usage') === '1';
      const snapshot = await cliproxy.fetchCliproxySnapshot(config, {
        includeCodexUsage,
        maxCodex: 5
      });
      sendJson(res, 200, snapshot);
      return true;
    }

    return false;
  }

  return handle;
}

module.exports = { attachUsageRoutes, fetchUsage, buildCliproxyProvider, proxiedFetch };