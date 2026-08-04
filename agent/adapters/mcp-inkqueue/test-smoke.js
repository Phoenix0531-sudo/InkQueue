#!/usr/bin/env node
'use strict';

/**
 * Smoke-test mcp-inkqueue over stdio without an MCP host.
 * Spawns the server, sends initialize + tools/list + tools/call health/context/events.
 */

const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, 'index.js');

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
    body
  ]);
}

function readFrames(buf) {
  const out = [];
  let rest = buf;
  while (true) {
    const idx = rest.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const header = rest.slice(0, idx).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) {
      rest = rest.slice(idx + 4);
      continue;
    }
    const len = parseInt(m[1], 10);
    const start = idx + 4;
    if (rest.length < start + len) break;
    const body = rest.slice(start, start + len).toString('utf8');
    rest = rest.slice(start + len);
    out.push(JSON.parse(body));
  }
  return { messages: out, rest };
}

function fail(msg) {
  process.stderr.write('FAIL: ' + msg + '\n');
  process.exit(1);
}

function ok(msg) {
  process.stderr.write('ok: ' + msg + '\n');
}

async function main() {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  });

  let stdout = Buffer.alloc(0);
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  child.stdout.on('data', (chunk) => {
    stdout = Buffer.concat([stdout, chunk]);
    const { messages, rest } = readFrames(stdout);
    stdout = rest;
    for (const msg of messages) {
      if (msg && msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  let stderrText = '';
  child.stderr.on('data', (c) => {
    stderrText += c.toString('utf8');
  });

  child.on('exit', (code) => {
    closed = true;
    if (pending.size) {
      for (const [, { reject }] of pending) {
        reject(new Error('server exited with code ' + code));
      }
    }
  });

  function rpc(method, params) {
    const id = nextId++;
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('server already closed'));
        return;
      }
      pending.set(id, { resolve, reject });
      child.stdin.write(frame(msg));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('timeout waiting for ' + method));
        }
      }, 15000);
    });
  }

  try {
    const init = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-inkqueue-smoke', version: '0.1.0' }
    });
    if (!init.result || !init.result.serverInfo) fail('initialize missing serverInfo');
    if (init.result.serverInfo.name !== 'inkqueue') fail('bad server name');
    ok('initialize');

    // notification — no response expected
    child.stdin.write(
      frame({ jsonrpc: '2.0', method: 'notifications/initialized' })
    );

    const listed = await rpc('tools/list');
    const tools = (listed.result && listed.result.tools) || [];
    const names = tools.map((t) => t.name).sort();
    const expected = ['add', 'context', 'events', 'get', 'health', 'list', 'patch'].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      fail('tools mismatch: ' + names.join(','));
    }
    ok('tools/list (' + names.length + ')');

    const health = await rpc('tools/call', { name: 'health', arguments: {} });
    const healthBody = JSON.parse(health.result.content[0].text);
    if (!healthBody.ok) fail('health not ok: ' + JSON.stringify(healthBody));
    ok('tools/call health');

    const ctx = await rpc('tools/call', { name: 'context', arguments: {} });
    const ctxBody = JSON.parse(ctx.result.content[0].text);
    if (!ctxBody.ok || !ctxBody.context) fail('context bad');
    ok('tools/call context');

    const ev = await rpc('tools/call', {
      name: 'events',
      arguments: { limit: 5 }
    });
    const evBody = JSON.parse(ev.result.content[0].text);
    if (!evBody.ok || !Array.isArray(evBody.events) || !Array.isArray(evBody.signals)) {
      fail('events missing signals/events');
    }
    ok('tools/call events (signals=' + evBody.signal_count + ')');

    const list = await rpc('tools/call', {
      name: 'list',
      arguments: { status: 'todo' }
    });
    const listBody = JSON.parse(list.result.content[0].text);
    if (!listBody.ok || !Array.isArray(listBody.tasks)) fail('list bad');
    ok('tools/call list (count=' + listBody.count + ')');

    process.stderr.write('\nAll mcp-inkqueue smoke checks passed.\n');
    if (stderrText && /mcp-inkqueue ready/.test(stderrText)) {
      ok('stderr ready banner');
    }
  } finally {
    try {
      child.stdin.end();
    } catch {}
    child.kill();
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
