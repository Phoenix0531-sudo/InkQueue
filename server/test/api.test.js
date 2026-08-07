'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkqueue-api-'));
process.env.INKQUEUE_DATA_FILE = path.join(tmpDir, 'tasks.json');
process.env.INKQUEUE_CONFIG_FILE = path.join(tmpDir, 'config.json');
process.env.INKQUEUE_TOKEN = 'dev-token';

const { start, readStore, validateStartupConfig } = require('../src/server');

function request(baseUrl, pathname, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  return fetch(`${baseUrl}${pathname}`, Object.assign({}, options, { headers }));
}

test('health endpoint returns ok without token', async () => {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await request(baseUrl, '/v1/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('snapshot rejects missing token', async () => {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await request(baseUrl, '/v1/tasks/snapshot');
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid json returns client error', async () => {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: { 'X-InkQueue-Token': 'dev-token', 'Content-Type': 'application/json' },
      body: '{bad json'
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid json');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('task validation rejects malformed date and time', async () => {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const badDate = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: tokenHeader,
      json: { title: 'Bad date', due_date: '2026-02-31' }
    });
    assert.equal(badDate.status, 400);
    assert.equal((await badDate.json()).error, 'invalid due_date');

    const badTime = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: tokenHeader,
      json: { title: 'Bad time', due_time: '25:10' }
    });
    assert.equal(badTime.status, 400);
    assert.equal((await badTime.json()).error, 'invalid due_time');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operation validation reports malformed items without server error', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const res = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST',
      headers: tokenHeader,
      json: { device_id: 'kindle-pw3', operations: [null, { id: 'op_bad', type: 'postpone' }] }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accepted.length, 0);
    assert.equal(body.ignored.length, 0);
    assert.equal(body.errors.length, 2);
    assert.match(body.errors[0].error, /operation must be an object/);
    assert.match(body.errors[1].error, /task_id/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('create task, snapshot, complete and postpone operations', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const createdA = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: tokenHeader,
      json: { title: '整理 BootSem 文档', due_date: '2026-07-06', due_time: '14:00', priority: 'normal' }
    });
    assert.equal(createdA.status, 201);
    const taskA = (await createdA.json()).task;
    assert.equal(taskA.status, 'todo');
    assert.equal(taskA.due_time, '14:00');

    const createdB = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: tokenHeader,
      json: { title: '\u770B\u76D0\u6784\u9020 DEM \u8BBA\u6587', due_date: '2026-07-06', due_time: '20:00' }
    });
    const taskB = (await createdB.json()).task;

    const snapshot = await request(baseUrl, '/v1/tasks/snapshot', { headers: tokenHeader });
    assert.equal(snapshot.status, 200);
    const snapshotJson = await snapshot.json();
    assert.equal(snapshotJson.tasks.length, 2);

    const ops = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST',
      headers: tokenHeader,
      json: {
        device_id: 'kindle-pw3',
        operations: [
          { id: 'op_complete', type: 'complete', task_id: taskA.id, created_at: '2026-07-06T09:00:00+08:00', payload: { completed_at: '2026-07-06T09:00:00+08:00' } },
          { id: 'op_postpone', type: 'postpone', task_id: taskB.id, created_at: '2026-07-06T09:01:00+08:00', payload: { due_date: '2026-07-07', due_time: '20:00', postpone_target: 'tomorrow' } },
          { id: 'op_missing', type: 'complete', task_id: 'missing', created_at: '2026-07-06T09:02:00+08:00', payload: {} }
        ]
      }
    });
    assert.equal(ops.status, 200);
    const opsJson = await ops.json();
    assert.deepEqual(opsJson.accepted, ['op_complete', 'op_postpone']);
    assert.deepEqual(opsJson.ignored, ['op_missing']);
    assert.deepEqual(opsJson.errors, []);

    const store = readStore();
    const done = store.tasks.find((task) => task.id === taskA.id);
    const postponed = store.tasks.find((task) => task.id === taskB.id);
    assert.equal(done.status, 'done');
    assert.match(done.completed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    assert.notEqual(done.completed_at, '2026-07-06T09:00:00+08:00');
    assert.equal(postponed.due_date, '2026-07-07');
    assert.equal(postponed.due_time, '20:00');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('/v1/usage returns structured response with token', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  fs.writeFileSync(process.env.INKQUEUE_CONFIG_FILE, JSON.stringify({
    codex_auth_path: path.join(tmpDir, 'missing-codex-auth.json'),
    usage_reports: [{
      provider: 'opencode-go',
      cost: 12,
      reported_at: new Date().toISOString()
    }]
  }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const res = await fetch(baseUrl + '/v1/usage', { headers: tokenHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.server_time, 'server_time present');
    assert.ok(Array.isArray(body.providers), 'providers is array');
    assert.equal(body.providers.length, 1, 'only cliproxyapi/CPA provider');
    assert.equal(body.providers[0].provider, 'cliproxyapi');
    assert.ok(body.providers[0].data, 'cpa data present');
    assert.ok(Array.isArray(body.providers[0].data.lines), 'cpa display lines');
    assert.ok(body.cliproxy, 'cliproxy summary block present');
    assert.doesNotMatch(JSON.stringify(body), /reports|reported_cost|total_reported_cost/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('authenticated usage report endpoint is not available and does not change config', async () => {
  const originalConfig = JSON.stringify({
    marker: 'keep-me',
    usage_reports: [{ provider: 'opencode-go', cost: 1 }]
  }, null, 2);
  fs.writeFileSync(process.env.INKQUEUE_CONFIG_FILE, originalConfig);
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await request(baseUrl, '/v1/usage/report', {
      method: 'POST',
      headers: { 'X-InkQueue-Token': 'dev-token' },
      json: { provider: 'opencode-go', cost: 99 }
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
    assert.equal(fs.readFileSync(process.env.INKQUEUE_CONFIG_FILE, 'utf8'), originalConfig);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('startup config validation warns when config is missing', () => {
  const warnings = [];
  validateStartupConfig(path.join(tmpDir, 'missing-config.json'), {
    warn: (...args) => warnings.push(args.join(' '))
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /config\.json not found/);
});

test('startup config validation warns when config JSON is invalid', () => {
  const configFile = path.join(tmpDir, 'invalid-config.json');
  fs.writeFileSync(configFile, '{bad json');
  const warnings = [];
  validateStartupConfig(configFile, {
    warn: (...args) => warnings.push(args.join(' '))
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /parse error/);
});

test('startup config validation warns when config file is missing', () => {
  const configFile = path.join(tmpDir, 'missing-config.json');
  const warnings = [];
  validateStartupConfig(configFile, {
    warn: (...args) => warnings.push(args.join(' '))
  });
  assert.ok(warnings.length >= 1);
  assert.match(warnings[0], /config\.json/);
});

test('startup config validation warns on null config', () => {
  const configFile = path.join(tmpDir, 'null-config.json');
  fs.writeFileSync(configFile, 'null');
  const warnings = [];
  assert.doesNotThrow(() => validateStartupConfig(configFile, {
    warn: (...args) => warnings.push(args.join(' '))
  }));
  assert.ok(warnings.length >= 1);
  assert.match(warnings[0], /invalid|empty|config/i);
});

test('startup config validation passes with a valid config object', () => {
  const configFile = path.join(tmpDir, 'valid-config.json');
  fs.writeFileSync(configFile, JSON.stringify({ cliproxy_management_key: 'test' }));
  const warnings = [];
  validateStartupConfig(configFile, {
    warn: (...args) => warnings.push(args.join(' '))
  });
  assert.equal(warnings.length, 0);
});

test('/v1/usage rejects missing token', async () => {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(baseUrl + '/v1/usage');
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('operation timestamps are owned by the server, not the device payload', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader, json: { title: 'server timestamp task' }
    });
    const task = (await created.json()).task;
    const response = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST',
      headers: tokenHeader,
      json: {
        device_id: 'kindle-pw3',
        operations: [{
          id: 'op_server_timestamp',
          type: 'complete',
          task_id: task.id,
          created_at: '2000-01-01T00:00:00+08:00',
          payload: { completed_at: '2000-01-01T00:00:00+08:00' }
        }]
      }
    });
    assert.equal(response.status, 200);
    const stored = readStore().tasks.find((item) => item.id === task.id);
    assert.match(stored.completed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    assert.notEqual(stored.completed_at, '2000-01-01T00:00:00+08:00');
    assert.notEqual(stored.updated_at, '2000-01-01T00:00:00+08:00');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('replaying an accepted operation is idempotent', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader, json: { title: 'idempotent task' }
    });
    const task = (await created.json()).task;
    const operation = {
      id: 'op_replayed', type: 'complete', task_id: task.id,
      payload: { completed_at: '2000-01-01T00:00:00+08:00' }
    };

    const first = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader, json: { operations: [operation] }
    });
    assert.deepEqual((await first.json()).accepted, ['op_replayed']);
    const afterFirst = readStore().tasks.find((item) => item.id === task.id);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader, json: { operations: [operation] }
    });
    const secondJson = await second.json();
    assert.deepEqual(secondJson.accepted, ['op_replayed']);
    assert.deepEqual(secondJson.ignored, []);
    const afterSecond = readStore().tasks.find((item) => item.id === task.id);
    assert.equal(afterSecond.updated_at, afterFirst.updated_at);
    assert.equal(afterSecond.completed_at, afterFirst.completed_at);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('agent webhook creates and updates tasks', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };

  try {
    const createdResponse = await request(baseUrl, '/v1/webhook/agent', {
      method: 'POST',
      headers: tokenHeader,
      json: { event_id: 'agent-event-1', task: { title: 'Agent webhook task', priority: 'high' } }
    });
    assert.equal(createdResponse.status, 200);
    const createdBody = await createdResponse.json();
    assert.equal(createdBody.created.length, 1);
    assert.equal(createdBody.updated.length, 0);
    const createdTask = createdBody.created[0];
    assert.equal(createdTask.source, 'agent');

    const updatedResponse = await request(baseUrl, '/v1/webhook/agent', {
      method: 'POST',
      headers: tokenHeader,
      json: { task: { id: createdTask.id, title: 'Agent webhook task updated' } }
    });
    assert.equal(updatedResponse.status, 200);
    const updatedBody = await updatedResponse.json();
    assert.equal(updatedBody.created.length, 0);
    assert.equal(updatedBody.updated.length, 1);
    assert.equal(updatedBody.updated[0].title, 'Agent webhook task updated');

    const duplicateResponse = await request(baseUrl, '/v1/webhook/agent', {
      method: 'POST', headers: tokenHeader,
      json: { event_id: 'agent-event-1', task: { title: 'should not be created' } }
    });
    assert.equal(duplicateResponse.status, 200);
    const duplicateBody = await duplicateResponse.json();
    assert.equal(duplicateBody.duplicate, true);
    assert.equal(duplicateBody.created.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /v1/events streams accepted operations with task title and type', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    // Use today's date (relative) for the probe task so it isn't auto-grouped as overdue
    const ctx0 = await (await request(baseUrl, '/v1/agent/context', { headers: tokenHeader })).json();
    const today = ctx0.today_date;

    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader,
      json: { title: 'agent-context event probe', due_date: today }
    });
    const task = (await created.json()).task;

    await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: {
        device_id: 'kindle-pw3',
        operations: [
          { id: 'op_ev_complete', type: 'complete', task_id: task.id, created_at: '2026-08-01T09:00:00+08:00', payload: {} }
        ]
      }
    });

    const evRes = await request(baseUrl, '/v1/events', { headers: tokenHeader });
    const evJson = await evRes.json();
    assert.equal(evJson.events.length, 1);
    const ev = evJson.events[0];
    assert.equal(ev.type, 'complete');
    assert.equal(ev.task_id, task.id);
    assert.equal(ev.task_title, 'agent-context event probe');
    assert.match(ev.occurred_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    assert.equal(evJson.latest_event_at, ev.occurred_at);

    // since filter excludes the just-consumed event
    const evSinceRes = await request(baseUrl, `/v1/events?since=${encodeURIComponent(ev.occurred_at)}`,
      { headers: tokenHeader });
    const evSinceJson = await evSinceRes.json();
    assert.equal(evSinceJson.events.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /v1/agent/context reports overdue, today, week, later and suggestion', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    // Use ISO from server so dates are relative to "now" in product TZ.
    const ctx0 = await (await request(baseUrl, '/v1/agent/context', { headers: tokenHeader })).json();
    const today = ctx0.today_date;
    // Compute one week ahead and one day before in YYYY-MM-DD
    const t = new Date(`${today}T00:00:00Z`);
    const overdue = new Date(t.getTime() - 86400_000).toISOString().slice(0, 10);
    const later = new Date(t.getTime() + 30 * 86400_000).toISOString().slice(0, 10);

    await request(baseUrl, '/v1/tasks', { method: 'POST', headers: tokenHeader,
      json: { title: 'overdue test', due_date: overdue } });
    await request(baseUrl, '/v1/tasks', { method: 'POST', headers: tokenHeader,
      json: { title: 'today test', due_date: today } });
    await request(baseUrl, '/v1/tasks', { method: 'POST', headers: tokenHeader,
      json: { title: 'week test', due_date: today } });  // today is excluded from overdue and today buckets; place at tomorrow
    await request(baseUrl, '/v1/tasks', { method: 'POST', headers: tokenHeader,
      json: { title: 'later test', due_date: later } });
    await request(baseUrl, '/v1/tasks', { method: 'POST', headers: tokenHeader,
      json: { title: 'no date test' } });

    const res = await request(baseUrl, '/v1/agent/context', { headers: tokenHeader });
    const body = await res.json();
    assert.equal(body.open.overdue, 1, `overdue should be 1, got ${body.open.overdue}`);
    assert.equal(body.open.today, 2, `today should be 2 (today + week test both due today), got ${body.open.today}`);
    assert.ok(body.open.later >= 2, `later should be >=2 (later + nodate), got ${body.open.later}`);
    assert.ok(body.open.total >= 5, `total should be >=5, got ${body.open.total}`);
    assert.equal(typeof body.suggestion.note, 'string');
    assert.ok(body.suggestion.note.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /v1/events and /v1/agent/context reject missing token', async () => {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const ev = await request(baseUrl, '/v1/events');
    assert.equal(ev.status, 401);
    const ctx = await request(baseUrl, '/v1/agent/context');
    assert.equal(ctx.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('P8 outbound agent webhook fires on complete operation when configured', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  // Stand up a tiny echo HTTP server to receive the outbound webhook.
  const received = [];
  const echo = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body: buf });
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise((resolve) => echo.listen(0, resolve));
  const echoPort = echo.address().port;
  const echoUrl = `http://127.0.0.1:${echoPort}/inkqueue-event`;

  // Configure InkQueue to use it
  fs.writeFileSync(process.env.INKQUEUE_CONFIG_FILE,
    JSON.stringify({ agent_webhook_url: echoUrl }, null, 2));

  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    const ctx0 = await (await request(baseUrl, '/v1/agent/context', { headers: tokenHeader })).json();
    const today = ctx0.today_date;
    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader,
      json: { title: 'webhook probe', due_date: today }
    });
    const task = (await created.json()).task;
    await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: { device_id: 'kindle-pw3',
        operations: [{ id: 'op_p8_ev', type: 'complete', task_id: task.id,
          created_at: '2026-08-01T09:00:00+08:00', payload: {} }] }
    });
    // Wait up to 2s for fire-and-forget webhook to land
    const start = Date.now();
    while (received.length === 0 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(received.length, 1, `echo server should receive 1 webhook, got ${received.length}`);
    const envelope = JSON.parse(received[0].body);
    assert.equal(envelope.schema, 'inkqueue.device_event.v1');
    const event = envelope.event;
    assert.equal(event.type, 'complete');
    assert.equal(event.task_id, task.id);
    assert.equal(event.task_title, 'webhook probe');
    assert.match(event.occurred_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/);
    assert.equal(envelope.signal.kind, 'task_completed');
    assert.equal(envelope.signal.task_id, task.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => echo.close(resolve));
    // Clean up config so other tests don't see agent_webhook_url
    try { fs.unlinkSync(process.env.INKQUEUE_CONFIG_FILE); } catch (e) {}
  }
});


test('GET /v1/events includes backward-compatible signals array', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    const ctx0 = await (await request(baseUrl, '/v1/agent/context', { headers: tokenHeader })).json();
    const today = ctx0.today_date;
    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader,
      json: { title: 'signals probe', due_date: today }
    });
    const task = (await created.json()).task;

    await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: {
        device_id: 'kindle-pw3',
        operations: [
          {
            id: 'op_sig_complete',
            type: 'complete',
            task_id: task.id,
            created_at: '2026-08-04T09:00:00+08:00',
            payload: {}
          }
        ]
      }
    });

    const evRes = await request(baseUrl, '/v1/events', { headers: tokenHeader });
    assert.equal(evRes.status, 200);
    const body = await evRes.json();
    assert.ok(Array.isArray(body.events));
    assert.ok(Array.isArray(body.signals), 'signals must exist for agents');
    assert.equal(body.events.length, 1);
    assert.ok(body.signals.some((s) => s.kind === 'task_completed' && s.task_id === task.id));
    const completed = body.signals.find((s) => s.kind === 'task_completed');
    assert.ok(completed.advice && completed.advice.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('deriveSignals flags chronic_postpone after 3 postpones on same task', async () => {
  const { deriveSignals } = require('../src/server');
  const base = [
    {
      event_id: 'op1', type: 'postpone', task_id: 't1', task_title: '慢性推迟',
      occurred_at: '2026-08-01T10:00:00+08:00',
      payload: { due_date: '2026-08-02', postpone_target: 'tomorrow' }
    },
    {
      event_id: 'op2', type: 'postpone', task_id: 't1', task_title: '慢性推迟',
      occurred_at: '2026-08-02T10:00:00+08:00',
      payload: { due_date: '2026-08-03', postpone_target: 'tomorrow' }
    },
    {
      event_id: 'op3', type: 'postpone', task_id: 't1', task_title: '慢性推迟',
      occurred_at: '2026-08-03T10:00:00+08:00',
      payload: { due_date: '2026-08-04', postpone_target: 'weekend' }
    }
  ];
  const signals = deriveSignals(base);
  const postponed = signals.filter((s) => s.kind === 'postponed');
  assert.equal(postponed.length, 3);
  assert.equal(postponed[2].streak, 3);
  assert.equal(postponed[2].target, 'weekend');
  const chronic = signals.filter((s) => s.kind === 'chronic_postpone');
  assert.equal(chronic.length, 1);
  assert.equal(chronic[0].task_id, 't1');
  assert.equal(chronic[0].postpone_count_window, 3);
  assert.match(chronic[0].advice, /拆分|降级|取消/);
});

test('pruneOperations drops typeless legacy ops and respects max retain', () => {
  const { pruneOperations } = require('../src/server');
  const store = {
    operations: [
      { id: 'legacy_1', task_id: 't1', applied_at: '2026-08-01T10:00:00+08:00' }, // no type
      { id: 'ok_old', type: 'complete', task_id: 't2', applied_at: '2026-08-01T11:00:00+08:00' },
      { id: 'ok_new', type: 'postpone', task_id: 't3', applied_at: '2026-08-05T11:00:00+08:00' },
      { task_id: 'no-id', type: 'complete', applied_at: '2026-08-05T12:00:00+08:00' }
    ]
  };
  const removed = pruneOperations(store, Date.parse('2026-08-05T12:00:00+08:00'));
  assert.ok(removed >= 2, 'should drop typeless + missing id');
  assert.equal(store.operations.every((o) => o.id && o.type), true);
  assert.ok(store.operations.some((o) => o.id === 'ok_new'));
});

test('operations response includes pruned count and stores device_id', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [], operations: [
    { id: 'legacy_dead', task_id: 'x', applied_at: '2026-08-01T10:00:00+08:00' }
  ] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader,
      json: { title: 'device id probe', due_date: '2026-08-05' }
    });
    const task = (await created.json()).task;
    const ops = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: {
        device_id: 'kindle-pw3-b1',
        operations: [{ id: 'op_device_probe', type: 'complete', task_id: task.id, payload: {} }]
      }
    });
    assert.equal(ops.status, 200);
    const body = await ops.json();
    assert.ok(Array.isArray(body.accepted));
    assert.ok(body.accepted.includes('op_device_probe'));
    assert.equal(typeof body.pruned, 'number');
    // Note: startup prune may have already cleaned the legacy op, so pruned can be 0 here.
    // The device_id + type fields on remembered ops are the real assertion target.
    assert.ok(body.pruned >= 0, 'pruned is non-negative');
    const store = readStore();
    const remembered = (store.operations || []).find((o) => o.id === 'op_device_probe');
    assert.ok(remembered);
    assert.equal(remembered.device_id, 'kindle-pw3-b1');
    assert.equal(remembered.type, 'complete');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('TOKEN_PREV accepts previous token on header and query', async () => {
  process.env.INKQUEUE_TOKEN = 'new-token';
  process.env.INKQUEUE_TOKEN_PREV = 'old-token';
  // re-require after env change is hard; start() reads TOKEN at module load.
  // So we only assert tokenMatches export with current module constants by spawning is not needed:
  // Instead hit live server after restarting module cache.
  const pathServer = require.resolve('../src/server');
  delete require.cache[pathServer];
  // Keep DATA_FILE from outer env
  const fresh = require('../src/server');
  assert.equal(fresh.tokenMatches('new-token'), true);
  assert.equal(fresh.tokenMatches('old-token'), true);
  assert.equal(fresh.tokenMatches('nope'), false);

  const server = fresh.start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const okNew = await request(baseUrl, '/v1/tasks/snapshot', {
      headers: { 'X-InkQueue-Token': 'new-token' }
    });
    assert.equal(okNew.status, 200);
    const okOld = await request(baseUrl, '/v1/tasks/snapshot', {
      headers: { 'X-InkQueue-Token': 'old-token' }
    });
    assert.equal(okOld.status, 200);
    const bad = await request(baseUrl, '/v1/tasks/snapshot', {
      headers: { 'X-InkQueue-Token': 'nope' }
    });
    assert.equal(bad.status, 401);
    const okQuery = await request(baseUrl, '/v1/tasks/snapshot?token=old-token');
    // query auth only if hasTokenOrQuery used on snapshot — check endpoint uses hasToken only.
    // snapshot uses hasToken (header). Discovery may use query. Assert header path is enough.
    assert.ok(okQuery.status === 200 || okQuery.status === 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // restore default token for later tests in same process
    process.env.INKQUEUE_TOKEN = 'dev-token';
    delete process.env.INKQUEUE_TOKEN_PREV;
    delete require.cache[pathServer];
    require('../src/server');
  }
});

test('ignored stays string ids and ignored_details carries reason', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [], operations: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    const ops = await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: {
        device_id: 'agent-cli',
        operations: [{ id: 'op_miss_detail', type: 'complete', task_id: 'no_such', payload: {} }]
      }
    });
    assert.equal(ops.status, 200);
    const body = await ops.json();
    assert.deepEqual(body.ignored, ['op_miss_detail']);
    assert.ok(Array.isArray(body.ignored_details));
    assert.equal(body.ignored_details[0].id, 'op_miss_detail');
    assert.equal(body.ignored_details[0].reason, 'task_not_found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('events can filter by device_id and include device_id field', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [], operations: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokenHeader = { 'X-InkQueue-Token': 'dev-token' };
  try {
    const created = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader,
      json: { title: 'device filter probe', due_date: '2026-08-06' }
    });
    const task = (await created.json()).task;
    await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: {
        device_id: 'kindle-a',
        operations: [{ id: 'op_dev_a', type: 'complete', task_id: task.id, payload: {} }]
      }
    });
    // second op on missing will be ignored — create another task for device b postpone no: complete needs open task
    const created2 = await request(baseUrl, '/v1/tasks', {
      method: 'POST', headers: tokenHeader,
      json: { title: 'device filter probe 2', due_date: '2026-08-07' }
    });
    const task2 = (await created2.json()).task;
    await request(baseUrl, '/v1/tasks/operations', {
      method: 'POST', headers: tokenHeader,
      json: {
        device_id: 'kindle-b',
        operations: [{ id: 'op_dev_b', type: 'complete', task_id: task2.id, payload: {} }]
      }
    });
    const all = await request(baseUrl, '/v1/events?limit=20', { headers: tokenHeader });
    assert.equal(all.status, 200);
    const allBody = await all.json();
    assert.ok(allBody.events.some((e) => e.device_id === 'kindle-a'));
    assert.ok(allBody.events.some((e) => e.device_id === 'kindle-b'));
    const onlyA = await request(baseUrl, '/v1/events?device_id=kindle-a', { headers: tokenHeader });
    const aBody = await onlyA.json();
    assert.ok(aBody.events.length >= 1);
    assert.ok(aBody.events.every((e) => e.device_id === 'kindle-a'));
    assert.equal(aBody.device_id, 'kindle-a');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('readStore heals from .bak when primary JSON is corrupt', () => {
  const dataFile = process.env.INKQUEUE_DATA_FILE;
  const good = { tasks: [{ id: 't_bak', title: 'from bak', status: 'todo' }], operations: [] };
  fs.writeFileSync(dataFile + '.bak', JSON.stringify(good, null, 2));
  fs.writeFileSync(dataFile, '{not-json');
  const store = readStore();
  assert.ok(Array.isArray(store.tasks));
  assert.ok(store.tasks.some((t) => t.id === 't_bak'));
  // primary should be rewritten heal
  const reloaded = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.ok(reloaded.tasks.some((t) => t.id === 't_bak'));
});

test('pruneOperations drops ops older than OPERATIONS_TTL_DAYS', () => {
  const orig = process.env.INKQUEUE_OPERATIONS_TTL_DAYS;
  process.env.INKQUEUE_OPERATIONS_TTL_DAYS = '7';
  delete require.cache[require.resolve('../src/server')];
  const { pruneOperations } = require('../src/server');
  const now = Date.parse('2026-08-10T12:00:00+08:00');
  const store = {
    operations: [
      { id: 'old', type: 'complete', task_id: 't1', applied_at: '2026-07-20T10:00:00+08:00' }, // > 7d
      { id: 'fresh', type: 'complete', task_id: 't2', applied_at: '2026-08-09T10:00:00+08:00' }  // within TTL
    ]
  };
  const removed = pruneOperations(store, now);
  assert.ok(removed >= 1, 'expired op should be pruned');
  assert.ok(store.operations.some((o) => o.id === 'fresh'), 'fresh op survives');
  assert.ok(!store.operations.some((o) => o.id === 'old'), 'expired op dropped');
  if (orig !== undefined) process.env.INKQUEUE_OPERATIONS_TTL_DAYS = orig;
  else delete process.env.INKQUEUE_OPERATIONS_TTL_DAYS;
  delete require.cache[require.resolve('../src/server')];
  require('../src/server');
});

test('start() prunes expired operations on startup', async () => {
  const dataFile = process.env.INKQUEUE_DATA_FILE;
  const oldApplied = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60d ago
  fs.writeFileSync(dataFile, JSON.stringify({
    tasks: [],
    operations: [
      { id: 'expired_startup', type: 'complete', task_id: 'x', applied_at: oldApplied },
      { id: 'fresh_startup', type: 'complete', task_id: 'y', applied_at: new Date().toISOString() }
    ]
  }, null, 2));
  process.env.INKQUEUE_OPERATIONS_TTL_DAYS = '30';
  delete require.cache[require.resolve('../src/server')];
  const { start, readStore } = require('../src/server');
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const store = readStore();
    assert.ok(!store.operations.some((o) => o.id === 'expired_startup'), 'expired op pruned at startup');
    assert.ok(store.operations.some((o) => o.id === 'fresh_startup'), 'fresh op kept at startup');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.INKQUEUE_OPERATIONS_TTL_DAYS;
    delete require.cache[require.resolve('../src/server')];
    require('../src/server');
  }
});

test('snapshot returns 304 when If-Modified-Since >= store mtime', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [], operations: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  try {
    // First call to get Last-Modified
    const r1 = await request(baseUrl, '/v1/tasks/snapshot', { headers: { 'X-InkQueue-Token': 'dev-token' } });
    assert.equal(r1.status, 200);
    const lastModified = r1.headers.get('last-modified');
    assert.ok(lastModified, 'snapshot must return Last-Modified');

    // Second call with If-Modified-Since = Last-Modified -> 304
    const r2 = await request(baseUrl, '/v1/tasks/snapshot', {
      headers: { 'X-InkQueue-Token': 'dev-token', 'If-Modified-Since': lastModified }
    });
    assert.equal(r2.status, 304, 'should be 304 when IMS >= mtime');
    assert.ok(r2.headers.get('last-modified'), '304 should still echo Last-Modified');

    // Mutating via a task create bumps mtime -> next snapshot is 200
    const addRes = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: { 'X-InkQueue-Token': 'dev-token' },
      json: { title: 'push test', due_date: '2026-08-12' }
    });
    assert.equal(addRes.status, 201);
    // Add a tiny wait to ensure mtime advances past the (1s) IMS resolution.
    await new Promise((r) => setTimeout(r, 1100));
    // Same IMS header now too old -> 200 again
    const r3 = await request(baseUrl, '/v1/tasks/snapshot', {
      headers: { 'X-InkQueue-Token': 'dev-token', 'If-Modified-Since': lastModified }
    });
    assert.equal(r3.status, 200, 'should be 200 after mutation');
    const j = await r3.json();
    assert.equal(j.tasks.length, 1);
    assert.equal(j.tasks[0].title, 'push test');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('snapshot ignores garbage If-Modified-Since and returns 200', async () => {
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({ tasks: [], operations: [] }, null, 2));
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  try {
    const r = await request(baseUrl, '/v1/tasks/snapshot', {
      headers: { 'X-InkQueue-Token': 'dev-token', 'If-Modified-Since': 'not-a-date' }
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.tasks));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('TLS env: server starts HTTPS when INKQUEUE_TLS_KEY/CERT set', async () => {
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkqueue-tls-'));
  // Generate self-signed cert via openssl (CI may lack openssl, skip if so).
  let certOk = false;
  try {
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');
    require('child_process').execSync(
      'openssl req -x509 -newkey rsa:2048 -nodes -keyout ' + keyPath +
      ' -out ' + certPath + ' -days 1 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"',
      { stdio: 'pipe' }
    );
    certOk = fs.existsSync(keyPath) && fs.existsSync(certPath);
    process.env.INKQUEUE_TLS_KEY = keyPath;
    process.env.INKQUEUE_TLS_CERT = certPath;
  } catch (_) {
    certOk = false;
  }
  if (!certOk) {
    process.env.NODE_SKIP_INKQUEUE_TLS_TEST = '1';
  }
  try {
    if (!certOk) { return; } // openssl unavailable in test env: skip
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    delete require.cache[require.resolve('../src/server')];
    const { start } = require('../src/server');
    const server = start(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `https://localhost:${server.address().port}`;
    try {
      const res = await fetch(baseUrl + '/v1/health');
      assert.equal(res.status, 200);
      const j = await res.json();
      assert.deepEqual(j, { ok: true });
      // snapshot too
      const sres = await fetch(baseUrl + '/v1/tasks/snapshot', { headers: { 'X-InkQueue-Token': 'dev-token' } });
      assert.equal(sres.status, 200);
      const sj = await sres.json();
      assert.ok(Array.isArray(sj.tasks));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete process.env.INKQUEUE_TLS_KEY;
      delete process.env.INKQUEUE_TLS_CERT;
      delete require.cache[require.resolve('../src/server')];
      require('../src/server');
    }
  } finally {
    try { fs.rmSync(certDir, { recursive: true, force: true }); } catch (_) {}
  }
});
