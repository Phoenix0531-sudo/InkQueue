'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
    assert.equal(done.completed_at, '2026-07-06T09:00:00+08:00');
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
  assert.match(warnings[0], /no config\.json found/);
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

test('startup config validation warns when opencode_api_key is missing', () => {
  const configFile = path.join(tmpDir, 'keyless-config.json');
  fs.writeFileSync(configFile, JSON.stringify({ proxy: 'http://localhost' }));
  const warnings = [];
  validateStartupConfig(configFile, {
    warn: (...args) => warnings.push(args.join(' '))
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /opencode_api_key/);
});

test('startup config validation treats null config as missing opencode_api_key', () => {
  const configFile = path.join(tmpDir, 'null-config.json');
  fs.writeFileSync(configFile, 'null');
  const warnings = [];
  assert.doesNotThrow(() => validateStartupConfig(configFile, {
    warn: (...args) => warnings.push(args.join(' '))
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /opencode_api_key/);
});

test('startup config validation accepts a nonempty opencode_api_key', () => {
  const configFile = path.join(tmpDir, 'valid-config.json');
  fs.writeFileSync(configFile, JSON.stringify({ opencode_api_key: 'test-key' }));
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
