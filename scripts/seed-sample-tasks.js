#!/usr/bin/env node
'use strict';

/**
 * Seed a few sample tasks for Kindle / Agent end-to-end testing.
 *
 *   node scripts/seed-sample-tasks.js
 *   INKQUEUE_URL=http://127.0.0.1:8787 INKQUEUE_TOKEN=dev-token node scripts/seed-sample-tasks.js
 */

const BASE = (process.env.INKQUEUE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const TOKEN = process.env.INKQUEUE_TOKEN || 'dev-token';

function shanghaiYmd(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nextMondayYmd() {
  // Iterate days until Monday in Asia/Shanghai calendar label.
  for (let i = 1; i <= 8; i++) {
    const ymd = shanghaiYmd(i);
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short'
    }).format(new Date(Date.now() + i * 86400000));
    if (wd === 'Mon') return ymd;
  }
  return shanghaiYmd(7);
}

function nextSaturdayYmd() {
  for (let i = 0; i <= 8; i++) {
    const ymd = shanghaiYmd(i);
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short'
    }).format(new Date(Date.now() + i * 86400000));
    if (wd === 'Sat' && i > 0) return ymd;
    if (wd === 'Sat' && i === 0) continue; // if today is Sat, still want "this weekend" later — use next
  }
  return shanghaiYmd(6);
}

async function createTask(body) {
  const res = await fetch(`${BASE}/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-InkQueue-Token': TOKEN
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  const today = shanghaiYmd(0);
  const tomorrow = shanghaiYmd(1);
  const weekend = nextSaturdayYmd();
  const later = nextMondayYmd();

  const samples = [
    {
      title: '整理 BootSem 文档',
      note: '给 juniors 的说明材料，写清启动优化流程。',
      due_date: today,
      due_time: '14:00',
      project: 'BootSem',
      priority: 'high',
      source: 'agent'
    },
    {
      title: '看盐构造 DEM 论文',
      note: '今晚扫一遍摘要和结论。',
      due_date: today,
      due_time: null,
      project: 'Research',
      priority: 'normal',
      source: 'agent'
    },
    {
      title: '周五前提交材料',
      note: '',
      due_date: weekend,
      due_time: null,
      project: 'BootSem',
      priority: 'normal',
      source: 'agent'
    },
    {
      title: '读完某本书',
      note: '没有硬截止。',
      due_date: later,
      due_time: null,
      project: 'Reading',
      priority: 'normal',
      source: 'agent'
    },
    {
      title: '复盘比赛记录',
      note: '可推迟。',
      due_date: tomorrow,
      due_time: '09:00',
      project: 'BootSem',
      priority: 'normal',
      source: 'agent'
    }
  ];

  console.log(`seeding ${samples.length} tasks -> ${BASE}`);
  for (const s of samples) {
    const r = await createTask(s);
    const t = r.task || r;
    console.log(`+ ${t.id}  ${t.title}  due=${t.due_date || '-'} ${t.due_time || ''}`);
  }
  console.log('done. pull snapshot:');
  console.log(`  curl ${BASE}/v1/tasks/snapshot -H "X-InkQueue-Token: ${TOKEN}"`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
