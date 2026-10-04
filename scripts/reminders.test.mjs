import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, DAY, MIN } from '../public/srs.js';
import {
  DEFAULT_REMINDER_MIN, smartReminderMinute, recordStudyTime, reminderMinute, reminderPlan, reminderText, parseHHMM, toHHMM,
} from '../public/reminders.js';
import worker, { localSlot, dueReminder, checkSubscribe, validEndpoint } from '../worker/src/index.js';
import { encryptPayload, vapidAuth, b64url, unb64url } from '../worker/src/webpush.js';

const NOW = new Date(2026, 9, 3, 15, 0, 0).getTime(); // 3 Oct 2026, 15:00 local
const at = (h, m = 0, d = 3) => new Date(2026, 9, d, h, m).getTime();
const times = (...mins) => Object.fromEntries(mins.map((m, i) => [`2026-09-${String(10 + i).padStart(2, '0')}`, m]));

test('smart timing uses 19:00 until there are enough study days', () => {
  assert.equal(DEFAULT_REMINDER_MIN, 19 * 60);
  assert.equal(smartReminderMinute({}), 19 * 60);
  assert.equal(smartReminderMinute(times(8 * 60, 8 * 60)), 19 * 60);
});

test('smart timing goes 30 minutes before the median study time, on a 15-minute slot', () => {
  assert.equal(smartReminderMinute(times(20 * 60, 20 * 60 + 10, 21 * 60, 6 * 60 + 30)), 19 * 60 + 30);
  assert.equal(smartReminderMinute(times(17 * 60 + 40, 17 * 60 + 50, 18 * 60)), 17 * 60 + 15);
});

test('smart timing treats after-midnight study as late evening and stays in waking hours', () => {
  // 23:30, 00:30 and 01:00 have a median of 00:30, so 00:00, which is clamped to 21:30.
  assert.equal(smartReminderMinute(times(23 * 60 + 30, 30, 60)), 21 * 60 + 30);
  assert.equal(smartReminderMinute(times(5 * 60, 5 * 60, 5 * 60)), 7 * 60);
});

test('smart timing only looks at the last 14 study days', () => {
  const t = {};
  for (let i = 1; i <= 10; i++) t[`2026-08-${String(i).padStart(2, '0')}`] = 8 * 60;
  for (let i = 1; i <= 14; i++) t[`2026-09-${String(i).padStart(2, '0')}`] = 20 * 60;
  assert.equal(smartReminderMinute(t), 19 * 60 + 30);
});

test('fixed time overrides smart timing', () => {
  assert.equal(reminderMinute({ remindMode: 'fixed', remindTime: '07:45' }, times(20 * 60, 20 * 60, 20 * 60)), 7 * 60 + 45);
  assert.equal(reminderMinute({ remindMode: 'fixed', remindTime: 'nonsense' }, {}), DEFAULT_REMINDER_MIN);
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(toHHMM(19 * 60 + 5), '19:05');
});

test('only the first study of a day is recorded, and old days are pruned', () => {
  let t = recordStudyTime({}, at(18, 20));
  t = recordStudyTime(t, at(21, 0));
  assert.deepEqual(t, { '2026-10-03': 18 * 60 + 20 });
  // 02:00 on the 4th still belongs to the 3rd's study day.
  assert.equal(recordStudyTime({}, at(2, 0, 4))['2026-10-03'], 120);
  for (let i = 0; i < 40; i++) t = recordStudyTime(t, NOW + (i + 1) * DAY);
  assert.equal(Object.keys(t).length, 30);
  assert.ok(!t['2026-10-03']);
});

test('the plan counts reviews due by each reminder plus the new-card quota', () => {
  const cards = {
    a: { state: 'review', due: at(4, 0, 3) }, // due today
    b: { state: 'review', due: at(4, 0, 5) }, // due on the 5th
    c: { state: 'learning', due: NOW + 10 * MIN },
    d: { state: 'review', due: at(4, 0, 30) },
  };
  const plan = reminderPlan({ cards, newPerDay: 10, newToday: 4, newAvailable: 50, minute: 19 * 60, now: NOW });
  assert.equal(Object.keys(plan).length, 14);
  assert.deepEqual(plan['2026-10-03'], [2, 6]);
  assert.deepEqual(plan['2026-10-04'], [2, 10]);
  assert.deepEqual(plan['2026-10-05'], [3, 10]);
  const done = reminderPlan({ cards: {}, newPerDay: 10, newToday: 10, newAvailable: 0, minute: 19 * 60, now: NOW });
  assert.deepEqual(done['2026-10-03'], [0, 0]);
});

test('reminder text names what is waiting', () => {
  assert.match(reminderText(12, 10).body, /^10 new characters and 12 reviews waiting/);
  assert.match(reminderText(1, 0).body, /^1 review waiting/);
});

// ---------- push server ----------

test('local slot uses the 04:00 rollover in the subscriber time zone', () => {
  const t = Date.UTC(2026, 9, 3, 11, 30); // 19:30 in Hong Kong
  assert.deepEqual(localSlot(t, 'Asia/Hong_Kong'), { day: '2026-10-03', since: 15 * 60 + 30 });
  assert.deepEqual(localSlot(Date.UTC(2026, 9, 3, 18, 0), 'Asia/Hong_Kong'), { day: '2026-10-03', since: 22 * 60 }); // 02:00 next day
  assert.equal(localSlot(t, 'America/New_York').day, '2026-10-03');
});

test('a reminder goes out once, in its window, only when something is due', () => {
  const rec = { tz: 'Asia/Hong_Kong', minute: 19 * 60, plan: { '2026-10-03': [3, 10], '2026-10-04': [0, 0] }, sent: null };
  const hk = (d, h, m = 0) => Date.UTC(2026, 9, d, h - 8, m);
  assert.equal(dueReminder(rec, hk(3, 18, 45)), null);
  assert.deepEqual(dueReminder(rec, hk(3, 19, 0)), { day: '2026-10-03', counts: [3, 10] });
  assert.ok(dueReminder(rec, hk(3, 21, 59)));
  assert.equal(dueReminder(rec, hk(3, 22, 0)), null, 'too late, skip the day');
  assert.equal(dueReminder({ ...rec, sent: '2026-10-03' }, hk(3, 19, 15)), null);
  assert.equal(dueReminder(rec, hk(4, 19, 0)), null, 'nothing due');
  assert.equal(dueReminder(rec, hk(5, 19, 0)), null, 'plan ran out');
});

test('subscriptions are validated', () => {
  assert.ok(validEndpoint('https://web.push.apple.com/abc'));
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(!validEndpoint('https://evil.example/abc'));
  assert.ok(!validEndpoint('http://fcm.googleapis.com/x'));
  const ok = { subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'a', auth: 'b' } }, tz: 'Asia/Hong_Kong', minute: 1140, plan: { '2026-10-03': [1, 2] } };
  assert.equal(checkSubscribe(ok), null);
  assert.equal(checkSubscribe({ ...ok, tz: 'Mars/Base' }), 'bad time zone');
  assert.equal(checkSubscribe({ ...ok, minute: 1440 }), 'bad minute');
  assert.equal(checkSubscribe({ ...ok, plan: { '2026-10-03': [1, -2] } }), 'bad plan');
});

// Decrypts an aes128gcm Web Push body as the browser would (RFC 8291).
async function decrypt(body, uaKeys, authSecret) {
  const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
  const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), new Uint8Array([...info, 1]))).slice(0, len);
  const enc = new TextEncoder();
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  assert.equal(plain.at(-1), 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test('push payloads decrypt with the subscription keys', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64url(await crypto.subtle.exportKey('raw', ua.publicKey));
  const body = await encryptPayload('{"title":"溫習時間"}', { p256dh, auth: b64url(auth) });
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(await decrypt(body, ua, auth), '{"title":"溫習時間"}');
});

async function vapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    kp,
    publicKey: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)),
    privateKey: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d,
    subject: 'https://example.com/',
  };
}

test('VAPID header carries a valid ES256 token for the push service origin', async () => {
  const v = await vapidKeys();
  const header = await vapidAuth('https://web.push.apple.com/abc', v, NOW);
  const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, v.publicKey);
  const [h, c, sig] = token.split('.');
  const claims = JSON.parse(new TextDecoder().decode(unb64url(c)));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://example.com/');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.kp.publicKey, unb64url(sig), new TextEncoder().encode(`${h}.${c}`)));
});

function memoryKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

test('server stores, moves, sends to and removes subscriptions', async (t) => {
  const v = await vapidKeys();
  const env = { SUBS: memoryKV(), VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: v.subject, ALLOWED_ORIGIN: 'https://app.example' };
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const keys = { p256dh: b64url(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const call = (path, body, origin = 'https://app.example') => worker.fetch(new Request(`https://push.example${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env);

  const cfg = await worker.fetch(new Request('https://push.example/config'), env);
  assert.equal((await cfg.json()).publicKey, v.publicKey);
  assert.equal((await call('/subscribe', {}, 'https://other.example')).status, 403);

  const sub = { endpoint: 'https://web.push.apple.com/one', keys };
  const plan = { '2026-10-03': [2, 5] };
  assert.equal((await call('/subscribe', { subscription: sub, tz: 'Asia/Hong_Kong', minute: 1140, plan })).status, 200);
  assert.equal(env.SUBS.m.size, 1);

  const moved = { endpoint: 'https://web.push.apple.com/two', keys };
  assert.equal((await call('/move', { old: sub.endpoint, subscription: moved })).status, 200);
  assert.equal(env.SUBS.m.size, 1);
  assert.equal([...env.SUBS.m.values()].map(JSON.parse)[0].subscription.endpoint, moved.endpoint);

  const sent = [];
  let status = 201;
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push({ url, init }); return new Response(null, { status }); });
  const cron = (now) => new Promise((resolve) => worker.scheduled({ scheduledTime: now }, env, { waitUntil: (p) => p.then(resolve) }));

  await cron(Date.UTC(2026, 9, 3, 10, 0)); // 18:00 HK, too early
  assert.equal(sent.length, 0);
  await cron(Date.UTC(2026, 9, 3, 11, 0)); // 19:00 HK
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, moved.endpoint);
  assert.match(sent[0].init.headers.Authorization, /^vapid t=/);
  const msg = JSON.parse(await decrypt(sent[0].init.body, ua, unb64url(keys.auth)));
  assert.equal(msg.count, 7);
  assert.match(msg.body, /5 new characters and 2 reviews/);
  await cron(Date.UTC(2026, 9, 3, 11, 15)); // already sent today
  assert.equal(sent.length, 1);

  // A gone subscription is deleted.
  status = 410;
  const rec = JSON.parse([...env.SUBS.m.values()][0]);
  await env.SUBS.put([...env.SUBS.m.keys()][0], JSON.stringify({ ...rec, plan: { '2026-10-04': [1, 0] } }));
  await cron(Date.UTC(2026, 9, 4, 11, 0));
  assert.equal(env.SUBS.m.size, 0);
});
