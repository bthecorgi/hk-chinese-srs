import {
  newCard, schedule, previewIntervals, dayKey, isMature, formatDelay,
  WRONG, RIGHT, FAST, SLOW, classifySpeed, recordThink, LEARN_AHEAD, DAY,
} from '../srs.js';
import { DIRS, key, splitKey, orderNew } from './queue.js';

const STORE_KEY = 'ja-srs-v1';
const DIR_LABEL = { r: 'Japanese → English', p: 'English → Japanese', l: 'Listen → English' };
const DIR_SHORT = { r: 'J→E', p: 'E→J', l: '♪→E' };
const DEFAULT_SETTINGS = {
  lessons: Array.from({ length: 21 }, (_, i) => i + 1),
  newPerDay: 10,
  dirs: ['r', 'p'],
  script: 'kanji', // kanji | kana
  showKana: true,
  showRomaji: true,
  frontReadings: true, // kana/romaji on the front of Japanese → English cards
  autoplay: 'reveal', // reveal | front | off
  voice: '',
  rate: 0.9,
};

// ---------- state ----------

let DATA = null; // { lessons: [{l, t}], phrases: [...] }
let BY_ID = new Map();
let store = loadStore();
let route = { name: 'home' };
let session = null;

function loadStore() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { /* corrupt or unavailable */ }
  return {
    cards: s.cards || {},
    days: s.days || {},
    think: s.think || {},
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
  };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    toast('Could not save progress — storage is full or blocked.');
  }
}

const S = () => store.settings;
const today = () => {
  const k = dayKey(Date.now());
  store.days[k] ||= { new: 0, rev: 0 };
  return store.days[k];
};
const dirsOn = () => DIRS.filter((d) => S().dirs.includes(d));

// ---------- helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function cardStatus(k) {
  const card = store.cards[k];
  if (!card || card.state === 'new') return 'new';
  if (card.state !== 'review') return 'learn';
  return isMature(card) ? 'mature' : 'young';
}

// A phrase's status for the progress bars: its least-advanced enabled direction.
const RANK = { new: 0, learn: 1, young: 2, mature: 3 };
function phraseStatus(id) {
  const st = dirsOn().map((d) => cardStatus(key(id, d)));
  if (!st.length) return 'new';
  if (st.every((s) => s === 'new')) return 'new';
  const min = st.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
  return min === 'new' ? 'learn' : min;
}

const kanaText = (x) => x.k.replace(/ /g, '');
const mainText = (x) => (S().script === 'kana' ? x.k : x.j);
// Hiragana line under the Japanese, when it adds something (kanji or katakana in the main text).
const kanaLine = (x) => (S().script === 'kanji' && S().showKana && kanaText(x) !== x.j.replace(/[ 。、？！…]/g, '') ? x.k : '');
const sizeClass = (t) => { const n = [...t].length; return n <= 4 ? 'xl' : n <= 9 ? 'lg' : n <= 18 ? 'md' : 'sm'; };

// ---------- speech ----------

const speech = {
  voices: [],
  load() { if ('speechSynthesis' in window) this.voices = speechSynthesis.getVoices(); },
  quality(v) {
    const id = `${v.voiceURI} ${v.name}`.toLowerCase();
    if (id.includes('premium')) return 3;
    if (id.includes('enhanced')) return 2;
    if (id.includes('compact')) return 0;
    return 1;
  },
  qualityLabel(v) {
    const label = ['Compact', '', 'Enhanced', 'Premium'][this.quality(v)];
    return v.name.toLowerCase().includes(label.toLowerCase()) ? '' : label;
  },
  list() {
    return this.voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'))
      .sort((a, b) => this.quality(b) - this.quality(a));
  },
  pick() {
    const list = this.list();
    return list.find((v) => v.voiceURI === S().voice) || list[0] || null;
  },
  playThroughSilent() {
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
  },
  say(text) {
    if (!('speechSynthesis' in window)) { toast('Speech is not supported in this browser.'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    const v = this.pick();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = S().rate;
    this.u = u; // keep a reference so Safari doesn't drop it
    this.playThroughSilent();
    speechSynthesis.speak(u);
  },
};
const sayPhrase = (x) => speech.say(x.s || x.j);
if ('speechSynthesis' in window) {
  speech.playThroughSilent();
  speech.load();
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    speech.load();
    if (route.name === 'settings') render();
  });
}

const selecting = () => !(window.getSelection()?.isCollapsed ?? true);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-say]');
  if (!b) return;
  if (selecting() && !b.matches('button')) return;
  e.stopPropagation();
  const x = BY_ID.get(b.dataset.say);
  if (x) sayPhrase(x); else speech.say(b.dataset.say);
});

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor"/></svg>';
const playBtn = (id, cls = '') => `<button class="speak ${cls}" data-say="${esc(id)}" aria-label="Play Japanese">${PLAY_ICON}</button>`;

// ---------- queue ----------

const newQueue = () => orderNew(DATA.phrases, S().dirs, S().lessons, store.cards);

function counts(now = Date.now()) {
  let learn = 0; let due = 0;
  const on = new Set(dirsOn());
  for (const [k, card] of Object.entries(store.cards)) {
    if (!on.has(splitKey(k)[1]) || !BY_ID.has(splitKey(k)[0])) continue;
    if (card.state === 'learning' || card.state === 'relearning') { if (card.due <= now + LEARN_AHEAD) learn++; } else if (card.state === 'review' && card.due <= now) due++;
  }
  const quota = Math.max(0, S().newPerDay - today().new);
  const fresh = Math.min(quota, newQueue().length);
  return { learn, due, fresh };
}

function activeEntries() {
  const on = new Set(dirsOn());
  return Object.entries(store.cards).filter(([k]) => { const [id, d] = splitKey(k); return on.has(d) && BY_ID.has(id); });
}

function nextCard(now = Date.now()) {
  const entries = activeEntries();
  const learning = entries.filter(([, c]) => c.state === 'learning' || c.state === 'relearning').sort((a, b) => a[1].due - b[1].due);
  const learnNow = learning.find(([, c]) => c.due <= now);
  if (learnNow) return learnNow[0];

  const reviews = entries.filter(([, c]) => c.state === 'review' && c.due <= now).sort((a, b) => a[1].due - b[1].due);
  const quota = S().newPerDay - today().new;
  const fresh = quota > 0 ? newQueue()[0] : null;

  if (fresh && (!reviews.length || session.sinceNew >= 3)) return fresh;
  if (reviews.length) return reviews[0][0];
  if (fresh) return fresh;

  const ahead = learning.find(([k, c]) => c.due <= now + LEARN_AHEAD && k !== session?.last);
  return ahead ? ahead[0] : null;
}

// ---------- rendering ----------

function setTitle(text, back = null) {
  const bar = $('.topbar');
  bar.innerHTML = `${back ? `<button class="back" data-back="${back}">‹ Back</button>` : ''}<h1>${esc(text)}</h1>`;
  const b = $('[data-back]', bar);
  if (b) b.onclick = () => go(b.dataset.back);
}

function go(name, extra = {}) {
  if (route.name === 'study' && name !== 'study') {
    session = null;
    window.speechSynthesis?.cancel();
  }
  route = { name, ...extra };
  document.body.classList.toggle('studying', name === 'study');
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === (name === 'lesson' ? 'lessons' : name));
  });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const v = $('#view');
  switch (route.name) {
    case 'home': return renderHome(v);
    case 'lessons': return renderLessons(v);
    case 'lesson': return renderLesson(v, route.l);
    case 'settings': return renderSettings(v);
    case 'study': return renderStudy(v);
  }
}

function lessonStats(l) {
  const ps = l == null ? DATA.phrases : DATA.phrases.filter((x) => x.l === l);
  const s = { total: ps.length, new: 0, learn: 0, young: 0, mature: 0 };
  for (const x of ps) s[phraseStatus(x.id)]++;
  return s;
}

function barHtml(s) {
  const pct = (n) => `${(100 * n / (s.total || 1)).toFixed(2)}%`;
  return `<div class="bar" role="img" aria-label="${s.mature} mature, ${s.young} young, ${s.learn} learning, ${s.new} new">
    <i class="mature" style="width:${pct(s.mature)}"></i><i class="young" style="width:${pct(s.young)}"></i><i class="learn" style="width:${pct(s.learn)}"></i></div>`;
}

const LEGEND = (s) => `<div class="legend"><span><i style="background:var(--st-mature)"></i>Mature${s ? ` ${s.mature}` : ''}</span><span><i style="background:var(--st-young)"></i>Young${s ? ` ${s.young}` : ''}</span><span><i style="background:var(--st-learn)"></i>Learning${s ? ` ${s.learn}` : ''}</span><span><i style="background:var(--st-new)"></i>New${s ? ` ${s.new}` : ''}</span></div>`;

function streak() {
  let n = 0;
  const d = new Date();
  if (!(store.days[dayKey(d.getTime())]?.rev)) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = dayKey(d.getTime());
    if (!store.days[k]?.rev) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

const lessonName = (l) => DATA.lessons.find((x) => x.l === l)?.t || `Lesson ${l}`;
const lessonShort = (l) => (l === 21 ? 'Culture' : `L${l}`);

function renderHome(v) {
  setTitle('日本語 Japanese 1');
  const c = counts();
  const total = c.learn + c.due + c.fresh;
  const started = activeEntries().filter(([, x]) => x.state !== 'new').length;
  const mature = activeEntries().filter(([, x]) => isMature(x)).length;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const on = dirsOn();
  const ls = S().lessons;
  const lessonsText = !ls.length ? 'none selected' : ls.length === DATA.lessons.length ? 'all lessons' : ls.map(lessonShort).join(', ');
  const all = lessonStats(null);

  v.innerHTML = `
    ${isIOS && !standalone ? `<div class="card install-hint"><b>Install on iPhone / iPad</b>
      <p class="small">Tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>. The app then works offline and opens full screen.</p></div>` : ''}
    <div class="card">
      <h2>Today</h2>
      <div class="counts">
        <div class="n-new"><b>${c.fresh}</b><span>New</span></div>
        <div class="n-learn"><b>${c.learn}</b><span>Learning</span></div>
        <div class="n-due"><b>${c.due}</b><span>To review</span></div>
      </div>
      <button class="btn primary block" id="study" ${total ? '' : 'disabled'}>${total ? 'Study now' : on.length ? 'All done for today 🎉' : 'Turn on a direction in Settings'}</button>
      <div class="dir-pills" role="group" aria-label="Test directions">${DIRS.map((d) => `<button data-dir="${d}" aria-pressed="${on.includes(d)}">${DIR_LABEL[d]}</button>`).join('')}</div>
      <p class="small muted" style="margin:10px 0 0">New phrases from: <b>${esc(lessonsText)}</b> · ${S().newPerDay} new cards/day.
        <a href="#" id="pick-lessons">Change</a></p>
    </div>
    <div class="card">
      <h2>Progress</h2>
      <div class="stats">
        <div><b>${started}</b><span>Cards started / ${DATA.phrases.length * on.length}</span></div>
        <div><b>${mature}</b><span>Mature (21d+)</span></div>
        <div><b>${streak()}</b><span>Day streak</span></div>
        <div><b>${today().rev}</b><span>Reviews today</span></div>
      </div>
      <div style="margin-top:12px">${barHtml(all)}</div>
      ${LEGEND(all)}
    </div>`;
  $('#study').onclick = () => startStudy();
  $('#pick-lessons').onclick = (e) => { e.preventDefault(); go('lessons'); };
  v.querySelectorAll('[data-dir]').forEach((b) => {
    b.onclick = () => {
      const set = new Set(S().dirs);
      set.has(b.dataset.dir) ? set.delete(b.dataset.dir) : set.add(b.dataset.dir);
      S().dirs = DIRS.filter((d) => set.has(d));
      save();
      render();
    };
  });
}

function renderLessons(v) {
  setTitle('Lessons');
  v.innerHTML = `
    <input class="search" id="q" type="search" placeholder="Search Japanese, romaji or English" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div id="search-results"></div>
    <div id="lesson-list">
      <div class="row small muted" style="margin-bottom:10px"><span>Switch on the lessons you want new phrases from. They're introduced in lesson order.</span></div>
      <div class="btn-row" style="margin:-2px 0 12px"><button class="btn" id="all-on">All on</button><button class="btn" id="all-off">All off</button></div>
      ${DATA.lessons.map(({ l, t }) => { const s = lessonStats(l); return `
        <div class="card level">
          <div class="badge">${l === 21 ? '文' : l}</div>
          <div class="name">${esc(t)}
            <div class="small muted">${s.total} phrases · ${s.new} new · ${s.learn + s.young} learning · ${s.mature} mature</div></div>
          <label class="toggle" title="Include in new cards"><input type="checkbox" data-lesson="${l}" ${S().lessons.includes(l) ? 'checked' : ''} aria-label="Learn ${esc(t)}"><span></span></label>
          <div class="bar-wrap" style="grid-column:2/4">${barHtml(s)}</div>
          <div style="grid-column:1/4;margin-top:6px"><button class="btn" data-open="${l}">Browse phrases</button></div>
        </div>`; }).join('')}
      ${LEGEND()}
    </div>`;

  v.querySelectorAll('[data-lesson]').forEach((el) => {
    el.onchange = () => {
      const l = Number(el.dataset.lesson);
      const set = new Set(S().lessons);
      el.checked ? set.add(l) : set.delete(l);
      S().lessons = [...set].sort((a, b) => a - b);
      save();
    };
  });
  const setAll = (on) => { S().lessons = on ? DATA.lessons.map((x) => x.l) : []; save(); render(); };
  $('#all-on').onclick = () => setAll(true);
  $('#all-off').onclick = () => setAll(false);
  v.querySelectorAll('[data-open]').forEach((el) => { el.onclick = () => go('lesson', { l: Number(el.dataset.open) }); });

  const q = $('#q');
  q.oninput = () => {
    const res = search(q.value);
    $('#lesson-list').hidden = !!q.value.trim();
    $('#search-results').innerHTML = q.value.trim()
      ? (res.length ? `<ul class="phrases">${res.slice(0, 80).map(rowHtml).join('')}</ul>` : '<p class="muted">No matches.</p>')
      : '';
  };
}

// Romaji typed without macrons still matches: ō = o, ou, oo; ū = u, uu.
const foldRomaji = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/o[ou]/g, 'o').replace(/uu/g, 'u').replace(/[^a-z]/g, '');

function search(raw) {
  const q = raw.trim();
  if (!q) return [];
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(q)) {
    const bare = q.replace(/\s+/g, '');
    return DATA.phrases.filter((x) => x.j.includes(bare) || kanaText(x).includes(bare));
  }
  const fr = foldRomaji(q);
  const word = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const scored = [];
  for (const x of DATA.phrases) {
    const r = foldRomaji(x.r);
    let score = 0;
    if (fr && r === fr) score = 3;
    else if (fr.length >= 2 && r.startsWith(fr)) score = 2.5;
    else if (fr.length >= 3 && r.includes(fr)) score = 2;
    if (!score && q.length >= 2 && word.test(x.e)) score = 1;
    if (score) scored.push([score, x]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((s) => s[1]);
}

function rowHtml(x) {
  const dots = dirsOn().map((d) => `<i class="dot s-${cardStatus(key(x.id, d))}" title="${DIR_LABEL[d]}: ${cardStatus(key(x.id, d))}"></i>`).join('');
  return `<li data-detail="${esc(x.id)}">
    <span class="grow"><span class="pj" lang="ja">${esc(mainText(x))}</span>
      ${S().showRomaji ? `<span class="pr">${esc(x.r)}</span>` : ''}
      <span class="pe">${esc(x.e)}</span></span>
    <span class="dots">${dots}</span>
    ${playBtn(x.id, 'sm')}</li>`;
}

function renderLesson(v, l) {
  setTitle(lessonName(l), 'lessons');
  const ps = DATA.phrases.filter((x) => x.l === l);
  const s = lessonStats(l);
  v.innerHTML = `
    <div class="card">${barHtml(s)}${LEGEND(s)}
      <p class="small muted" style="margin:8px 0 0">Dots show each test direction: ${dirsOn().map((d) => DIR_LABEL[d]).join(', ') || 'none on'}.</p></div>
    <ul class="phrases">${ps.map(rowHtml).join('')}</ul>`;
}

// The full answer: Japanese, kana reading, romaji, English and notes.
function answerHtml(x, { english = true } = {}) {
  const main = mainText(x);
  const kana = kanaLine(x);
  return `
    <div class="jp ${sizeClass(main)}" lang="ja" data-say="${esc(x.id)}">${esc(main)}</div>
    <div class="answer">
      ${kana ? `<div class="kana" lang="ja">${esc(kana)}</div>` : ''}
      ${S().showRomaji ? `<div class="romaji">${esc(x.r)}</div>` : ''}
      <div class="row" style="justify-content:center;margin:12px 0 4px">${playBtn(x.id)}</div>
      ${english ? `<div class="def">${esc(x.e)}</div>` : ''}
      ${x.n ? `<div class="note">${esc(x.n)}</div>` : ''}
      <div class="meta">${esc(lessonName(x.l))}</div>
    </div>`;
}

// ---------- detail sheet ----------

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-say]')) return;
  const b = e.target.closest('[data-detail]');
  if (b) showDetail(b.dataset.detail);
});

function showDetail(id) {
  const x = BY_ID.get(id);
  const on = dirsOn();
  const lines = on.map((d) => {
    const card = store.cards[key(id, d)];
    const status = cardStatus(key(id, d));
    const label = { new: 'not started', learn: 'learning', young: 'young', mature: 'mature' }[status];
    const next = card && card.state !== 'new'
      ? ` · next ${card.due <= Date.now() ? 'now' : `in ${formatDelay(card.due - Date.now())}`}${card.state === 'review' ? ` · ${card.ivl}d` : ''}` : '';
    return `<div><i class="dot s-${status}"></i> ${DIR_LABEL[d]}: ${label}${next}</div>`;
  }).join('');
  const anyStarted = DIRS.some((d) => store.cards[key(id, d)]);
  const allMature = on.length && on.every((d) => cardStatus(key(id, d)) === 'mature');
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-body">
    <button class="sheet-close" aria-label="Close">✕</button>
    ${answerHtml(x)}
    <div class="small muted dir-status">${lines}</div>
    <div class="btn-row" style="justify-content:center">
      ${allMature || !on.length ? '' : '<button class="btn" data-act="known">I know this</button>'}
      ${anyStarted ? '<button class="btn danger" data-act="reset">Reset</button>' : ''}
    </div></div>`;
  $('.sheet-close', sheet).onclick = () => sheet.close();
  sheet.onclick = (e) => { if (e.target === sheet) sheet.close(); };
  sheet.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.act === 'known') {
        const ivl = 30;
        for (const d of on) {
          const k = key(id, d);
          store.cards[k] = { ...newCard(), ...(store.cards[k] || {}), state: 'review', ivl, due: Date.now() + ivl * DAY, step: 0 };
        }
        toast('Marked as known');
      } else {
        for (const d of DIRS) delete store.cards[key(id, d)];
        toast('Reset');
      }
      save();
      sheet.close();
      render();
    };
  });
  if (!sheet.open) {
    lockScroll();
    sheet.showModal();
  }
}

let lockedY = null;
function lockScroll() {
  if (lockedY !== null) return;
  lockedY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', overflow: 'hidden' });
}
function unlockScroll() {
  if (lockedY === null) return;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', overflow: '' });
  window.scrollTo(0, lockedY);
  lockedY = null;
}
$('#sheet').addEventListener('close', unlockScroll);

// ---------- study ----------

function startStudy() {
  session = { current: null, revealed: false, sinceNew: 0, done: 0, undo: null };
  go('study');
}

function renderStudy(v) {
  setTitle('Study', 'home');
  if (!session) session = { current: null, revealed: false, sinceNew: 0, done: 0, undo: null };
  clearTimeout(session.wait);
  if (!session.current) {
    session.current = nextCard();
    session.revealed = false;
    session.shownAt = Date.now();
    session.speed = null;
    if (session.current) {
      const [id, dir] = splitKey(session.current);
      if (dir === 'l' || (dir === 'r' && S().autoplay === 'front')) sayPhrase(BY_ID.get(id));
    }
  }
  const c = counts();
  const head = `<div class="study-head">
      <span class="q"><b class="c-new">${c.fresh}</b> + <b class="c-learn">${c.learn}</b> + <b class="c-due">${c.due}</b></span>
      <span class="spacer"></span>
      <span>${session.done} done</span>
      ${session.undo ? '<button class="btn" id="undo" style="padding:4px 10px">↶ Undo</button>' : ''}
    </div>`;

  const waiting = !session.current && activeEntries().map(([, k]) => k)
    .filter((k) => (k.state === 'learning' || k.state === 'relearning') && k.due <= Date.now() + LEARN_AHEAD)
    .sort((a, b) => a.due - b.due)[0];
  if (waiting) {
    const ms = Math.max(0, waiting.due - Date.now());
    session.wait = setTimeout(() => { if (route.name === 'study') render(); }, ms + 500);
    v.innerHTML = `<div class="study">${head}<div class="done"><div class="big">⏳</div>
      <h2>Next card in ${formatDelay(ms)}</h2><p class="muted">The card you just answered comes back when it's due. Keep this screen open, or come back later.</p>
      <button class="btn primary" id="home">Back to Today</button></div></div>`;
    $('#home').onclick = () => go('home');
    bindUndo();
    return;
  }
  if (!session.current) {
    v.innerHTML = `<div class="study">${head}<div class="done"><div class="big">🎉</div>
      <h2>All caught up</h2><p class="muted">You studied ${session.done} card${session.done === 1 ? '' : 's'}. Come back later for more reviews, or switch on more lessons / raise the daily limit for more new phrases.</p>
      <button class="btn primary" id="home">Back to Today</button></div></div>`;
    $('#home').onclick = () => go('home');
    bindUndo();
    return;
  }

  const [id, dir] = splitKey(session.current);
  const x = BY_ID.get(id);
  const card = store.cards[session.current] || newCard();
  const isNew = card.state === 'new';
  const tag = `<div class="dir-tag">${isNew ? '✨ New · ' : ''}${DIR_LABEL[dir]}</div>`;
  let front;
  if (dir === 'p') {
    front = session.revealed
      ? `${tag}<div class="prompt-en">${esc(x.e)}</div>${answerHtml(x, { english: false })}`
      : `${tag}<div class="prompt-en big-en">${esc(x.e)}</div><div class="prompt small">How do you say it in Japanese?</div>`;
  } else if (dir === 'l') {
    front = session.revealed
      ? `${tag}${answerHtml(x)}`
      : `${tag}<div class="row" style="justify-content:center;margin:24px 0 8px">${playBtn(x.id, 'xl')}</div><div class="prompt">What does it mean?</div>`;
  } else {
    const main = mainText(x);
    const kana = S().frontReadings && kanaLine(x);
    front = session.revealed
      ? `${tag}${answerHtml(x)}`
      : `${tag}<div class="jp ${sizeClass(main)}" lang="ja">${esc(main)}</div>
        ${kana ? `<div class="kana" lang="ja">${esc(kana)}</div>` : ''}
        ${S().frontReadings && S().showRomaji ? `<div class="romaji">${esc(x.r)}</div>` : ''}
        <div class="row" style="justify-content:center;margin-top:12px">${playBtn(x.id, 'sm')}</div>
        <div class="prompt small">What does it mean?</div>`;
  }

  const prev = previewIntervals(card, Date.now(), session.speed);
  const hint = card.state === 'review' && session.revealed
    ? { [FAST]: ' · quick', [SLOW]: ' · slow' }[session.speed] || '' : '';
  const actions = session.revealed
    ? `<div class="ratings">
        <button class="wrong" data-rate="${WRONG}">✗ Wrong<small>${prev[WRONG]}</small></button>
        <button class="right" data-rate="${RIGHT}">✓ Right<small>${prev[RIGHT]}${hint}</small></button></div>`
    : '<button class="btn primary block" id="reveal">Show answer</button>';

  v.innerHTML = `<div class="study">${head}
    <div class="flash${session.revealed ? ' revealed' : ''}">${front}</div>
    <div class="actions">${actions}</div></div>`;

  const reveal = $('#reveal');
  if (reveal) {
    reveal.onclick = doReveal;
    const flash = $('.flash', v);
    flash.classList.add('tap');
    flash.onclick = (e) => { if (!e.target.closest('button') && !selecting()) doReveal(); };
  }
  v.querySelectorAll('[data-rate]').forEach((b) => { b.onclick = () => rate(Number(b.dataset.rate)); });
  bindUndo();
}

function bindUndo() {
  const u = $('#undo');
  if (!u) return;
  u.onclick = () => {
    const { k, prevCard, prevDay, prevSinceNew, speed } = session.undo;
    if (prevCard) store.cards[k] = prevCard; else delete store.cards[k];
    store.days[dayKey(Date.now())] = prevDay;
    session.sinceNew = prevSinceNew;
    session.done = Math.max(0, session.done - 1);
    session.undo = null;
    session.current = k;
    session.revealed = true;
    session.speed = speed;
    save();
    render();
  };
}

function doReveal() {
  if (session.revealed) return;
  const [id, dir] = splitKey(session.current);
  if (session.shownAt) {
    const ms = Date.now() - session.shownAt;
    session.speed = classifySpeed(ms, store.think[dir]);
    store.think[dir] = recordThink(store.think[dir], ms);
  }
  session.revealed = true;
  render();
  if (dir === 'p' ? S().autoplay !== 'off' : S().autoplay === 'reveal') sayPhrase(BY_ID.get(id));
}

function rate(r) {
  const k = session.current;
  const prevCard = store.cards[k];
  const card = prevCard || newCard();
  const day = today();
  session.undo = { k, prevCard, prevDay: { ...day }, prevSinceNew: session.sinceNew, speed: session.speed };
  if (card.state === 'new') { day.new++; session.sinceNew = 0; } else session.sinceNew++;
  day.rev++;
  store.cards[k] = schedule(card, r, Date.now(), Math.random, session.speed);
  save();
  session.done++;
  session.last = k;
  session.current = null;
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !session.revealed) session.shownAt = null;
});

document.addEventListener('keydown', (e) => {
  if (route.name !== 'study' || !session?.current || e.target.matches('input, select, textarea')) return;
  if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); doReveal(); }
  else if (session.revealed && ['1', 'ArrowLeft'].includes(e.key)) rate(WRONG);
  else if (session.revealed && ['2', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); rate(RIGHT); }
  else if (e.key === 'p') sayPhrase(BY_ID.get(splitKey(session.current)[0]));
});

// ---------- settings ----------

const toggle = (id, on) => `<span class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span>`;
const opt = (val, cur, label) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;

function renderSettings(v) {
  setTitle('Settings');
  const st = S();
  const voices = speech.list();
  const noJa = 'speechSynthesis' in window && speech.voices.length && !voices.length;
  v.innerHTML = `
    <div class="card"><h2>Study</h2>
      <div class="field"><label for="newPerDay">New cards per day<small>Each direction of a phrase is its own card</small></label>
        <input id="newPerDay" type="number" min="0" max="200" inputmode="numeric" value="${st.newPerDay}"></div>
      ${DIRS.map((d) => `<div class="field"><label for="dir-${d}">${DIR_LABEL[d]}<small>${{
        r: 'See the Japanese, recall the meaning',
        p: 'See the English, say it in Japanese',
        l: 'Hear it, recall the meaning',
      }[d]}</small></label>${toggle(`dir-${d}`, st.dirs.includes(d))}</div>`).join('')}
      <div class="field"><label for="autoplay">Play audio</label>
        <select id="autoplay">${opt('reveal', st.autoplay, 'When the answer shows')}${opt('front', st.autoplay, 'As soon as Japanese shows')}${opt('off', st.autoplay, 'Only when tapped')}</select></div>
    </div>
    <div class="card"><h2>Display</h2>
      <div class="field"><label for="script">Japanese script<small>Booklet style is all hiragana</small></label>
        <select id="script">${opt('kanji', st.script, 'Kanji &amp; kana')}${opt('kana', st.script, 'Hiragana (booklet)')}</select></div>
      <div class="field"><label for="showKana">Show hiragana reading<small>Under phrases written with kanji or katakana</small></label>${toggle('showKana', st.showKana)}</div>
      <div class="field"><label for="showRomaji">Show romaji</label>${toggle('showRomaji', st.showRomaji)}</div>
      <div class="field"><label for="frontReadings">Readings on the question side<small>Off: Japanese → English cards show only the Japanese script until you reveal</small></label>${toggle('frontReadings', st.frontReadings)}</div>
    </div>
    <div class="card"><h2>Voice</h2>
      <div class="field"><label for="voice">Japanese voice</label><select id="voice">${voices.length ? `<option value="">Automatic</option>${voices.map((vo) => `<option value="${esc(vo.voiceURI)}" ${vo.voiceURI === st.voice ? 'selected' : ''}>${esc(vo.name)}${speech.qualityLabel(vo) ? ` · ${speech.qualityLabel(vo)}` : ''}</option>`).join('')}` : '<option value="">System default</option>'}</select>
        <button class="speak sm" data-say="こんにちは。日本語を話します。" aria-label="Test voice">${PLAY_ICON}</button></div>
      <div class="field"><label for="rate">Speed <small>${st.rate.toFixed(2)}×</small></label><input id="rate" type="range" min="0.5" max="1.2" step="0.05" value="${st.rate}"></div>
      <p class="small muted">${noJa ? 'No Japanese voice found on this device. ' : ''}On iPhone/iPad, better voices (Kyoko, Otoya, Hattori…) can be downloaded under <b>Settings → Accessibility → Read &amp; Speak → Voices → Japanese</b> (older iOS: Spoken Content).</p>
    </div>
    <div class="card"><h2>Progress backup</h2>
      <p class="small muted">Progress is stored on this device only. Export a backup now and then.</p>
      <div class="btn-row">
        <button class="btn" id="export">Export backup</button>
        <label class="btn" for="import">Import backup</label>
        <input id="import" type="file" accept="application/json,.json" hidden>
        <button class="btn danger" id="reset">Reset all progress</button>
      </div>
    </div>
    <div class="card small"><h2>About</h2>
      <p>${DATA.phrases.length} words and phrases from the <b>Pimsleur Japanese 1</b> Reading Booklet (Lessons 1–20) and Culture Notes. Kanji forms, English meanings and romaji were added for this app; the booklet itself is hiragana only. Audio uses your device's Japanese voice.</p>
    </div>`;

  const num = $('#newPerDay');
  num.onchange = () => { st.newPerDay = Math.max(0, Math.min(200, parseInt(num.value, 10) || 0)); num.value = st.newPerDay; save(); };
  for (const id of ['autoplay', 'script', 'voice']) $(`#${id}`).onchange = (e) => { st[id] = e.target.value; save(); };
  for (const id of ['showKana', 'showRomaji', 'frontReadings']) $(`#${id}`).onchange = (e) => { st[id] = e.target.checked; save(); };
  for (const d of DIRS) {
    $(`#dir-${d}`).onchange = (e) => {
      const set = new Set(st.dirs);
      e.target.checked ? set.add(d) : set.delete(d);
      st.dirs = DIRS.filter((x) => set.has(x));
      save();
    };
  }
  $('#rate').oninput = (e) => { st.rate = Number(e.target.value); $('label[for=rate] small').textContent = `${st.rate.toFixed(2)}×`; };
  $('#rate').onchange = () => save();
  $('#export').onclick = exportBackup;
  $('#import').onchange = importBackup;
  $('#reset').onclick = () => {
    if (!confirm('Delete all progress on this device? This cannot be undone.')) return;
    store.cards = {};
    store.days = {};
    save();
    toast('Progress reset');
    render();
  };
}

async function exportBackup() {
  const json = JSON.stringify({ app: 'ja-srs', version: 1, exported: new Date().toISOString(), ...store });
  const name = `ja-srs-backup-${dayKey(Date.now())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'ja-srs' || typeof data.cards !== 'object') throw new Error('not a backup file');
    if (!confirm(`Replace current progress with this backup (${Object.keys(data.cards).length} cards)?`)) return;
    store = { cards: data.cards, days: data.days || {}, think: data.think || {}, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
    save();
    toast('Backup restored');
    render();
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// ---------- boot ----------

document.addEventListener('touchstart', () => {}, { passive: true });
document.querySelectorAll('.tabbar button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });

async function boot() {
  try {
    const res = await fetch('data/phrases.json');
    DATA = await res.json();
  } catch {
    $('#view').innerHTML = '<p class="loading">Could not load the phrase list. Check your connection and reload.</p>';
    return;
  }
  BY_ID = new Map(DATA.phrases.map((x) => [x.id, x]));
  render();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || route.name === 'study') return;
        reloaded = true;
        location.reload();
      });
    }
  }
}

boot();
