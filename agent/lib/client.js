/**
 * Shared InkQueue HTTP client for agent CLI / future MCP adapters.
 * Single source for config resolution + HTTP so protocol does not fork.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');

const DEFAULT_BASE = 'http://127.0.0.1:8787';
const DEFAULT_AUTH = 'dev-token';
const HEADER_AUTH = 'X-InkQueue-Token';
const PRODUCT_TZ_OFFSET = '+08:00';

const ROOT = path.resolve(__dirname, '..', '..');
const LOCAL_CONFIG_CANDIDATES = [
  process.env.INKQUEUE_CONFIG,
  path.join(os.homedir(), '.inkqueue', 'config.json'),
  path.join(__dirname, '..', 'config.json'),
  path.join(ROOT, 'server', 'data', 'agent-config.json')
].filter(Boolean);

function readJsonFile(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadFileConfig(explicitPath) {
  const paths = explicitPath ? [explicitPath] : LOCAL_CONFIG_CANDIDATES;
  for (const p of paths) {
    if (!p) continue;
    const raw = readJsonFile(p);
    if (raw && typeof raw === 'object') {
      return { path: p, data: raw };
    }
  }
  return { path: null, data: {} };
}

/** Asia/Shanghai wall clock as +08:00 ISO parts (mirrors server). */
function shanghaiNowParts() {
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
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`
  };
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function resolveDue(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim().toLowerCase();
  const today = shanghaiNowParts().date;
  if (s === 'today') return today;
  if (s === 'tomorrow') return addDaysYmd(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error(`invalid --due (want today|tomorrow|YYYY-MM-DD): ${raw}`);
}

/**
 * @param {object} [flags]
 * @param {string} [flags['base-url']]
 * @param {string} [flags.auth]
 * @param {string} [flags.config]
 */
function buildConfig(flags) {
  flags = flags || {};
  const file = loadFileConfig(flags.config);
  const data = file.data || {};
  const baseUrl = String(
    flags['base-url'] ||
      process.env.INKQUEUE_BASE_URL ||
      data.base_url ||
      data.baseUrl ||
      DEFAULT_BASE
  ).replace(/\/$/, '');
  const auth = String(
    flags.auth ||
      process.env.INKQUEUE_AUTH ||
      data.auth ||
      data.token ||
      DEFAULT_AUTH
  );
  return { baseUrl, auth, configPath: file.path };
}

/**
 * Low-level HTTP. Returns { status, json, raw }.
 * @param {{baseUrl:string, auth:string}} cfg
 * @param {string} method
 * @param {string} apiPath
 * @param {object} [bodyObj]
 */
function request(cfg, method, apiPath, bodyObj) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(apiPath, cfg.baseUrl.endsWith('/') ? cfg.baseUrl : cfg.baseUrl + '/');
    } catch (err) {
      reject(err);
      return;
    }
    const payload = bodyObj === undefined ? null : JSON.stringify(bodyObj);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers = {
      Accept: 'application/json',
      [HEADER_AUTH]: cfg.auth
    };
    if (payload !== null) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 15000
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch {
              json = { raw };
            }
          }
          resolve({ status: res.statusCode || 0, json, raw });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function health(cfg) {
  return request(cfg, 'GET', '/v1/health');
}

async function context(cfg) {
  return request(cfg, 'GET', '/v1/agent/context');
}

async function snapshot(cfg) {
  return request(cfg, 'GET', '/v1/tasks/snapshot');
}

async function createTask(cfg, body) {
  return request(cfg, 'POST', '/v1/tasks', body);
}

async function patchTask(cfg, id, body) {
  return request(cfg, 'PATCH', `/v1/tasks/${encodeURIComponent(id)}`, body);
}

async function events(cfg, opts) {
  opts = opts || {};
  const q = new URLSearchParams();
  if (opts.since) q.set('since', opts.since);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return request(cfg, 'GET', '/v1/events' + (qs ? `?${qs}` : ''));
}

module.exports = {
  DEFAULT_BASE,
  DEFAULT_AUTH,
  HEADER_AUTH,
  PRODUCT_TZ_OFFSET,
  ROOT,
  buildConfig,
  loadFileConfig,
  request,
  health,
  context,
  snapshot,
  createTask,
  patchTask,
  events,
  shanghaiNowParts,
  addDaysYmd,
  resolveDue
};
