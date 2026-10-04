// Push server for daily study reminders (Cloudflare Worker + KV).
//
// The app keeps all progress on the device, so it uploads only what this needs:
// the push subscription, the time zone, the reminder time and a 14-day plan of how
// many cards will be waiting at each reminder. A cron trigger every 15 minutes sends
// each subscriber their reminder once per study day, unless nothing is due.

import { sendPush } from './webpush.js';
import { reminderText } from '../../public/reminders.js';

const ROLLOVER_MIN = 4 * 60; // matches ROLLOVER_HOUR in public/srs.js
const LATE_WINDOW = 3 * 60; // give up on a day's reminder this many minutes after its time
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.apple.com', 'notify.windows.com', 'push.services.mozilla.com'];

// Local study day (04:00 rollover) and minutes since rollover, for `now` in time zone `tz`.
export function localSlot(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - (minute < ROLLOVER_MIN ? 1 : 0)));
  return { day: d.toISOString().slice(0, 10), since: (minute - ROLLOVER_MIN + 1440) % 1440 };
}

// The [reviews, new] counts to remind about now, or null if this record shouldn't get a reminder now.
export function dueReminder(rec, now) {
  const { day, since } = localSlot(now, rec.tz);
  if (rec.sent === day) return null;
  const target = (rec.minute - ROLLOVER_MIN + 1440) % 1440;
  if (since < target || since >= target + LATE_WINDOW) return null;
  const counts = rec.plan?.[day];
  if (!counts || counts[0] + counts[1] === 0) return null;
  return { day, counts };
}

export function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const validTz = (tz) => {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
};

const count = (n) => Number.isInteger(n) && n >= 0 && n < 100000;

// Checks a /subscribe body; returns an error message or null.
export function checkSubscribe(b) {
  const s = b?.subscription;
  if (!s || !validEndpoint(s.endpoint)) return 'bad subscription endpoint';
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return 'bad subscription keys';
  if (!validTz(b.tz)) return 'bad time zone';
  if (!Number.isInteger(b.minute) || b.minute < 0 || b.minute >= 1440) return 'bad minute';
  const plan = b.plan;
  if (!plan || typeof plan !== 'object' || Object.keys(plan).length > 31) return 'bad plan';
  for (const [k, v] of Object.entries(plan)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v) || v.length !== 2 || !v.every(count)) return 'bad plan';
  }
  return null;
}

async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return `sub:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const vapid = (env) => ({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });

async function notify(env, rec, counts) {
  const payload = JSON.stringify({ ...reminderText(...counts), count: counts[0] + counts[1] });
  return sendPush(rec.subscription, payload, vapid(env), { topic: 'study-reminder' });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || '*';
  const cors = {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' && url.pathname === '/config') return json({ publicKey: env.VAPID_PUBLIC_KEY });
  if (request.method !== 'POST') return json({ error: 'not found' }, 404);
  if (allowed !== '*' && origin !== allowed) return json({ error: 'origin not allowed' }, 403);

  const text = await request.text();
  if (text.length > 8192) return json({ error: 'too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }

  switch (url.pathname) {
    case '/subscribe': {
      const err = checkSubscribe(body);
      if (err) return json({ error: err }, 400);
      const key = await keyFor(body.subscription.endpoint);
      // A changed subscription (browser rotated it) carries the old endpoint so the record moves over.
      let prev = await env.SUBS.get(key, 'json');
      if (!prev && validEndpoint(body.old) && body.old !== body.subscription.endpoint) {
        const oldKey = await keyFor(body.old);
        prev = await env.SUBS.get(oldKey, 'json');
        if (prev) await env.SUBS.delete(oldKey);
      }
      const { endpoint, keys: { p256dh, auth } } = body.subscription;
      const rec = {
        subscription: { endpoint, keys: { p256dh, auth } },
        tz: body.tz, minute: body.minute, plan: body.plan, sent: prev?.sent ?? null, updated: Date.now(),
      };
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true });
    }
    case '/move': {
      // From the service worker's pushsubscriptionchange, which has no settings to send.
      const s = body.subscription;
      if (!validEndpoint(body.old) || !validEndpoint(s?.endpoint) || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') {
        return json({ error: 'bad subscription' }, 400);
      }
      const oldKey = await keyFor(body.old);
      const prev = await env.SUBS.get(oldKey, 'json');
      if (!prev) return json({ error: 'not subscribed' }, 404);
      const rec = { ...prev, subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, updated: Date.now() };
      await env.SUBS.put(await keyFor(s.endpoint), JSON.stringify(rec));
      await env.SUBS.delete(oldKey);
      return json({ ok: true });
    }
    case '/unsubscribe': {
      if (!validEndpoint(body.endpoint)) return json({ error: 'bad endpoint' }, 400);
      await env.SUBS.delete(await keyFor(body.endpoint));
      return json({ ok: true });
    }
    case '/test': {
      if (!validEndpoint(body.endpoint)) return json({ error: 'bad endpoint' }, 400);
      const rec = await env.SUBS.get(await keyFor(body.endpoint), 'json');
      if (!rec) return json({ error: 'not subscribed' }, 404);
      const { day } = localSlot(Date.now(), rec.tz);
      const res = await notify(env, rec, rec.plan[day] || [0, 0]);
      return json({ ok: res.ok, status: res.status }, res.ok ? 200 : 502);
    }
    default:
      return json({ error: 'not found' }, 404);
  }
}

async function sendDue(env, now = Date.now()) {
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    await Promise.all(page.keys.map(async ({ name }) => {
      const rec = await env.SUBS.get(name, 'json');
      const due = rec && dueReminder(rec, now);
      if (!due) return;
      try {
        const res = await notify(env, rec, due.counts);
        if (res.status === 404 || res.status === 410) await env.SUBS.delete(name);
        else if (res.ok) await env.SUBS.put(name, JSON.stringify({ ...rec, sent: due.day }));
        else console.warn('push failed', res.status, await res.text());
      } catch (e) {
        console.warn('push error', e);
      }
    }));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(sendDue(env, event.scheduledTime)),
};
