'use strict';

// Product timezone is always Asia/Shanghai (+08:00). Do not follow host TZ.
// Kept module-scoped so any clock drift between now and nowMinusSeconds is consistent.

const TZ = 'Asia/Shanghai';
const PARTS = ['year', 'month', 'day', 'hour', 'minute', 'second'];

function formatToParts(d) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const out = {};
  for (const p of fmt) out[p.type] = p.value;
  return out;
}

function composeFrom(parts) {
  const get = (t) => parts[t] || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
}

/** Current ISO8601 timestamp in product timezone (+08:00). */
function nowIso() {
  return composeFrom(formatToParts(new Date()));
}

/** Timestamp `seconds` seconds ago in product timezone. */
function nowIsoMinusSeconds(seconds) {
  const d = new Date(Date.now() - seconds * 1000);
  return composeFrom(formatToParts(d));
}

module.exports = { nowIso, nowIsoMinusSeconds };
