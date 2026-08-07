'use strict';

// Agent-facing surface: events, signals, agent context, outbound webhook.
//
// deriveSignals is a pure function over a window of device events.
// notifyAgentWebhook is fire-and-forget; failures are logged but never
// block the response path.

const http = require('http');
const { nowIso } = require('./time');

function eventFromOperation(op, task) {
  return {
    event_id: op.id,
    type: op.type,
    task_id: op.task_id,
    task_title: op.task_title || (task ? task.title : null),
    occurred_at: op.applied_at,
    device_id: op.device_id || null,
    payload: op.payload || null
  };
}

function listEvents(store, sinceIso, deviceId, operationStore) {
  const ops = operationStore(store).slice().sort((a, b) => a.applied_at.localeCompare(b.applied_at));
  let events = ops.map((op) => {
    const task = store.tasks.find((t) => t.id === op.task_id);
    return eventFromOperation(op, task);
  });
  if (deviceId) {
    const want = String(deviceId);
    events = events.filter((e) => e.device_id && e.device_id === want);
  }
  if (!sinceIso) return events;
  return events.filter((e) => e.occurred_at > sinceIso);
}

function normalizePostponeTarget(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const t = payload.postpone_target;
  if (t === 'tomorrow' || t === 'weekend' || t === 'next_week' || t === 'today') return t;
  return t ? String(t) : null;
}

function daysBetweenYmd(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(a.slice(0, 10) + 'T00:00:00Z');
  const db = Date.parse(b.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

/**
 * Derive agent-readable signals from raw device events.
 * Pure function: does not mutate store.
 *
 * kinds:
 *   task_completed     — complete op
 *   postponed          — postpone op (with target / due shift)
 *   chronic_postpone   — same task postponed >=3 times in last 7d of the window
 */
function deriveSignals(events, opts) {
  opts = opts || {};
  const win = Array.isArray(events) ? events : [];
  const chronicThreshold = opts.chronicThreshold || 3;
  const running = Object.create(null);
  const signals = [];
  const chronicEmitted = Object.create(null);

  for (const e of win) {
    if (!e || !e.type) continue;
    if (e.type === 'complete') {
      signals.push({
        kind: 'task_completed',
        event_id: e.event_id || null,
        task_id: e.task_id || null,
        title: e.task_title || null,
        at: e.occurred_at || null,
        advice: '可提后续；勿重复 add 同意图'
      });
      continue;
    }
    if (e.type === 'postpone') {
      const payload = e.payload || {};
      const target = normalizePostponeTarget(payload);
      const toDue = payload.due_date || null;
      const fromDue = payload.from_due_date || payload.previous_due_date || null;
      const tid = e.task_id || null;
      const streak = tid ? (running[tid] = (running[tid] || 0) + 1) : 1;
      signals.push({
        kind: 'postponed',
        event_id: e.event_id || null,
        task_id: tid,
        title: e.task_title || null,
        at: e.occurred_at || null,
        target, from_due: fromDue, to_due: toDue, streak,
        advice:
          target === 'tomorrow'
            ? '今日可能过载；少加今天'
            : (target === 'weekend' || target === 'next_week')
              ? '降低工作日权重，或拆分'
              : '已推迟；核对 due 是否合理'
      });
      if (tid && streak >= chronicThreshold && !chronicEmitted[tid]) {
        chronicEmitted[tid] = true;
        signals.push({
          kind: 'chronic_postpone',
          task_id: tid,
          title: e.task_title || null,
          postpone_count_window: streak,
          last_at: e.occurred_at || null,
          advice: '拆分/降级/问是否取消，禁止只改 due'
        });
      }
    }
  }
  return signals;
}

// Returns YYYY-MM-DD of this week's Sunday (Beijing week: Mon..Sun)
function endOfWeek(todayIso) {
  const d = new Date(`${todayIso}T00:00:00Z`);
  let daysToSunday = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}

function buildAgentSuggestion(overdue, todayCount, weekCount, recentDone, recentPostpones) {
  if (overdue >= 5) return '过期任务偏多，建议先安排过期清理或批量推迟，再考虑新增任务';
  if (todayCount === 0) return '今日还没有任务，建议补 2-3 个今日任务';
  if (todayCount >= 8) return '今日任务偏多，墨水屏用户处理节奏有限，建议控制在 3-5 个';
  if (recentPostpones > recentDone && recentDone + recentPostpones > 0) {
    return '设备方最近推迟次数多于完成，可考虑核对任务日期合理性';
  }
  return '节奏正常，可继续按过去 7 天节奏安排本周任务';
}

function webhookTasks(input) {
  if (Array.isArray(input.tasks)) return input.tasks;
  if (input.task && typeof input.task === 'object') return [input.task];
  if (input.title !== undefined) return [input];
  return [];
}

function webhookEventId(input, generatedId) {
  const value = input.event_id || input.id || generatedId('webhook');
  return value ? String(value) : null;
}

// Outbound webhook to Agent — fire-and-forget push of device events.
// Reads agent_webhook_url from readConfig result (or env). Failures never block.
function notifyAgentWebhook(event, url) {
  if (!url) return;
  setImmediate(() => {
    try {
      let target;
      try { target = new URL(url); } catch (e) {
        console.warn('[webhook] invalid agent_webhook_url');
        return;
      }
      const envelope = {
        schema: 'inkqueue.device_event.v1',
        server_time: nowIso(),
        event: event,
        signal: event && event.type === 'complete'
          ? {
              kind: 'task_completed',
              task_id: event.task_id || null,
              title: event.task_title || null,
              at: event.occurred_at || null,
              advice: '可提后续；勿重复 add 同意图'
            }
          : event && event.type === 'postpone'
            ? {
                kind: 'postponed',
                task_id: event.task_id || null,
                title: event.task_title || null,
                at: event.occurred_at || null,
                target: (event.payload && event.payload.postpone_target) || null,
                to_due: (event.payload && event.payload.due_date) || null
              }
            : null
      };
      const body = JSON.stringify(envelope);
      const isHttps = target.protocol === 'https:';
      const lib = isHttps ? require('https') : http;
      const req = lib.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'InkQueue-Server/0.9'
        },
        timeout: 5000,
        rejectUnauthorized: false
      }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[webhook] ok', event && event.type, event && event.task_id, '->', res.statusCode);
        } else {
          console.warn('[webhook] non-2xx', res.statusCode, event && event.type);
        }
      });
      req.on('error', (err) => { console.warn('[webhook] error', err.message); });
      req.on('timeout', () => { req.destroy(); console.warn('[webhook] timeout'); });
      req.write(body);
      req.end();
    } catch (e) {
      console.warn('[webhook] failed', e && e.message);
    }
  });
}

module.exports = {
  eventFromOperation, listEvents,
  normalizePostponeTarget, daysBetweenYmd, deriveSignals,
  endOfWeek, buildAgentSuggestion,
  webhookTasks, webhookEventId, notifyAgentWebhook
};