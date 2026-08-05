'use strict';

/**
 * Triage runner — shared orchestration layer used by both `inkq` CLI and
 * mcp-inkqueue so they produce identical triage results.
 *
 * Pure planning logic lives in lib/triage.js (planTriage / applyableActions /
 * date helpers). This module does the I/O assembly: fetch context + events +
 * snapshot, plan, optionally apply patches, and return a structured result.
 *
 * Contract: cfg is a built client config (base_url + auth + device_id).
 * flags shape: { cap?: number, apply?: boolean|string, forceChronic?:
 * boolean|string, why?: string, source_session?: string }.
 *
 * Returns: { ok, dryRun, plan, results?, hint }.
 */

const path = require('path');
const triageMod = require(path.join(__dirname, 'triage.js'));
const client = require(path.join(__dirname, 'client.js'));
const { context: apiContext, events: apiEvents, snapshot: apiSnapshot, patchTask: apiPatchTask } = client;

function flagBool(v) {
  return v === 'true' || v === true;
}

async function runTriage(cfg, flags) {
  const CAP = Number(flags.cap) || 5;
  const apply = flagBool(flags.apply);
  const forceChronic = flagBool(flags.forceChronic) || flagBool(flags['force-chronic']);

  // 1) Load context (today's open count) + chronic signals from events.
  const [ctxRes, evRes] = await Promise.all([
    apiContext(cfg).catch((e) => ({ status: 0, json: null, err: e })),
    apiEvents(cfg, { limit: 80 }).catch((e) => ({ status: 0, json: null, err: e }))
  ]);

  if (ctxRes.status === 401 || ctxRes.status === 403) {
    return { ok: false, error: 'auth_rejected', status: ctxRes.status, detail: ctxRes.json };
  }
  if (ctxRes.status !== 200) {
    return { ok: false, error: 'context_failed', status: ctxRes.status };
  }

  const ctx = ctxRes.json || {};
  const todayOpen = Number(ctx.today_open || 0);
  const signals = (evRes.json && evRes.json.signals) || [];
  const chronic = signals.filter((s) => s && s.kind === 'chronic_postpone');

  // 2) Overflow today tasks: need snapshot to know titles.
  const snapRes = await apiSnapshot(cfg).catch((e) => ({ status: 0, json: null, err: e }));
  let todayTasks = [];
  if (snapRes.status === 200 && snapRes.json && Array.isArray(snapRes.json.tasks)) {
    const todayStr = triageMod.fmtDateOffset(new Date(), 0);
    todayTasks = snapRes.json.tasks
      .filter((t) => t.status === 'todo' && t.due_date === todayStr)
      .map((t) => ({ id: t.id, title: t.title, due_time: t.due_time }));
  }

  // 3) Pure plan via lib/triage.js.
  const plan = triageMod.planTriage({
    today_open: todayOpen,
    cap: CAP,
    chronic: chronic,
    today_tasks: todayTasks,
    now: new Date()
  });
  if (snapRes.status !== 200) {
    plan.snapshot_unavailable = snapRes.err ? snapRes.err.message : `status=${snapRes.status}`;
  }

  // 4) Dry-run ends here with the plan; no patches sent.
  if (!apply) {
    return {
      ok: true,
      dryRun: true,
      plan,
      hint: `dry-run: ${plan.actions.length} suggested action(s)`
    };
  }

  // 5) Apply: patch each actionable task (chronic skipped unless --force-chronic).
  const applyList = triageMod.applyableActions(plan.actions, forceChronic);
  const skippedChronic =
    plan.actions.filter((a) => a.action === 'chronic_ask_user').length -
    applyList.filter((a) => a.action === 'chronic_ask_user').length;

  const results = [];
  for (const a of plan.actions) {
    if (a.action === 'chronic_ask_user' && !forceChronic) {
      results.push({
        task_id: a.task_id,
        ok: false,
        skipped: true,
        reason: 'chronic_needs_user_decision',
        hint: '问用户是否取消/拆分；或加 --force-chronic 强制推迟到 ' + a.deferred_due_date_if_forced
      });
      continue;
    }
    const due = a.action === 'chronic_ask_user' ? a.deferred_due_date_if_forced : a.new_due_date;
    const body = { due_date: due };
    if (a.action === 'chronic_ask_user') body.force = true;
    if (flags.why !== undefined) body.why = flags.why;
    if (flags.source_session !== undefined) body.source_session = flags.source_session;
    try {
      const res = await apiPatchTask(cfg, a.task_id, body);
      if (res.status !== 200) {
        results.push({ task_id: a.task_id, ok: false, status: res.status, error: res.json });
      } else {
        results.push({
          task_id: a.task_id,
          ok: true,
          due_date: (res.json.task || {}).due_date,
          forced: a.action === 'chronic_ask_user' || undefined
        });
      }
    } catch (e) {
      results.push({ task_id: a.task_id, ok: false, error: String(e.message) });
    }
  }

  const hint = skippedChronic > 0
    ? `applied ${results.filter((r) => r.ok).length}/${results.length}; ${skippedChronic} chronic skipped (ask user)`
    : `applied ${results.filter((r) => r.ok).length}/${results.length} patch(es)`;

  return {
    ok: true,
    dryRun: false,
    plan,
    results,
    hint
  };
}

module.exports = { runTriage, flagBool };
