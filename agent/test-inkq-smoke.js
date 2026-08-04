#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for agent/inkq.js against a live reference server.
 * Start server first: node scripts/server-ctl.js start
 *
 *   node agent/test-inkq-smoke.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INKQ = path.join(__dirname, 'inkq.js');

function run(args) {
  const r = spawnSync(process.execPath, [INKQ, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  });
  let json = null;
  try {
    json = JSON.parse((r.stdout || '').trim() || 'null');
  } catch {
    json = null;
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok:', msg);
}

const health = run(['health']);
if (health.code !== 0) {
  console.error('Server not reachable. Start with: node scripts/server-ctl.js start');
  console.error(health.stdout || health.stderr);
  process.exit(2);
}
assert(health.json && health.json.ok === true, 'health ok');

const ctx = run(['context']);
assert(ctx.code === 0 && ctx.json && ctx.json.ok && ctx.json.context, 'context ok');

const title = `inkq-smoke-${Date.now().toString(36)}`;
const add = run(['add', '--title', title, '--due', 'tomorrow', '--priority', 'normal', '--note', 'agent smoke']);
assert(add.code === 0 && add.json && add.json.task && add.json.task.id, 'add returns task id');
const id = add.json.task.id;
assert(add.json.task.title === title, 'add preserves UTF-8 title');
assert(add.json.task.due_date && /^\d{4}-\d{2}-\d{2}$/.test(add.json.task.due_date), 'due resolved');

const list = run(['list', '--status', 'todo']);
assert(list.code === 0 && list.json.tasks.some((t) => t.id === id), 'list contains new task');

const got = run(['get', id]);
assert(got.code === 0 && got.json.task.id === id, 'get by id');

const patched = run(['patch', id, '--priority', 'high']);
assert(patched.code === 0 && patched.json.task.priority === 'high', 'patch priority');

const ev = run(['events', '--limit', '5']);
assert(ev.code === 0 && ev.json && Array.isArray(ev.json.events), 'events shape');

const bad = run(['get', 'task_does_not_exist_zz']);
assert(bad.code === 3 && bad.json && bad.json.ok === false, 'get missing → exit 3');

console.log('\nAll inkq smoke checks passed.');
