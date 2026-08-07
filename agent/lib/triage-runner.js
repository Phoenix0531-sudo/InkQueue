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
const { context: apiContext, events: apiEvents, snapshot: apiSnapshot, patchTask: apiPatchTask, createTask: apiCreateTask } = client;

function flagBool(v) {
  return v === 'true' || v === true;
}

async function runTriage(cfg, flags) {
  const CAP = Number(flags.cap) || 5;
  const apply = flagBool(flags.apply);
  const forceChronic = flagBool(flags.forceChronic) || flagBool(flags['force-chronic']);
  const suggestSplit = flagBool(flags.suggestSplit) || flagBool(flags['suggest-split']);
  const suggestSplitN = Number(flags.splitParts || flags['split-parts']) || 2;

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
    now: new Date(),
    suggestSplit
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

  // 5) Apply: patch each actionable task (chronic skipped unless --force-chronic;
  // split_suggest ADDS subtasks + patches original done, only when both
  // --apply and --suggest-split are set).
  const suggestSplitApply = apply && suggestSplit;
  const applyList = triageMod.applyableActions(plan.actions, forceChronic, suggestSplitApply);
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
        hint: '问用户是否取消/拆分；或加 --force-chronic 强制推迟到 ' + a.deferred_due_date_if_forced + '；或加 --suggest-split 拆分'
      });
      continue;
    }
    if (a.action === 'split_suggest' && !suggestSplitApply) {
      // dry-run includes split_suggest only when --suggest-split; the
      // plan-level action is informational. Already emitted by plan.
      continue;
    }
    if (a.action === 'split_suggest' && suggestSplitApply) {
      // (1) Add N subtasks (configured by --split-parts, default 2).
      const parts = Math.max(1, Math.min(5, suggestSplitN));
      const subIds = [];
      let subAddOk = true;
      for (let i = 1; i <= parts; i++) {
        const subBody = {
          title: `${a.subtask_title_prefix}${i}`,
          due_date: a.subtask_due_date,
          source: 'agent',
          note: `拆分自 ${a.title || a.task_id}`
        };
        if (flags.why !== undefined) subBody.why = flags.why;
        if (flags.source_session !== undefined) subBody.source_session = flags.source_session;
        try {
          const r = await apiCreateTask(cfg, subBody);
          if (r.status === 201 || r.status === 200) {
            subIds.push(((r.json || {}).task || {}).id || null);
          } else {
            subAddOk = false;
            results.push({
              task_id: a.task_id,
              ok: false,
              split_index: i,
              status: r.status,
              error: r.json
            });
            break;
          }
        } catch (e) {
          subAddOk = false;
          results.push({ task_id: a.task_id, ok: false, split_index: i, error: String(e.message) });
          break;
        }
      }
      if (!subAddOk) continue;
      // (2) Patch original task done.
      let doneOk = false;
      try {
        const res = await apiPatchTask(cfg, a.task_id, { status: 'done' });
        if (res.status === 200) {
          doneOk = true;
        } else {
          results.push({
            task_id: a.task_id,
            ok: false,
            original_patch: true,
            status: res.status,
            error: res.json
          });
        }
      } catch (e) {
        results.push({ task_id: a.task_id, ok: false, original_patch: true, error: String(e.message) });
      }
      if (doneOk) {
        results.push({
          task_id: a.task_id,
          ok: true,
          split: true,
          subtask_ids: subIds,
          parts
        });
      }
      continue;
    }
    // Existing: defer_overflow_weekend or force-chronic defer.
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
