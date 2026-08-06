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
