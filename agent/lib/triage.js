'use strict';

/**
 * triage — pure decision logic for inkq patch triage.
 *
 * Input: server state (today open count, chronic signals, today's tasks).
 * Output: a list of suggested actions (chronic + overflow).
 *
 * Hard rule: chronic tasks are NEVER auto-deferred (only-due patch on chronic
 * is "糊弄"). Always suggest ask_user_cancel_or_split. --force-chronic overrides
 * (caller still needs server-side --force).
 *
 * Kept pure so it can be unit-tested without spinning up http servers.
 */

/** Build a YYYY-MM-DD from a Date + dayDelta. */
function fmtDateOffset(base, dayDelta) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayDelta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Days until this Saturday (Mon=0..Sun=6 week). Mon-Fri -> this Sat; Sat/Sun -> next Sat. */
function saturdayDelta(base) {
  const wd = (base.getDay() + 6) % 7;
  if (wd <= 4) return 5 - wd;
  return 7 - wd + 5;
}

/** Days until next Monday. */
function nextMondayDelta(base) {
  const wd = (base.getDay() + 6) % 7; // Mon=0..Sun=6
  if (wd === 0) return 7; // already Monday -> next Monday
  return 7 - wd; // Tue=6,Wed=5,Thu=4,Fri=3,Sat=2,Sun=1
}

/**
 * @param {Object} input
 * @param {number} input.today_open     count of open tasks due today
 * @param {number} input.cap            today cap (default 5)
 * @param {Array}  input.chronic        chronic signals [{task_id,title,postpone_count_window,last_at}]
 * @param {Array}  input.today_tasks    today's non-chronic open tasks [{id,title,due_time}]
 * @param {Date}   [input.now]          reference date (default new Date())
 * @returns {Object} {chronic, today_open, cap, overflow, actions}
 */
function planTriage(input) {
  const todayOpen = Number(input.today_open || 0);
  const cap = Number(input.cap) || 5;
  const chronic = Array.isArray(input.chronic) ? input.chronic : [];
  const chronicIds = new Set(chronic.map((s) => s && s.task_id).filter(Boolean));
  const todayTasks = Array.isArray(input.today_tasks) ? input.today_tasks : [];
  const now = input.now || new Date();

  const overflow = Math.max(0, todayOpen - cap);
  const nextMon = fmtDateOffset(now, nextMondayDelta(now));
  const weekendStr = fmtDateOffset(now, saturdayDelta(now));

  const actions = [];

  // 1) Chronic: never auto-defer. Suggest ask_user_cancel_or_split.
  for (const s of chronic) {
    actions.push({
      action: 'chronic_ask_user',
      task_id: s.task_id,
      title: s.title || null,
      reason: 'chronic_postpone',
      postpone_count_window: s.postpone_count_window || null,
      last_at: s.last_at || null,
      suggest: 'ask_user_cancel_or_split',
      deferred_due_date_if_forced: nextMon
    });
  }

  // 2) Overflow non-chronic today tasks -> this weekend. Keep due_time.
  const overflowTasks = todayTasks
    .filter((t) => t && t.id && !chronicIds.has(t.id))
    .slice(0, overflow);
  for (const t of overflowTasks) {
    actions.push({
      action: 'defer_overflow_weekend',
      task_id: t.id,
      title: t.title || null,
      new_due_date: weekendStr,
      preserve_due_time: t.due_time || null
    });
  }

  return {
    chronic: chronic.length,
    today_open: todayOpen,
    cap,
    overflow,
    actions
  };
}

/**
 * Apply filter: returns actions that --apply will actually patch.
 * chronic are excluded unless forceChronic=true.
 */
function applyableActions(actions, forceChronic) {
  return actions.filter((a) => {
    if (a.action === 'chronic_ask_user') return !!forceChronic;
    return true;
  });
}

module.exports = {
  fmtDateOffset,
  saturdayDelta,
  nextMondayDelta,
  planTriage,
  applyableActions
};
