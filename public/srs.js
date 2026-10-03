// Spaced-repetition scheduler (SM-2 family, Anki-style learning steps).
// Pure functions only, so it can be unit-tested in Node.

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
export const ROLLOVER_HOUR = 4; // a new study day starts at 04:00 local time

export const LEARN_STEPS = [1 * MIN, 10 * MIN];
export const RELEARN_STEPS = [10 * MIN];
export const GRADUATING_IVL = 1;
export const EASY_IVL = 4;
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_IVL = 3650;
export const LEARN_AHEAD = 20 * MIN;

export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;

// Start of the study day containing `ts` (local time, 04:00 rollover).
export function dayStart(ts) {
  const d = new Date(ts);
  if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(ROLLOVER_HOUR, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ts) {
  const d = new Date(dayStart(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newCard() {
  return { state: 'new', step: 0, due: 0, ivl: 0, ease: START_EASE, reps: 0, lapses: 0 };
}

function dueInDays(now, days) {
  // Add calendar days at the rollover hour so DST shifts don't move the due time.
  const d = new Date(dayStart(now));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function fuzz(ivl, rng) {
  if (ivl < 3) return ivl;
  const f = 1 + (rng() - 0.5) * 0.1;
  return Math.max(1, Math.round(ivl * f));
}

function graduate(card, ivl, now, rng) {
  const days = Math.min(MAX_IVL, fuzz(ivl, rng));
  return { ...card, state: 'review', step: 0, ivl: days, due: dueInDays(now, days) };
}

// Returns a new card object; does not mutate `card`.
export function schedule(card, rating, now, rng = Math.random) {
  const c = { ...card, reps: card.reps + 1, last: now };

  if (c.state === 'new' || c.state === 'learning') {
    c.state = 'learning';
    switch (rating) {
      case AGAIN:
        return { ...c, step: 0, due: now + LEARN_STEPS[0] };
      case HARD: {
        const delay = c.step === 0 && LEARN_STEPS.length > 1
          ? (LEARN_STEPS[0] + LEARN_STEPS[1]) / 2
          : LEARN_STEPS[c.step];
        return { ...c, due: now + delay };
      }
      case GOOD: {
        const step = c.step + 1;
        if (step >= LEARN_STEPS.length) return graduate(c, GRADUATING_IVL, now, rng);
        return { ...c, step, due: now + LEARN_STEPS[step] };
      }
      case EASY:
        return graduate(c, EASY_IVL, now, rng);
    }
  }

  if (c.state === 'relearning') {
    switch (rating) {
      case AGAIN:
        return { ...c, step: 0, due: now + RELEARN_STEPS[0] };
      case HARD:
        return { ...c, due: now + RELEARN_STEPS[c.step] * 1.5 };
      case GOOD: {
        const step = c.step + 1;
        if (step >= RELEARN_STEPS.length) return graduate(c, c.ivl, now, rng);
        return { ...c, step, due: now + RELEARN_STEPS[step] };
      }
      case EASY:
        return graduate(c, c.ivl + 1, now, rng);
    }
  }

  // review
  const ivl = c.ivl;
  switch (rating) {
    case AGAIN:
      return {
        ...c,
        state: 'relearning',
        step: 0,
        lapses: c.lapses + 1,
        ease: Math.max(MIN_EASE, c.ease - 0.2),
        ivl: Math.max(1, Math.round(ivl * 0.5)),
        due: now + RELEARN_STEPS[0],
      };
    case HARD:
      return graduate({ ...c, ease: Math.max(MIN_EASE, c.ease - 0.15) }, Math.max(ivl + 1, ivl * 1.2), now, rng);
    case GOOD:
      return graduate(c, Math.max(ivl + 1, ivl * c.ease), now, rng);
    case EASY:
      return graduate({ ...c, ease: c.ease + 0.15 }, Math.max(ivl + 2, ivl * c.ease * 1.3), now, rng);
  }
  throw new Error(`bad rating ${rating}`);
}

export function formatDelay(ms) {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`;
  const d = Math.round(ms / DAY);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

// Labels shown under the answer buttons, e.g. { 1: '1m', 2: '6m', 3: '10m', 4: '4d' }.
export function previewIntervals(card, now) {
  const noFuzz = () => 0.5;
  const out = {};
  for (const r of [AGAIN, HARD, GOOD, EASY]) {
    const next = schedule(card, r, now, noFuzz);
    // Review intervals are whole days; show those rather than hours-until-04:00.
    out[r] = formatDelay(next.state === 'review' ? next.ivl * DAY : next.due - now);
  }
  return out;
}

export function isMature(card) {
  return card && card.state === 'review' && card.ivl >= 21;
}
