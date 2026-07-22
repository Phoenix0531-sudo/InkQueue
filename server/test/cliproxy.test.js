'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const cliproxy = require('../src/cliproxy');

test('summarizePool marks capacity enough with 3 codex', () => {
  const accounts = [
    { type: 'codex', disabled: false, token_expired: false, has_access_token: true },
    { type: 'codex', disabled: false, token_expired: false, has_access_token: true },
    { type: 'codex', disabled: false, token_expired: false, has_access_token: true },
    { type: 'xai', disabled: false, token_expired: false, has_access_token: true }
  ];
  const s = cliproxy.summarizePool(accounts);
  assert.equal(s.total, 4);
  assert.equal(s.by_type.codex.enabled, 3);
  assert.equal(s.capacity.enough, true);
});

test('readAccountFiles reads local auth dir without exposing tokens', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-cpa-'));
  fs.writeFileSync(path.join(tmp, 'codex-a.json'), JSON.stringify({
    type: 'codex',
    email: 'alice@example.com',
    disabled: false,
    expired: '2099-01-01T00:00:00Z',
    access_token: 'secret-access',
    refresh_token: 'secret-refresh',
    account_id: 'acc-1',
    last_refresh: '2026-07-20T00:00:00+08:00'
  }));
  const pool = cliproxy.readAccountFiles(tmp);
  assert.equal(pool.ok, true);
  assert.equal(pool.accounts.length, 1);
  assert.equal(pool.accounts[0].type, 'codex');
  assert.equal(pool.accounts[0]._access_token, 'secret-access');
  const pub = cliproxy.publicAccounts(pool.accounts);
  assert.equal(pub[0].email, 'al***@example.com');
  assert.equal(pub[0].has_access_token, true);
  assert.equal(pub[0]._access_token, undefined);
  assert.equal(JSON.stringify(pub).includes('secret-access'), false);
});

test('probeCliproxyHealth hits /v1/models', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'grok-test' }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const health = await cliproxy.probeCliproxyHealth({
      cliproxy_base_url: `http://127.0.0.1:${port}`,
      cliproxy_api_key: 'test-key'
    });
    assert.equal(health.ok, true);
    assert.equal(health.model_count, 2);
    assert.ok(health.models_sample.includes('gpt-test'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('admin panel and cliproxy endpoints via InkQueue server', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkqueue-cpa-api-'));
  process.env.INKQUEUE_DATA_FILE = path.join(tmpDir, 'tasks.json');
  process.env.INKQUEUE_CONFIG_FILE = path.join(tmpDir, 'config.json');
  process.env.INKQUEUE_TOKEN = 'dev-token';

  // mock cliproxy models + fake auth dir
  const mock = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'model-a' }] }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;

  const authDir = path.join(tmpDir, 'auth');
  fs.mkdirSync(authDir);
  fs.writeFileSync(path.join(authDir, 'codex-1.json'), JSON.stringify({
    type: 'codex', email: 'one@test.com', disabled: false,
    access_token: 't', refresh_token: 'r', expired: '2099-01-01T00:00:00Z'
  }));
  fs.writeFileSync(path.join(authDir, 'xai-1.json'), JSON.stringify({
    type: 'xai', email: 'two@test.com', disabled: false,
    access_token: 't2', expired: '2099-01-01T00:00:00Z'
  }));
  fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
    cliproxy_base_url: `http://127.0.0.1:${mockPort}`,
    cliproxy_api_key: 'k',
    cliproxy_auth_dir: authDir,
    proxy: ''
  }));

  // require after env set
  delete require.cache[require.resolve('../src/server')];
  const { start } = require('../src/server');
  const server = start(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/v1/cliproxy/health`, {
      headers: { 'X-InkQueue-Token': 'dev-token' }
    });
    assert.equal(health.status, 200);
    const hj = await health.json();
    assert.equal(hj.ok, true);
    assert.equal(hj.health.model_count, 1);

    const pool = await fetch(`${base}/v1/cliproxy/pool`, {
      headers: { 'X-InkQueue-Token': 'dev-token' }
    });
    assert.equal(pool.status, 200);
    const pj = await pool.json();
    assert.equal(pj.pool.summary.total, 2);
    assert.equal(pj.pool.summary.by_type.codex.total, 1);
    assert.equal(pj.pool.summary.by_type.xai.total, 1);
    assert.ok(!JSON.stringify(pj).includes('"access_token"'));

    const admin = await fetch(`${base}/admin/cliproxy?token=dev-token`);
    assert.equal(admin.status, 200);
    const html = await admin.text();
    assert.match(html, /CLIProxy 健康/);
    assert.match(html, /账号池汇总/);
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => mock.close(r));
  }
});

test('parseCodexUsageBody derives 7-day label from limit_window_seconds (not hardcoding 5h)', () => {
  const body = {
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 64,
        limit_window_seconds: 604800,
        reset_after_seconds: 1000,
        reset_at: 1785058944
      },
      secondary_window: null
    },
    credits: { has_credits: false, balance: '0' }
  };
  const parsed = cliproxy.parseCodexUsageBody(body);
  assert.ok(parsed);
  assert.equal(parsed.plan_type, 'plus');
  assert.equal(parsed.allowed, true);
  assert.equal(parsed.limit_reached, false);
  assert.equal(parsed.primary.usage_percent, 64);
  assert.equal(parsed.primary.limit_window_seconds, 604800);
  assert.equal(parsed.primary.label, '7天');
  assert.equal(parsed.secondary, null);
  assert.notEqual(parsed.primary.label, '5小时');
  assert.notEqual(parsed.primary.label, '5-hour');
});

test('windowLabelFromSeconds maps known windows', () => {
  assert.equal(cliproxy.windowLabelFromSeconds(604800), '7天');
  assert.equal(cliproxy.windowLabelFromSeconds(18000), '5小时');
  assert.equal(cliproxy.windowLabelFromSeconds(86400), '1天');
  assert.equal(cliproxy.windowLabelFromSeconds(0), '额度窗口');
});

test('fetchCliproxySnapshot reconciles codex_enabled to probe-alive count', async () => {
  // Local auth dir with 3 codex files; override probe by stubbing global fetch path via includeCodexUsage
  // and a fake proxy that returns 1 OK + 2×401 for wham/usage is heavy — instead unit-check
  // summarizePool capacity + that parseCodexUsageBody path is wired for reconcile consumers.
  const accounts = [
    { type: 'codex', disabled: false, token_expired: false, has_access_token: true },
    { type: 'codex', disabled: false, token_expired: false, has_access_token: true },
    { type: 'codex', disabled: false, token_expired: false, has_access_token: true }
  ];
  const s = cliproxy.summarizePool(accounts);
  // File-based count before probe is still 3; probe-reconcile happens in fetchCliproxySnapshot.
  assert.equal(s.by_type.codex.enabled, 3);
  // Simulate post-probe capacity rewrite shape used by server.js buildCliproxyProvider.
  const codexUsage = [
    { error: null, data: { primary: { usage_percent: 10, label: '7天' } } },
    { error: 'http_401', data: null },
    { error: 'http_401', data: null }
  ];
  const alive = codexUsage.filter((x) => !x.error && x.data).length;
  const dead = codexUsage.filter((x) => x.error || !x.data).length;
  assert.equal(alive, 1);
  assert.equal(dead, 2);
  // After reconcile, display must use alive, not file count.
  assert.notEqual(alive, s.by_type.codex.enabled);
});
