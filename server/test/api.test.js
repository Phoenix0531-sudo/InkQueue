'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkqueue-api-'));
process.env.INKQUEUE_DATA_FILE = path.join(tmpDir, 'tasks.json');
process.env.INKQUEUE_TOKEN = 'dev-token';

const { start, readStore } = require('../src/server');

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
      json: { title: '整理 BootSem 文档', due_date: '2026-07-06', due_time: '14:00', project: 'BootSem', priority: 'normal' }
    });
    assert.equal(createdA.status, 201);
    const taskA = (await createdA.json()).task;
    assert.equal(taskA.status, 'todo');
    assert.equal(taskA.due_time, '14:00');

    const createdB = await request(baseUrl, '/v1/tasks', {
      method: 'POST',
      headers: tokenHeader,
      json: { title: '看盐构造 DEM 论文', due_date: '2026-07-06', due_time: '20:00', project: 'Research' }
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
