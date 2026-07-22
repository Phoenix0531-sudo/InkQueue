'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const tls = require('tls');

const DEFAULT_BASE = 'http://127.0.0.1:18317';
const DEFAULT_API_KEY = 'sk-cliproxy-local';
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveAuthDir(config) {
  const raw = (config && (config.cliproxy_auth_dir || config.auth_dir)) || process.env.CLIPROXY_AUTH_DIR || DEFAULT_AUTH_DIR;
  return path.resolve(expandHome(String(raw)));
}

function resolveBaseUrl(config) {
  return String((config && config.cliproxy_base_url) || process.env.CLIPROXY_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function resolveApiKey(config) {
  return String((config && config.cliproxy_api_key) || process.env.CLIPROXY_API_KEY || DEFAULT_API_KEY);
}

function resolveManagementKey(config) {
  return String(
    (config && (config.cliproxy_management_key || config.management_key)) ||
    process.env.CLIPROXY_MANAGEMENT_KEY ||
    ''
  );
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at <= 1) return email;
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = Math.min(2, name.length);
  return name.slice(0, keep) + '***@' + domain;
}

function isExpired(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t <= Date.now();
}

function readAccountFiles(authDir) {
  if (!fs.existsSync(authDir)) {
    return { ok: false, error: 'auth_dir_missing', auth_dir: authDir, accounts: [] };
  }
  let files;
  try {
    files = fs.readdirSync(authDir).filter((f) => f.endsWith('.json'));
  } catch (e) {
    return { ok: false, error: e.message, auth_dir: authDir, accounts: [] };
  }

  const accounts = [];
  for (const file of files) {
    const full = path.join(authDir, file);
    try {
      const d = JSON.parse(fs.readFileSync(full, 'utf8'));
      const type = d.type || d.provider || 'unknown';
      const expired = d.expired || d.expires_at || null;
      accounts.push({
        id: d.account_id || file.replace(/\.json$/, ''),
        file,
        type,
        email: d.email || null,
        email_masked: maskEmail(d.email),
        disabled: Boolean(d.disabled),
        expired,
        token_expired: isExpired(expired),
        last_refresh: d.last_refresh || null,
        has_access_token: Boolean(d.access_token),
        has_refresh_token: Boolean(d.refresh_token),
        // keep token only for internal usage probes; never expose in API responses
        _access_token: d.access_token || null,
        _refresh_token: d.refresh_token || null
      });
    } catch (e) {
      accounts.push({
        id: file,
        file,
        type: 'invalid',
        email: null,
        email_masked: null,
        disabled: true,
        expired: null,
        token_expired: true,
        last_refresh: null,
        has_access_token: false,
        has_refresh_token: false,
        parse_error: e.message,
        _access_token: null,
        _refresh_token: null
      });
    }
  }

  accounts.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return String(a.email || a.file).localeCompare(String(b.email || b.file));
  });

  return { ok: true, error: null, auth_dir: authDir, accounts };
}

function summarizePool(accounts) {
  const byType = {};
  for (const a of accounts) {
    if (!byType[a.type]) {
      byType[a.type] = { total: 0, enabled: 0, disabled: 0, token_expired: 0, with_token: 0 };
    }
    const s = byType[a.type];
    s.total += 1;
    if (a.disabled) s.disabled += 1;
    else s.enabled += 1;
    if (a.token_expired) s.token_expired += 1;
    if (a.has_access_token) s.with_token += 1;
  }

  const codexEnabled = (byType.codex && byType.codex.enabled) || 0;
  const xaiEnabled = (byType.xai && byType.xai.enabled) || 0;
  // Capacity rule: enough when codex usable >= 2 OR xai enabled >= 3.
  const capacity = {
    codex_enabled: codexEnabled,
    xai_enabled: xaiEnabled,
    enough: codexEnabled >= 2 || xaiEnabled >= 3,
    note: codexEnabled >= 2 || xaiEnabled >= 3
      ? '账号池充足，单账号额度百分比次要'
      : '账号偏少，建议关注额度'
  };

  return {
    total: accounts.length,
    by_type: byType,
    capacity
  };
}

function publicAccounts(accounts) {
  return accounts.map((a) => ({
    id: a.id,
    file: a.file,
    type: a.type,
    email: a.email_masked,
    disabled: a.disabled,
    expired: a.expired,
    token_expired: a.token_expired,
    last_refresh: a.last_refresh,
    has_access_token: a.has_access_token,
    has_refresh_token: a.has_refresh_token,
    parse_error: a.parse_error || undefined
  }));
}

function httpGetJson(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: headers || {},
      timeout: timeoutMs || 4000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = { raw: raw.slice(0, 200) }; }
        resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function proxiedHttpsGetJson(proxyUrl, targetUrl, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    const proxy = new URL(proxyUrl);
    const req = http.request({
      hostname: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: urlObj.hostname + ':443',
      timeout: timeoutMs || 8000
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error('proxy CONNECT ' + res.statusCode));
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        host: urlObj.hostname,
        servername: urlObj.hostname,
        rejectUnauthorized: false
      });
      tlsSocket.setTimeout(timeoutMs || 8000);
      tlsSocket.once('secureConnect', () => {
        let line = 'GET ' + urlObj.pathname + urlObj.search + ' HTTP/1.1\r\n';
        line += 'Host: ' + urlObj.hostname + '\r\n';
        for (const [k, v] of Object.entries(headers || {})) line += k + ': ' + v + '\r\n';
        line += 'Connection: close\r\n\r\n';
        tlsSocket.write(line);
        let raw = '';
        tlsSocket.on('data', (c) => { raw += c; });
        tlsSocket.on('end', () => {
          const idx = raw.indexOf('\r\n\r\n');
          if (idx === -1) { reject(new Error('bad proxy response')); return; }
          const headerBlock = raw.slice(0, idx);
          const bodyData = raw.slice(idx + 4);
          const m = headerBlock.match(/HTTP\/\d\.\d (\d+)/);
          const status = m ? parseInt(m[1], 10) : 0;
          let body = null;
          try { body = bodyData ? JSON.parse(bodyData) : null; } catch (e) { body = { raw: bodyData.slice(0, 200) }; }
          resolve({ status, ok: status >= 200 && status < 300, body });
        });
        tlsSocket.on('error', reject);
        tlsSocket.on('timeout', () => { tlsSocket.destroy(); reject(new Error('tls timeout')); });
      });
      tlsSocket.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('proxy timeout')); });
    req.end();
  });
}

async function probeCliproxyHealth(config) {
  const base = resolveBaseUrl(config);
  const key = resolveApiKey(config);
  const started = Date.now();
  try {
    const res = await httpGetJson(base + '/v1/models', {
      Authorization: 'Bearer ' + key,
      Accept: 'application/json'
    }, 4000);
    const models = (res.body && Array.isArray(res.body.data)) ? res.body.data.map((m) => m.id) : [];
    return {
      ok: res.ok,
      base_url: base,
      latency_ms: Date.now() - started,
      status_code: res.status,
      model_count: models.length,
      models_sample: models.slice(0, 12),
      error: res.ok ? null : ('http_' + res.status)
    };
  } catch (e) {
    return {
      ok: false,
      base_url: base,
      latency_ms: Date.now() - started,
      status_code: 0,
      model_count: 0,
      models_sample: [],
      error: e.message || String(e)
    };
  }
}

function windowLabelFromSeconds(seconds) {
  const s = Number(seconds || 0);
  if (!s || s <= 0) return '额度窗口';
  // Prefer exact known windows; otherwise fall back to human duration.
  if (s >= 600000 && s <= 620000) return '7天'; // ~7d
  if (s >= 2500000 && s <= 2700000) return '30天';
  if (s >= 85000 && s <= 90000) return '1天';
  if (s >= 17000 && s <= 19000) return '5小时';
  if (s >= 3500 && s <= 3700) return '1小时';
  if (s % 86400 === 0) return (s / 86400) + '天';
  if (s % 3600 === 0) return (s / 3600) + '小时';
  if (s >= 86400) return Math.round(s / 86400) + '天';
  if (s >= 3600) return Math.round(s / 3600) + '小时';
  return Math.round(s / 60) + '分钟';
}

function parseRateWindow(win) {
  if (!win || typeof win !== 'object') return null;
  const limitSeconds = Number(
    win.limit_window_seconds != null ? win.limit_window_seconds : (win.window_seconds || 0)
  );
  const resetAfter = Number(
    win.reset_after_seconds != null
      ? win.reset_after_seconds
      : (win.resets_in_seconds != null ? win.resets_in_seconds : 0)
  );
  const usagePercent = Number(
    win.used_percent != null ? win.used_percent : (win.percent != null ? win.percent : 0)
  );
  return {
    usage_percent: usagePercent,
    limit_window_seconds: limitSeconds || null,
    reset_after_seconds: resetAfter || null,
    reset_at: win.reset_at != null ? win.reset_at : null,
    // label derived from API window length — never hardcode 5-hour
    label: windowLabelFromSeconds(limitSeconds)
  };
}

function parseCodexUsageBody(json) {
  if (!json || typeof json !== 'object') return null;
  const rl = json.rate_limit || null;
  if (!rl) {
    return {
      plan_type: json.plan_type || null,
      allowed: null,
      limit_reached: null,
      primary: null,
      secondary: null,
      credits: json.credits || null
    };
  }
  return {
    plan_type: json.plan_type || null,
    allowed: rl.allowed != null ? Boolean(rl.allowed) : null,
    limit_reached: rl.limit_reached != null ? Boolean(rl.limit_reached) : null,
    rate_limit_reached_type: json.rate_limit_reached_type || null,
    primary: parseRateWindow(rl.primary_window),
    secondary: parseRateWindow(rl.secondary_window),
    credits: json.credits || null
  };
}

async function probeCodexAccountUsage(account, proxyUrl) {
  if (!account._access_token) {
    return { id: account.id, email: account.email_masked, type: 'codex', error: 'no_access_token', data: null };
  }
  try {
    let res;
    if (proxyUrl) {
      res = await proxiedHttpsGetJson(proxyUrl, 'https://chatgpt.com/backend-api/wham/usage', {
        Authorization: 'Bearer ' + account._access_token,
        Accept: 'application/json'
      }, 10000);
    } else {
      res = await httpGetJson('https://chatgpt.com/backend-api/wham/usage', {
        Authorization: 'Bearer ' + account._access_token,
        Accept: 'application/json'
      }, 10000);
    }
    if (!res.ok) {
      return {
        id: account.id,
        email: account.email_masked,
        type: 'codex',
        error: 'http_' + res.status,
        data: null
      };
    }
    return {
      id: account.id,
      email: account.email_masked,
      type: 'codex',
      error: null,
      data: parseCodexUsageBody(res.body)
    };
  } catch (e) {
    return {
      id: account.id,
      email: account.email_masked,
      type: 'codex',
      error: (e.message || String(e)).slice(0, 120),
      data: null
    };
  }
}

async function managementGet(config, pathAndQuery, timeoutMs) {
  const base = resolveBaseUrl(config);
  const key = resolveManagementKey(config);
  if (!key) {
    return { ok: false, enabled: false, status: 0, error: 'management_key_missing', body: null };
  }
  try {
    const res = await httpGetJson(base + pathAndQuery, {
      Authorization: 'Bearer ' + key,
      'X-Management-Key': key,
      Accept: 'application/json'
    }, timeoutMs || 5000);
    return {
      ok: res.ok,
      enabled: true,
      status: res.status,
      error: res.ok ? null : ('http_' + res.status),
      body: res.body
    };
  } catch (e) {
    return {
      ok: false,
      enabled: true,
      status: 0,
      error: e.message || String(e),
      body: null
    };
  }
}

function sanitizeManagementAuthFiles(body) {
  const files = (body && Array.isArray(body.files)) ? body.files : [];
  const byType = {};
  const accounts = files.map((f) => {
    const type = f.type || f.provider || 'unknown';
    if (!byType[type]) {
      byType[type] = {
        total: 0,
        active: 0,
        disabled: 0,
        unavailable: 0,
        success: 0,
        failed: 0
      };
    }
    const s = byType[type];
    s.total += 1;
    if (f.disabled) s.disabled += 1;
    else s.active += 1;
    if (f.unavailable) s.unavailable += 1;
    s.success += Number(f.success || 0);
    s.failed += Number(f.failed || 0);
    return {
      id: f.id || f.name || f.auth_index || null,
      type,
      email: maskEmail(f.email || f.account || f.label || null),
      disabled: Boolean(f.disabled),
      unavailable: Boolean(f.unavailable),
      status: f.status || null,
      status_message: f.status_message || '',
      success: Number(f.success || 0),
      failed: Number(f.failed || 0),
      recent_requests: Array.isArray(f.recent_requests) ? f.recent_requests : [],
      updated_at: f.updated_at || null,
      created_at: f.created_at || null
    };
  });

  const codexEnabled = (byType.codex && byType.codex.active) || 0;
  const xaiEnabled = (byType.xai && byType.xai.active) || 0;
  return {
    total: accounts.length,
    by_type: byType,
    capacity: {
      codex_enabled: codexEnabled,
      xai_enabled: xaiEnabled,
      enough: codexEnabled >= 2 || xaiEnabled >= 3,
      note: (codexEnabled >= 2 || xaiEnabled >= 3)
        ? '账号池充足，单账号 5h 百分比次要'
        : '账号偏少，建议关注额度'
    },
    accounts
  };
}

async function fetchManagementSnapshot(config) {
  const key = resolveManagementKey(config);
  if (!key) {
    return {
      enabled: false,
      ok: false,
      reason: 'management_key_missing',
      auth_status: null,
      usage_statistics_enabled: null,
      api_key_usage: null,
      usage_queue: null,
      pool: null
    };
  }

  const [authStatus, statsEnabled, apiKeyUsage, usageQueue, authFiles] = await Promise.all([
    managementGet(config, '/v0/management/get-auth-status'),
    managementGet(config, '/v0/management/usage-statistics-enabled'),
    managementGet(config, '/v0/management/api-key-usage'),
    managementGet(config, '/v0/management/usage-queue?count=20'),
    managementGet(config, '/v0/management/auth-files')
  ]);

  const enabledOk = [authStatus, statsEnabled, authFiles].some((r) => r.ok);
  return {
    enabled: true,
    ok: enabledOk,
    reason: enabledOk ? null : (authStatus.error || statsEnabled.error || authFiles.error || 'management_unreachable'),
    auth_status: authStatus.ok ? authStatus.body : { error: authStatus.error, status: authStatus.status },
    usage_statistics_enabled: statsEnabled.ok
      ? Boolean(statsEnabled.body && statsEnabled.body['usage-statistics-enabled'])
      : null,
    api_key_usage: apiKeyUsage.ok ? apiKeyUsage.body : null,
    usage_queue: usageQueue.ok ? usageQueue.body : null,
    pool: authFiles.ok ? sanitizeManagementAuthFiles(authFiles.body) : null,
    endpoints: {
      auth_status: authStatus.status,
      usage_statistics_enabled: statsEnabled.status,
      api_key_usage: apiKeyUsage.status,
      usage_queue: usageQueue.status,
      auth_files: authFiles.status
    }
  };
}

async function fetchCliproxySnapshot(config, options) {
  const opts = options || {};
  const authDir = resolveAuthDir(config);
  const pool = readAccountFiles(authDir);
  const [health, management] = await Promise.all([
    probeCliproxyHealth(config),
    fetchManagementSnapshot(config)
  ]);
  const fileSummary = summarizePool(pool.accounts || []);

  // Prefer management auth-files when available (runtime success/failed counters).
  // Overlay token_expired / disabled from local auth-dir files (management often omits expiry).
  const effectivePoolSummary = (management.ok && management.pool)
    ? {
        total: management.pool.total,
        by_type: Object.fromEntries(Object.entries(management.pool.by_type).map(([k, v]) => {
          const fileSide = fileSummary.by_type[k] || {};
          return [k, {
            total: v.total,
            enabled: v.active,
            disabled: Number(v.disabled || 0) || Number(fileSide.disabled || 0),
            token_expired: Number(fileSide.token_expired || 0),
            with_token: v.active,
            unavailable: v.unavailable,
            success: v.success,
            failed: v.failed
          }];
        })),
        capacity: management.pool.capacity
      }
    : fileSummary;

  const accounts = (management.ok && management.pool && management.pool.accounts.length)
    ? management.pool.accounts
    : publicAccounts(pool.accounts || []);

  let codexUsage = [];
  // Always probe Codex accounts for real health (file "active" can still be 401).
  // Keep it bounded and only when not explicitly disabled.
  const shouldProbeCodex = opts.includeCodexUsage !== false && opts.probeCodex !== false;
  if (shouldProbeCodex) {
    const proxy = (config && config.proxy) || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '';
    const codexAccounts = (pool.accounts || []).filter((a) => a.type === 'codex' && !a.disabled && a.has_access_token);
    const limited = codexAccounts.slice(0, opts.maxCodex || 5);
    codexUsage = await Promise.all(limited.map((a) => probeCodexAccountUsage(a, proxy)));
  }

  // Reconcile "enabled" Codex against real probe results.
  // Files/management may still list 3, but dead tokens should not count as usable.
  const codexAlive = codexUsage.filter((u) => !u.error && u.data).length;
  const codexDead = codexUsage.filter((u) => !!u.error).length;
  const codexProbed = codexUsage.length;
  if (codexProbed > 0 && effectivePoolSummary.by_type && effectivePoolSummary.by_type.codex) {
    const c = effectivePoolSummary.by_type.codex;
    c.enabled = codexAlive;
    c.active = codexAlive;
    c.probe_dead = codexDead;
    c.probe_total = codexProbed;
    // keep unavailable as max of management unavailable and probe dead
    c.unavailable = Math.max(Number(c.unavailable || 0), codexDead);
  }
  if (codexProbed > 0 && effectivePoolSummary.capacity) {
    effectivePoolSummary.capacity.codex_enabled = codexAlive;
    effectivePoolSummary.capacity.codex_dead = codexDead;
    effectivePoolSummary.capacity.enough =
      codexAlive >= 2 || Number(effectivePoolSummary.capacity.xai_enabled || 0) >= 3;
    effectivePoolSummary.capacity.note = effectivePoolSummary.capacity.enough
      ? '账号池充足，单账号额度百分比次要'
      : '可用 Codex 偏少，请关注额度/失效号';
  }

  return {
    server_time: new Date().toISOString(),
    source: management.ok ? 'cliproxyapi-management+auth-dir' : 'cliproxyapi-auth-dir',
    management_api: {
      enabled: management.enabled,
      ok: management.ok,
      reason: management.reason,
      auth_status: management.auth_status,
      usage_statistics_enabled: management.usage_statistics_enabled,
      api_key_usage: management.api_key_usage,
      usage_queue: management.usage_queue,
      endpoints: management.endpoints || null
    },
    health,
    pool: {
      ok: pool.ok || Boolean(management.ok && management.pool),
      error: pool.error,
      auth_dir: pool.auth_dir,
      summary: effectivePoolSummary,
      accounts
    },
    runtime: management.ok && management.pool ? {
      by_type: management.pool.by_type,
      total_success: Object.values(management.pool.by_type).reduce((n, v) => n + (v.success || 0), 0),
      total_failed: Object.values(management.pool.by_type).reduce((n, v) => n + (v.failed || 0), 0)
    } : null,
    codex_usage: codexUsage,
    codex_health: {
      probed: codexProbed,
      alive: codexAlive,
      dead: codexDead
    },
    enough: effectivePoolSummary.capacity.enough
  };
}

function buildAdminHtml(snapshot) {
  const health = snapshot.health || {};
  const summary = (snapshot.pool && snapshot.pool.summary) || { total: 0, by_type: {}, capacity: {} };
  const accounts = (snapshot.pool && snapshot.pool.accounts) || [];
  const codexUsage = snapshot.codex_usage || [];
  const mgmt = snapshot.management_api || {};
  const runtime = snapshot.runtime || null;

  const byTypeRows = Object.keys(summary.by_type || {}).map((t) => {
    const s = summary.by_type[t];
    return `<tr><td>${esc(t)}</td><td>${s.total || 0}</td><td>${s.enabled || s.active || 0}</td><td>${s.disabled || 0}</td><td>${s.success || 0}</td><td>${s.failed || 0}</td><td>${s.unavailable || 0}</td></tr>`;
  }).join('');

  const accountRows = accounts.map((a) => {
    const status = a.disabled ? 'disabled' : (a.unavailable ? 'unavailable' : (a.status || (a.token_expired ? 'token expired' : 'ok')));
    return `<tr>
      <td>${esc(a.type)}</td>
      <td>${esc(a.email || a.id)}</td>
      <td>${esc(status)}</td>
      <td>${Number(a.success || 0)}</td>
      <td>${Number(a.failed || 0)}</td>
      <td>${esc(a.updated_at || a.expired || a.last_refresh || '-')}</td>
    </tr>`;
  }).join('');

  const usageRows = codexUsage.map((u) => {
    const p5 = u.data && u.data.primary ? u.data.primary.usage_percent + '%' : '-';
    const pw = u.data && u.data.secondary ? u.data.secondary.usage_percent + '%' : '-';
    return `<tr>
      <td>${esc(u.email || u.id)}</td>
      <td>${esc(p5)}</td>
      <td>${esc(pw)}</td>
      <td>${esc(u.error || 'ok')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">未拉取单账号 5h/周额度（账号池足够时可忽略）</td></tr>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>InkQueue · CLIProxy 管理面板</title>
  <style>
    body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:24px;background:#fff;color:#000;line-height:1.45}
    h1{font-size:22px;margin:0 0 8px}
    h2{font-size:16px;margin:28px 0 10px;border-bottom:1px solid #000;padding-bottom:4px}
    .muted{color:#333;font-size:13px}
    .ok{color:#000;font-weight:700}
    .bad{color:#000;font-weight:700}
    table{border-collapse:collapse;width:100%;max-width:1100px;margin-top:8px}
    th,td{border:1px solid #000;padding:8px 10px;text-align:left;font-size:13px;vertical-align:top}
    th{background:#f5f5f5}
    .card{border:1px solid #000;padding:12px 14px;max-width:1100px;margin:10px 0}
    code{font-size:12px}
    a{color:#000}
  </style>
</head>
<body>
  <h1>CLIProxy 健康 / 账号池 / 用量</h1>
  <div class="muted">更新时间：${esc(snapshot.server_time || '')} · 数据源：${esc(snapshot.source || '')}</div>

  <h2>健康状态</h2>
  <div class="card">
    <div class="${health.ok ? 'ok' : 'bad'}">${health.ok ? 'OK' : 'DOWN'} · ${esc(health.base_url || '')}</div>
    <div class="muted">latency ${health.latency_ms || 0}ms · models ${health.model_count || 0} · ${esc(health.error || 'no error')}</div>
    <div class="muted">sample: ${esc((health.models_sample || []).join(', '))}</div>
  </div>

  <h2>Management API</h2>
  <div class="card">
    <div class="${mgmt.enabled && mgmt.ok ? 'ok' : 'bad'}">${mgmt.enabled && mgmt.ok ? 'ENABLED + OK' : (mgmt.enabled ? 'ENABLED but ERROR' : 'DISABLED')}</div>
    <div class="muted">usage-statistics-enabled: ${esc(String(mgmt.usage_statistics_enabled))} · auth_status: ${esc(JSON.stringify(mgmt.auth_status || {}))}</div>
    <div class="muted">reason: ${esc(mgmt.reason || 'none')}</div>
  </div>

  <h2>账号池汇总</h2>
  <div class="card">
    <div>总计 <b>${summary.total || 0}</b> · Codex 可用 <b>${(summary.capacity && summary.capacity.codex_enabled) || 0}</b> · xAI 可用 <b>${(summary.capacity && summary.capacity.xai_enabled) || 0}</b></div>
    <div class="muted">${esc((summary.capacity && summary.capacity.note) || '')}</div>
    <div class="muted">runtime success/failed: ${runtime ? (runtime.total_success + ' / ' + runtime.total_failed) : 'n/a'}</div>
  </div>
  <table>
    <thead><tr><th>类型</th><th>总数</th><th>启用</th><th>禁用</th><th>success</th><th>failed</th><th>unavailable</th></tr></thead>
    <tbody>${byTypeRows || '<tr><td colspan="7">无账号</td></tr>'}</tbody>
  </table>

  <h2>账号列表</h2>
  <table>
    <thead><tr><th>类型</th><th>邮箱/ID</th><th>状态</th><th>success</th><th>failed</th><th>updated</th></tr></thead>
    <tbody>${accountRows || '<tr><td colspan="6">无账号</td></tr>'}</tbody>
  </table>

  <h2>Codex 单账号额度（可选）</h2>
  <table>
    <thead><tr><th>账号</th><th>5h</th><th>weekly</th><th>状态</th></tr></thead>
    <tbody>${usageRows}</tbody>
  </table>

  <h2>API</h2>
  <div class="muted">
    <div><code>GET /v1/cliproxy/health</code></div>
    <div><code>GET /v1/cliproxy/pool</code></div>
    <div><code>GET /v1/usage</code></div>
    <div><code>GET /admin/cliproxy?token=dev-token</code></div>
  </div>
</body>
</html>`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  resolveAuthDir,
  resolveBaseUrl,
  resolveManagementKey,
  readAccountFiles,
  summarizePool,
  publicAccounts,
  probeCliproxyHealth,
  fetchManagementSnapshot,
  fetchCliproxySnapshot,
  buildAdminHtml,
  parseCodexUsageBody,
  windowLabelFromSeconds,
  parseRateWindow
};
