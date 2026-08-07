'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fmtDateOffset, saturdayDelta, nextMondayDelta,
  planTriage, applyableActions
} = require('../lib/triage.js');

// ---- date helpers (week starts Monday; Sat is weekend) ----

test('fmtDateOffset formats YYYY-MM-DD with day delta', () => {
  const base = new Date(2026, 7, 5); // 2026-08-05 Wednesday
  assert.equal(fmtDateOffset(base, 0), '2026-08-05');
  assert.equal(fmtDateOffset(base, 1), '2026-08-06');
  assert.equal(fmtDateOffset(base, -1), '2026-08-04');
  assert.equal(fmtDateOffset(base, 30), '2026-09-04');
});

test('saturdayDelta: Mon-Fri -> this Saturday', () => {
  assert.equal(saturdayDelta(new Date(2026, 7, 3)), 5,  // Mon 08-03 -> Sat 08-08
    'Mon -> this Sat is +5');
  assert.equal(saturdayDelta(new Date(2026, 7, 7)), 1,  // Fri 08-07 -> Sat 08-08
    'Fri -> this Sat is +1');
});

test('saturdayDelta: Sat or Sun -> next Saturday', () => {
  assert.equal(saturdayDelta(new Date(2026, 7, 8)), 7,  // Sat 08-08 -> Sat 08-15
    'Sat -> next Sat is +7');
  assert.equal(saturdayDelta(new Date(2026, 7, 9)), 6,  // Sun 08-09 -> Sat 08-15
    'Sun -> next Sat is +6');
});

test('nextMondayDelta: any day -> next Monday', () => {
  assert.equal(nextMondayDelta(new Date(2026, 7, 3)), 7,  // Mon 08-03 -> Mon 08-10
    'Mon -> next Mon is +7');
  assert.equal(nextMondayDelta(new Date(2026, 7, 7)), 3,  // Fri 08-07 -> Mon 08-10
    'Fri -> next Mon is +3');
  assert.equal(nextMondayDelta(new Date(2026, 7, 9)), 1,  // Sun 08-09 -> Mon 08-10
    'Sun -> next Mon is +1');
});

// ---- planTriage: chronic hard rule ----

test('planTriage: chronic task is never auto-deferred', () => {
  const plan = planTriage({
    today_open: 0,
    cap: 5,
    chronic: [{ task_id: 't_chronic', title: '大宛齐', postpone_count_window: 3, last_at: '2026-08-04T10:00:00+08:00' }],
    today_tasks: [],
    now: new Date(2026, 7, 5)
  });
  assert.equal(plan.actions.length, 1);
  const a = plan.actions[0];
  assert.equal(a.action, 'chronic_ask_user');
  assert.equal(a.suggest, 'ask_user_cancel_or_split');
  assert.equal(a.deferred_due_date_if_forced, '2026-08-10', // Wed 08-05 -> next Mon 08-10
    'chronic deferred_due_date_if_forced should be next Monday');
  assert.ok(!('new_due_date' in a), 'chronic action must NOT carry new_due_date (no auto-defer)');
});

test('planTriage: chronic carries postpone_count_window and last_at', () => {
  const plan = planTriage({
    today_open: 0, cap: 5,
    chronic: [{ task_id: 'c1', title: 'X', postpone_count_window: 4, last_at: '2026-08-01T00:00:00+08:00' }],
    today_tasks: [], now: new Date(2026, 7, 5)
  });
  const a = plan.actions[0];
  assert.equal(a.postpone_count_window, 4);
  assert.equal(a.last_at, '2026-08-01T00:00:00+08:00');
});

test('planTriage: chronic with missing optional fields still ok', () => {
  const plan = planTriage({
    today_open: 0, cap: 5,
    chronic: [{ task_id: 'c1' }],
    today_tasks: [], now: new Date(2026, 7, 5)
  });
  const a = plan.actions[0];
  assert.equal(a.title, null);
  assert.equal(a.postpone_count_window, null);
  assert.equal(a.last_at, null);
});

// ---- planTriage: today overflow ----

test('planTriage: no overflow when today_open <= cap', () => {
  const plan = planTriage({
    today_open: 3, cap: 5,
    chronic: [],
    today_tasks: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }, { id: 't3', title: 'C' }],
    now: new Date(2026, 7, 5)
  });
  assert.equal(plan.overflow, 0);
  assert.equal(plan.actions.length, 0, 'no overflow actions when within cap');
});

test('planTriage: overflow deferred to this weekend, preserves due_time', () => {
  const plan = planTriage({
    today_open: 7, cap: 5,
    chronic: [],
    today_tasks: [
      { id: 't1', title: 'A', due_time: '14:00' },
      { id: 't2', title: 'B', due_time: null },
      { id: 't3', title: 'C', due_time: '09:30' }
    ],
    now: new Date(2026, 7, 5) // Wed -> Sat 08-08
  });
  assert.equal(plan.overflow, 2);
  assert.equal(plan.actions.length, 2);
  for (const a of plan.actions) {
    assert.equal(a.action, 'defer_overflow_weekend');
    assert.equal(a.new_due_date, '2026-08-08', 'overflow should go to this Saturday');
  }
  assert.equal(plan.actions[0].preserve_due_time, '14:00', 'keep due_time');
  assert.equal(plan.actions[1].preserve_due_time, null);
});

test('planTriage: chronic tasks excluded from overflow selection', () => {
  const plan = planTriage({
    today_open: 7, cap: 5,
    chronic: [{ task_id: 'chronic1', title: 'C' }],
    today_tasks: [
      { id: 'chronic1', title: 'C', due_time: null },   // same id as chronic
      { id: 'normal1', title: 'N1', due_time: null },
      { id: 'normal2', title: 'N2', due_time: null },
      { id: 'normal3', title: 'N3', due_time: null }
    ],
    now: new Date(2026, 7, 5)
  });
  assert.equal(plan.chronic, 1);
  assert.equal(plan.overflow, 2);
  // 1 chronic + 2 overflow = 3 actions
  assert.equal(plan.actions.length, 3);
  const chronicActions = plan.actions.filter((a) => a.action === 'chronic_ask_user');
  const overflowActions = plan.actions.filter((a) => a.action === 'defer_overflow_weekend');
  assert.equal(chronicActions.length, 1);
  assert.equal(overflowActions.length, 2);
  // chronic1 must NOT appear in overflow actions
  assert.ok(!overflowActions.some((a) => a.task_id === 'chronic1'),
    'chronic task must not be double-counted as overflow');
});

test('planTriage: custom cap respected', () => {
  const plan = planTriage({
    today_open: 3, cap: 2,
    chronic: [],
    today_tasks: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }, { id: 't3', title: 'C' }],
    now: new Date(2026, 7, 5)
  });
  assert.equal(plan.overflow, 1);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].task_id, 't1', 'slice from the front');
});

// ---- applyableActions ----

test('applyableActions: chronic excluded by default', () => {
  const actions = [
    { action: 'chronic_ask_user', task_id: 'c1' },
    { action: 'defer_overflow_weekend', task_id: 't1' }
  ];
  const out = applyableActions(actions, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, 'defer_overflow_weekend');
});

test('applyableActions: chronic included when forceChronic=true', () => {
  const actions = [
    { action: 'chronic_ask_user', task_id: 'c1' },
    { action: 'defer_overflow_weekend', task_id: 't1' }
  ];
  const out = applyableActions(actions, true);
  assert.equal(out.length, 2);
});

test('applyableActions: empty input safe', () => {
  assert.deepEqual(applyableActions([], false), []);
  assert.deepEqual(applyableActions([], true), []);
});

// ---- edge cases ----

test('planTriage: empty everything', () => {
  const plan = planTriage({ today_open: 0, cap: 5, chronic: [], today_tasks: [], now: new Date(2026, 7, 5) });
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.chronic, 0);
  assert.equal(plan.overflow, 0);
});

test('planTriage: defaults sensible when fields missing', () => {
  const plan = planTriage({});
  assert.equal(plan.cap, 5);
  assert.equal(plan.today_open, 0);
  assert.equal(plan.actions.length, 0);
});

// ---- planTriage: suggest-split (chronic decomposition template) ----

test('planTriage: suggestSplit emits split_suggest alongside ask_user', () => {
  const plan = planTriage({
    today_open: 0, cap: 5,
    chronic: [{ task_id: 'c1', title: '大宛齐', postpone_count_window: 3, last_at: '2026-08-01T00:00:00+08:00' }],
    today_tasks: [],
    now: new Date(2026, 7, 5),
    suggestSplit: true
  });
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].action, 'chronic_ask_user');
  assert.equal(plan.actions[1].action, 'split_suggest');
  const s = plan.actions[1];
  assert.equal(s.task_id, 'c1');
  assert.ok(s.subtask_title_prefix.startsWith('大宛齐'), 'prefix derived from title');
  assert.equal(s.subtask_due_date, '2026-08-10', 'Wed 08-05 -> next Mon 08-10');
  assert.equal(s.original_done_after_split, true);
  assert.equal(s.reason, 'chronic_postpone_split');
});

test('planTriage: suggestSplit with missing title uses task_id in prefix', () => {
  const plan = planTriage({
    today_open: 0, cap: 5,
    chronic: [{ task_id: 'c_no_title', postpone_count_window: 3 }],
    today_tasks: [],
    now: new Date(2026, 7, 5),
    suggestSplit: true
  });
  // With title missing, only chronic signal is emitted and split uses task_id.
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[1].subtask_title_prefix, 'c_no_title — 拆分#');
});

test('planTriage: suggestSplit=false (default) does NOT emit split_suggest', () => {
  const plan = planTriage({
    today_open: 0, cap: 5,
    chronic: [{ task_id: 'c1', title: 'X' }],
    today_tasks: [],
    now: new Date(2026, 7, 5)
  });
  assert.ok(plan.actions.every(a => a.action !== 'split_suggest'),
    'no split_suggest without suggestSplit=true');
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].action, 'chronic_ask_user');
});

// ---- applyableActions: suggest-split apply gating ----

test('applyableActions: split_suggest excluded by default', () => {
  // plan has split_suggest action but caller doesn't opt in:
  const acts = [
    { action: 'split_suggest', task_id: 'c1' },
    { action: 'defer_overflow_weekend', task_id: 't1' }
  ];
  const result = applyableActions(acts, false, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].action, 'defer_overflow_weekend');
});

test('applyableActions: split_suggest included only when suggestSplitApply=true', () => {
  const acts = [{ action: 'split_suggest', task_id: 'c1' }];
  const result = applyableActions(acts, false, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].action, 'split_suggest');
  assert.equal(result[0].task_id, 'c1');
});

test('applyableActions: forceChronic still excludes split_suggest while suggestSplitApply=false', () => {
  // forceChronic applies only to chronic_ask_user; split_suggest is gated independently.
  const acts = [
    { action: 'chronic_ask_user', task_id: 'c1' },
    { action: 'split_suggest', task_id: 'c1' }
  ];
  const result = applyableActions(acts, true, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].action, 'chronic_ask_user');
  assert.ok(!result.some(a => a.action === 'split_suggest'));
});
