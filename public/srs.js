// Spaced-repetition scheduler (SM-2 family, Anki-style learning steps).
// The learner only says whether they got the card right or wrong; the scheduler works out
// how easy the card is from its history (misses while learning, lapses, how late a review
// was and still remembered) and adjusts each card's ease on its own.
// Pure functions only, so it can be unit-tested in Node.

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
export const ROLLOVER_HOUR = 4; // a new study day starts at 04:00 local time

export const LEARN_STEPS = [1 * MIN, 10 * MIN];
export const RELEARN_STEPS = [10 * MIN];
export const GRADUATING_IVL = 1; // first interval for a card missed while learning
export const KNOWN_IVL = 3; // first interval for a card right every time while learning
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const EASE_UP = 0.05; // each correct review makes the card a little easier
export const EASE_DOWN = 0.2; // each lapse makes it harder
export const MAX_IVL = 3650;
export const LEARN_AHEAD = 20 * MIN;

export const WRONG = 1;
export const RIGHT = 2;

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
  const { missed, ...c } = card;
  return { ...c, state: 'review', step: 0, ivl: days, due: dueInDays(now, days) };
}

// Whole study days a review card was answered after its due date.
function daysLate(card, now) {
  return Math.max(0, Math.round((dayStart(now) - dayStart(card.due)) / DAY));
}

// Returns a new card object; does not mutate `card`. `answer` is RIGHT or WRONG.
export function schedule(card, answer, now, rng = Math.random) {
  if (answer !== RIGHT && answer !== WRONG) throw new Error(`bad answer ${answer}`);
  const right = answer === RIGHT;
  const c = { ...card, reps: card.reps + 1, last: now };

  if (c.state === 'new' || c.state === 'learning') {
    c.state = 'learning';
    if (!right) return { ...c, step: 0, missed: true, due: now + LEARN_STEPS[0] };
    const step = c.step + 1;
    if (step >= LEARN_STEPS.length) return graduate(c, c.missed ? GRADUATING_IVL : KNOWN_IVL, now, rng);
    return { ...c, step, due: now + LEARN_STEPS[step] };
  }

  if (c.state === 'relearning') {
    if (!right) return { ...c, step: 0, due: now + RELEARN_STEPS[0] };
    const step = c.step + 1;
    if (step >= RELEARN_STEPS.length) return graduate(c, c.ivl, now, rng);
    return { ...c, step, due: now + RELEARN_STEPS[step] };
  }

  // review
  if (!right) {
    return {
      ...c,
      state: 'relearning',
      step: 0,
      lapses: c.lapses + 1,
      ease: Math.max(MIN_EASE, c.ease - EASE_DOWN),
      ivl: Math.max(1, Math.round(c.ivl * 0.5)),
      due: now + RELEARN_STEPS[0],
    };
  }
  // Remembered even though it was late: give half the extra days as credit.
  const base = c.ivl + daysLate(c, now) / 2;
  const ease = c.ease < MAX_EASE ? Math.min(MAX_EASE, c.ease + EASE_UP) : c.ease;
  return graduate({ ...c, ease }, Math.max(c.ivl + 1, base * c.ease), now, rng);
}

export function formatDelay(ms) {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`;
  const d = Math.round(ms / DAY);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

// Labels shown under the answer buttons, e.g. { 1: '1m', 2: '10m' }.
export function previewIntervals(card, now) {
  const noFuzz = () => 0.5;
  const out = {};
  for (const r of [WRONG, RIGHT]) {
    const next = schedule(card, r, now, noFuzz);
    // Review intervals are whole days; show those rather than hours-until-04:00.
    out[r] = formatDelay(next.state === 'review' ? next.ivl * DAY : next.due - now);
  }
  return out;
}

export function isMature(card) {
  return card && card.state === 'review' && card.ivl >= 21;
}
