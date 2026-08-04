#!/usr/bin/env node
'use strict';

/**
 * inkq — Agent-facing CLI for InkQueue.
 *
 * Any local agent (Hermes, Codex, Claude Code, plain shell) calls this
 * instead of hand-rolling curl. The Kindle app never talks to agents;
 * it only syncs with the server this CLI hits.
 *
 * Config resolution (first hit wins per field):
 *   1) flags: --base-url / --auth
 *   2) env:   INKQUEUE_BASE_URL / INKQUEUE_AUTH
 *   3) file:  INKQUEUE_CONFIG or ~/.inkqueue/config.json or agent/config.json
 *   4) defaults: http://127.0.0.1:8787 + dev-token
 *
 * stdout = machine JSON (for agents)
 * stderr = short human hints
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');

const DEFAULT_BASE = 'http://127.0.0.1:8787';
const DEFAULT_AUTH = 'dev-token';
const HEADER_AUTH = 'X-InkQueue-Token';
const PRODUCT_TZ_OFFSET = '+08:00';

const ROOT = path.resolve(__dirname, '..');
const LOCAL_CONFIG_CANDIDATES = [
  process.env.INKQUEUE_CONFIG,
  path.join(os.homedir(), '.inkqueue', 'config.json'),
  path.join(__dirname, 'config.json'),
  path.join(ROOT, 'server', 'data', 'agent-config.json')
].filter(Boolean);

function usage(code) {
  const text = `inkq — InkQueue agent CLI

Usage:
  inkq health
  inkq context
  inkq list [--status todo|done|all] [--due today|tomorrow|YYYY-MM-DD]
  inkq get <task_id>
  inkq add --title <text> [options]
  inkq patch <task_id> [options]
  inkq events [--since <ISO>] [--limit <n>]

Add / patch options:
  --title <text>
  --note <text>
  --due <today|tomorrow|YYYY-MM-DD>
  --time <HH:mm>
  --priority <normal|high>
  --status <todo|done|archived>
  --source <agent|device|imported>

Global:
  --base-url <url>     default ${DEFAULT_BASE}
  --auth <secret>      dev default is local only
  --config <path>      JSON with base_url / auth
  --help

Exit codes: 0 ok, 1 usage/client, 2 server/network, 3 not found
`;
  process.stderr.write(text);
  process.exit(code);
}

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

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.flags.help = true;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
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

function buildConfig(flags) {
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

function emit(okPayload, hint) {
  if (hint) process.stderr.write(hint.endsWith('\n') ? hint : hint + '\n');
  process.stdout.write(JSON.stringify(okPayload, null, 2) + '\n');
}

function fail(exitCode, error, detail) {
  const body = { ok: false, error, detail: detail || null };
  process.stdout.write(JSON.stringify(body, null, 2) + '\n');
  process.exit(exitCode);
}

async function cmdHealth(cfg) {
  try {
    const res = await request(cfg, 'GET', '/v1/health');
    if (res.status !== 200) {
      fail(2, 'health_failed', { status: res.status, body: res.json });
    }
    emit(
      { ok: true, base_url: cfg.baseUrl, health: res.json, config_path: cfg.configPath },
      'server ok'
    );
  } catch (err) {
    fail(2, 'unreachable', {
      message: err.message,
      base_url: cfg.baseUrl,
      hint: 'Start server: cd server && npm start   or   node scripts/server-ctl.js start'
    });
  }
}

async function cmdContext(cfg) {
  const res = await request(cfg, 'GET', '/v1/agent/context');
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 200) fail(2, 'context_failed', { status: res.status, body: res.json });
  const note = res.json && res.json.suggestion && res.json.suggestion.note;
  emit({ ok: true, context: res.json }, note ? `suggestion: ${note}` : 'context ok');
}

function filterTasks(tasks, flags) {
  let list = Array.isArray(tasks) ? tasks.slice() : [];
  const status = (flags.status || 'todo').toLowerCase();
  if (status !== 'all') {
    list = list.filter((t) => String(t.status || '') === status);
  }
  if (flags.due) {
    const due = resolveDue(flags.due);
    list = list.filter((t) => t.due_date === due);
  }
  return list;
}

async function cmdList(cfg, flags) {
  const res = await request(cfg, 'GET', '/v1/tasks/snapshot');
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 200) fail(2, 'list_failed', { status: res.status, body: res.json });
  const all = (res.json && res.json.tasks) || [];
  const tasks = filterTasks(all, flags);
  emit(
    {
      ok: true,
      server_time: res.json.server_time,
      count: tasks.length,
      filter: { status: flags.status || 'todo', due: flags.due || null },
      tasks
    },
    `${tasks.length} task(s)`
  );
}

async function cmdGet(cfg, id) {
  const res = await request(cfg, 'GET', '/v1/tasks/snapshot');
  if (res.status !== 200) fail(2, 'snapshot_failed', { status: res.status, body: res.json });
  const tasks = (res.json && res.json.tasks) || [];
  const task = tasks.find((t) => t.id === id);
  if (!task) fail(3, 'not_found', { id });
  emit({ ok: true, task }, `found ${id}`);
}

async function cmdAdd(cfg, flags) {
  if (!flags.title || !String(flags.title).trim()) {
    fail(1, 'title_required', { hint: 'inkq add --title "..."' });
  }
  const body = {
    title: String(flags.title).trim(),
    source: flags.source || 'agent'
  };
  if (flags.note !== undefined) body.note = flags.note;
  if (flags.due !== undefined) body.due_date = resolveDue(flags.due);
  if (flags.time !== undefined) body.due_time = flags.time;
  if (flags.priority !== undefined) body.priority = flags.priority;
  if (flags.status !== undefined) body.status = flags.status;

  const res = await request(cfg, 'POST', '/v1/tasks', body);
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 201 && res.status !== 200) {
    fail(2, 'add_failed', { status: res.status, body: res.json });
  }
  const task = res.json && res.json.task;
  emit(
    { ok: true, task },
    task
      ? `added ${task.id} — Kindle 同步后可见`
      : 'added'
  );
}

async function cmdPatch(cfg, id, flags) {
  const body = {};
  if (flags.title !== undefined) body.title = flags.title;
  if (flags.note !== undefined) body.note = flags.note;
  if (flags.due !== undefined) body.due_date = resolveDue(flags.due);
  if (flags.time !== undefined) body.due_time = flags.time;
  if (flags.priority !== undefined) body.priority = flags.priority;
  if (flags.status !== undefined) body.status = flags.status;
  if (flags.source !== undefined) body.source = flags.source;
  if (Object.keys(body).length === 0) {
    fail(1, 'nothing_to_patch', { hint: 'pass --title/--note/--due/--time/--priority/--status' });
  }
  const res = await request(cfg, 'PATCH', `/v1/tasks/${encodeURIComponent(id)}`, body);
  if (res.status === 404) fail(3, 'not_found', { id, body: res.json });
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 200) fail(2, 'patch_failed', { status: res.status, body: res.json });
  emit({ ok: true, task: res.json.task }, `patched ${id}`);
}

async function cmdEvents(cfg, flags) {
  const q = new URLSearchParams();
  if (flags.since) q.set('since', flags.since);
  if (flags.limit) q.set('limit', String(flags.limit));
  const qs = q.toString();
  const res = await request(cfg, 'GET', '/v1/events' + (qs ? `?${qs}` : ''));
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 200) fail(2, 'events_failed', { status: res.status, body: res.json });
  const events = (res.json && res.json.events) || [];
  emit(
    {
      ok: true,
      server_time: res.json.server_time,
      latest_event_at: res.json.latest_event_at,
      count: events.length,
      events
    },
    `${events.length} event(s)`
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.help || parsed._.length === 0) usage(parsed._.length === 0 ? 1 : 0);

  let cfg;
  try {
    cfg = buildConfig(parsed.flags);
  } catch (err) {
    fail(1, 'config_error', { message: err.message });
  }

  const [cmd, arg1] = parsed._;
  try {
    switch (cmd) {
      case 'health':
        await cmdHealth(cfg);
        break;
      case 'context':
        await cmdContext(cfg);
        break;
      case 'list':
        await cmdList(cfg, parsed.flags);
        break;
      case 'get':
        if (!arg1) fail(1, 'id_required', { hint: 'inkq get <task_id>' });
        await cmdGet(cfg, arg1);
        break;
      case 'add':
        await cmdAdd(cfg, parsed.flags);
        break;
      case 'patch':
        if (!arg1) fail(1, 'id_required', { hint: 'inkq patch <task_id> --title ...' });
        await cmdPatch(cfg, arg1, parsed.flags);
        break;
      case 'events':
        await cmdEvents(cfg, parsed.flags);
        break;
      default:
        fail(1, 'unknown_command', { cmd, hint: 'inkq --help' });
    }
  } catch (err) {
    if (err && err.message && /invalid --due/.test(err.message)) {
      fail(1, 'bad_args', { message: err.message });
    }
    fail(2, 'request_error', {
      message: err.message,
      base_url: cfg.baseUrl,
      hint: 'Check server is up: inkq health'
    });
  }
}

main();
