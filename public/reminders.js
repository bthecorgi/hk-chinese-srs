// Daily study reminder timing and content. Pure functions only, so it can be unit-tested in Node.
//
// "Smart" timing sends the reminder shortly before the time you usually start studying.
// Habit-anchored reminders get opened more than ones at a fixed clock time. Duolingo's
// reminder research found this too: its default is 23.5 hours after the last practice.
// Until there's enough history it uses 19:00, the after-dinner homework slot for primary
// pupils and the usual evening peak for app notification opens.

import { dayStart, dayKey, ROLLOVER_HOUR, MIN } from './srs.js';

export const DEFAULT_REMINDER_MIN = 19 * 60;
export const SMART_MIN_DAYS = 3; // study days needed before smart timing kicks in
export const SMART_LOOKBACK = 14; // most recent study days used
export const SMART_LEAD = 30; // minutes before the usual study time
export const SMART_EARLIEST = 7 * 60;
export const SMART_LATEST = 21 * 60 + 30;
export const PLAN_DAYS = 14;
const KEEP_TIMES = 30;

// Minutes after the 04:00 rollover, so a 01:00 session counts as late at night rather than early morning.
const sinceRollover = (m) => (m - ROLLOVER_HOUR * 60 + 1440) % 1440;
const fromRollover = (m) => (m + ROLLOVER_HOUR * 60) % 1440;

export const minuteOfDay = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Records when the first card of a study day was answered. Returns the (pruned) map.
export function recordStudyTime(times, ts) {
  const k = dayKey(ts);
  if (times[k] !== undefined) return times;
  const next = { ...times, [k]: minuteOfDay(ts) };
  const keys = Object.keys(next).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_TIMES))) delete next[old];
  return next;
}

// The reminder time, in minutes after midnight, that smart timing picks from past study times.
export function smartReminderMinute(times) {
  const recent = Object.keys(times).sort().slice(-SMART_LOOKBACK).map((k) => sinceRollover(times[k]));
  if (recent.length < SMART_MIN_DAYS) return DEFAULT_REMINDER_MIN;
  recent.sort((a, b) => a - b);
  const mid = recent.length >> 1;
  const median = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
  const target = Math.round((median - SMART_LEAD) / 15) * 15;
  const clamped = Math.min(sinceRollover(SMART_LATEST), Math.max(sinceRollover(SMART_EARLIEST), target));
  return fromRollover(clamped);
}

export function reminderMinute(settings, times) {
  if (settings.remindMode === 'fixed') return parseHHMM(settings.remindTime) ?? DEFAULT_REMINDER_MIN;
  return smartReminderMinute(times);
}

// What will be waiting at each of the next PLAN_DAYS reminders: { dayKey: [reviews, new] }.
// The push server sends nothing on days with nothing to do, or once the plan runs out.
export function reminderPlan({ cards, newPerDay, newToday, newAvailable, minute, now }) {
  const plan = {};
  const offset = sinceRollover(minute) * MIN;
  const cardList = Object.values(cards);
  for (let i = 0; i < PLAN_DAYS; i++) {
    const d = new Date(dayStart(now));
    d.setDate(d.getDate() + i);
    const at = d.getTime() + offset;
    let reviews = 0;
    for (const c of cardList) {
      if (c.state === 'learning' || c.state === 'relearning' || (c.state === 'review' && c.due <= at)) reviews++;
    }
    const quota = i === 0 ? Math.max(0, newPerDay - newToday) : newPerDay;
    plan[dayKey(d.getTime())] = [reviews, Math.min(quota, newAvailable)];
  }
  return plan;
}

export function reminderText(reviews, fresh) {
  const parts = [];
  if (fresh) parts.push(`${fresh} new character${fresh === 1 ? '' : 's'}`);
  if (reviews) parts.push(`${reviews} review${reviews === 1 ? '' : 's'}`);
  return {
    title: '溫習時間 · Time to study',
    body: parts.length ? `${parts.join(' and ')} waiting for you today.` : 'Your characters are waiting for you.',
  };
}
