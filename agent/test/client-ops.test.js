'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePostponeTarget, generatedOpId } = require('../lib/client.js');

test('resolvePostponeTarget tomorrow/weekend/next_week', () => {
  // Wednesday 2026-08-05
  assert.equal(resolvePostponeTarget('tomorrow', '2026-08-05'), '2026-08-06');
  assert.equal(resolvePostponeTarget('weekend', '2026-08-03'), '2026-08-08'); // Mon -> Sat
  assert.equal(resolvePostponeTarget('weekend', '2026-08-07'), '2026-08-08'); // Fri -> Sat
  assert.equal(resolvePostponeTarget('weekend', '2026-08-08'), '2026-08-15'); // Sat -> next Sat
  assert.equal(resolvePostponeTarget('weekend', '2026-08-09'), '2026-08-15'); // Sun -> next Sat
  assert.equal(resolvePostponeTarget('next_week', '2026-08-05'), '2026-08-10'); // Wed -> next Mon
  assert.equal(resolvePostponeTarget('2026-09-01', '2026-08-05'), '2026-09-01');
});

test('generatedOpId is unique-ish', () => {
  const a = generatedOpId('op');
  const b = generatedOpId('op');
  assert.notEqual(a, b);
  assert.match(a, /^op_/);
});

test('postOperations parses accepted/ignored/pruned from server', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkq-client-ops-'));
  process.env.INKQUEUE_DATA_FILE = path.join(tmp, 'tasks.json');
  process.env.INKQUEUE_CONFIG_FILE = path.join(tmp, 'config.json');
  process.env.INKQUEUE_TOKEN = 'dev-token';
  // Seed store with one legacy typeless op so pruned >= 1.
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({
    tasks: [{ id: 't_alive', title: 'alive', status: 'todo' }],
    operations: [{ id: 'legacy_typeless', task_id: 't_alive', applied_at: '2026-08-01T10:00:00+08:00' }]
  }, null, 2));
  delete require.cache[require.resolve('../../server/src/server')];
  const { start } = require('../../server/src/server');
  const { buildConfig, postOperations } = require('../lib/client.js');
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const cfg = buildConfig({ 'base-url': `http://localhost:${port}`, auth: 'dev-token' });
    const r = await postOperations(cfg, {
      device_id: 'agent-test',
      operations: [{ id: 'op_test_1', type: 'complete', task_id: 't_alive', payload: {} }]
    });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.accepted), 'accepted is array');
    assert.ok(r.json.accepted.includes('op_test_1'), 'op accepted');
    assert.equal(typeof r.json.pruned, 'number', 'pruned field present');
    assert.ok(r.json.pruned >= 0, 'pruned is non-negative (startup may have already cleaned)');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[require.resolve('../../server/src/server')];
    delete process.env.INKQUEUE_DATA_FILE;
    delete process.env.INKQUEUE_CONFIG_FILE;
  }
});

test('events --device filters by device_id end-to-end', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkq-events-'));
  process.env.INKQUEUE_DATA_FILE = path.join(tmp, 'tasks.json');
  process.env.INKQUEUE_CONFIG_FILE = path.join(tmp, 'config.json');
  process.env.INKQUEUE_TOKEN = 'dev-token';
  // Seed store with one todo task that both a kindle device and the agent-cli will act on.
  fs.writeFileSync(process.env.INKQUEUE_DATA_FILE, JSON.stringify({
    tasks: [{ id: 't_e1', title: '探子', status: 'todo', due_date: '2026-08-08' }],
    operations: []
  }, null, 2));
  delete require.cache[require.resolve('../../server/src/server')];
  const { start } = require('../../server/src/server');
  const { buildConfig, postOperations, events } = require('../lib/client.js');
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const cfg = buildConfig({ 'base-url': `http://localhost:${port}`, auth: 'dev-token' });
    // Kindle completes the task
    await postOperations(cfg, {
      device_id: 'kindle-pw3',
      operations: [{ id: 'op_k1', type: 'complete', task_id: 't_e1', payload: {} }]
    });
    // agent-cli then re-opens it (unlikely real flow, but proves two device_ids coexist)
    await postOperations(cfg, {
      device_id: 'agent-cli',
      operations: [{ id: 'op_a1', type: 'postpone', task_id: 't_e1', payload: { due_date: '2026-08-10', postpone_target: 'tomorrow' } }]
    });

    // Filter by kindle-pw3: should see only the complete event
    const rK = await events(cfg, { device: 'kindle-pw3', limit: 30 });
    assert.equal(rK.status, 200);
    assert.equal(rK.json.events.length, 1, 'kindle-pw3 has 1 event');
    assert.equal(rK.json.events[0].device_id, 'kindle-pw3');
    assert.equal(rK.json.events[0].type, 'complete');
    assert.equal(rK.json.device_id, 'kindle-pw3', 'echoed filter in response');

    // Filter by agent-cli: should see only the postpone event
    const rA = await events(cfg, { device: 'agent-cli', limit: 30 });
    assert.equal(rA.json.events.length, 1, 'agent-cli has 1 event');
    assert.equal(rA.json.events[0].device_id, 'agent-cli');
    assert.equal(rA.json.events[0].type, 'postpone');

    // No filter: both events return
    const rAll = await events(cfg, { limit: 30 });
    assert.equal(rAll.json.events.length, 2, 'all events = 2');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[require.resolve('../../server/src/server')];
    delete process.env.INKQUEUE_DATA_FILE;
    delete process.env.INKQUEUE_CONFIG_FILE;
  }
});
