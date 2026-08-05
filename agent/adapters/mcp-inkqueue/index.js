#!/usr/bin/env node
'use strict';

/**
 * mcp-inkqueue — thin MCP stdio adapter for InkQueue.
 *
 * Zero deps. Reuses agent/lib/client.js only (no second HTTP stack).
 * Optional; main path remains: node agent/inkq.js
 *
 * Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0
 *   (matches official Python mcp SDK used by Hermes; NOT Content-Length)
 *   tools: health, context, list, get, add, patch, events
 */

const path = require('path');
// agent/adapters/mcp-inkqueue → agent/lib/client.js
const client = require(path.join(__dirname, '..', '..', 'lib', 'client.js'));
const {
  buildConfig,
  health: apiHealth,
  context: apiContext,
  snapshot: apiSnapshot,
  createTask: apiCreateTask,
  patchTask: apiPatchTask,
  events: apiEvents,
  resolveDue
} = client;

const SERVER_INFO = {
  name: 'inkqueue',
  version: '0.1.0'
};

const TOOLS = [
  {
    name: 'health',
    description: 'Check InkQueue server reachability (GET /v1/health).',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string', description: 'Override API base URL' },
        auth: { type: 'string', description: 'Override token (prefer env INKQUEUE_AUTH)' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'context',
    description:
      'Agent scheduling context: open today/week/later/overdue counts + suggestion. Call before add.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string' },
        auth: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'list',
    description: 'List tasks from snapshot. Default status=todo.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'todo | done | all (default todo)'
        },
        due: {
          type: 'string',
          description: 'today | tomorrow | YYYY-MM-DD'
        },
        base_url: { type: 'string' },
        auth: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get',
    description: 'Get one task by id from snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'task id' },
        base_url: { type: 'string' },
        auth: { type: 'string' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'add',
    description:
      'Create a task (POST /v1/tasks). source defaults to agent. Use after context.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        note: { type: 'string' },
        due: {
          type: 'string',
          description: 'today | tomorrow | YYYY-MM-DD'
        },
        time: { type: 'string', description: 'HH:mm' },
        priority: { type: 'string', description: 'normal | high' },
        status: { type: 'string' },
        source: { type: 'string' },
        base_url: { type: 'string' },
        auth: { type: 'string' }
      },
      required: ['title'],
      additionalProperties: false
    }
  },
  {
    name: 'patch',
    description: 'Patch task fields (PATCH /v1/tasks/:id).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        note: { type: 'string' },
        due: { type: 'string' },
        time: { type: 'string' },
        priority: { type: 'string' },
        status: { type: 'string' },
        source: { type: 'string' },
        base_url: { type: 'string' },
        auth: { type: 'string' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'events',
    description:
      'Device complete/postpone events + derived signals (task_completed, postponed, chronic_postpone).',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO8601 lower bound' },
        limit: { type: 'number', description: 'max events (tail)' },
        base_url: { type: 'string' },
        auth: { type: 'string' }
      },
      additionalProperties: false
    }
  }
];

function cfgFromArgs(args) {
  args = args || {};
  return buildConfig({
    'base-url': args.base_url,
    auth: args.auth
  });
}

function textResult(obj, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    isError: !!isError
  };
}

function filterTasks(tasks, args) {
  let list = Array.isArray(tasks) ? tasks.slice() : [];
  const status = String(args.status || 'todo').toLowerCase();
  if (status !== 'all') {
    list = list.filter((t) => String(t.status || '') === status);
  }
  if (args.due) {
    const due = resolveDue(args.due);
    list = list.filter((t) => t.due_date === due);
  }
  return list;
}

async function callTool(name, args) {
  args = args || {};
  const cfg = cfgFromArgs(args);

  if (name === 'health') {
    try {
      const res = await apiHealth(cfg);
      if (res.status !== 200) {
        return textResult(
          { ok: false, error: 'health_failed', status: res.status, body: res.json },
          true
        );
      }
      return textResult({
        ok: true,
        base_url: cfg.baseUrl,
        health: res.json,
        config_path: cfg.configPath
      });
    } catch (err) {
      return textResult(
        {
          ok: false,
          error: 'unreachable',
          message: err.message,
          base_url: cfg.baseUrl
        },
        true
      );
    }
  }

  if (name === 'context') {
    const res = await apiContext(cfg);
    if (res.status === 401 || res.status === 403) {
      return textResult({ ok: false, error: 'auth_rejected', body: res.json }, true);
    }
    if (res.status !== 200) {
      return textResult(
        { ok: false, error: 'context_failed', status: res.status, body: res.json },
        true
      );
    }
    return textResult({ ok: true, context: res.json });
  }

  if (name === 'list') {
    const res = await apiSnapshot(cfg);
    if (res.status === 401 || res.status === 403) {
      return textResult({ ok: false, error: 'auth_rejected', body: res.json }, true);
    }
    if (res.status !== 200) {
      return textResult(
        { ok: false, error: 'list_failed', status: res.status, body: res.json },
        true
      );
    }
    const all = (res.json && res.json.tasks) || [];
    const tasks = filterTasks(all, args);
    return textResult({
      ok: true,
      server_time: res.json.server_time,
      count: tasks.length,
      filter: { status: args.status || 'todo', due: args.due || null },
      tasks
    });
  }

  if (name === 'get') {
    if (!args.id) return textResult({ ok: false, error: 'id_required' }, true);
    const res = await apiSnapshot(cfg);
    if (res.status !== 200) {
      return textResult(
        { ok: false, error: 'snapshot_failed', status: res.status, body: res.json },
        true
      );
    }
    const tasks = (res.json && res.json.tasks) || [];
    const task = tasks.find((t) => t.id === args.id);
    if (!task) return textResult({ ok: false, error: 'not_found', id: args.id }, true);
    return textResult({ ok: true, task });
  }

  if (name === 'add') {
    if (!args.title || !String(args.title).trim()) {
      return textResult({ ok: false, error: 'title_required' }, true);
    }
    const body = {
      title: String(args.title).trim(),
      source: args.source || 'agent'
    };
    if (args.note !== undefined) body.note = args.note;
    if (args.due !== undefined) body.due_date = resolveDue(args.due);
    if (args.time !== undefined) body.due_time = args.time;
    if (args.priority !== undefined) body.priority = args.priority;
    if (args.status !== undefined) body.status = args.status;

    const res = await apiCreateTask(cfg, body);
    if (res.status === 401 || res.status === 403) {
      return textResult({ ok: false, error: 'auth_rejected', body: res.json }, true);
    }
    if (res.status !== 201 && res.status !== 200) {
      return textResult(
        { ok: false, error: 'add_failed', status: res.status, body: res.json },
        true
      );
    }
    return textResult({ ok: true, task: res.json && res.json.task });
  }

  if (name === 'patch') {
    if (!args.id) return textResult({ ok: false, error: 'id_required' }, true);
    const body = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.note !== undefined) body.note = args.note;
    if (args.due !== undefined) body.due_date = resolveDue(args.due);
    if (args.time !== undefined) body.due_time = args.time;
    if (args.priority !== undefined) body.priority = args.priority;
    if (args.status !== undefined) body.status = args.status;
    if (args.source !== undefined) body.source = args.source;
    if (Object.keys(body).length === 0) {
      return textResult({ ok: false, error: 'nothing_to_patch' }, true);
    }
    const res = await apiPatchTask(cfg, args.id, body);
    if (res.status === 404) {
      return textResult({ ok: false, error: 'not_found', id: args.id, body: res.json }, true);
    }
    if (res.status === 401 || res.status === 403) {
      return textResult({ ok: false, error: 'auth_rejected', body: res.json }, true);
    }
    if (res.status !== 200) {
      return textResult(
        { ok: false, error: 'patch_failed', status: res.status, body: res.json },
        true
      );
    }
    return textResult({ ok: true, task: res.json && res.json.task });
  }

  if (name === 'events') {
    const res = await apiEvents(cfg, {
      since: args.since,
      limit: args.limit
    });
    if (res.status === 401 || res.status === 403) {
      return textResult({ ok: false, error: 'auth_rejected', body: res.json }, true);
    }
    if (res.status !== 200) {
      return textResult(
        { ok: false, error: 'events_failed', status: res.status, body: res.json },
        true
      );
    }
    const events = (res.json && res.json.events) || [];
    const signals = (res.json && res.json.signals) || [];
    return textResult({
      ok: true,
      server_time: res.json.server_time,
      latest_event_at: res.json.latest_event_at,
      count: events.length,
      signal_count: signals.length,
      events,
      signals
    });
  }

  return textResult({ ok: false, error: 'unknown_tool', name }, true);
}

function writeMessage(msg) {
  // Official MCP Python SDK (Hermes) uses newline-delimited JSON on stdio,
  // not LSP-style Content-Length framing.
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
}

function sendResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  writeMessage({ jsonrpc: '2.0', id, error: err });
}

async function handleRpc(msg) {
  if (!msg || typeof msg !== 'object') return;
  // notifications have no id
  const isNotif = !Object.prototype.hasOwnProperty.call(msg, 'id') || msg.id === null;
  const { id, method, params } = msg;

  if (!method) {
    if (!isNotif) sendError(id, -32600, 'Invalid Request');
    return;
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return;
  }

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
    return;
  }

  if (method === 'ping') {
    sendResult(id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (!name) {
      sendError(id, -32602, 'Missing tool name');
      return;
    }
    try {
      const result = await callTool(name, args);
      sendResult(id, result);
    } catch (err) {
      sendResult(
        id,
        textResult(
          {
            ok: false,
            error: 'request_error',
            message: err && err.message ? err.message : String(err)
          },
          true
        )
      );
    }
    return;
  }

  if (isNotif) return;
  sendError(id, -32601, `Method not found: ${method}`);
}

// Newline-delimited JSON reader (MCP stdio, matches Python mcp SDK)
let lineBuf = '';

function tryConsumeLines() {
  let nl;
  while ((nl = lineBuf.indexOf('\n')) !== -1) {
    const raw = lineBuf.slice(0, nl);
    lineBuf = lineBuf.slice(nl + 1);
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      });
      continue;
    }
    Promise.resolve()
      .then(() => handleRpc(msg))
      .catch((err) => {
        if (msg && msg.id !== undefined && msg.id !== null) {
          sendError(msg.id, -32000, err.message || String(err));
        }
      });
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  lineBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  tryConsumeLines();
});

process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

// Never write non-protocol noise to stdout.
process.stderr.write('mcp-inkqueue ready (stdio, tools: health/context/list/get/add/patch/events)\n');
