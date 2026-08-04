#!/usr/bin/env node
'use strict';

/**
 * inkq — Agent-facing CLI for InkQueue.
 *
 * Any local agent (Hermes, Codex, Claude Code, plain shell) calls this
 * instead of hand-rolling curl. The Kindle app never talks to agents;
 * it only syncs with the server this CLI hits.
 *
 * HTTP + config live in agent/lib/client.js (shared with future MCP).
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

const path = require('path');
const client = require(path.join(__dirname, 'lib', 'client.js'));

const {
  DEFAULT_BASE,
  buildConfig,
  health: apiHealth,
  context: apiContext,
  snapshot: apiSnapshot,
  createTask: apiCreateTask,
  patchTask: apiPatchTask,
  events: apiEvents,
  resolveDue
} = client;

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
    const res = await apiHealth(cfg);
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
  const res = await apiContext(cfg);
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
  const res = await apiSnapshot(cfg);
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
  const res = await apiSnapshot(cfg);
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

  const res = await apiCreateTask(cfg, body);
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
  const res = await apiPatchTask(cfg, id, body);
  if (res.status === 404) fail(3, 'not_found', { id, body: res.json });
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 200) fail(2, 'patch_failed', { status: res.status, body: res.json });
  emit({ ok: true, task: res.json.task }, `patched ${id}`);
}

async function cmdEvents(cfg, flags) {
  const res = await apiEvents(cfg, { since: flags.since, limit: flags.limit });
  if (res.status === 401 || res.status === 403) fail(2, 'auth_rejected', res.json);
  if (res.status !== 200) fail(2, 'events_failed', { status: res.status, body: res.json });
  const events = (res.json && res.json.events) || [];
  const signals = (res.json && res.json.signals) || [];
  const hintParts = [`${events.length} event(s)`];
  if (signals.length) hintParts.push(`${signals.length} signal(s)`);
  const chronic = signals.filter((s) => s.kind === 'chronic_postpone');
  if (chronic.length) hintParts.push(`chronic_postpone=${chronic.length}`);
  emit(
    {
      ok: true,
      server_time: res.json.server_time,
      latest_event_at: res.json.latest_event_at,
      count: events.length,
      signal_count: signals.length,
      events,
      signals
    },
    hintParts.join(', ')
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
